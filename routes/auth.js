const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { getDb, logAudit } = require('../db/database');

const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

// GET /auth/login
router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.render('auth/login', { title: 'Login', error: null, csrfToken: req.csrfToken() });
});

// POST /auth/login
router.post('/login', [
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required')
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.render('auth/login', {
      title: 'Login',
      error: errors.array()[0].msg,
      csrfToken: req.csrfToken()
    });
  }

  const db = getDb();
  const { email, password } = req.body;
  const user = db.prepare(`
    SELECT u.*, r.RoleName FROM Users u
    JOIN Roles r ON u.RoleId = r.RoleId
    WHERE u.Email = ?
  `).get(email);

  if (!user) {
    logAudit(null, 'LOGIN_FAILED', 'Auth', null, null, { email }, req.ip);
    return res.render('auth/login', {
      title: 'Login',
      error: 'Invalid email or password.',
      csrfToken: req.csrfToken()
    });
  }

  // Check lockout
  if (user.LockoutEnd) {
    const lockoutEnd = new Date(user.LockoutEnd);
    if (lockoutEnd > new Date()) {
      logAudit(user.UserId, 'LOGIN_LOCKED', 'Auth', user.UserId, null, { email }, req.ip);
      const remaining = Math.ceil((lockoutEnd - new Date()) / 60000);
      return res.render('auth/login', {
        title: 'Login',
        error: `Account locked. Try again in ${remaining} minute(s).`,
        csrfToken: req.csrfToken()
      });
    }
    // Lockout expired, reset
    db.prepare('UPDATE Users SET FailedLoginCount = 0, LockoutEnd = NULL WHERE UserId = ?').run(user.UserId);
    user.FailedLoginCount = 0;
    user.LockoutEnd = null;
  }

  if (!user.IsActive) {
    return res.render('auth/login', {
      title: 'Login',
      error: 'Account is deactivated. Contact an administrator.',
      csrfToken: req.csrfToken()
    });
  }

  if (!bcrypt.compareSync(password, user.PasswordHash)) {
    const newCount = user.FailedLoginCount + 1;
    if (newCount >= MAX_FAILED_ATTEMPTS) {
      const lockoutEnd = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString();
      db.prepare('UPDATE Users SET FailedLoginCount = ?, LockoutEnd = ? WHERE UserId = ?')
        .run(newCount, lockoutEnd, user.UserId);
      logAudit(user.UserId, 'ACCOUNT_LOCKED', 'Auth', user.UserId, null, { attempts: newCount }, req.ip);
      return res.render('auth/login', {
        title: 'Login',
        error: `Account locked for ${LOCKOUT_MINUTES} minutes after ${MAX_FAILED_ATTEMPTS} failed attempts.`,
        csrfToken: req.csrfToken()
      });
    }
    db.prepare('UPDATE Users SET FailedLoginCount = ? WHERE UserId = ?').run(newCount, user.UserId);
    logAudit(user.UserId, 'LOGIN_FAILED', 'Auth', user.UserId, null, { attempts: newCount }, req.ip);
    return res.render('auth/login', {
      title: 'Login',
      error: 'Invalid email or password.',
      csrfToken: req.csrfToken()
    });
  }

  // Success — reset failed count
  db.prepare('UPDATE Users SET FailedLoginCount = 0, LockoutEnd = NULL WHERE UserId = ?').run(user.UserId);

  req.session.user = {
    id: user.UserId,
    name: user.FullName,
    email: user.Email,
    role: user.RoleName,
    roleId: user.RoleId
  };

  logAudit(user.UserId, 'LOGIN_SUCCESS', 'Auth', user.UserId, null, null, req.ip);
  res.redirect('/dashboard');
});

// GET /auth/register
router.get('/register', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.render('auth/register', { title: 'Register', errors: [], old: {}, csrfToken: req.csrfToken() });
});

// POST /auth/register
router.post('/register', [
  body('fullName').trim().notEmpty().withMessage('Full Name is required')
    .isLength({ max: 100 }).withMessage('Full Name max 100 characters'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('password')
    .matches(PASSWORD_REGEX)
    .withMessage('Password must be at least 8 characters with uppercase, lowercase, and a digit'),
  body('confirmPassword').custom((val, { req }) => {
    if (val !== req.body.password) throw new Error('Passwords do not match');
    return true;
  })
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.render('auth/register', {
      title: 'Register',
      errors: errors.array(),
      old: req.body,
      csrfToken: req.csrfToken()
    });
  }

  const db = getDb();
  const { fullName, email, password } = req.body;

  const existing = db.prepare('SELECT UserId FROM Users WHERE Email = ?').get(email);
  if (existing) {
    return res.render('auth/register', {
      title: 'Register',
      errors: [{ msg: 'Email is already registered' }],
      old: req.body,
      csrfToken: req.csrfToken()
    });
  }

  const hash = bcrypt.hashSync(password, 10);
  const salesRole = db.prepare("SELECT RoleId FROM Roles WHERE RoleName = 'SalesExecutive'").get();

  const result = db.prepare(
    'INSERT INTO Users (FullName, Email, PasswordHash, RoleId) VALUES (?, ?, ?, ?)'
  ).run(fullName, email, hash, salesRole.RoleId);

  logAudit(result.lastInsertRowid, 'REGISTER', 'Auth', result.lastInsertRowid, null, { email }, req.ip);
  res.redirect('/auth/login');
});

// GET /auth/logout
router.get('/logout', (req, res) => {
  const userId = req.session.user ? req.session.user.id : null;
  if (userId) {
    logAudit(userId, 'LOGOUT', 'Auth', userId, null, null, req.ip);
  }
  req.session.destroy(() => {
    res.redirect('/auth/login');
  });
});

module.exports = router;

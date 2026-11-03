const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { getDb, logAudit } = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);
router.use(requireRole('Admin'));

// List users
router.get('/', (req, res) => {
  const db = getDb();
  const users = db.prepare(`
    SELECT u.UserId, u.FullName, u.Email, u.RoleId, u.IsActive,
           u.FailedLoginCount, u.LockoutEnd, u.CreatedDate, r.RoleName
    FROM Users u
    JOIN Roles r ON u.RoleId = r.RoleId
    ORDER BY u.UserId ASC
  `).all();

  res.render('users/index', {
    title: 'User Management',
    users,
    user: req.session.user,
    csrfToken: req.csrfToken()
  });
});

// Create user form
router.get('/create', (req, res) => {
  const db = getDb();
  const roles = db.prepare('SELECT * FROM Roles ORDER BY RoleId ASC').all();
  res.render('users/form', {
    title: 'Create User',
    targetUser: {},
    roles,
    errors: [],
    user: req.session.user,
    csrfToken: req.csrfToken()
  });
});

// Create user POST
router.post('/create', [
  body('FullName').trim().notEmpty().withMessage('Full Name is required').isLength({ max: 100 }),
  body('Email').isEmail().withMessage('Enter a valid email address'),
  body('Password')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/)
    .withMessage('Password must be at least 8 characters with uppercase, lowercase, and a digit'),
  body('RoleId').notEmpty().withMessage('Role is required')
], (req, res) => {
  const db = getDb();
  const errors = validationResult(req);

  const existing = db.prepare('SELECT UserId FROM Users WHERE Email = ?').get(req.body.Email);
  const extraErrors = [];
  if (existing) {
    extraErrors.push({ msg: 'Email is already registered' });
  }

  if (!errors.isEmpty() || extraErrors.length) {
    const roles = db.prepare('SELECT * FROM Roles ORDER BY RoleId ASC').all();
    return res.render('users/form', {
      title: 'Create User',
      targetUser: req.body,
      roles,
      errors: [...errors.array(), ...extraErrors],
      user: req.session.user,
      csrfToken: req.csrfToken()
    });
  }

  const hash = bcrypt.hashSync(req.body.Password, 10);
  const result = db.prepare(`
    INSERT INTO Users (FullName, Email, PasswordHash, RoleId, IsActive)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.body.FullName, req.body.Email, hash, req.body.RoleId, req.body.IsActive ? 1 : 1);

  logAudit(req.session.user.id, 'CREATE_USER', 'User', result.lastInsertRowid, null, { email: req.body.Email, roleId: req.body.RoleId }, req.ip);
  res.redirect('/users');
});

// Toggle Active / Unlock
router.post('/toggle-status/:id', (req, res) => {
  const db = getDb();
  const target = db.prepare('SELECT * FROM Users WHERE UserId = ?').get(req.params.id);
  if (!target) return res.redirect('/users');

  const newStatus = target.IsActive ? 0 : 1;
  db.prepare('UPDATE Users SET IsActive = ? WHERE UserId = ?').run(newStatus, target.UserId);
  logAudit(req.session.user.id, 'USER_STATUS_CHANGE', 'User', target.UserId, { isActive: target.IsActive }, { isActive: newStatus }, req.ip);
  res.redirect('/users');
});

router.post('/unlock/:id', (req, res) => {
  const db = getDb();
  db.prepare('UPDATE Users SET FailedLoginCount = 0, LockoutEnd = NULL WHERE UserId = ?').run(req.params.id);
  logAudit(req.session.user.id, 'USER_UNLOCK', 'User', req.params.id, null, { unlocked: true }, req.ip);
  res.redirect('/users');
});

module.exports = router;

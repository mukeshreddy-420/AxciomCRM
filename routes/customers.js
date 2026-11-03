const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { getDb, logAudit } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// Helper: scope query for SalesExecutive
function scopeWhere(user, alias) {
  if (user.role === 'SalesExecutive') return ` AND ${alias}.CreatedBy = ?`;
  return '';
}
function scopeParams(user) {
  return user.role === 'SalesExecutive' ? [user.id] : [];
}

// Generate next CustomerCode
function nextCode(db) {
  const last = db.prepare("SELECT CustomerCode FROM Customers ORDER BY CustomerId DESC LIMIT 1").get();
  if (!last) return 'CUST-001';
  const num = parseInt(last.CustomerCode.split('-')[1]) + 1;
  return 'CUST-' + String(num).padStart(3, '0');
}

// LIST
router.get('/', (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const { search, status } = req.query;
  let sql = `SELECT c.*, u.FullName as CreatedByName FROM Customers c
    LEFT JOIN Users u ON c.CreatedBy = u.UserId WHERE 1=1`;
  const params = [];

  if (user.role === 'SalesExecutive') {
    sql += ' AND c.CreatedBy = ?';
    params.push(user.id);
  }
  if (search) {
    sql += ' AND (c.CustomerName LIKE ? OR c.Email LIKE ? OR c.Phone LIKE ? OR c.CompanyName LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s, s);
  }
  if (status) {
    sql += ' AND c.Status = ?';
    params.push(status);
  }
  sql += ' ORDER BY c.CustomerId DESC';

  const customers = db.prepare(sql).all(...params);
  res.render('customers/list', {
    title: 'Customers',
    customers,
    user,
    search: search || '',
    status: status || '',
    csrfToken: req.csrfToken()
  });
});

// CREATE form
router.get('/create', (req, res) => {
  const db = getDb();
  const users = db.prepare("SELECT u.UserId, u.FullName FROM Users u WHERE u.IsActive = 1").all();
  res.render('customers/form', {
    title: 'Create Customer',
    customer: {},
    users,
    user: req.session.user,
    errors: [],
    csrfToken: req.csrfToken()
  });
});

// CREATE POST
router.post('/create', [
  body('CustomerName').trim().notEmpty().withMessage('Customer Name is required').isLength({ max: 100 }).withMessage('Max 100 characters'),
  body('Email').isEmail().withMessage('Enter a valid email address'),
  body('Phone').matches(/^\d{10}$/).withMessage('Enter a valid 10-digit phone number'),
  body('CompanyName').optional({ checkFalsy: true }).isLength({ max: 100 }).withMessage('Max 100 characters'),
  body('Address').optional({ checkFalsy: true }).isLength({ max: 200 }).withMessage('Max 200 characters'),
  body('City').optional({ checkFalsy: true }).isLength({ max: 50 }).withMessage('Max 50 characters'),
  body('State').optional({ checkFalsy: true }).isLength({ max: 50 }).withMessage('Max 50 characters')
], (req, res) => {
  const errors = validationResult(req);
  const db = getDb();
  const user = req.session.user;

  if (!errors.isEmpty()) {
    const users = db.prepare("SELECT u.UserId, u.FullName FROM Users u WHERE u.IsActive = 1").all();
    return res.render('customers/form', {
      title: 'Create Customer',
      customer: req.body,
      users,
      user,
      errors: errors.array(),
      csrfToken: req.csrfToken()
    });
  }

  // Uniqueness checks
  const dupEmail = db.prepare('SELECT CustomerId FROM Customers WHERE Email = ?').get(req.body.Email);
  const dupPhone = db.prepare('SELECT CustomerId FROM Customers WHERE Phone = ?').get(req.body.Phone);
  const errs = [];
  if (dupEmail) errs.push({ msg: 'A customer with this email already exists' });
  if (dupPhone) errs.push({ msg: 'A customer with this phone already exists' });
  if (errs.length) {
    const users = db.prepare("SELECT u.UserId, u.FullName FROM Users u WHERE u.IsActive = 1").all();
    return res.render('customers/form', {
      title: 'Create Customer',
      customer: req.body,
      users,
      user,
      errors: errs,
      csrfToken: req.csrfToken()
    });
  }

  const code = nextCode(db);
  const result = db.prepare(`
    INSERT INTO Customers (CustomerCode, CustomerName, Email, Phone, CompanyName, Address, City, State, Status, CreatedBy)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Active', ?)
  `).run(code, req.body.CustomerName, req.body.Email, req.body.Phone,
    req.body.CompanyName || null, req.body.Address || null, req.body.City || null, req.body.State || null, user.id);

  logAudit(user.id, 'CREATE', 'Customer', result.lastInsertRowid, null, req.body, req.ip);
  res.redirect('/customers');
});

// EDIT form
router.get('/edit/:id', (req, res) => {
  const db = getDb();
  const user = req.session.user;
  let customer = db.prepare('SELECT * FROM Customers WHERE CustomerId = ?').get(req.params.id);
  if (!customer) return res.status(404).render('error', { title: 'Not Found', message: 'Customer not found', user });
  if (user.role === 'SalesExecutive' && customer.CreatedBy !== user.id) {
    return res.status(403).render('error', { title: 'Access Denied', message: 'You cannot edit this customer.', user });
  }
  const users = db.prepare("SELECT u.UserId, u.FullName FROM Users u WHERE u.IsActive = 1").all();
  res.render('customers/form', {
    title: 'Edit Customer',
    customer,
    users,
    user,
    errors: [],
    csrfToken: req.csrfToken()
  });
});

// EDIT POST
router.post('/edit/:id', [
  body('CustomerName').trim().notEmpty().withMessage('Customer Name is required').isLength({ max: 100 }).withMessage('Max 100 characters'),
  body('Email').isEmail().withMessage('Enter a valid email address'),
  body('Phone').matches(/^\d{10}$/).withMessage('Enter a valid 10-digit phone number'),
  body('CompanyName').optional({ checkFalsy: true }).isLength({ max: 100 }),
  body('Address').optional({ checkFalsy: true }).isLength({ max: 200 }),
  body('City').optional({ checkFalsy: true }).isLength({ max: 50 }),
  body('State').optional({ checkFalsy: true }).isLength({ max: 50 })
], (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const old = db.prepare('SELECT * FROM Customers WHERE CustomerId = ?').get(req.params.id);
  if (!old) return res.status(404).render('error', { title: 'Not Found', message: 'Customer not found', user });
  if (user.role === 'SalesExecutive' && old.CreatedBy !== user.id) {
    return res.status(403).render('error', { title: 'Access Denied', message: 'You cannot edit this customer.', user });
  }

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const users = db.prepare("SELECT u.UserId, u.FullName FROM Users u WHERE u.IsActive = 1").all();
    return res.render('customers/form', {
      title: 'Edit Customer',
      customer: { ...old, ...req.body },
      users,
      user,
      errors: errors.array(),
      csrfToken: req.csrfToken()
    });
  }

  // Uniqueness (exclude self)
  const dupEmail = db.prepare('SELECT CustomerId FROM Customers WHERE Email = ? AND CustomerId != ?').get(req.body.Email, req.params.id);
  const dupPhone = db.prepare('SELECT CustomerId FROM Customers WHERE Phone = ? AND CustomerId != ?').get(req.body.Phone, req.params.id);
  const errs = [];
  if (dupEmail) errs.push({ msg: 'A customer with this email already exists' });
  if (dupPhone) errs.push({ msg: 'A customer with this phone already exists' });
  if (errs.length) {
    const users = db.prepare("SELECT u.UserId, u.FullName FROM Users u WHERE u.IsActive = 1").all();
    return res.render('customers/form', {
      title: 'Edit Customer',
      customer: { ...old, ...req.body },
      users,
      user,
      errors: errs,
      csrfToken: req.csrfToken()
    });
  }

  db.prepare(`
    UPDATE Customers SET CustomerName=?, Email=?, Phone=?, CompanyName=?, Address=?, City=?, State=?, Status=?, ModifiedDate=datetime('now')
    WHERE CustomerId=?
  `).run(req.body.CustomerName, req.body.Email, req.body.Phone,
    req.body.CompanyName || null, req.body.Address || null, req.body.City || null, req.body.State || null,
    req.body.Status || 'Active', req.params.id);

  logAudit(user.id, 'UPDATE', 'Customer', req.params.id, old, req.body, req.ip);
  res.redirect('/customers');
});

// DELETE
router.post('/delete/:id', (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const old = db.prepare('SELECT * FROM Customers WHERE CustomerId = ?').get(req.params.id);
  if (!old) return res.status(404).render('error', { title: 'Not Found', message: 'Customer not found', user });
  if (user.role === 'SalesExecutive' && old.CreatedBy !== user.id) {
    return res.status(403).render('error', { title: 'Access Denied', message: 'You cannot delete this customer.', user });
  }
  db.prepare('DELETE FROM Customers WHERE CustomerId = ?').run(req.params.id);
  logAudit(user.id, 'DELETE', 'Customer', req.params.id, old, null, req.ip);
  res.redirect('/customers');
});

module.exports = router;

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { getDb, logAudit } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

// All API endpoints require session authentication
router.use(requireAuth);

function nextCustomerCode(db) {
  const last = db.prepare("SELECT CustomerCode FROM Customers ORDER BY CustomerId DESC LIMIT 1").get();
  if (!last) return 'CUST-001';
  const num = parseInt(last.CustomerCode.split('-')[1]) + 1;
  return 'CUST-' + String(num).padStart(3, '0');
}

function nextLeadCode(db) {
  const last = db.prepare("SELECT LeadCode FROM Leads ORDER BY LeadId DESC LIMIT 1").get();
  if (!last) return 'LEAD-001';
  const num = parseInt(last.LeadCode.split('-')[1]) + 1;
  return 'LEAD-' + String(num).padStart(3, '0');
}

// -------------------------------------------------------------
// CUSTOMERS API
// -------------------------------------------------------------

// GET /api/customers
router.get('/customers', (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const isSales = user.role === 'SalesExecutive';
  const { search, status } = req.query;

  let sql = `
    SELECT c.CustomerId, c.CustomerCode, c.CustomerName, c.Email, c.Phone,
           c.CompanyName, c.Address, c.City, c.State, c.Status, c.CreatedDate,
           c.ModifiedDate, c.CreatedBy, u.FullName as CreatedByName
    FROM Customers c
    LEFT JOIN Users u ON c.CreatedBy = u.UserId
    WHERE 1=1
  `;
  const params = [];

  if (isSales) {
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

  const rows = db.prepare(sql).all(...params);
  return res.status(200).json(rows);
});

// GET /api/customers/:id
router.get('/customers/:id', (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const isSales = user.role === 'SalesExecutive';

  const customer = db.prepare(`
    SELECT c.CustomerId, c.CustomerCode, c.CustomerName, c.Email, c.Phone,
           c.CompanyName, c.Address, c.City, c.State, c.Status, c.CreatedDate,
           c.ModifiedDate, c.CreatedBy, u.FullName as CreatedByName
    FROM Customers c
    LEFT JOIN Users u ON c.CreatedBy = u.UserId
    WHERE c.CustomerId = ?
  `).get(req.params.id);

  if (!customer) {
    return res.status(404).json({ error: 'Customer not found' });
  }

  if (isSales && customer.CreatedBy !== user.id) {
    return res.status(403).json({ error: 'Access denied to this customer record' });
  }

  return res.status(200).json(customer);
});

// POST /api/customers
router.post('/customers', [
  body('CustomerName').trim().notEmpty().withMessage('Customer Name is required').isLength({ max: 100 }).withMessage('Customer Name max 100 characters'),
  body('Email').isEmail().withMessage('Enter a valid email address'),
  body('Phone').matches(/^\d{10}$/).withMessage('Enter a valid 10-digit phone number'),
  body('CompanyName').optional({ checkFalsy: true }).isLength({ max: 100 }).withMessage('Company Name max 100 characters'),
  body('Address').optional({ checkFalsy: true }).isLength({ max: 200 }).withMessage('Address max 200 characters'),
  body('City').optional({ checkFalsy: true }).isLength({ max: 50 }).withMessage('City max 50 characters'),
  body('State').optional({ checkFalsy: true }).isLength({ max: 50 }).withMessage('State max 50 characters')
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const db = getDb();
  const user = req.session.user;

  // Uniqueness checks
  const dupEmail = db.prepare('SELECT CustomerId FROM Customers WHERE Email = ?').get(req.body.Email);
  if (dupEmail) {
    return res.status(400).json({ error: 'A customer with this email already exists' });
  }
  const dupPhone = db.prepare('SELECT CustomerId FROM Customers WHERE Phone = ?').get(req.body.Phone);
  if (dupPhone) {
    return res.status(400).json({ error: 'A customer with this phone already exists' });
  }

  const code = nextCustomerCode(db);
  const result = db.prepare(`
    INSERT INTO Customers (CustomerCode, CustomerName, Email, Phone, CompanyName, Address, City, State, Status, CreatedBy)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Active', ?)
  `).run(
    code,
    req.body.CustomerName,
    req.body.Email,
    req.body.Phone,
    req.body.CompanyName || null,
    req.body.Address || null,
    req.body.City || null,
    req.body.State || null,
    user.id
  );

  const newCustomer = db.prepare('SELECT * FROM Customers WHERE CustomerId = ?').get(result.lastInsertRowid);
  logAudit(user.id, 'CREATE_API', 'Customer', result.lastInsertRowid, null, newCustomer, req.ip);

  return res.status(201).json(newCustomer);
});

// PUT /api/customers/:id
router.put('/customers/:id', [
  body('CustomerName').trim().notEmpty().withMessage('Customer Name is required').isLength({ max: 100 }).withMessage('Customer Name max 100 characters'),
  body('Email').isEmail().withMessage('Enter a valid email address'),
  body('Phone').matches(/^\d{10}$/).withMessage('Enter a valid 10-digit phone number'),
  body('CompanyName').optional({ checkFalsy: true }).isLength({ max: 100 }),
  body('Address').optional({ checkFalsy: true }).isLength({ max: 200 }),
  body('City').optional({ checkFalsy: true }).isLength({ max: 50 }),
  body('State').optional({ checkFalsy: true }).isLength({ max: 50 }),
  body('Status').optional().isIn(['Active', 'Inactive']).withMessage('Status must be Active or Inactive')
], (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const isSales = user.role === 'SalesExecutive';

  const old = db.prepare('SELECT * FROM Customers WHERE CustomerId = ?').get(req.params.id);
  if (!old) {
    return res.status(404).json({ error: 'Customer not found' });
  }

  if (isSales && old.CreatedBy !== user.id) {
    return res.status(403).json({ error: 'Access denied to update this customer' });
  }

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  // Duplicate email / phone checks excluding current
  const dupEmail = db.prepare('SELECT CustomerId FROM Customers WHERE Email = ? AND CustomerId != ?').get(req.body.Email, req.params.id);
  if (dupEmail) {
    return res.status(400).json({ error: 'A customer with this email already exists' });
  }
  const dupPhone = db.prepare('SELECT CustomerId FROM Customers WHERE Phone = ? AND CustomerId != ?').get(req.body.Phone, req.params.id);
  if (dupPhone) {
    return res.status(400).json({ error: 'A customer with this phone already exists' });
  }

  db.prepare(`
    UPDATE Customers
    SET CustomerName = ?, Email = ?, Phone = ?, CompanyName = ?, Address = ?,
        City = ?, State = ?, Status = ?, ModifiedDate = datetime('now')
    WHERE CustomerId = ?
  `).run(
    req.body.CustomerName,
    req.body.Email,
    req.body.Phone,
    req.body.CompanyName || null,
    req.body.Address || null,
    req.body.City || null,
    req.body.State || null,
    req.body.Status || old.Status,
    req.params.id
  );

  const updated = db.prepare('SELECT * FROM Customers WHERE CustomerId = ?').get(req.params.id);
  logAudit(user.id, 'UPDATE_API', 'Customer', req.params.id, old, updated, req.ip);

  return res.status(200).json(updated);
});

// DELETE /api/customers/:id
router.delete('/customers/:id', (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const isSales = user.role === 'SalesExecutive';

  const old = db.prepare('SELECT * FROM Customers WHERE CustomerId = ?').get(req.params.id);
  if (!old) {
    return res.status(404).json({ error: 'Customer not found' });
  }

  if (isSales && old.CreatedBy !== user.id) {
    return res.status(403).json({ error: 'Access denied to delete this customer' });
  }

  db.prepare('DELETE FROM Customers WHERE CustomerId = ?').run(req.params.id);
  logAudit(user.id, 'DELETE_API', 'Customer', req.params.id, old, null, req.ip);

  return res.status(200).json({ message: 'Customer deleted successfully' });
});

// -------------------------------------------------------------
// LEADS API
// -------------------------------------------------------------

const VALID_STATUSES = ['New', 'Contacted', 'Qualified', 'Unqualified', 'Converted', 'Lost'];

// GET /api/leads
router.get('/leads', (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const isSales = user.role === 'SalesExecutive';
  const { search, status } = req.query;

  let sql = `
    SELECT l.LeadId, l.LeadCode, l.LeadName, l.Email, l.Phone, l.CompanyName,
           l.Source, l.Status, l.Priority, l.ExpectedValue, l.Notes, l.CreatedDate,
           l.AssignedTo, u.FullName as AssignedName
    FROM Leads l
    LEFT JOIN Users u ON l.AssignedTo = u.UserId
    WHERE 1=1
  `;
  const params = [];

  if (isSales) {
    sql += ' AND l.AssignedTo = ?';
    params.push(user.id);
  }
  if (search) {
    sql += ' AND (l.LeadName LIKE ? OR l.CompanyName LIKE ? OR l.Email LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s);
  }
  if (status) {
    sql += ' AND l.Status = ?';
    params.push(status);
  }
  sql += ' ORDER BY l.LeadId DESC';

  const rows = db.prepare(sql).all(...params);
  return res.status(200).json(rows);
});

// POST /api/leads
router.post('/leads', [
  body('LeadName').trim().notEmpty().withMessage('Lead Name is required').isLength({ max: 100 }).withMessage('Lead Name max 100 characters'),
  body('Email').isEmail().withMessage('Enter a valid email address'),
  body('Phone').matches(/^\d{10}$/).withMessage('Enter a valid 10-digit phone number'),
  body('Source').notEmpty().withMessage('Source is required'),
  body('Status').optional().isIn(VALID_STATUSES).withMessage('Invalid lead status'),
  body('ExpectedValue').optional({ checkFalsy: true }).isFloat({ min: 0 }).withMessage('Expected value must be >= 0'),
  body('AssignedTo').notEmpty().withMessage('AssignedTo user is required')
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const db = getDb();
  const user = req.session.user;

  // Verify AssignedTo user exists
  const assigned = db.prepare('SELECT UserId FROM Users WHERE UserId = ?').get(req.body.AssignedTo);
  if (!assigned) {
    return res.status(400).json({ error: 'Assigned user does not exist' });
  }

  const code = nextLeadCode(db);
  const result = db.prepare(`
    INSERT INTO Leads (LeadCode, LeadName, Email, Phone, CompanyName, Source, Status, Priority, ExpectedValue, Notes, AssignedTo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    code,
    req.body.LeadName,
    req.body.Email,
    req.body.Phone,
    req.body.CompanyName || null,
    req.body.Source,
    req.body.Status || 'New',
    req.body.Priority || 'Medium',
    req.body.ExpectedValue || 0,
    req.body.Notes || null,
    req.body.AssignedTo
  );

  const newLead = db.prepare('SELECT * FROM Leads WHERE LeadId = ?').get(result.lastInsertRowid);
  logAudit(user.id, 'CREATE_API', 'Lead', result.lastInsertRowid, null, newLead, req.ip);

  return res.status(201).json(newLead);
});

// -------------------------------------------------------------
// OPPORTUNITIES API
// -------------------------------------------------------------

const STAGES = ['Qualification', 'Proposal', 'Negotiation', 'Won', 'Lost'];

// GET /api/opportunities
router.get('/opportunities', (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const isSales = user.role === 'SalesExecutive';
  const { search, stage } = req.query;

  let sql = `
    SELECT o.OpportunityId, o.OpportunityName, o.CustomerId, o.LeadId, o.Amount,
           o.Stage, o.Probability, o.ExpectedCloseDate, o.Status, o.Notes,
           o.CreatedDate, o.ModifiedDate, o.AssignedTo,
           c.CustomerName, u.FullName as AssignedName
    FROM Opportunities o
    LEFT JOIN Customers c ON o.CustomerId = c.CustomerId
    LEFT JOIN Users u ON o.AssignedTo = u.UserId
    WHERE 1=1
  `;
  const params = [];

  if (isSales) {
    sql += ' AND o.AssignedTo = ?';
    params.push(user.id);
  }
  if (search) {
    sql += ' AND (o.OpportunityName LIKE ? OR c.CustomerName LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s);
  }
  if (stage) {
    sql += ' AND o.Stage = ?';
    params.push(stage);
  }
  sql += ' ORDER BY o.OpportunityId DESC';

  const rows = db.prepare(sql).all(...params);
  return res.status(200).json(rows);
});

// POST /api/opportunities
router.post('/opportunities', [
  body('OpportunityName').trim().notEmpty().withMessage('Opportunity Name is required').isLength({ max: 150 }).withMessage('Max 150 characters'),
  body('Amount').isFloat({ gt: 0 }).withMessage('Amount must be greater than 0'),
  body('Probability').isFloat({ min: 0, max: 100 }).withMessage('Probability must be between 0 and 100'),
  body('ExpectedCloseDate').notEmpty().withMessage('Expected Close Date is required'),
  body('Stage').isIn(STAGES).withMessage('Invalid stage'),
  body('AssignedTo').notEmpty().withMessage('Assigned user is required')
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  // Business validation: ExpectedCloseDate not in past for active opp
  if (req.body.Stage !== 'Won' && req.body.Stage !== 'Lost') {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (new Date(req.body.ExpectedCloseDate) < today) {
      return res.status(400).json({ error: 'Expected Close Date cannot be in the past' });
    }
  }

  const db = getDb();
  const user = req.session.user;

  // Verify AssignedTo user
  const assigned = db.prepare('SELECT UserId FROM Users WHERE UserId = ?').get(req.body.AssignedTo);
  if (!assigned) {
    return res.status(400).json({ error: 'Assigned user does not exist' });
  }

  const result = db.prepare(`
    INSERT INTO Opportunities (OpportunityName, CustomerId, LeadId, Amount, Stage, Probability, ExpectedCloseDate, Status, Notes, AssignedTo)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'Open', ?, ?)
  `).run(
    req.body.OpportunityName,
    req.body.CustomerId || null,
    req.body.LeadId || null,
    req.body.Amount,
    req.body.Stage,
    req.body.Probability,
    req.body.ExpectedCloseDate,
    req.body.Notes || null,
    req.body.AssignedTo
  );

  const newOpp = db.prepare('SELECT * FROM Opportunities WHERE OpportunityId = ?').get(result.lastInsertRowid);
  logAudit(user.id, 'CREATE_API', 'Opportunity', result.lastInsertRowid, null, newOpp, req.ip);

  return res.status(201).json(newOpp);
});

module.exports = router;

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { getDb, logAudit } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

const VALID_STATUSES = ['New', 'Contacted', 'Qualified', 'Unqualified', 'Converted', 'Lost'];
const VALID_TRANSITIONS = {
  'New': ['Contacted', 'Unqualified', 'Lost'],
  'Contacted': ['Qualified', 'Unqualified', 'Lost'],
  'Qualified': ['Converted', 'Lost'],
  'Unqualified': ['New', 'Lost'],
  'Converted': [],
  'Lost': []
};

function nextLeadCode(db) {
  const last = db.prepare("SELECT LeadCode FROM Leads ORDER BY LeadId DESC LIMIT 1").get();
  if (!last) return 'LEAD-001';
  const num = parseInt(last.LeadCode.split('-')[1]) + 1;
  return 'LEAD-' + String(num).padStart(3, '0');
}

// LIST
router.get('/', (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const { search, status } = req.query;
  let sql = `SELECT l.*, u.FullName as AssignedName FROM Leads l
    LEFT JOIN Users u ON l.AssignedTo = u.UserId WHERE 1=1`;
  const params = [];

  if (user.role === 'SalesExecutive') { sql += ' AND l.AssignedTo = ?'; params.push(user.id); }
  if (search) {
    sql += ' AND (l.LeadName LIKE ? OR l.CompanyName LIKE ? OR l.Email LIKE ?)';
    const s = `%${search}%`; params.push(s, s, s);
  }
  if (status) { sql += ' AND l.Status = ?'; params.push(status); }
  sql += ' ORDER BY l.LeadId DESC';

  const leads = db.prepare(sql).all(...params);
  res.render('leads/list', { title: 'Leads', leads, user, search: search || '', status: status || '', csrfToken: req.csrfToken(), VALID_STATUSES });
});

// CREATE form
router.get('/create', (req, res) => {
  const db = getDb();
  const users = db.prepare("SELECT u.UserId, u.FullName FROM Users u WHERE u.IsActive = 1").all();
  res.render('leads/form', { title: 'Create Lead', lead: {}, users, user: req.session.user, errors: [], csrfToken: req.csrfToken(), isEdit: false });
});

// CREATE POST
router.post('/create', [
  body('LeadName').trim().notEmpty().withMessage('Lead Name is required').isLength({ max: 100 }).withMessage('Max 100 characters'),
  body('Email').isEmail().withMessage('Enter a valid email address'),
  body('Phone').matches(/^\d{10}$/).withMessage('Enter a valid 10-digit phone number'),
  body('Source').notEmpty().withMessage('Source is required'),
  body('Status').isIn(VALID_STATUSES).withMessage('Invalid status'),
  body('ExpectedValue').optional({ checkFalsy: true }).isFloat({ min: 0 }).withMessage('Expected value must be >= 0'),
  body('AssignedTo').notEmpty().withMessage('Assigned user is required')
], (req, res) => {
  const errors = validationResult(req);
  const db = getDb();
  const user = req.session.user;

  if (!errors.isEmpty()) {
    const users = db.prepare("SELECT u.UserId, u.FullName FROM Users u WHERE u.IsActive = 1").all();
    return res.render('leads/form', { title: 'Create Lead', lead: req.body, users, user, errors: errors.array(), csrfToken: req.csrfToken(), isEdit: false });
  }

  const code = nextLeadCode(db);
  const result = db.prepare(`
    INSERT INTO Leads (LeadCode, LeadName, Email, Phone, CompanyName, Source, Status, Priority, ExpectedValue, Notes, AssignedTo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(code, req.body.LeadName, req.body.Email, req.body.Phone, req.body.CompanyName || null,
    req.body.Source, req.body.Status || 'New', req.body.Priority || 'Medium',
    req.body.ExpectedValue || 0, req.body.Notes || null, req.body.AssignedTo);

  logAudit(user.id, 'CREATE', 'Lead', result.lastInsertRowid, null, req.body, req.ip);
  res.redirect('/leads');
});

// EDIT form
router.get('/edit/:id', (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const lead = db.prepare('SELECT * FROM Leads WHERE LeadId = ?').get(req.params.id);
  if (!lead) return res.status(404).render('error', { title: 'Not Found', message: 'Lead not found', user });
  if (user.role === 'SalesExecutive' && lead.AssignedTo !== user.id) {
    return res.status(403).render('error', { title: 'Access Denied', message: 'Not your lead', user });
  }
  const users = db.prepare("SELECT u.UserId, u.FullName FROM Users u WHERE u.IsActive = 1").all();
  const allowedStatuses = VALID_TRANSITIONS[lead.Status] || [];
  res.render('leads/form', { title: 'Edit Lead', lead, users, user, errors: [], csrfToken: req.csrfToken(), isEdit: true, allowedStatuses, currentStatus: lead.Status });
});

// EDIT POST
router.post('/edit/:id', [
  body('LeadName').trim().notEmpty().withMessage('Lead Name is required').isLength({ max: 100 }),
  body('Email').isEmail().withMessage('Enter a valid email address'),
  body('Phone').matches(/^\d{10}$/).withMessage('Enter a valid 10-digit phone number'),
  body('Source').notEmpty().withMessage('Source is required'),
  body('ExpectedValue').optional({ checkFalsy: true }).isFloat({ min: 0 }).withMessage('Expected value must be >= 0'),
  body('AssignedTo').notEmpty().withMessage('Assigned user is required')
], (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const old = db.prepare('SELECT * FROM Leads WHERE LeadId = ?').get(req.params.id);
  if (!old) return res.status(404).render('error', { title: 'Not Found', message: 'Lead not found', user });
  if (user.role === 'SalesExecutive' && old.AssignedTo !== user.id) {
    return res.status(403).render('error', { title: 'Access Denied', message: 'Not your lead', user });
  }

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const users = db.prepare("SELECT u.UserId, u.FullName FROM Users u WHERE u.IsActive = 1").all();
    const allowedStatuses = VALID_TRANSITIONS[old.Status] || [];
    return res.render('leads/form', { title: 'Edit Lead', lead: { ...old, ...req.body }, users, user, errors: errors.array(), csrfToken: req.csrfToken(), isEdit: true, allowedStatuses, currentStatus: old.Status });
  }

  // Validate status transition
  const newStatus = req.body.Status || old.Status;
  if (newStatus !== old.Status) {
    const allowed = VALID_TRANSITIONS[old.Status] || [];
    if (!allowed.includes(newStatus)) {
      const users = db.prepare("SELECT u.UserId, u.FullName FROM Users u WHERE u.IsActive = 1").all();
      return res.render('leads/form', {
        title: 'Edit Lead', lead: { ...old, ...req.body }, users, user,
        errors: [{ msg: `Cannot transition from ${old.Status} to ${newStatus}` }],
        csrfToken: req.csrfToken(), isEdit: true, allowedStatuses: allowed, currentStatus: old.Status
      });
    }
  }

  db.prepare(`
    UPDATE Leads SET LeadName=?, Email=?, Phone=?, CompanyName=?, Source=?, Status=?, Priority=?, ExpectedValue=?, Notes=?, AssignedTo=?
    WHERE LeadId=?
  `).run(req.body.LeadName, req.body.Email, req.body.Phone, req.body.CompanyName || null,
    req.body.Source, newStatus, req.body.Priority || 'Medium',
    req.body.ExpectedValue || 0, req.body.Notes || null, req.body.AssignedTo, req.params.id);

  logAudit(user.id, 'UPDATE', 'Lead', req.params.id, old, req.body, req.ip);
  res.redirect('/leads');
});

// CONVERT lead to customer + opportunity
router.post('/convert/:id', (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const lead = db.prepare('SELECT * FROM Leads WHERE LeadId = ?').get(req.params.id);
  if (!lead) return res.status(404).render('error', { title: 'Not Found', message: 'Lead not found', user });
  if (user.role === 'SalesExecutive' && lead.AssignedTo !== user.id) {
    return res.status(403).render('error', { title: 'Access Denied', message: 'Not your lead', user });
  }
  if (lead.Status === 'Converted') return res.redirect('/leads');
  if (!VALID_TRANSITIONS[lead.Status].includes('Converted') && lead.Status !== 'Qualified') {
    return res.status(400).render('error', { title: 'Invalid', message: 'Lead must be Qualified to convert', user });
  }

  // Check if customer email or phone already exists
  const existingCust = db.prepare('SELECT CustomerId FROM Customers WHERE Email = ? OR Phone = ?').get(lead.Email, lead.Phone);
  let customerId;
  if (existingCust) {
    customerId = existingCust.CustomerId;
  } else {
    // Create customer
    const lastCust = db.prepare("SELECT CustomerCode FROM Customers ORDER BY CustomerId DESC LIMIT 1").get();
    let custCode = 'CUST-001';
    if (lastCust) { custCode = 'CUST-' + String(parseInt(lastCust.CustomerCode.split('-')[1]) + 1).padStart(3, '0'); }

    const custResult = db.prepare(`
      INSERT INTO Customers (CustomerCode, CustomerName, Email, Phone, CompanyName, Status, CreatedBy)
      VALUES (?, ?, ?, ?, ?, 'Active', ?)
    `).run(custCode, lead.LeadName, lead.Email, lead.Phone, lead.CompanyName || null, user.id);
    customerId = custResult.lastInsertRowid;
    logAudit(user.id, 'CREATE', 'Customer', customerId, null, { source: 'LeadConversion', leadId: lead.LeadId }, req.ip);
  }

  // Create opportunity
  const today = new Date();
  const closeDate = new Date(today.getFullYear(), today.getMonth() + 3, today.getDate()).toISOString().split('T')[0];
  const oppResult = db.prepare(`
    INSERT INTO Opportunities (OpportunityName, CustomerId, LeadId, Amount, Stage, Probability, ExpectedCloseDate, Status, AssignedTo)
    VALUES (?, ?, ?, ?, 'Qualification', 10, ?, 'Open', ?)
  `).run(`Opp - ${lead.LeadName}`, customerId, lead.LeadId, lead.ExpectedValue || 1000, closeDate, lead.AssignedTo);
  logAudit(user.id, 'CREATE', 'Opportunity', oppResult.lastInsertRowid, null, { source: 'LeadConversion', leadId: lead.LeadId }, req.ip);

  // Update lead status
  db.prepare("UPDATE Leads SET Status = 'Converted' WHERE LeadId = ?").run(lead.LeadId);
  logAudit(user.id, 'CONVERT', 'Lead', lead.LeadId, { status: lead.Status }, { status: 'Converted', customerId, opportunityId: oppResult.lastInsertRowid }, req.ip);

  res.redirect('/leads');
});

// DELETE
router.post('/delete/:id', (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const old = db.prepare('SELECT * FROM Leads WHERE LeadId = ?').get(req.params.id);
  if (!old) return res.status(404).render('error', { title: 'Not Found', message: 'Lead not found', user });
  if (user.role === 'SalesExecutive' && old.AssignedTo !== user.id) {
    return res.status(403).render('error', { title: 'Access Denied', message: 'Not your lead', user });
  }
  db.prepare('DELETE FROM Leads WHERE LeadId = ?').run(req.params.id);
  logAudit(user.id, 'DELETE', 'Lead', req.params.id, old, null, req.ip);
  res.redirect('/leads');
});

module.exports = router;

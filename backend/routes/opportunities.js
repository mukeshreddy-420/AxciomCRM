const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { getDb, logAudit } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

const STAGES = ['Qualification', 'Proposal', 'Negotiation', 'Won', 'Lost'];

// LIST
router.get('/', (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const { search, stage } = req.query;
  let sql = `SELECT o.*, c.CustomerName, u.FullName as AssignedName FROM Opportunities o
    LEFT JOIN Customers c ON o.CustomerId = c.CustomerId
    LEFT JOIN Users u ON o.AssignedTo = u.UserId WHERE 1=1`;
  const params = [];

  if (user.role === 'SalesExecutive') { sql += ' AND o.AssignedTo = ?'; params.push(user.id); }
  if (search) { sql += ' AND (o.OpportunityName LIKE ? OR c.CustomerName LIKE ?)'; const s = `%${search}%`; params.push(s, s); }
  if (stage) { sql += ' AND o.Stage = ?'; params.push(stage); }
  sql += ' ORDER BY o.OpportunityId DESC';

  const opportunities = db.prepare(sql).all(...params);
  res.render('opportunities/list', { title: 'Opportunities', opportunities, user, search: search || '', stage: stage || '', STAGES, csrfToken: req.csrfToken() });
});

// CREATE form
router.get('/create', (req, res) => {
  const db = getDb();
  const customers = db.prepare('SELECT CustomerId, CustomerName FROM Customers').all();
  const users = db.prepare("SELECT u.UserId, u.FullName FROM Users u WHERE u.IsActive = 1").all();
  res.render('opportunities/form', { title: 'Create Opportunity', opp: {}, customers, users, user: req.session.user, errors: [], csrfToken: req.csrfToken(), STAGES });
});

// CREATE POST
router.post('/create', [
  body('OpportunityName').trim().notEmpty().withMessage('Opportunity Name is required').isLength({ max: 150 }),
  body('Amount').isFloat({ gt: 0 }).withMessage('Amount must be greater than 0'),
  body('Probability').isFloat({ min: 0, max: 100 }).withMessage('Probability must be between 0 and 100'),
  body('ExpectedCloseDate').notEmpty().withMessage('Expected Close Date is required'),
  body('Stage').isIn(STAGES).withMessage('Invalid stage'),
  body('AssignedTo').notEmpty().withMessage('Assigned user is required')
], (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const errors = validationResult(req);
  const extraErrors = [];

  // Business validation: ExpectedCloseDate not in past for active opp
  if (req.body.ExpectedCloseDate && req.body.Stage !== 'Won' && req.body.Stage !== 'Lost') {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (new Date(req.body.ExpectedCloseDate) < today) {
      extraErrors.push({ msg: 'Expected Close Date cannot be in the past' });
    }
  }

  if (!errors.isEmpty() || extraErrors.length) {
    const customers = db.prepare('SELECT CustomerId, CustomerName FROM Customers').all();
    const users = db.prepare("SELECT u.UserId, u.FullName FROM Users u WHERE u.IsActive = 1").all();
    return res.render('opportunities/form', {
      title: 'Create Opportunity', opp: req.body, customers, users, user,
      errors: [...errors.array(), ...extraErrors], csrfToken: req.csrfToken(), STAGES
    });
  }

  const result = db.prepare(`
    INSERT INTO Opportunities (OpportunityName, CustomerId, LeadId, Amount, Stage, Probability, ExpectedCloseDate, Status, Notes, AssignedTo)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'Open', ?, ?)
  `).run(req.body.OpportunityName, req.body.CustomerId || null, req.body.LeadId || null,
    req.body.Amount, req.body.Stage, req.body.Probability, req.body.ExpectedCloseDate,
    req.body.Notes || null, req.body.AssignedTo);

  logAudit(user.id, 'CREATE', 'Opportunity', result.lastInsertRowid, null, req.body, req.ip);
  res.redirect('/opportunities');
});

// EDIT form
router.get('/edit/:id', (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const opp = db.prepare('SELECT * FROM Opportunities WHERE OpportunityId = ?').get(req.params.id);
  if (!opp) return res.status(404).render('error', { title: 'Not Found', message: 'Opportunity not found', user });
  if (user.role === 'SalesExecutive' && opp.AssignedTo !== user.id) {
    return res.status(403).render('error', { title: 'Access Denied', message: 'Not your opportunity', user });
  }
  const customers = db.prepare('SELECT CustomerId, CustomerName FROM Customers').all();
  const users = db.prepare("SELECT u.UserId, u.FullName FROM Users u WHERE u.IsActive = 1").all();
  res.render('opportunities/form', { title: 'Edit Opportunity', opp, customers, users, user, errors: [], csrfToken: req.csrfToken(), STAGES });
});

// EDIT POST
router.post('/edit/:id', [
  body('OpportunityName').trim().notEmpty().withMessage('Opportunity Name is required').isLength({ max: 150 }),
  body('Amount').isFloat({ gt: 0 }).withMessage('Amount must be greater than 0'),
  body('Probability').isFloat({ min: 0, max: 100 }).withMessage('Probability must be between 0 and 100'),
  body('ExpectedCloseDate').notEmpty().withMessage('Expected Close Date is required'),
  body('Stage').isIn(STAGES).withMessage('Invalid stage'),
  body('AssignedTo').notEmpty().withMessage('Assigned user is required')
], (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const old = db.prepare('SELECT * FROM Opportunities WHERE OpportunityId = ?').get(req.params.id);
  if (!old) return res.status(404).render('error', { title: 'Not Found', message: 'Opportunity not found', user });
  if (user.role === 'SalesExecutive' && old.AssignedTo !== user.id) {
    return res.status(403).render('error', { title: 'Access Denied', message: 'Not your opportunity', user });
  }

  const errors = validationResult(req);
  const extraErrors = [];

  if (req.body.ExpectedCloseDate && req.body.Stage !== 'Won' && req.body.Stage !== 'Lost') {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (new Date(req.body.ExpectedCloseDate) < today) {
      extraErrors.push({ msg: 'Expected Close Date cannot be in the past' });
    }
  }

  if (!errors.isEmpty() || extraErrors.length) {
    const customers = db.prepare('SELECT CustomerId, CustomerName FROM Customers').all();
    const users = db.prepare("SELECT u.UserId, u.FullName FROM Users u WHERE u.IsActive = 1").all();
    return res.render('opportunities/form', {
      title: 'Edit Opportunity', opp: { ...old, ...req.body }, customers, users, user,
      errors: [...errors.array(), ...extraErrors], csrfToken: req.csrfToken(), STAGES
    });
  }

  const newStatus = (req.body.Stage === 'Won' || req.body.Stage === 'Lost') ? 'Closed' : 'Open';
  db.prepare(`
    UPDATE Opportunities SET OpportunityName=?, CustomerId=?, Amount=?, Stage=?, Probability=?,
    ExpectedCloseDate=?, Status=?, Notes=?, AssignedTo=?, ModifiedDate=datetime('now')
    WHERE OpportunityId=?
  `).run(req.body.OpportunityName, req.body.CustomerId || null, req.body.Amount,
    req.body.Stage, req.body.Probability, req.body.ExpectedCloseDate, newStatus,
    req.body.Notes || null, req.body.AssignedTo, req.params.id);

  logAudit(user.id, 'UPDATE', 'Opportunity', req.params.id, old, req.body, req.ip);
  res.redirect('/opportunities');
});

// DELETE
router.post('/delete/:id', (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const old = db.prepare('SELECT * FROM Opportunities WHERE OpportunityId = ?').get(req.params.id);
  if (!old) return res.status(404).render('error', { title: 'Not Found', message: 'Opportunity not found', user });
  if (user.role === 'SalesExecutive' && old.AssignedTo !== user.id) {
    return res.status(403).render('error', { title: 'Access Denied', message: 'Not your opportunity', user });
  }
  db.prepare('DELETE FROM Opportunities WHERE OpportunityId = ?').run(req.params.id);
  logAudit(user.id, 'DELETE', 'Opportunity', req.params.id, old, null, req.ip);
  res.redirect('/opportunities');
});

module.exports = router;

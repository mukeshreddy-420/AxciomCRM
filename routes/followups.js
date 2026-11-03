const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { getDb, logAudit } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

const FOLLOWUP_STATUSES = ['Planned', 'Completed', 'Missed', 'Cancelled'];
const FOLLOWUP_TYPES = ['Call', 'Meeting', 'Email', 'Task', 'Visit'];

// LIST
router.get('/', (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const { search, status } = req.query;
  let sql = `SELECT f.*, c.CustomerName, l.LeadName, u.FullName as AssignedName FROM FollowUps f
    LEFT JOIN Customers c ON f.CustomerId = c.CustomerId
    LEFT JOIN Leads l ON f.LeadId = l.LeadId
    LEFT JOIN Users u ON f.AssignedTo = u.UserId WHERE 1=1`;
  const params = [];

  if (user.role === 'SalesExecutive') { sql += ' AND f.AssignedTo = ?'; params.push(user.id); }
  if (search) { sql += ' AND (f.Subject LIKE ? OR c.CustomerName LIKE ? OR l.LeadName LIKE ?)'; const s = `%${search}%`; params.push(s, s, s); }
  if (status) { sql += ' AND f.Status = ?'; params.push(status); }
  sql += ' ORDER BY f.FollowUpDate DESC';

  const followups = db.prepare(sql).all(...params);
  res.render('followups/list', { title: 'Follow-Ups', followups, user, search: search || '', status: status || '', FOLLOWUP_STATUSES, csrfToken: req.csrfToken() });
});

// CREATE form
router.get('/create', (req, res) => {
  const db = getDb();
  const customers = db.prepare('SELECT CustomerId, CustomerName FROM Customers').all();
  const leads = db.prepare('SELECT LeadId, LeadName FROM Leads').all();
  const users = db.prepare("SELECT u.UserId, u.FullName FROM Users u WHERE u.IsActive = 1").all();
  res.render('followups/form', { title: 'Create Follow-Up', followup: {}, customers, leads, users, user: req.session.user, errors: [], csrfToken: req.csrfToken(), FOLLOWUP_TYPES, FOLLOWUP_STATUSES });
});

// CREATE POST
router.post('/create', [
  body('Subject').trim().notEmpty().withMessage('Subject is required').isLength({ max: 200 }),
  body('FollowUpDate').notEmpty().withMessage('Follow-up date is required'),
  body('FollowUpType').isIn(['Call', 'Meeting', 'Email', 'Task', 'Visit']).withMessage('Invalid type'),
  body('AssignedTo').notEmpty().withMessage('Assigned user is required')
], (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const errors = validationResult(req);
  const extraErrors = [];

  // Business rule: follow-up date not in the past for Planned
  const fStatus = req.body.Status || 'Planned';
  if (req.body.FollowUpDate && (fStatus === 'Planned')) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (new Date(req.body.FollowUpDate) < today) {
      extraErrors.push({ msg: 'Follow-up date cannot be earlier than today' });
    }
  }

  if (!errors.isEmpty() || extraErrors.length) {
    const customers = db.prepare('SELECT CustomerId, CustomerName FROM Customers').all();
    const leads = db.prepare('SELECT LeadId, LeadName FROM Leads').all();
    const users = db.prepare("SELECT u.UserId, u.FullName FROM Users u WHERE u.IsActive = 1").all();
    return res.render('followups/form', { title: 'Create Follow-Up', followup: req.body, customers, leads, users, user, errors: [...errors.array(), ...extraErrors], csrfToken: req.csrfToken(), FOLLOWUP_TYPES, FOLLOWUP_STATUSES });
  }

  const result = db.prepare(`
    INSERT INTO FollowUps (CustomerId, LeadId, FollowUpDate, FollowUpType, Subject, Remarks, Status, AssignedTo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.body.CustomerId || null, req.body.LeadId || null,
    req.body.FollowUpDate, req.body.FollowUpType, req.body.Subject,
    req.body.Remarks || null, fStatus, req.body.AssignedTo);

  logAudit(user.id, 'CREATE', 'FollowUp', result.lastInsertRowid, null, req.body, req.ip);
  res.redirect('/followups');
});

// EDIT form
router.get('/edit/:id', (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const followup = db.prepare('SELECT * FROM FollowUps WHERE FollowUpId = ?').get(req.params.id);
  if (!followup) return res.status(404).render('error', { title: 'Not Found', message: 'Follow-up not found', user });
  if (user.role === 'SalesExecutive' && followup.AssignedTo !== user.id) {
    return res.status(403).render('error', { title: 'Access Denied', message: 'Not your follow-up', user });
  }
  const customers = db.prepare('SELECT CustomerId, CustomerName FROM Customers').all();
  const leads = db.prepare('SELECT LeadId, LeadName FROM Leads').all();
  const users = db.prepare("SELECT u.UserId, u.FullName FROM Users u WHERE u.IsActive = 1").all();
  res.render('followups/form', { title: 'Edit Follow-Up', followup, customers, leads, users, user, errors: [], csrfToken: req.csrfToken(), FOLLOWUP_TYPES, FOLLOWUP_STATUSES });
});

// EDIT POST
router.post('/edit/:id', [
  body('Subject').trim().notEmpty().withMessage('Subject is required').isLength({ max: 200 }),
  body('FollowUpDate').notEmpty().withMessage('Follow-up date is required'),
  body('FollowUpType').isIn(['Call', 'Meeting', 'Email', 'Task', 'Visit']).withMessage('Invalid type'),
  body('AssignedTo').notEmpty().withMessage('Assigned user is required')
], (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const old = db.prepare('SELECT * FROM FollowUps WHERE FollowUpId = ?').get(req.params.id);
  if (!old) return res.status(404).render('error', { title: 'Not Found', message: 'Follow-up not found', user });
  if (user.role === 'SalesExecutive' && old.AssignedTo !== user.id) {
    return res.status(403).render('error', { title: 'Access Denied', message: 'Not your follow-up', user });
  }

  const errors = validationResult(req);
  const extraErrors = [];

  const fStatus = req.body.Status || old.Status;
  if (req.body.FollowUpDate && fStatus === 'Planned') {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (new Date(req.body.FollowUpDate) < today) {
      extraErrors.push({ msg: 'Follow-up date cannot be earlier than today' });
    }
  }

  if (!errors.isEmpty() || extraErrors.length) {
    const customers = db.prepare('SELECT CustomerId, CustomerName FROM Customers').all();
    const leads = db.prepare('SELECT LeadId, LeadName FROM Leads').all();
    const users = db.prepare("SELECT u.UserId, u.FullName FROM Users u WHERE u.IsActive = 1").all();
    return res.render('followups/form', { title: 'Edit Follow-Up', followup: { ...old, ...req.body }, customers, leads, users, user, errors: [...errors.array(), ...extraErrors], csrfToken: req.csrfToken(), FOLLOWUP_TYPES, FOLLOWUP_STATUSES });
  }

  db.prepare(`
    UPDATE FollowUps SET CustomerId=?, LeadId=?, FollowUpDate=?, FollowUpType=?, Subject=?, Remarks=?, Status=?, AssignedTo=?
    WHERE FollowUpId=?
  `).run(req.body.CustomerId || null, req.body.LeadId || null, req.body.FollowUpDate,
    req.body.FollowUpType, req.body.Subject, req.body.Remarks || null,
    fStatus, req.body.AssignedTo, req.params.id);

  logAudit(user.id, 'UPDATE', 'FollowUp', req.params.id, old, req.body, req.ip);
  res.redirect('/followups');
});

// DELETE
router.post('/delete/:id', (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const old = db.prepare('SELECT * FROM FollowUps WHERE FollowUpId = ?').get(req.params.id);
  if (!old) return res.status(404).render('error', { title: 'Not Found', message: 'Follow-up not found', user });
  if (user.role === 'SalesExecutive' && old.AssignedTo !== user.id) {
    return res.status(403).render('error', { title: 'Access Denied', message: 'Not your follow-up', user });
  }
  db.prepare('DELETE FROM FollowUps WHERE FollowUpId = ?').run(req.params.id);
  logAudit(user.id, 'DELETE', 'FollowUp', req.params.id, old, null, req.ip);
  res.redirect('/followups');
});

module.exports = router;

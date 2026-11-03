const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);
router.use(requireRole('Admin'));

router.get('/', (req, res) => {
  const db = getDb();
  const { action, entity, userId, dateFrom, dateTo } = req.query;
  let sql = `SELECT a.*, u.FullName, u.Email as UserEmail FROM AuditLog a
    LEFT JOIN Users u ON a.UserId = u.UserId WHERE 1=1`;
  const params = [];

  if (action) { sql += ' AND a.Action LIKE ?'; params.push(`%${action}%`); }
  if (entity) { sql += ' AND a.EntityName = ?'; params.push(entity); }
  if (userId) { sql += ' AND a.UserId = ?'; params.push(userId); }
  if (dateFrom) { sql += ' AND a.CreatedDate >= ?'; params.push(dateFrom); }
  if (dateTo) { sql += ' AND a.CreatedDate <= ?'; params.push(dateTo + ' 23:59:59'); }

  sql += ' ORDER BY a.AuditLogId DESC LIMIT 500';
  const logs = db.prepare(sql).all(...params);
  const users = db.prepare('SELECT UserId, FullName FROM Users').all();
  const entities = ['Auth', 'Customer', 'Lead', 'Opportunity', 'FollowUp'];

  res.render('audit/index', {
    title: 'Audit Log',
    logs, users, entities, user: req.session.user,
    filters: { action: action || '', entity: entity || '', userId: userId || '', dateFrom: dateFrom || '', dateTo: dateTo || '' }
  });
});

module.exports = router;

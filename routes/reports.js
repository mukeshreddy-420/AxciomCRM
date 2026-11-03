const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);
router.use(requireRole('Admin', 'Manager'));

// Pipeline Report
router.get('/pipeline', (req, res) => {
  const db = getDb();
  const user = req.session.user;

  const byStage = db.prepare(`
    SELECT Stage, COUNT(*) as count, COALESCE(SUM(Amount),0) as totalAmount,
    COALESCE(SUM(Amount * Probability / 100),0) as weightedAmount
    FROM Opportunities WHERE Status = 'Open' GROUP BY Stage
  `).all();

  const byOwner = db.prepare(`
    SELECT u.FullName as owner, COUNT(*) as count, COALESCE(SUM(o.Amount),0) as totalAmount,
    COALESCE(SUM(o.Amount * o.Probability / 100),0) as weightedAmount
    FROM Opportunities o JOIN Users u ON o.AssignedTo = u.UserId
    WHERE o.Status = 'Open' GROUP BY o.AssignedTo
  `).all();

  res.render('reports/pipeline', {
    title: 'Pipeline Report',
    byStage,
    byOwner,
    user
  });
});

module.exports = router;

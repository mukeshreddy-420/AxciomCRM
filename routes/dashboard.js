const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const isSales = user.role === 'SalesExecutive';

  // Scope filter for SalesExecutive
  const custWhere = isSales ? 'WHERE CreatedBy = ?' : '';
  const leadWhere = isSales ? 'WHERE AssignedTo = ?' : '';
  const oppWhere = isSales ? 'WHERE AssignedTo = ?' : '';
  const params = isSales ? [user.id] : [];

  const totalCustomers = db.prepare(`SELECT COUNT(*) as c FROM Customers ${custWhere}`).get(...params).c;
  const totalLeads = db.prepare(`SELECT COUNT(*) as c FROM Leads ${leadWhere}`).get(...params).c;
  const openLeads = db.prepare(`SELECT COUNT(*) as c FROM Leads ${isSales ? 'WHERE AssignedTo = ? AND' : 'WHERE'} Status NOT IN ('Converted','Lost','Unqualified')`).get(...params).c;
  const totalOpportunities = db.prepare(`SELECT COUNT(*) as c FROM Opportunities ${oppWhere}`).get(...params).c;
  const openOpportunities = db.prepare(`SELECT COUNT(*) as c FROM Opportunities ${isSales ? 'WHERE AssignedTo = ? AND' : 'WHERE'} Status = 'Open' AND Stage NOT IN ('Won','Lost')`).get(...params).c;
  const wonOpportunities = db.prepare(`SELECT COUNT(*) as c FROM Opportunities ${isSales ? 'WHERE AssignedTo = ? AND' : 'WHERE'} Stage = 'Won'`).get(...params).c;
  const lostOpportunities = db.prepare(`SELECT COUNT(*) as c FROM Opportunities ${isSales ? 'WHERE AssignedTo = ? AND' : 'WHERE'} Stage = 'Lost'`).get(...params).c;
  const pipelineRow = db.prepare(`SELECT COALESCE(SUM(Amount),0) as v FROM Opportunities ${isSales ? 'WHERE AssignedTo = ? AND' : 'WHERE'} Status = 'Open' AND Stage NOT IN ('Won','Lost')`).get(...params);
  const pipelineValue = pipelineRow.v;

  // Charts
  const leadStatus = db.prepare(`SELECT Status as status, COUNT(*) as count FROM Leads ${leadWhere} GROUP BY Status`).all(...params);
  const oppPipeline = db.prepare(`SELECT Stage as stage, COUNT(*) as count FROM Opportunities ${oppWhere} GROUP BY Stage`).all(...params);
  const monthlySales = db.prepare(`
    SELECT strftime('%Y-%m', ExpectedCloseDate) as month, COALESCE(SUM(Amount),0) as total
    FROM Opportunities ${isSales ? 'WHERE AssignedTo = ? AND' : 'WHERE'} Stage = 'Won'
    GROUP BY month ORDER BY month DESC LIMIT 12
  `).all(...params).reverse();

  res.render('dashboard/index', {
    title: 'Dashboard',
    user,
    stats: { totalCustomers, totalLeads, openLeads, totalOpportunities, openOpportunities, wonOpportunities, lostOpportunities, pipelineValue },
    charts: { leadStatus, oppPipeline, monthlySales }
  });
});

module.exports = router;

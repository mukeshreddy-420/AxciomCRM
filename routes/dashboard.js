const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const isSales = user.role === 'SalesExecutive';

  // Role scoping filters
  const custWhere = isSales ? 'WHERE CreatedBy = ?' : '';
  const leadWhere = isSales ? 'WHERE AssignedTo = ?' : '';
  const oppWhere = isSales ? 'WHERE AssignedTo = ?' : '';
  const followupWhere = isSales ? 'WHERE f.AssignedTo = ?' : '';
  const auditWhere = isSales ? 'WHERE a.UserId = ?' : '';
  const params = isSales ? [user.id] : [];

  // Core KPI counts (Section 17.11 mandatory)
  const totalCustomers = db.prepare(`SELECT COUNT(*) as c FROM Customers ${custWhere}`).get(...params).c;
  const totalLeads = db.prepare(`SELECT COUNT(*) as c FROM Leads ${leadWhere}`).get(...params).c;
  const openLeads = db.prepare(`SELECT COUNT(*) as c FROM Leads ${isSales ? 'WHERE AssignedTo = ? AND' : 'WHERE'} Status NOT IN ('Converted','Lost','Unqualified')`).get(...params).c;
  const totalOpportunities = db.prepare(`SELECT COUNT(*) as c FROM Opportunities ${oppWhere}`).get(...params).c;
  const openOpportunities = db.prepare(`SELECT COUNT(*) as c FROM Opportunities ${isSales ? 'WHERE AssignedTo = ? AND' : 'WHERE'} Status = 'Open' AND Stage NOT IN ('Won','Lost')`).get(...params).c;
  const wonOpportunities = db.prepare(`SELECT COUNT(*) as c FROM Opportunities ${isSales ? 'WHERE AssignedTo = ? AND' : 'WHERE'} Stage = 'Won'`).get(...params).c;
  const lostOpportunities = db.prepare(`SELECT COUNT(*) as c FROM Opportunities ${isSales ? 'WHERE AssignedTo = ? AND' : 'WHERE'} Stage = 'Lost'`).get(...params).c;
  const pipelineRow = db.prepare(`SELECT COALESCE(SUM(Amount),0) as v FROM Opportunities ${isSales ? 'WHERE AssignedTo = ? AND' : 'WHERE'} Status = 'Open' AND Stage NOT IN ('Won','Lost')`).get(...params);
  const pipelineValue = pipelineRow.v;

  // Extended KPIs: Revenue, Win Rate, Conversion Rate, Average Deal Size
  const revenueRow = db.prepare(`SELECT COALESCE(SUM(Amount),0) as r FROM Opportunities ${isSales ? 'WHERE AssignedTo = ? AND' : 'WHERE'} Stage = 'Won'`).get(...params);
  const totalRevenue = revenueRow.r;

  const closedCount = wonOpportunities + lostOpportunities;
  const winRate = closedCount > 0 ? Math.round((wonOpportunities / closedCount) * 100) : 0;

  const convertedLeads = db.prepare(`SELECT COUNT(*) as c FROM Leads ${isSales ? 'WHERE AssignedTo = ? AND' : 'WHERE'} Status = 'Converted'`).get(...params).c;
  const conversionRate = totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 100) : 0;

  const avgDealSize = wonOpportunities > 0 ? Math.round(totalRevenue / wonOpportunities) : 0;

  // Pending / Upcoming Follow-ups count
  const pendingFollowups = db.prepare(`SELECT COUNT(*) as c FROM FollowUps ${isSales ? 'WHERE AssignedTo = ? AND' : 'WHERE'} Status = 'Planned'`).get(...params).c;

  // Month-over-Month calculation for Won Revenue trend
  const currentMonth = new Date().toISOString().slice(0, 7); // e.g. '2026-11'
  const lastMonthDate = new Date();
  lastMonthDate.setMonth(lastMonthDate.getMonth() - 1);
  const lastMonth = lastMonthDate.toISOString().slice(0, 7);

  const thisMonthWon = db.prepare(`
    SELECT COALESCE(SUM(Amount),0) as t FROM Opportunities
    ${isSales ? 'WHERE AssignedTo = ? AND' : 'WHERE'} Stage = 'Won' AND strftime('%Y-%m', ExpectedCloseDate) = ?
  `).get(...(isSales ? [user.id, currentMonth] : [currentMonth])).t;

  const lastMonthWon = db.prepare(`
    SELECT COALESCE(SUM(Amount),0) as t FROM Opportunities
    ${isSales ? 'WHERE AssignedTo = ? AND' : 'WHERE'} Stage = 'Won' AND strftime('%Y-%m', ExpectedCloseDate) = ?
  `).get(...(isSales ? [user.id, lastMonth] : [lastMonth])).t;

  let revenueMoMGrowth = 0;
  if (lastMonthWon > 0) {
    revenueMoMGrowth = Math.round(((thisMonthWon - lastMonthWon) / lastMonthWon) * 100);
  } else if (thisMonthWon > 0) {
    revenueMoMGrowth = 100;
  }

  // Charts Data
  // 1. Lead Status Breakdown (Section 17.12)
  const leadStatuses = ['New', 'Contacted', 'Qualified', 'Unqualified', 'Converted', 'Lost'];
  const leadStatusRaw = db.prepare(`SELECT Status as status, COUNT(*) as count FROM Leads ${leadWhere} GROUP BY Status`).all(...params);
  const leadStatusMap = Object.fromEntries(leadStatusRaw.map(r => [r.status, r.count]));
  const leadStatus = leadStatuses.map(status => ({
    status,
    count: leadStatusMap[status] || 0
  }));

  // 2. Opportunity Pipeline (Section 17.12)
  const oppStages = ['Qualification', 'Proposal', 'Negotiation', 'Won', 'Lost'];
  const oppPipelineRaw = db.prepare(`
    SELECT Stage as stage, COUNT(*) as count, COALESCE(SUM(Amount),0) as amount
    FROM Opportunities ${oppWhere} GROUP BY Stage
  `).all(...params);
  const oppPipelineMap = Object.fromEntries(oppPipelineRaw.map(r => [r.stage, r]));
  const oppPipeline = oppStages.map(stage => ({
    stage,
    count: oppPipelineMap[stage] ? oppPipelineMap[stage].count : 0,
    amount: oppPipelineMap[stage] ? oppPipelineMap[stage].amount : 0
  }));

  // 3. Monthly Sales (Won deals over last 6-12 months)
  const monthlySales = db.prepare(`
    SELECT strftime('%Y-%m', ExpectedCloseDate) as month, COALESCE(SUM(Amount),0) as total, COUNT(*) as deals
    FROM Opportunities ${isSales ? 'WHERE AssignedTo = ? AND' : 'WHERE'} Stage = 'Won'
    GROUP BY month ORDER BY month ASC LIMIT 12
  `).all(...params);

  // 4. Customer Growth (New Customers per month)
  const customerGrowth = db.prepare(`
    SELECT strftime('%Y-%m', CreatedDate) as month, COUNT(*) as count
    FROM Customers ${custWhere}
    GROUP BY month ORDER BY month ASC LIMIT 6
  `).all(...params);

  // Recent data tables
  // Recent Leads (5)
  const recentLeads = db.prepare(`
    SELECT l.*, u.FullName as AssignedName FROM Leads l
    LEFT JOIN Users u ON l.AssignedTo = u.UserId
    ${leadWhere} ORDER BY l.LeadId DESC LIMIT 5
  `).all(...params);

  // Latest Customers (5)
  const latestCustomers = db.prepare(`
    SELECT c.*, u.FullName as CreatedByName FROM Customers c
    LEFT JOIN Users u ON c.CreatedBy = u.UserId
    ${custWhere} ORDER BY c.CustomerId DESC LIMIT 5
  `).all(...params);

  // Upcoming Follow-ups (5)
  const upcomingFollowups = db.prepare(`
    SELECT f.*, c.CustomerName, l.LeadName, u.FullName as AssignedName
    FROM FollowUps f
    LEFT JOIN Customers c ON f.CustomerId = c.CustomerId
    LEFT JOIN Leads l ON f.LeadId = l.LeadId
    LEFT JOIN Users u ON f.AssignedTo = u.UserId
    ${followupWhere}
    ORDER BY f.FollowUpDate ASC, f.FollowUpId DESC LIMIT 5
  `).all(...params);

  // Recent Activities / Audit Trail (6)
  const recentActivities = db.prepare(`
    SELECT a.*, u.FullName, u.Email as UserEmail
    FROM AuditLog a
    LEFT JOIN Users u ON a.UserId = u.UserId
    ${auditWhere}
    ORDER BY a.AuditLogId DESC LIMIT 6
  `).all(...params);

  res.render('dashboard/index', {
    title: 'Dashboard',
    user,
    stats: {
      totalCustomers,
      totalLeads,
      openLeads,
      totalOpportunities,
      openOpportunities,
      wonOpportunities,
      lostOpportunities,
      pipelineValue,
      totalRevenue,
      winRate,
      conversionRate,
      avgDealSize,
      pendingFollowups,
      revenueMoMGrowth,
      thisMonthWon
    },
    charts: {
      leadStatus,
      oppPipeline,
      monthlySales,
      customerGrowth
    },
    tables: {
      recentLeads,
      latestCustomers,
      upcomingFollowups,
      recentActivities
    }
  });
});

module.exports = router;

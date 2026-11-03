const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'acxiomcrm.db');
let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initializeDatabase() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS Roles (
      RoleId INTEGER PRIMARY KEY AUTOINCREMENT,
      RoleName TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS Users (
      UserId INTEGER PRIMARY KEY AUTOINCREMENT,
      FullName TEXT NOT NULL,
      Email TEXT NOT NULL UNIQUE,
      PasswordHash TEXT NOT NULL,
      RoleId INTEGER NOT NULL,
      IsActive INTEGER NOT NULL DEFAULT 1,
      FailedLoginCount INTEGER NOT NULL DEFAULT 0,
      LockoutEnd TEXT,
      CreatedDate TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (RoleId) REFERENCES Roles(RoleId)
    );

    CREATE TABLE IF NOT EXISTS Customers (
      CustomerId INTEGER PRIMARY KEY AUTOINCREMENT,
      CustomerCode TEXT NOT NULL UNIQUE,
      CustomerName TEXT NOT NULL,
      Email TEXT NOT NULL UNIQUE,
      Phone TEXT NOT NULL UNIQUE,
      CompanyName TEXT,
      Address TEXT,
      City TEXT,
      State TEXT,
      Status TEXT NOT NULL DEFAULT 'Active',
      CreatedDate TEXT NOT NULL DEFAULT (datetime('now')),
      ModifiedDate TEXT,
      CreatedBy INTEGER NOT NULL,
      FOREIGN KEY (CreatedBy) REFERENCES Users(UserId)
    );

    CREATE TABLE IF NOT EXISTS Leads (
      LeadId INTEGER PRIMARY KEY AUTOINCREMENT,
      LeadCode TEXT NOT NULL UNIQUE,
      LeadName TEXT NOT NULL,
      Email TEXT NOT NULL,
      Phone TEXT NOT NULL,
      CompanyName TEXT,
      Source TEXT NOT NULL DEFAULT 'Website',
      Status TEXT NOT NULL DEFAULT 'New',
      Priority TEXT NOT NULL DEFAULT 'Medium',
      ExpectedValue REAL DEFAULT 0,
      Notes TEXT,
      CreatedDate TEXT NOT NULL DEFAULT (datetime('now')),
      AssignedTo INTEGER NOT NULL,
      FOREIGN KEY (AssignedTo) REFERENCES Users(UserId)
    );

    CREATE TABLE IF NOT EXISTS Opportunities (
      OpportunityId INTEGER PRIMARY KEY AUTOINCREMENT,
      OpportunityName TEXT NOT NULL,
      CustomerId INTEGER,
      LeadId INTEGER,
      Amount REAL NOT NULL,
      Stage TEXT NOT NULL DEFAULT 'Qualification',
      Probability REAL NOT NULL DEFAULT 0,
      ExpectedCloseDate TEXT NOT NULL,
      Status TEXT NOT NULL DEFAULT 'Open',
      Notes TEXT,
      CreatedDate TEXT NOT NULL DEFAULT (datetime('now')),
      ModifiedDate TEXT,
      AssignedTo INTEGER NOT NULL,
      FOREIGN KEY (CustomerId) REFERENCES Customers(CustomerId),
      FOREIGN KEY (LeadId) REFERENCES Leads(LeadId),
      FOREIGN KEY (AssignedTo) REFERENCES Users(UserId)
    );

    CREATE TABLE IF NOT EXISTS FollowUps (
      FollowUpId INTEGER PRIMARY KEY AUTOINCREMENT,
      CustomerId INTEGER,
      LeadId INTEGER,
      FollowUpDate TEXT NOT NULL,
      FollowUpType TEXT NOT NULL DEFAULT 'Call',
      Subject TEXT NOT NULL,
      Remarks TEXT,
      Status TEXT NOT NULL DEFAULT 'Planned',
      CreatedDate TEXT NOT NULL DEFAULT (datetime('now')),
      AssignedTo INTEGER NOT NULL,
      FOREIGN KEY (CustomerId) REFERENCES Customers(CustomerId),
      FOREIGN KEY (LeadId) REFERENCES Leads(LeadId),
      FOREIGN KEY (AssignedTo) REFERENCES Users(UserId)
    );

    CREATE TABLE IF NOT EXISTS AuditLog (
      AuditLogId INTEGER PRIMARY KEY AUTOINCREMENT,
      UserId INTEGER,
      Action TEXT NOT NULL,
      EntityName TEXT NOT NULL,
      RecordId INTEGER,
      OldValue TEXT,
      NewValue TEXT,
      CreatedDate TEXT NOT NULL DEFAULT (datetime('now')),
      IpAddress TEXT
    );
  `);

  // Seed roles
  const roleInsert = db.prepare('INSERT OR IGNORE INTO Roles (RoleName) VALUES (?)');
  roleInsert.run('Admin');
  roleInsert.run('Manager');
  roleInsert.run('SalesExecutive');

  // Seed users
  const existingUser = db.prepare('SELECT COUNT(*) as cnt FROM Users').get();
  if (existingUser.cnt === 0) {
    const hash = bcrypt.hashSync('Test@1234', 10);
    const insertUser = db.prepare(
      'INSERT INTO Users (FullName, Email, PasswordHash, RoleId) VALUES (?, ?, ?, ?)'
    );
    const adminRole = db.prepare("SELECT RoleId FROM Roles WHERE RoleName = 'Admin'").get();
    const managerRole = db.prepare("SELECT RoleId FROM Roles WHERE RoleName = 'Manager'").get();
    const salesRole = db.prepare("SELECT RoleId FROM Roles WHERE RoleName = 'SalesExecutive'").get();

    insertUser.run('Admin User', 'admin@acxiom.com', hash, adminRole.RoleId);
    insertUser.run('Manager User', 'manager@acxiom.com', hash, managerRole.RoleId);
    insertUser.run('Sales User', 'sales@acxiom.com', hash, salesRole.RoleId);
    console.log('Seeded 3 default users');
  }

  // Seed rich CRM sample data if Leads table is empty
  const leadCount = db.prepare('SELECT COUNT(*) as cnt FROM Leads').get().cnt;
  if (leadCount === 0) {
    seedCrmData(db);
  }
}

function seedCrmData(db) {
  // Ensure we have active customers
  const custCount = db.prepare('SELECT COUNT(*) as cnt FROM Customers').get().cnt;
  if (custCount < 5) {
    const insertCust = db.prepare(`
      INSERT OR IGNORE INTO Customers (CustomerCode, CustomerName, Email, Phone, CompanyName, Address, City, State, Status, CreatedDate, CreatedBy)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertCust.run('CUST-004', 'Apex Global Solutions', 'contact@apexglobal.com', '9811223344', 'Apex Global Inc', '742 Evergreen Terrace', 'Chicago', 'Illinois', 'Active', '2026-08-10 10:00:00', 3);
    insertCust.run('CUST-005', 'Quantum Dynamics', 'info@quantumdyn.com', '9822334455', 'Quantum Dynamics LLC', '100 Silicon Way', 'San Francisco', 'California', 'Active', '2026-09-05 11:30:00', 3);
    insertCust.run('CUST-006', 'Vanguard Health Tech', 'support@vanguardhealth.com', '9833445566', 'Vanguard Healthcare', '55 Medical Center Blvd', 'Boston', 'Massachusetts', 'Active', '2026-09-18 14:15:00', 2);
    insertCust.run('CUST-007', 'Starlight Media Group', 'media@starlight.io', '9844556677', 'Starlight Media', '220 Sunset Blvd', 'Los Angeles', 'California', 'Active', '2026-10-02 09:45:00', 3);
    insertCust.run('CUST-008', 'Horizon Logistics', 'ops@horizonlog.com', '9855667788', 'Horizon Logistics Corp', '12 Freight Way', 'Dallas', 'Texas', 'Active', '2026-10-15 16:20:00', 3);
  }

  // Seed Leads
  const insertLead = db.prepare(`
    INSERT INTO Leads (LeadCode, LeadName, Email, Phone, CompanyName, Source, Status, Priority, ExpectedValue, Notes, CreatedDate, AssignedTo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertLead.run('LEAD-001', 'David Miller', 'dmiller@nexustech.io', '9123456780', 'Nexus Tech', 'Website', 'New', 'High', 45000, 'Interested in Enterprise Cloud CRM', '2026-11-02 11:00:00', 3);
  insertLead.run('LEAD-002', 'Sarah Jenkins', 'sjenkins@innovate.co', '9123456781', 'Innovate Corp', 'Referral', 'Contacted', 'Medium', 32000, 'Had initial demo call, requested proposal', '2026-10-28 14:30:00', 3);
  insertLead.run('LEAD-003', 'Robert Chen', 'rchen@pinnacle.com', '9123456782', 'Pinnacle Systems', 'Cold Call', 'Qualified', 'High', 85000, 'Budget approved, evaluating technical fit', '2026-10-20 09:15:00', 3);
  insertLead.run('LEAD-004', 'Elena Rostova', 'elena@cyberguard.net', '9123456783', 'CyberGuard Security', 'Email Campaign', 'Qualified', 'High', 60000, 'Ready for contract negotiation', '2026-10-15 16:00:00', 2);
  insertLead.run('LEAD-005', 'Marcus Brody', 'mbrody@brodyauto.com', '9123456784', 'Brody Automations', 'Social Media', 'Converted', 'Medium', 28000, 'Successfully converted to customer and deal', '2026-09-25 10:20:00', 3);
  insertLead.run('LEAD-006', 'Rachel Adams', 'rachel@ecotrend.org', '9123456785', 'EcoTrend Greenery', 'Website', 'Lost', 'Low', 12000, 'Went with internal legacy tool', '2026-09-12 13:45:00', 3);
  insertLead.run('LEAD-007', 'Kavita Patel', 'kpatel@zenithretail.com', '9123456786', 'Zenith Retailers', 'Referral', 'Unqualified', 'Low', 8000, 'Company size below enterprise threshold', '2026-10-05 11:10:00', 3);
  insertLead.run('LEAD-008', 'Lucas Vance', 'lvance@aeroflow.com', '9123456787', 'AeroFlow Engineering', 'Website', 'Contacted', 'High', 95000, 'Follow up scheduled for product walkthrough', '2026-11-01 15:30:00', 3);

  // Seed Opportunities across stages and past/future months for realistic trend charts
  const insertOpp = db.prepare(`
    INSERT INTO Opportunities (OpportunityName, CustomerId, LeadId, Amount, Stage, Probability, ExpectedCloseDate, Status, Notes, CreatedDate, AssignedTo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  // Past Won deals (for Monthly Sales Chart)
  insertOpp.run('Enterprise Cloud Migration', 1, null, 42000, 'Won', 100, '2026-06-25', 'Closed', 'Deal closed successfully', '2026-06-01', 3);
  insertOpp.run('Global CRM Integration', 4, null, 68000, 'Won', 100, '2026-07-20', 'Closed', 'Yearly contract signed', '2026-07-02', 3);
  insertOpp.run('Security Compliance Suite', 5, null, 35000, 'Won', 100, '2026-08-18', 'Closed', 'Full suite implementation', '2026-08-01', 2);
  insertOpp.run('Healthcare Data Analytics', 6, null, 54000, 'Won', 100, '2026-09-28', 'Closed', 'HIPAA certified deployment', '2026-09-05', 3);
  insertOpp.run('Digital Media Advertising Hub', 7, null, 48000, 'Won', 100, '2026-10-22', 'Closed', 'Media workflows automated', '2026-10-01', 3);
  insertOpp.run('Logistics Routing Engine', 8, null, 75000, 'Won', 100, '2026-11-01', 'Closed', 'Phase 1 delivered and paid', '2026-10-10', 3);

  // Active Open deals (for Opportunity Pipeline Chart)
  insertOpp.run('Nexus Cloud Infrastructure', 1, 1, 55000, 'Qualification', 25, '2026-12-15', 'Open', 'Initial requirements discovery completed', '2026-11-02', 3);
  insertOpp.run('Innovate Corp CRM Rollout', 4, 2, 40000, 'Proposal', 50, '2026-12-28', 'Open', 'Formal proposal submitted to CFO', '2026-10-29', 3);
  insertOpp.run('Pinnacle Enterprise License', 5, 3, 90000, 'Negotiation', 75, '2026-11-25', 'Open', 'Redline review with procurement', '2026-10-22', 3);
  insertOpp.run('CyberGuard Security Suite', 6, 4, 65000, 'Negotiation', 80, '2026-12-05', 'Open', 'Final SLA terms under review', '2026-10-18', 2);
  insertOpp.run('AeroFlow Systems Automation', 7, 8, 85000, 'Proposal', 40, '2027-01-20', 'Open', 'Demo scheduled with VP Engineering', '2026-11-01', 3);

  // Lost deal (for realistic win-loss ratio)
  insertOpp.run('Legacy POS Modernization', 8, null, 25000, 'Lost', 0, '2026-09-15', 'Closed', 'Budget diverted to physical stores', '2026-08-20', 3);

  // Seed Follow-Ups (upcoming and completed)
  const insertFollowup = db.prepare(`
    INSERT INTO FollowUps (CustomerId, LeadId, FollowUpDate, FollowUpType, Subject, Remarks, Status, CreatedDate, AssignedTo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertFollowup.run(null, 1, '2026-11-05', 'Call', 'Product Overview Call with David Miller', 'Walk through enterprise multi-tenant features', 'Planned', '2026-11-02', 3);
  insertFollowup.run(4, 2, '2026-11-07', 'Meeting', 'Executive Pricing Discussion with Innovate', 'Review volume discount tiers with Sarah Jenkins', 'Planned', '2026-10-29', 3);
  insertFollowup.run(5, 3, '2026-11-10', 'Meeting', 'Final Security & Architecture Review', 'Meeting with Chief Information Security Officer', 'Planned', '2026-10-23', 3);
  insertFollowup.run(null, 8, '2026-11-12', 'Call', 'AeroFlow Technical Deep Dive Call', 'Clarify API integration requirements', 'Planned', '2026-11-01', 3);
  insertFollowup.run(1, null, '2026-11-15', 'Email', 'Q4 Account Review & Satisfaction Survey', 'Annual satisfaction check-in with Acme Corp', 'Planned', '2026-11-03', 3);
  insertFollowup.run(6, 4, '2026-10-30', 'Call', 'SLA Clarification Discussion', 'Resolved questions on uptime guarantee', 'Completed', '2026-10-25', 2);
  insertFollowup.run(7, 5, '2026-09-22', 'Meeting', 'Contract Signing Celebration', 'Signed agreement and introduced customer success team', 'Completed', '2026-09-20', 3);

  console.log('Seeded rich CRM sample data: Customers, Leads, Opportunities, and FollowUps');
}

function logAudit(userId, action, entityName, recordId, oldValue, newValue, ipAddress) {
  const db = getDb();
  db.prepare(`
    INSERT INTO AuditLog (UserId, Action, EntityName, RecordId, OldValue, NewValue, IpAddress)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId || null,
    action,
    entityName,
    recordId || null,
    oldValue ? JSON.stringify(oldValue) : null,
    newValue ? JSON.stringify(newValue) : null,
    ipAddress || null
  );
}

module.exports = { getDb, initializeDatabase, logAudit };

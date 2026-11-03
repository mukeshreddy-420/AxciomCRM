const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, '..', 'acxiomcrm.db');
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

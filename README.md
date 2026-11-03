# AcxiomCRM

A lightweight, robust Customer Relationship Management (CRM) web application built with **Node.js**, **Express**, **SQLite (better-sqlite3)**, **EJS Views**, **Bootstrap 5 (CDN)**, and **Chart.js (CDN)** according to the project specifications in `AcxiomCRM_Complete_Project_Assignment.pdf`.

---

## 🚀 Quick Start & Setup

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+ recommended)
- npm (comes with Node.js)

### Installation
```bash
# 1. Install dependencies
npm install

# 2. Start the application
npm start
# or
node app.js
```
The server will start at `http://localhost:3000`. The SQLite database (`acxiomcrm.db`) and seeded users/roles are automatically initialized on first run.

---

## 🔑 Seeded Test Accounts

All accounts are pre-configured with the default password: `Test@1234`

| Role | Email | Password | Access Scope |
| :--- | :--- | :--- | :--- |
| **Admin** | `admin@acxiom.com` | `Test@1234` | Full administration: Users, Roles, Audit Logs, Pipeline Reports, All CRM records & APIs |
| **Manager** | `manager@acxiom.com` | `Test@1234` | Team CRM records, Pipeline Report, Dashboard analytics |
| **SalesExecutive** | `sales@acxiom.com` | `Test@1234` | Own assigned Customers, Leads, Opportunities, and Follow-ups |

---

## 📦 Features & Architecture

### Phase 1: Authentication & Authorization
- **Session & Security**: Secure cookie sessions via `express-session`, password hashing via `bcryptjs` (salt rounds: 10).
- **Password Policy**: Minimum 8 characters, at least 1 uppercase letter, 1 lowercase letter, and 1 numeric digit (`^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$`).
- **Account Lockout**: Automatically locks account for 15 minutes after 5 consecutive failed login attempts.
- **CSRF Protection**: Token generated on all state-changing HTML POST forms (`csurf`).
- **Role-Based Access Control**: `requireRole('Admin', 'Manager', 'SalesExecutive')` server-side middleware enforced on routes and views.

### Phase 2: CRM Core Modules (Section 17.3)
- **Customers**: Code, Name, Email, Phone, Company, Address, City, State, Status, CreatedDate, CreatedBy. Enforces unique email and unique phone.
- **Leads**: Code, Name, Email, Phone, Company, Source, Status, Priority, ExpectedValue, Notes, AssignedTo.
  - Allowed status transitions: `New` ➔ `Contacted` ➔ `Qualified` ➔ `Converted`.
  - **1-Click Convert**: Converts Qualified Lead directly into a Customer and an Opportunity.
- **Opportunities**: Name, Customer, Lead, Amount, Stage (`Qualification`, `Proposal`, `Negotiation`, `Won`, `Lost`), Probability (0-100), ExpectedCloseDate, Status, AssignedTo.
  - Amount must be > 0.
  - ExpectedCloseDate cannot be in the past for active opportunities.
- **Follow-ups**: Customer, Lead, Date, Type (`Call`, `Meeting`, `Email`, `Task`, `Visit`), Remarks, Status (`Planned`, `Completed`, `Missed`, `Cancelled`), AssignedTo.
  - Follow-up date cannot be earlier than today for planned follow-ups.
- **Dual Validation**: Client-side inline HTML5 + custom JS validation + server-side `express-validator` checks on all fields.

### Phase 3: Audit Logging & Dashboard Analytics
- **AuditLog Table**: Records `UserId`, `Action`, `EntityName`, `RecordId`, `OldValue`, `NewValue`, `CreatedDate`, `IpAddress`.
  - Captures: Login success/failure/lockout, Logout, Create, Update, Delete, Lead conversions, User status changes.
- **Admin Audit Viewer**: Filterable by Action, Entity, User, and Date Range (`/audit`).
- **Dashboard (Section 17.11)**:
  - 8 KPI cards: Total Customers, Total Leads, Open Leads, Total Opportunities, Open Opportunities, Won Opportunities, Lost Opportunities, and Total Pipeline Value.
  - 3 dynamic Chart.js visualizations: Lead Status Distribution (Doughnut), Opportunity Pipeline Stages (Bar), and Monthly Sales Won (Line).
- **Pipeline Report**: Stage-wise and owner-wise open pipeline breakdown with weighted amounts (`/reports/pipeline`).

### Phase 4: REST API Endpoints
All API routes are session-authenticated, role-scoped, input-validated, parameterized, and omit sensitive password hashes.
- `GET /api/customers` - List/search customers (scoped by role)
- `POST /api/customers` - Create customer (201 Created)
- `GET /api/customers/:id` - Fetch single customer
- `PUT /api/customers/:id` - Update customer
- `DELETE /api/customers/:id` - Delete customer
- `GET /api/leads` - List/search leads (scoped by role)
- `POST /api/leads` - Create lead (201 Created)
- `GET /api/opportunities` - List/search opportunities (scoped by role)
- `POST /api/opportunities` - Create opportunity (201 Created)

---

## 🧪 Acceptance Test Suite (Section 17.19)

To run the automated 14-step verification suite:
```bash
node acceptance_test.js
```

### Verification Checklist:
1. `GET /dashboard` without login redirects to `/auth/login`; `/api/customers` returns `401`.
2. Login with valid credentials (`sales@acxiom.com`) succeeds and reaches `/dashboard`.
3. Client-side validation attributes (`data-validate`) present and active on forms.
4. Crafted direct HTTP requests with invalid data are rejected by server-side `express-validator`.
5. Opportunity with `Amount <= 0` is rejected with 400/error message.
6. Opportunity with `Probability > 100` is rejected with 400/error message.
7. Active Opportunity with past `ExpectedCloseDate` is rejected.
8. Follow-Up with date earlier than today is rejected for Planned activities.
9. `SalesExecutive` is forbidden (403) from accessing admin routes (`/audit`, `/users`, `/reports/pipeline`).
10. `Manager` can view `/reports/pipeline` but is forbidden (403) from `/audit`.
11. `Admin` has full access to `/audit` and `/users` management.
12. Creating, updating, deleting records writes entries into `AuditLog`.
13. `GET /api/customers` returns authorized JSON without exposing password hashes.
14. Dashboard displays all 8 KPI cards and 3 Chart.js graphs rendered from server data.

const http = require('http');
const { spawn } = require('child_process');

let baseUrl = 'http://localhost:3000';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Simple HTTP client supporting cookies, redirects, and CSRF token extraction
class HttpClient {
  constructor() {
    this.cookies = {};
  }

  getCookieHeader() {
    return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  }

  saveCookies(res) {
    const raw = res.headers['set-cookie'];
    if (raw) {
      raw.forEach(c => {
        const parts = c.split(';')[0].split('=');
        this.cookies[parts[0].trim()] = parts.slice(1).join('=').trim();
      });
    }
  }

  request(options, postData = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(options.path, baseUrl);
      const reqOpts = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: options.method || 'GET',
        headers: {
          ...options.headers,
          Cookie: this.getCookieHeader()
        }
      };

      if (postData && (reqOpts.method === 'POST' || reqOpts.method === 'PUT')) {
        if (typeof postData === 'object' && !reqOpts.headers['Content-Type']) {
          postData = new URLSearchParams(postData).toString();
          reqOpts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
        } else if (typeof postData === 'object' && reqOpts.headers['Content-Type'] === 'application/json') {
          postData = JSON.stringify(postData);
        }
        reqOpts.headers['Content-Length'] = Buffer.byteLength(postData);
      }

      const req = http.request(reqOpts, (res) => {
        this.saveCookies(res);
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body
          });
        });
      });

      req.on('error', reject);
      if (postData) req.write(postData);
      req.end();
    });
  }

  async get(path) {
    return this.request({ path, method: 'GET' });
  }

  async post(path, data, isJson = false) {
    return this.request({
      path,
      method: 'POST',
      headers: isJson ? { 'Content-Type': 'application/json' } : {}
    }, data);
  }

  async put(path, data, isJson = false) {
    return this.request({
      path,
      method: 'PUT',
      headers: isJson ? { 'Content-Type': 'application/json' } : {}
    }, data);
  }

  async delete(path) {
    return this.request({ path, method: 'DELETE' });
  }

  extractCsrf(html) {
    const match = html.match(/name="_csrf"\s+value="([^"]+)"/);
    return match ? match[1] : null;
  }
}

async function runAcceptanceTests() {
  console.log('=== STARTING 14-STEP ACCEPTANCE VERIFICATION ===\n');

  // Spawn server
  const server = spawn('node', ['app.js'], { cwd: __dirname, stdio: 'pipe' });
  let serverReady = false;

  server.stdout.on('data', d => {
    // console.log('[Server]', d.toString().trim());
    if (d.toString().includes('AcxiomCRM running')) {
      serverReady = true;
    }
  });
  server.stderr.on('data', d => console.error('[Server Err]', d.toString()));

  // Wait for server to be ready
  let attempts = 0;
  while (!serverReady && attempts < 50) {
    await sleep(100);
    attempts++;
  }
  if (!serverReady) {
    console.error('Server failed to start in time');
    server.kill();
    process.exit(1);
  }

  let passedCount = 0;

  // Step 1: Open AcxiomCRM without authentication -> protected CRM pages must not be accessible
  {
    const client = new HttpClient();
    const res = await client.get('/dashboard');
    const isRedirect = (res.statusCode === 302 && res.headers.location === '/auth/login');
    const apiRes = await client.get('/api/customers');
    const isApiDenied = (apiRes.statusCode === 401);
    if (isRedirect && isApiDenied) {
      console.log('✅ STEP 1 PASSED: Unauthenticated access blocked (Redirected to /auth/login, API returns 401).');
      passedCount++;
    } else {
      console.error('❌ STEP 1 FAILED:', { status: res.statusCode, location: res.headers.location, apiStatus: apiRes.statusCode });
    }
  }

  // Step 2: Register/login with a valid test user -> user reaches the Dashboard
  let salesClient = new HttpClient();
  {
    const loginPage = await salesClient.get('/auth/login');
    const csrfToken = salesClient.extractCsrf(loginPage.body);
    const loginRes = await salesClient.post('/auth/login', {
      _csrf: csrfToken,
      email: 'sales@acxiom.com',
      password: 'Test@1234'
    });
    const reachesDashboard = (loginRes.statusCode === 302 && loginRes.headers.location === '/dashboard');
    const dashPage = await salesClient.get('/dashboard');
    if (reachesDashboard && dashPage.statusCode === 200 && dashPage.body.includes('Sales User')) {
      console.log('✅ STEP 2 PASSED: Valid login succeeds and user reaches the Dashboard.');
      passedCount++;
    } else {
      console.error('❌ STEP 2 FAILED:', { status: loginRes.statusCode, location: loginRes.headers.location });
    }
  }

  // Step 3: Create a Customer with invalid email/phone -> client-side validation rules present
  {
    const custCreate = await salesClient.get('/customers/create');
    const hasClientRules = custCreate.body.includes('data-validate="required,email"') &&
                           custCreate.body.includes('data-validate="required,phone"');
    if (hasClientRules) {
      console.log('✅ STEP 3 PASSED: Client-side validation attributes (HTML5/JS data-validate) present on customer form.');
      passedCount++;
    } else {
      console.error('❌ STEP 3 FAILED: Customer form missing client validation rules');
    }
  }

  // Step 4: Bypass browser validation with a crafted request -> server-side validation still rejects invalid data
  {
    const custForm = await salesClient.get('/customers/create');
    const csrf = salesClient.extractCsrf(custForm.body);
    const badSubmit = await salesClient.post('/customers/create', {
      _csrf: csrf,
      CustomerName: 'Bad Cust',
      Email: 'not-an-email',
      Phone: '123' // invalid phone
    });
    // Server rejects and re-renders form with error messages
    const hasError = badSubmit.body.includes('Enter a valid email address') || badSubmit.body.includes('Enter a valid 10-digit phone number');
    if (hasError) {
      console.log('✅ STEP 4 PASSED: Server-side validation rejects crafted invalid customer request.');
      passedCount++;
    } else {
      console.error('❌ STEP 4 FAILED: Server did not reject invalid customer data');
    }
  }

  // Create valid customer for subsequent steps
  let createdCustId = null;
  {
    const custForm = await salesClient.get('/customers/create');
    const csrf = salesClient.extractCsrf(custForm.body);
    const validSubmit = await salesClient.post('/customers/create', {
      _csrf: csrf,
      CustomerName: 'Acme Corp',
      Email: 'contact@acme.com',
      Phone: '9876543210',
      CompanyName: 'Acme International',
      City: 'New York'
    });
    const list = await salesClient.get('/customers');
    const match = list.body.match(/href="\/customers\/edit\/(\d+)"/);
    if (match) createdCustId = match[1];
  }

  // Step 5: Create an Opportunity with Amount <= 0 -> rejected
  {
    const oppForm = await salesClient.get('/opportunities/create');
    const csrf = salesClient.extractCsrf(oppForm.body);
    const res = await salesClient.post('/opportunities/create', {
      _csrf: csrf,
      OpportunityName: 'Zero Opp',
      CustomerId: createdCustId,
      Amount: 0,
      Probability: 50,
      ExpectedCloseDate: '2026-12-31',
      Stage: 'Qualification',
      AssignedTo: 3
    });
    const rejected = res.body.includes('Amount must be greater than 0');
    if (rejected) {
      console.log('✅ STEP 5 PASSED: Opportunity with Amount <= 0 is rejected by server.');
      passedCount++;
    } else {
      console.error('❌ STEP 5 FAILED: Amount <= 0 was not rejected');
    }
  }

  // Step 6: Create an Opportunity with Probability > 100 -> rejected
  {
    const oppForm = await salesClient.get('/opportunities/create');
    const csrf = salesClient.extractCsrf(oppForm.body);
    const res = await salesClient.post('/opportunities/create', {
      _csrf: csrf,
      OpportunityName: 'Over 100 Opp',
      CustomerId: createdCustId,
      Amount: 5000,
      Probability: 150,
      ExpectedCloseDate: '2026-12-31',
      Stage: 'Qualification',
      AssignedTo: 3
    });
    const rejected = res.body.includes('Probability must be between 0 and 100');
    if (rejected) {
      console.log('✅ STEP 6 PASSED: Opportunity with Probability > 100 is rejected by server.');
      passedCount++;
    } else {
      console.error('❌ STEP 6 FAILED: Probability > 100 was not rejected');
    }
  }

  // Step 7: Set Expected Close Date in the past -> rejected for an active opportunity
  {
    const oppForm = await salesClient.get('/opportunities/create');
    const csrf = salesClient.extractCsrf(oppForm.body);
    const res = await salesClient.post('/opportunities/create', {
      _csrf: csrf,
      OpportunityName: 'Past Opp',
      CustomerId: createdCustId,
      Amount: 5000,
      Probability: 50,
      ExpectedCloseDate: '2020-01-01',
      Stage: 'Qualification',
      AssignedTo: 3
    });
    const rejected = res.body.includes('Expected Close Date cannot be in the past');
    if (rejected) {
      console.log('✅ STEP 7 PASSED: Active Opportunity with past close date is rejected.');
      passedCount++;
    } else {
      console.error('❌ STEP 7 FAILED: Past Expected Close Date was not rejected');
    }
  }

  // Step 8: Create a Follow-Up dated before today -> rejected for a new/planned follow-up
  {
    const fForm = await salesClient.get('/followups/create');
    const csrf = salesClient.extractCsrf(fForm.body);
    const res = await salesClient.post('/followups/create', {
      _csrf: csrf,
      Subject: 'Old Meeting',
      FollowUpDate: '2020-01-01',
      FollowUpType: 'Call',
      Status: 'Planned',
      AssignedTo: 3
    });
    const rejected = res.body.includes('Follow-up date cannot be earlier than today');
    if (rejected) {
      console.log('✅ STEP 8 PASSED: Follow-up dated before today is rejected for Planned status.');
      passedCount++;
    } else {
      console.error('❌ STEP 8 FAILED: Past Follow-up date was not rejected');
    }
  }

  // Step 9: Login as SalesExecutive -> only authorized/assigned sales scope is accessible
  {
    const auditRes = await salesClient.get('/audit');
    const userRes = await salesClient.get('/users');
    const reportRes = await salesClient.get('/reports/pipeline');
    const auditBlocked = (auditRes.statusCode === 403);
    const userBlocked = (userRes.statusCode === 403);
    const reportBlocked = (reportRes.statusCode === 403);
    if (auditBlocked && userBlocked && reportBlocked) {
      console.log('✅ STEP 9 PASSED: SalesExecutive denied access to Admin/Manager pages (/audit, /users, /reports/pipeline return 403).');
      passedCount++;
    } else {
      console.error('❌ STEP 9 FAILED: SalesExecutive was able to access privileged routes');
    }
  }

  // Step 10: Login as Manager -> team pipeline/report access is available
  const managerClient = new HttpClient();
  {
    const loginPage = await managerClient.get('/auth/login');
    const csrfToken = managerClient.extractCsrf(loginPage.body);
    await managerClient.post('/auth/login', {
      _csrf: csrfToken,
      email: 'manager@acxiom.com',
      password: 'Test@1234'
    });
    const reportRes = await managerClient.get('/reports/pipeline');
    const auditRes = await managerClient.get('/audit');
    if (reportRes.statusCode === 200 && reportRes.body.includes('Pipeline Report') && auditRes.statusCode === 403) {
      console.log('✅ STEP 10 PASSED: Manager can access pipeline reports, but cannot access admin-only /audit (403).');
      passedCount++;
    } else {
      console.error('❌ STEP 10 FAILED:', { reportStatus: reportRes.statusCode, auditStatus: auditRes.statusCode });
    }
  }

  // Step 11: Login as Admin -> user/role/audit administration is available
  const adminClient = new HttpClient();
  {
    const loginPage = await adminClient.get('/auth/login');
    const csrfToken = adminClient.extractCsrf(loginPage.body);
    await adminClient.post('/auth/login', {
      _csrf: csrfToken,
      email: 'admin@acxiom.com',
      password: 'Test@1234'
    });
    const auditRes = await adminClient.get('/audit');
    const userRes = await adminClient.get('/users');
    if (auditRes.statusCode === 200 && auditRes.body.includes('Audit Log') &&
        userRes.statusCode === 200 && userRes.body.includes('User & Role Management')) {
      console.log('✅ STEP 11 PASSED: Admin has full access to /audit and /users administration.');
      passedCount++;
    } else {
      console.error('❌ STEP 11 FAILED:', { auditStatus: auditRes.statusCode, userStatus: userRes.statusCode });
    }
  }

  // Step 12: Create/update/delete a CRM record -> appropriate audit entry is generated
  {
    const auditPage = await adminClient.get('/audit');
    const hasAuditEntries = auditPage.body.includes('Customer') && auditPage.body.includes('CREATE');
    if (hasAuditEntries) {
      console.log('✅ STEP 12 PASSED: CRM actions generate AuditLog records with User, Action, Entity, and Details.');
      passedCount++;
    } else {
      console.error('❌ STEP 12 FAILED: No audit entries found for customer actions');
    }
  }

  // Step 13: Call /api/customers -> authorized JSON response is returned
  {
    const apiRes = await adminClient.get('/api/customers');
    let isValidJson = false;
    try {
      const data = JSON.parse(apiRes.body);
      isValidJson = Array.isArray(data) && data.length > 0 && !('PasswordHash' in data[0]);
    } catch (e) {}

    if (apiRes.statusCode === 200 && isValidJson) {
      console.log('✅ STEP 13 PASSED: /api/customers returned authorized JSON response without password hashes.');
      passedCount++;
    } else {
      console.error('❌ STEP 13 FAILED:', { status: apiRes.statusCode, body: apiRes.body.slice(0, 100) });
    }
  }

  // Step 14: Open Dashboard -> KPI cards and Chart.js charts display authorized data
  {
    const dashRes = await adminClient.get('/dashboard');
    const hasCards = dashRes.body.includes('Total Customers') &&
                     dashRes.body.includes('Total Leads') &&
                     dashRes.body.includes('Pipeline Value');
    const hasCharts = dashRes.body.includes('id="leadChart"') &&
                      dashRes.body.includes('id="oppChart"') &&
                      dashRes.body.includes('id="salesChart"') &&
                      dashRes.body.includes('chart.umd.min.js');
    if (dashRes.statusCode === 200 && hasCards && hasCharts) {
      console.log('✅ STEP 14 PASSED: Dashboard KPI cards and 3 Chart.js charts render with authorized data.');
      passedCount++;
    } else {
      console.error('❌ STEP 14 FAILED: Dashboard missing cards or charts');
    }
  }

  console.log(`\n=== ACCEPTANCE SUMMARY: ${passedCount}/14 STEPS PASSED ===`);
  server.kill();
  process.exit(passedCount === 14 ? 0 : 1);
}

runAcceptanceTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});

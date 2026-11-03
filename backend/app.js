const express = require('express');
const session = require('express-session');
const csrf = require('csurf');
const path = require('path');
const expressLayouts = require('express-ejs-layouts');
const { initializeDatabase } = require('./db/database');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize database
initializeDatabase();

// View engine & layouts
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'frontend', 'views'));
app.use(expressLayouts);
app.set('layout', 'layouts/main');

// Body parsing & static assets
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'frontend', 'public')));

// Session
app.use(session({
  secret: 'acxiomcrm-secret-key-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 3600000 }
}));

// Session user to locals
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.success = null;
  res.locals.error = null;
  res.locals.csrfToken = '';
  next();
});

// CSRF protection — skip for API JSON routes
const csrfProtection = csrf();
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return next();
  }
  csrfProtection(req, res, (err) => {
    if (err) return next(err);
    res.locals.csrfToken = req.csrfToken();
    next();
  });
});

// Routes
app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.redirect('/auth/login');
});

app.use('/auth', require('./routes/auth'));
app.use('/dashboard', require('./routes/dashboard'));
app.use('/customers', require('./routes/customers'));
app.use('/leads', require('./routes/leads'));
app.use('/opportunities', require('./routes/opportunities'));
app.use('/followups', require('./routes/followups'));
app.use('/users', require('./routes/users'));
app.use('/audit', require('./routes/audit'));
app.use('/reports', require('./routes/reports'));
app.use('/api', require('./routes/api'));

// CSRF error handler
app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).render('error', {
      title: 'Forbidden',
      message: 'Invalid CSRF token. Please try again.',
      user: req.session.user
    });
  }
  console.error(err);
  res.status(500).render('error', {
    title: 'Server Error',
    message: err.message || 'An unexpected error occurred.',
    user: req.session.user
  });
});

// 404
app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Not Found',
    message: 'The page you requested was not found.',
    user: req.session.user
  });
});

app.listen(PORT, () => {
  console.log(`AcxiomCRM running at http://localhost:${PORT}`);
});

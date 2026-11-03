// Authentication middleware
function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    const isApi = req.xhr ||
                  (req.baseUrl && req.baseUrl.startsWith('/api')) ||
                  (req.originalUrl && req.originalUrl.startsWith('/api'));
    if (isApi) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    return res.redirect('/auth/login');
  }
  next();
}

// Role-based authorization middleware
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      const isApi = req.xhr ||
                    (req.baseUrl && req.baseUrl.startsWith('/api')) ||
                    (req.originalUrl && req.originalUrl.startsWith('/api'));
      if (isApi) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      return res.redirect('/auth/login');
    }
    if (!roles.includes(req.session.user.role)) {
      const isApi = req.xhr ||
                    (req.baseUrl && req.baseUrl.startsWith('/api')) ||
                    (req.originalUrl && req.originalUrl.startsWith('/api'));
      if (isApi) {
        return res.status(403).json({ error: 'Access denied' });
      }
      return res.status(403).render('error', {
        title: 'Access Denied',
        message: 'You do not have permission to access this page.',
        user: req.session.user
      });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const config = require('../config');

function ensureAuthenticated(req, res, next) {
  if (req.session && req.session.admin) {
    return next();
  }

  return res.redirect('/admin/login');
}

function setFlash(req, type, message) {
  req.session.flash = { type, message };
}

function pullFlash(req, res, next) {
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
}

function safeCompare(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));

  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

async function verifyAdminCredentials(username, password) {
  if (!safeCompare(username, config.admin.username)) {
    return false;
  }

  if (config.admin.passwordHash) {
    return bcrypt.compare(password, config.admin.passwordHash);
  }

  if (config.admin.password) {
    return safeCompare(password, config.admin.password);
  }

  return false;
}

function csrfProtection(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }

  res.locals.csrfToken = req.session.csrfToken;

  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }

  const token = req.body?._csrf || req.query?._csrf || req.headers['x-csrf-token'];

  if (token && safeCompare(token, req.session.csrfToken)) {
    return next();
  }

  return res.status(403).render('admin/error', {
    title: 'Acesso bloqueado',
    message: 'A sessão expirou. Atualize a página e tente novamente.'
  });
}

module.exports = {
  ensureAuthenticated,
  verifyAdminCredentials,
  setFlash,
  pullFlash,
  csrfProtection
};

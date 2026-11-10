const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const config = require('../config');

function wantsJson(req) {
  return req.xhr || String(req.get('accept') || '').includes('application/json');
}

function ensureAuthenticated(req, res, next) {
  if (req.session && req.session.admin) return next();
  if (wantsJson(req)) {
    return res.status(401).json({ ok: false, error: 'Sessão expirada. Entre novamente.' });
  }
  if (req.method === 'GET') req.session.returnTo = req.originalUrl;
  return res.redirect('/admin/login');
}

function safeCompare(a, b) {
  const left = crypto.createHash('sha256').update(String(a)).digest();
  const right = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(left, right) && String(a).length === String(b).length;
}

async function verifyAdminCredentials(username, password) {
  const userOk = safeCompare(username, config.admin.username);

  if (config.admin.passwordHash) {
    // Executa o bcrypt mesmo com usuário errado para não revelar quais usuários existem pelo tempo de resposta.
    const passwordOk = await bcrypt.compare(password, config.admin.passwordHash);
    return userOk && passwordOk;
  }

  if (config.admin.password) {
    return userOk && safeCompare(password, config.admin.password);
  }

  return false;
}

/* Limite simples de tentativas de login por IP (memória do processo). */
const attempts = new Map();

function loginKey(req) {
  return String(req.ip || 'unknown');
}

function loginRateLimit(req, res, next) {
  const key = loginKey(req);
  const now = Date.now();
  const windowMs = config.loginWindowMinutes * 60 * 1000;
  const entry = attempts.get(key);

  if (entry && now - entry.first > windowMs) attempts.delete(key);
  const current = attempts.get(key);

  if (current && current.count >= config.loginMaxAttempts) {
    const minutes = Math.ceil((current.first + windowMs - now) / 60000);
    return res.status(429).render('admin/login', {
      title: 'Entrar',
      error: `Muitas tentativas. Aguarde ${minutes} minuto(s) e tente novamente.`
    });
  }
  return next();
}

function registerLoginFailure(req) {
  const key = loginKey(req);
  const entry = attempts.get(key) || { count: 0, first: Date.now() };
  entry.count += 1;
  attempts.set(key, entry);
}

function clearLoginFailures(req) {
  attempts.delete(loginKey(req));
}

function resetLoginAttempts() {
  attempts.clear();
}

module.exports = {
  wantsJson,
  ensureAuthenticated,
  verifyAdminCredentials,
  safeCompare,
  loginRateLimit,
  registerLoginFailure,
  clearLoginFailures,
  resetLoginAttempts
};

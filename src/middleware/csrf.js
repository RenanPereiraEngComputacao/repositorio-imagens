const crypto = require('crypto');
const { safeCompare, wantsJson } = require('./auth');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Token sincronizado por sessão. Para formulários multipart o corpo ainda não foi
 * processado neste ponto, então o token também é aceito no cabeçalho X-CSRF-Token
 * (enviado pelo JavaScript) ou na query string (fallback sem JavaScript).
 * Nenhum arquivo é gravado antes desta verificação.
 */
function csrfProtection(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;

  if (SAFE_METHODS.has(req.method)) return next();

  const token = req.get('x-csrf-token') || req.body?._csrf || req.query?._csrf;
  if (token && safeCompare(token, req.session.csrfToken)) return next();

  if (wantsJson(req)) {
    return res.status(403).json({ ok: false, error: 'A sessão expirou. Atualize a página e tente novamente.' });
  }
  return res.status(403).render('admin/error', {
    title: 'Acesso bloqueado',
    message: 'A sessão expirou ou o formulário é inválido. Atualize a página e tente novamente.'
  });
}

module.exports = { csrfProtection };

const express = require('express');
const config = require('../../config');
const audit = require('../../services/audit');
const {
  verifyAdminCredentials,
  loginRateLimit,
  registerLoginFailure,
  clearLoginFailures
} = require('../../middleware/auth');
const { setFlash } = require('../../middleware/flash');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session.admin) return res.redirect('/admin/dashboard');
  return res.render('admin/login', { title: 'Entrar' });
});

router.post('/login', loginRateLimit, async (req, res, next) => {
  try {
    const username = String(req.body.username || '').slice(0, 160);
    const password = String(req.body.password || '').slice(0, 512);
    const valid = await verifyAdminCredentials(username, password);

    if (!valid) {
      registerLoginFailure(req);
      await audit.record({ req, action: 'auth.login', status: 'failure', summary: 'Tentativa de login inválida', details: { username } });
      return res.status(401).render('admin/login', { title: 'Entrar', error: 'Usuário ou senha inválidos.', username });
    }

    clearLoginFailures(req);
    const returnTo = typeof req.session.returnTo === 'string' && req.session.returnTo.startsWith('/admin') ? req.session.returnTo : '/admin/dashboard';

    // Novo ID de sessão após o login (evita fixação de sessão).
    return req.session.regenerate((error) => {
      if (error) return next(error);
      req.session.admin = { username, loggedAt: new Date().toISOString() };
      setFlash(req, 'success', 'Bem-vindo de volta.');
      audit.record({ req, action: 'auth.login', summary: 'Login realizado' });
      return req.session.save(() => res.redirect(returnTo));
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/logout', (req, res) => {
  if (req.session.admin) audit.record({ req, action: 'auth.logout', summary: 'Logout' });
  req.session.destroy(() => {
    res.clearCookie(config.sessionCookieName);
    res.redirect('/admin/login');
  });
});

module.exports = router;

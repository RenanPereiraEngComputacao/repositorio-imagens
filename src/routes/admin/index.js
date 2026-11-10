const express = require('express');
const { pullFlash } = require('../../middleware/flash');
const { csrfProtection } = require('../../middleware/csrf');
const { ensureAuthenticated } = require('../../middleware/auth');

const router = express.Router();

router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
});
router.use(pullFlash);
router.use(csrfProtection);

router.use(require('./auth'));

router.use(ensureAuthenticated);
router.use((req, res, next) => {
  res.locals.admin = req.session.admin;
  res.locals.currentPath = req.path;
  next();
});

router.get('/', (req, res) => res.redirect('/admin/dashboard'));

router.use(require('./dashboard'));
router.use(require('./collections'));
router.use(require('./imports'));
router.use(require('./products'));
router.use(require('./images'));
router.use(require('./uploads'));
router.use(require('./activity'));

module.exports = router;

const path = require('path');
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const helmet = require('helmet');
const config = require('./config');
const { pool } = require('./db');
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');
const { wantsJson } = require('./middleware/auth');
const { formatBytes } = require('./utils/text');
const { displayUrl, thumbUrl } = require('./services/images');

const ACTION_LABELS = {
  'auth.login': 'Login',
  'auth.logout': 'Logout',
  'collection.create': 'Coleção criada',
  'collection.update': 'Coleção editada',
  'collection.delete': 'Coleção excluída',
  'collection.restore': 'Coleção restaurada',
  'product.create': 'Produto criado',
  'product.update': 'Produto editado',
  'product.delete': 'Produto excluído',
  'product.restore': 'Produto restaurado',
  'product.import': 'Planilha importada',
  'image.upload': 'Imagens enviadas',
  'image.bulk_upload': 'Envio em massa',
  'image.reorder': 'Ordem alterada',
  'image.main': 'Imagem principal',
  'image.delete': 'Imagem excluída',
  'image.restore': 'Imagem restaurada'
};

function createApp() {
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  Object.assign(app.locals, {
    brand: 'MÁLAGAH',
    baseUrl: config.baseUrl,
    formatBytes,
    displayUrl,
    thumbUrl,
    formatDate(value) {
      if (!value) return '—';
      return new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
    },
    icon(name, className = '') {
      return `<svg class="icon ${className}" aria-hidden="true" focusable="false"><use href="/assets/icons.svg#${name}"></use></svg>`;
    },
    actionLabel(action) {
      return ACTION_LABELS[action] || action;
    },
    plural(count, one, many) {
      return `${Number(count || 0).toLocaleString('pt-BR')} ${Number(count) === 1 ? one : many}`;
    }
  });

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"]
      }
    },
    crossOriginResourcePolicy: { policy: 'same-site' }
  }));

  app.use(express.urlencoded({ extended: false, limit: '2mb', parameterLimit: 2000 }));
  app.use(express.json({ limit: '1mb' }));

  app.use(session({
    store: new PgSession({ pool, tableName: 'session', pruneSessionInterval: config.env === 'test' ? false : 60 * 15 }),
    name: config.sessionCookieName,
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.sessionCookieSecure,
      maxAge: 1000 * 60 * 60 * config.sessionMaxAgeHours
    }
  }));

  app.use('/assets', express.static(path.join(config.rootDir, 'public/assets'), {
    maxAge: config.isProduction ? '7d' : 0,
    index: false
  }));

  // URLs públicas legadas dos arquivos: /imagens/{colecao}/{referencia}/{arquivo}
  app.use('/imagens', express.static(config.uploadRoot, {
    maxAge: config.isProduction ? '30d' : 0,
    fallthrough: true,
    redirect: false,
    index: false,
    dotfiles: 'ignore'
  }));

  app.use('/admin', adminRoutes);
  app.use('/', publicRoutes);

  app.use((req, res) => {
    if (wantsJson(req)) return res.status(404).json({ ok: false, error: 'Não encontrado.' });
    return res.status(404).render('public/not-found', { title: 'Página não encontrada' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    const expose = Boolean(error && error.expose);
    const status = expose ? (error.status || 400) : 500;
    const message = expose ? error.message : 'Não foi possível concluir a operação. Tente novamente.';

    if (!expose) console.error(error);
    if (res.headersSent) return res.end();

    if (wantsJson(req)) return res.status(status).json({ ok: false, error: message });

    if (req.originalUrl.startsWith('/admin')) {
      res.locals.flash = res.locals.flash || null;
      res.locals.csrfToken = req.session?.csrfToken || '';
      return res.status(status).render('admin/error', {
        title: status === 404 ? 'Não encontrado' : 'Algo deu errado',
        message
      });
    }

    return res.status(status === 500 ? 500 : 404).render('public/not-found', { title: 'Imagens não encontradas' });
  });

  return app;
}

module.exports = { createApp };

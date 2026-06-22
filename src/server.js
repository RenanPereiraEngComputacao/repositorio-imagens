const path = require('path');
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const helmet = require('helmet');
const config = require('./config');
const { pool } = require('./db');
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"]
    }
  }
}));

app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json({ limit: '2mb' }));

app.use(session({
  store: new PgSession({
    pool,
    tableName: 'session'
  }),
  name: 'stylezee.sid',
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.sessionCookieSecure,
    maxAge: 1000 * 60 * 60 * 8
  }
}));

app.use('/assets', express.static(path.join(config.rootDir, 'public/assets'), {
  maxAge: config.env === 'production' ? '7d' : 0
}));

app.use('/imagens', express.static(config.uploadRoot, {
  maxAge: config.env === 'production' ? '30d' : 0,
  fallthrough: true,
  redirect: false
}));

app.use('/admin', adminRoutes);
app.use('/', publicRoutes);

app.use((req, res) => {
  res.status(404).render('public/not-found', {
    title: 'Imagens não encontradas'
  });
});

app.use((error, req, res, next) => {
  console.error(error);

  if (res.headersSent) {
    return next(error);
  }

  const uploadErrorMessage = error.code === 'LIMIT_FILE_SIZE'
    ? `Imagem acima do limite de ${config.maxUploadMb} MB.`
    : error.message;

  if (req.originalUrl.startsWith('/admin')) {
    return res.status(500).render('admin/error', {
      title: 'Erro interno',
      message: uploadErrorMessage || 'Não foi possível concluir a operação.'
    });
  }

  return res.status(500).render('public/not-found', {
    title: 'Imagens não encontradas'
  });
});

app.listen(config.port, () => {
  console.log(`Servidor iniciado na porta ${config.port}`);
});

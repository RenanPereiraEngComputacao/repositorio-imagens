const path = require('path');
require('dotenv').config({ path: process.env.DOTENV_PATH || path.join(process.cwd(), '.env') });

const rootDir = path.resolve(__dirname, '..');
const DEFAULT_SECRET = 'dev-session-secret-change-me';

function booleanFromEnv(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'sim'].includes(String(value).toLowerCase());
}

function sessionCookieSecureFromEnv(value, env) {
  if (value === undefined || value === '') {
    return env === 'production' ? 'auto' : false;
  }
  const normalized = String(value).toLowerCase();
  if (normalized === 'auto') return 'auto';
  return ['1', 'true', 'yes', 'sim'].includes(normalized);
}

function numberFromEnv(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const env = process.env.NODE_ENV || 'development';

const config = {
  rootDir,
  env,
  isProduction: env === 'production',
  port: numberFromEnv(process.env.PORT, 3000),
  baseUrl: (process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, ''),
  databaseUrl: process.env.DATABASE_URL,
  databaseSsl: booleanFromEnv(process.env.DATABASE_SSL, false),
  sessionSecret: process.env.SESSION_SECRET || DEFAULT_SECRET,
  // O nome do cookie foi mantido para preservar as sessões ativas após a atualização.
  sessionCookieName: process.env.SESSION_COOKIE_NAME || 'stylezee.sid',
  sessionCookieSecure: sessionCookieSecureFromEnv(process.env.COOKIE_SECURE, env),
  sessionMaxAgeHours: numberFromEnv(process.env.SESSION_MAX_AGE_HOURS, 8),
  uploadRoot: path.resolve(rootDir, process.env.UPLOAD_ROOT || 'public/imagens'),
  // Lixeira fica FORA da pasta pública: arquivos removidos deixam de ser servidos,
  // mas continuam recuperáveis até serem purgados.
  trashRoot: path.resolve(rootDir, process.env.TRASH_ROOT || 'storage/lixeira'),
  tmpRoot: path.resolve(rootDir, process.env.TMP_ROOT || '.tmp'),
  maxUploadMb: numberFromEnv(process.env.MAX_UPLOAD_MB, 12),
  maxFilesPerRequest: numberFromEnv(process.env.MAX_FILES_PER_REQUEST, 40),
  maxZipImages: numberFromEnv(process.env.MAX_ZIP_IMAGES, 200),
  loginMaxAttempts: numberFromEnv(process.env.LOGIN_MAX_ATTEMPTS, 8),
  loginWindowMinutes: numberFromEnv(process.env.LOGIN_WINDOW_MINUTES, 15),
  admin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    passwordHash: process.env.ADMIN_PASSWORD_HASH || '',
    password: process.env.ADMIN_PASSWORD || ''
  }
};

function validateConfig(current = config) {
  const problems = [];
  if (!current.databaseUrl) problems.push('DATABASE_URL não configurada.');
  if (current.isProduction && current.sessionSecret === DEFAULT_SECRET) {
    problems.push('SESSION_SECRET precisa ser definido em produção.');
  }
  if (current.isProduction && !current.admin.passwordHash && !current.admin.password) {
    problems.push('ADMIN_PASSWORD_HASH precisa ser definido em produção.');
  }
  if (current.trashRoot.startsWith(current.uploadRoot + path.sep)) {
    problems.push('TRASH_ROOT não pode ficar dentro de UPLOAD_ROOT (seria publicado).');
  }
  return problems;
}

config.validateConfig = validateConfig;

module.exports = config;

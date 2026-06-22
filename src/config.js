const path = require('path');
require('dotenv').config({ path: path.join(process.cwd(), '.env') });

const rootDir = path.resolve(__dirname, '..');

function booleanFromEnv(value, fallback = false) {
  if (value === undefined) return fallback;
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

const env = process.env.NODE_ENV || 'development';

module.exports = {
  rootDir,
  env,
  port: Number(process.env.PORT || 3000),
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',
  databaseUrl: process.env.DATABASE_URL,
  databaseSsl: booleanFromEnv(process.env.DATABASE_SSL, false),
  sessionSecret: process.env.SESSION_SECRET || 'dev-session-secret-change-me',
  sessionCookieSecure: sessionCookieSecureFromEnv(process.env.COOKIE_SECURE, env),
  uploadRoot: path.resolve(rootDir, process.env.UPLOAD_ROOT || 'public/imagens'),
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 12),
  admin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    passwordHash: process.env.ADMIN_PASSWORD_HASH || '',
    password: process.env.ADMIN_PASSWORD || ''
  }
};

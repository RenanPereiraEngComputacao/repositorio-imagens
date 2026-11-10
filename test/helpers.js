/**
 * Ambiente de teste isolado.
 *
 * - Cria um banco NOVO e descartável (nome sempre contém "test") a partir de TEST_DATABASE_URL.
 * - Usa pastas temporárias para imagens, lixeira e uploads.
 * - Ignora o .env do projeto (nunca usa as credenciais reais).
 * - Ao final remove o banco e as pastas.
 *
 * Execução:  TEST_DATABASE_URL=postgres://usuario@localhost:5432/postgres npm test
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

const PASSWORD = 'senha-de-teste-123';

function requireTestUrl() {
  const base = process.env.TEST_DATABASE_URL;
  if (!base) {
    throw new Error('Defina TEST_DATABASE_URL (conexão a um PostgreSQL de testes, ex.: postgres://postgres@localhost:5432/postgres).');
  }
  return base;
}

function withDatabase(url, dbName) {
  const parsed = new URL(url);
  parsed.pathname = `/${dbName}`;
  return parsed.toString();
}

async function setup() {
  const base = requireTestUrl();
  const dbName = `malagah_test_${process.pid}_${Date.now()}`;
  if (!/test/.test(dbName)) throw new Error('Nome de banco de teste inválido.');

  const admin = new Client({ connectionString: base });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'malagah-test-'));
  Object.assign(process.env, {
    DOTENV_PATH: path.join(root, 'nao-existe.env'),
    NODE_ENV: 'test',
    DATABASE_URL: withDatabase(base, dbName),
    SESSION_SECRET: 'segredo-de-teste',
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD_HASH: bcrypt.hashSync(PASSWORD, 4),
    UPLOAD_ROOT: path.join(root, 'imagens'),
    TRASH_ROOT: path.join(root, 'lixeira'),
    TMP_ROOT: path.join(root, 'tmp'),
    BASE_URL: 'http://teste.local',
    LOGIN_MAX_ATTEMPTS: '5',
    COOKIE_SECURE: 'false'
  });
  fs.mkdirSync(process.env.UPLOAD_ROOT, { recursive: true });

  const { run } = require('../scripts/migrate');
  await run({ log: () => {} });

  const { createApp } = require('../src/app');
  const db = require('../src/db');
  const app = createApp();

  async function teardown() {
    await db.pool.end();
    const cleanup = new Client({ connectionString: base });
    await cleanup.connect();
    await cleanup.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await cleanup.end();
    fs.rmSync(root, { recursive: true, force: true });
  }

  return { app, db, root, teardown, uploadRoot: process.env.UPLOAD_ROOT, trashRoot: process.env.TRASH_ROOT };
}

/** Faz login e devolve { agent, csrf } prontos para requisições autenticadas. */
async function login(app) {
  const request = require('supertest');
  const agent = request.agent(app);
  const page = await agent.get('/admin/login');
  const csrf = extractCsrf(page.text);
  const response = await agent.post('/admin/login').type('form').send({ _csrf: csrf, username: 'admin', password: PASSWORD });
  if (response.status !== 302) throw new Error(`Login falhou: ${response.status}`);
  const dashboard = await agent.get('/admin/dashboard');
  return { agent, csrf: extractCsrf(dashboard.text) };
}

function extractCsrf(html) {
  const match = /name="csrf-token" content="([a-f0-9]+)"/.exec(html) || /name="_csrf" value="([a-f0-9]+)"/.exec(html);
  if (!match) throw new Error('Token CSRF não encontrado na página.');
  return match[1];
}

async function makeImage({ width = 1200, height = 1500, color = '#c9b8a0', format = 'jpeg' } = {}) {
  const sharp = require('sharp');
  return sharp({ create: { width, height, channels: 3, background: color } })[format]({ quality: 90 }).toBuffer();
}

/** Cria coleção + produto + imagens no formato legado (arquivo direto em imagens/<slug>/<ref>/). */
async function seedLegacy(db, uploadRoot, { slug = 'verao27', name = 'Verão 27', reference = '217.0004VT', images = 2, active = true } = {}) {
  const collection = await db.query('INSERT INTO collections (name, slug, active) VALUES ($1, $2, TRUE) RETURNING *', [name, slug]);
  const product = await db.query(
    'INSERT INTO products (collection_id, reference, name, active) VALUES ($1, $2, $3, $4) RETURNING *',
    [collection.rows[0].id, reference, 'Vestido teste', active]
  );
  const folder = path.join(uploadRoot, slug, reference);
  fs.mkdirSync(folder, { recursive: true });
  const rows = [];
  for (let index = 0; index < images; index += 1) {
    const filename = `legado-${index + 1}.jpg`;
    const buffer = await makeImage({ color: ['#c9b8a0', '#8a6b48', '#56684f', '#9b3f2f'][index % 4] });
    fs.writeFileSync(path.join(folder, filename), buffer);
    const row = await db.query(
      `INSERT INTO product_images (product_id, file_path, file_url, display_order, is_main)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [product.rows[0].id, `imagens/${slug}/${reference}/${filename}`, `/imagens/${slug}/${reference}/${filename}`, index + 1, index === 0]
    );
    rows.push({ ...row.rows[0], buffer });
  }
  return { collection: collection.rows[0], product: product.rows[0], images: rows };
}

function binaryParser(res, callback) {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

module.exports = { setup, login, extractCsrf, makeImage, seedLegacy, binaryParser, PASSWORD };

#!/usr/bin/env node
/**
 * Aplica db/schema.sql (base idempotente) e, em seguida, cada arquivo de
 * db/migrations em ordem alfabética. Cada migração roda em transação e fica
 * registrada em schema_migrations com checksum; reaplicar é seguro.
 *
 * Uso:
 *   npm run db:migrate            aplica pendentes
 *   npm run db:migrate:status     apenas lista o estado
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const config = require('../src/config');

const MIGRATIONS_DIR = path.join(config.rootDir, 'db', 'migrations');
const SCHEMA_FILE = path.join(config.rootDir, 'db', 'schema.sql');
const LOCK_KEY = 72_465_001; // chave arbitrária para pg_advisory_lock

function checksum(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

async function run({ statusOnly = false, connectionString = config.databaseUrl, log = console.log } = {}) {
  if (!connectionString) throw new Error('DATABASE_URL não configurada.');

  const client = new Client({
    connectionString,
    ssl: config.databaseSsl ? { rejectUnauthorized: false } : false
  });
  await client.connect();

  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);

    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);

    const files = fs.readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith('.sql')).sort();
    const applied = new Map(
      (await client.query('SELECT name, checksum FROM schema_migrations')).rows.map((row) => [row.name, row.checksum])
    );

    if (statusOnly) {
      for (const file of files) {
        const state = applied.has(file) ? 'aplicada' : 'PENDENTE';
        log(`${state.padEnd(9)} ${file}`);
      }
      return { pending: files.filter((file) => !applied.has(file)) };
    }

    log('→ base: db/schema.sql');
    await client.query(fs.readFileSync(SCHEMA_FILE, 'utf8'));

    const newlyApplied = [];
    for (const file of files) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      const sum = checksum(sql);

      if (applied.has(file)) {
        if (applied.get(file) !== sum) {
          log(`! ${file} já aplicada, mas o arquivo foi alterado depois (checksum diferente).`);
        }
        continue;
      }

      log(`→ aplicando ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [file, sum]);
        await client.query('COMMIT');
        newlyApplied.push(file);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Falha ao aplicar ${file}: ${error.message}`);
      }
    }

    log(newlyApplied.length ? `✓ ${newlyApplied.length} migração(ões) aplicada(s).` : '✓ Banco já está atualizado.');
    return { applied: newlyApplied };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    await client.end();
  }
}

if (require.main === module) {
  run({ statusOnly: process.argv.includes('--status') }).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { run };

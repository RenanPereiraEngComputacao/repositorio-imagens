const { Pool } = require('pg');
const config = require('./config');

if (!config.databaseUrl) {
  console.warn('DATABASE_URL nao foi configurada. Configure o .env antes de iniciar em producao.');
}

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : false
});

async function query(text, params) {
  return pool.query(text, params);
}

async function transaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  query,
  transaction
};

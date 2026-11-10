const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : false,
  max: Number(process.env.DATABASE_POOL_MAX || 10)
});

pool.on('error', (error) => {
  console.error('[db] erro inesperado no pool:', error.message);
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
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('[db] falha no rollback:', rollbackError.message);
    }
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

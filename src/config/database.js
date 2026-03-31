const { Pool } = require('pg');

// Support DATABASE_URL (ex. Render, Neon) ou variables séparées DB_*
const baseConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || 'global_exchange',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
    };

const poolConfig = {
  ...baseConfig,
  max: parseInt(process.env.DB_POOL_MAX, 10) || 20,
  min: parseInt(process.env.DB_POOL_MIN, 10) || 2,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
};

const pool = new Pool(poolConfig);

pool.on('connect', () => {
  pool.removeAllListeners('connect');
  console.log('📦 PostgreSQL connection pool ready');
});

pool.on('error', (err) => {
  console.error('❌ PostgreSQL pool error:', err);
});

// Helper function for queries
const query = async (text, params) => {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV === 'development') {
      console.log('Executed query', { text: text.substring(0, 50), duration, rows: result.rowCount });
    }
    return result;
  } catch (error) {
    console.error('Query error:', error);
    throw error;
  }
};

/**
 * Obtenir un client dédié pour une transaction SQL (BEGIN / COMMIT / ROLLBACK).
 * Usage :
 *   const client = await getClient();
 *   try {
 *     await client.query('BEGIN');
 *     // ... queries ...
 *     await client.query('COMMIT');
 *   } catch (e) {
 *     await client.query('ROLLBACK');
 *     throw e;
 *   } finally {
 *     client.release();
 *   }
 */
const getClient = () => pool.connect();

module.exports = {
  pool,
  query,
  getClient
};

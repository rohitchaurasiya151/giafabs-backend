/**
 * Database Configuration
 * Manages PostgreSQL connection pool and query execution
 */

const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '8090', 10),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'EUogQFxWyDAsnY-bZNcRBnmxtbFK46M3',
  database: process.env.PGDATABASE || 'bd_zb',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

/**
 * Execute a query
 * @param {string} sql - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<Array>} Query results
 */
async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows;
  } catch (err) {
    console.error('Query error:', err);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Execute a query and return single row
 * @param {string} sql - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<Object>} Single row or null
 */
async function queryOne(sql, params = []) {
  const results = await query(sql, params);
  return results.length > 0 ? results[0] : null;
}

/**
 * Execute query in transaction
 * @param {Function} callback - Async function with client parameter
 * @returns {Promise<any>} Transaction result
 */
async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Transaction error:', err);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Get database connection pool
 * @returns {Pool} PostgreSQL pool
 */
function getPool() {
  return pool;
}

module.exports = {
  query,
  queryOne,
  transaction,
  getPool,
  pool,
};

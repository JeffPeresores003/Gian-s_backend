'use strict';

const mysql = require('mysql2/promise');
const logger = require('./logger');

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: '+00:00',
  charset: 'utf8mb4',
});

// Verify connection on startup
(async () => {
  try {
    const conn = await pool.getConnection();
    logger.info('MySQL connection pool established.');
    conn.release();
  } catch (err) {
    logger.error('Failed to establish MySQL connection pool', { error: err.message });
    process.exit(1);
  }
})();

module.exports = pool;

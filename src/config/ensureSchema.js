'use strict';

/**
 * Idempotent schema upgrades for Admin Order Management (edit / refund / audit).
 *
 * Runs once on server start. Uses information_schema checks so it works on
 * both MySQL 8 and MariaDB (Hostinger) without relying on
 * "ADD COLUMN IF NOT EXISTS" support. Safe to run repeatedly.
 *
 * The same changes are documented in database/admin_order_management.sql
 * if you prefer to run them manually.
 */

const logger = require('./logger');

const ORDER_COLUMNS = [
  { name: 'refund_amount', ddl: 'DECIMAL(10, 2) NOT NULL DEFAULT 0.00' },
  { name: 'refund_reason', ddl: 'TEXT NULL' },
  { name: 'refunded_at', ddl: 'DATETIME NULL' },
  { name: 'refunded_by', ddl: 'VARCHAR(80) NULL' },
  { name: 'edited_at', ddl: 'DATETIME NULL' },
  { name: 'edited_by', ddl: 'VARCHAR(80) NULL' },
];

const state = { ready: false };

const ensureSchema = async (pool) => {
  try {
    const [cols] = await pool.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'`
    );
    if (!cols.length) {
      logger.warn('ensureSchema: `orders` table not found — skipping admin order upgrades.');
      return;
    }

    const existing = new Set(cols.map((c) => c.COLUMN_NAME));
    for (const col of ORDER_COLUMNS) {
      if (!existing.has(col.name)) {
        await pool.query(`ALTER TABLE orders ADD COLUMN \`${col.name}\` ${col.ddl}`);
        logger.info(`ensureSchema: added orders.${col.name}`);
      }
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS order_audit_log (
        id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        order_id      INT UNSIGNED NOT NULL,
        action        VARCHAR(30)  NOT NULL,
        amount        DECIMAL(10, 2) DEFAULT NULL,
        reason        TEXT,
        details       TEXT,
        performed_by  VARCHAR(80)  DEFAULT NULL,
        created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_audit_order (order_id),
        CONSTRAINT fk_audit_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    state.ready = true;
  } catch (err) {
    // Never crash the API because of an optional upgrade — just log it.
    logger.error('ensureSchema: failed to apply admin order upgrades', { error: err.message });
  }
};

module.exports = ensureSchema;
module.exports.isAdminSchemaReady = () => state.ready;

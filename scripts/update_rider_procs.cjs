const mysql = require('mysql2/promise');
require('dotenv').config();

(async () => {
  try {
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT
    });

    console.log('Connected to Hostinger MySQL.');

    console.log('1. Updating sp_VerifyQRToken to support query by QR, OTN, or Customer Name...');
    await conn.query('DROP PROCEDURE IF EXISTS sp_VerifyQRToken');
    await conn.query(`
      CREATE PROCEDURE sp_VerifyQRToken(IN p_query VARCHAR(100))
      BEGIN
        DECLARE v_order_id INT UNSIGNED;

        -- 1. Check exact match by qr_token, order_number, or numeric id
        SELECT id INTO v_order_id
        FROM orders
        WHERE order_type = 'online'
          AND (
            qr_token = p_query
            OR order_number = p_query
            OR CAST(id AS CHAR) = p_query
          )
        ORDER BY created_at DESC
        LIMIT 1;

        -- 2. If no exact match, search by partial order_number, customer_name, or contact_number
        IF v_order_id IS NULL THEN
          SELECT id INTO v_order_id
          FROM orders
          WHERE order_type = 'online'
            AND (
              order_number LIKE CONCAT('%', p_query, '%')
              OR customer_name LIKE CONCAT('%', p_query, '%')
              OR contact_number LIKE CONCAT('%', p_query, '%')
            )
          ORDER BY
            CASE
              WHEN status = 'to_deliver' THEN 1
              WHEN status = 'confirmed'  THEN 2
              WHEN status = 'delivered'  THEN 3
              ELSE 4
            END ASC,
            created_at DESC
          LIMIT 1;
        END IF;

        -- Result set 1: Order header
        SELECT
          id, order_number, customer_name, contact_number,
          delivery_address, delivery_fee,
          total_amount, payment_method, status, rider_name,
          notes, created_at, qr_token
        FROM orders
        WHERE id = v_order_id
          AND order_type = 'online'
        LIMIT 1;

        -- Result set 2: All items
        SELECT
          oi.id, oi.product_name, oi.quantity, oi.unit_price, oi.subtotal, oi.is_updated
        FROM order_items oi
        WHERE oi.order_id = v_order_id
        ORDER BY oi.is_updated ASC, oi.id ASC;
      END
    `);
    console.log('sp_VerifyQRToken updated successfully.');

    console.log('2. Updating sp_MarkOrderDelivered to support QR, OTN, or order ID...');
    await conn.query('DROP PROCEDURE IF EXISTS sp_MarkOrderDelivered');
    await conn.query(`
      CREATE PROCEDURE sp_MarkOrderDelivered(
        IN p_identifier VARCHAR(100),
        IN p_rider_name VARCHAR(80)
      )
      BEGIN
        DECLARE v_order_id INT UNSIGNED;
        DECLARE v_status   VARCHAR(30);

        SELECT id, status
        INTO   v_order_id, v_status
        FROM   orders
        WHERE  order_type = 'online'
          AND  (
            qr_token = p_identifier
            OR order_number = p_identifier
            OR CAST(id AS CHAR) = p_identifier
          )
        LIMIT 1;

        IF v_order_id IS NULL THEN
          SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Order not found';
        END IF;

        IF v_status NOT IN ('to_deliver', 'confirmed') THEN
          SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Order is already completed or cancelled';
        END IF;

        UPDATE orders
        SET
          status     = 'delivered',
          rider_name = p_rider_name
        WHERE id = v_order_id;

        SELECT id, order_number, status, rider_name
        FROM   orders
        WHERE  id = v_order_id;
      END
    `);
    console.log('sp_MarkOrderDelivered updated successfully.');

    console.log('3. Updating sp_CancelOrderByRider to support QR, OTN, or order ID...');
    await conn.query('DROP PROCEDURE IF EXISTS sp_CancelOrderByRider');
    await conn.query(`
      CREATE PROCEDURE sp_CancelOrderByRider(
        IN p_identifier VARCHAR(100),
        IN p_rider_name VARCHAR(80)
      )
      BEGIN
        DECLARE v_order_id INT UNSIGNED;
        DECLARE v_status   VARCHAR(30);

        SELECT id, status
        INTO   v_order_id, v_status
        FROM   orders
        WHERE  order_type = 'online'
          AND  (
            qr_token = p_identifier
            OR order_number = p_identifier
            OR CAST(id AS CHAR) = p_identifier
          )
        LIMIT 1;

        IF v_order_id IS NULL THEN
          SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Order not found';
        END IF;

        UPDATE orders
        SET
          status     = 'cancelled',
          rider_name = p_rider_name
        WHERE id = v_order_id;

        SELECT id, order_number, status, rider_name
        FROM   orders
        WHERE  id = v_order_id;
      END
    `);
    console.log('sp_CancelOrderByRider updated successfully.');

    await conn.end();
    console.log('All procedures updated successfully!');
  } catch (err) {
    console.error('Migration error:', err);
    process.exit(1);
  }
})();

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

    console.log('1. Altering products table to MEDIUMTEXT for image_url...');
    await conn.query('ALTER TABLE products MODIFY COLUMN image_url MEDIUMTEXT');
    console.log('Table altered successfully.');

    console.log('2. Updating sp_CreateProduct...');
    await conn.query('DROP PROCEDURE IF EXISTS sp_CreateProduct');
    await conn.query(`
      CREATE PROCEDURE sp_CreateProduct(
        IN  p_name         VARCHAR(150),
        IN  p_description  TEXT,
        IN  p_price        DECIMAL(10,2),
        IN  p_category     VARCHAR(100),
        IN  p_image_url    MEDIUMTEXT,
        IN  p_is_available TINYINT(1)
      )
      BEGIN
        INSERT INTO products (name, description, price, category, image_url, is_available)
        VALUES (p_name, p_description, p_price, p_category, p_image_url, p_is_available);
        SELECT LAST_INSERT_ID() AS new_id;
      END
    `);
    console.log('sp_CreateProduct updated successfully.');

    console.log('3. Updating sp_UpdateProduct...');
    await conn.query('DROP PROCEDURE IF EXISTS sp_UpdateProduct');
    await conn.query(`
      CREATE PROCEDURE sp_UpdateProduct(
        IN p_id           INT UNSIGNED,
        IN p_name         VARCHAR(150),
        IN p_description  TEXT,
        IN p_price        DECIMAL(10,2),
        IN p_category     VARCHAR(100),
        IN p_image_url    MEDIUMTEXT,
        IN p_is_available TINYINT(1)
      )
      BEGIN
        UPDATE products
        SET    name         = p_name,
               description  = p_description,
               price        = p_price,
               category     = p_category,
               image_url    = p_image_url,
               is_available = p_is_available
        WHERE  id = p_id;
      END
    `);
    console.log('sp_UpdateProduct updated successfully.');

    const [cols] = await conn.query("SHOW COLUMNS FROM products WHERE Field = 'image_url'");
    console.log('Updated column:', cols[0]);

    await conn.end();
    console.log('All DB changes applied successfully!');
  } catch (err) {
    console.error('Error updating schema:', err);
    process.exit(1);
  }
})();

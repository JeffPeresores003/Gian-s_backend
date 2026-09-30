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
    const [cols] = await conn.query("SHOW COLUMNS FROM products WHERE Field = 'image_url'");
    console.log('image_url column:', cols);

    const [procs] = await conn.query("SHOW CREATE PROCEDURE sp_UpdateProduct");
    console.log('sp_UpdateProduct definition:\n', procs[0]['Create Procedure']);

    const [createProcs] = await conn.query("SHOW CREATE PROCEDURE sp_CreateProduct");
    console.log('sp_CreateProduct definition:\n', createProcs[0]['Create Procedure']);

    await conn.end();
  } catch (err) {
    console.error('Error:', err);
  }
})();

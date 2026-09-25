'use strict';

require('dotenv').config();
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

async function seedCashier() {
  const username = process.argv[2] || 'cashier';
  const password = process.argv[3] || 'GiansCashier2026!';

  console.log(`Hashing password for cashier account "${username}"...`);
  const salt = await bcrypt.genSalt(12);
  const hash = await bcrypt.hash(password, salt);

  console.log('\n--- Cashier Credentials ---');
  console.log(`Username: ${username}`);
  console.log(`Password: ${password}`);
  console.log(`Role:     cashier`);
  console.log(`Hash:     ${hash}`);
  console.log('---------------------------\n');

  try {
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: parseInt(process.env.DB_PORT, 10) || 3306,
    });

    console.log('Connected to MySQL. Updating or inserting cashier record...');
    await connection.execute(
      `INSERT INTO admins (username, password_hash, role) 
       VALUES (?, ?, 'cashier') 
       ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), role = 'cashier'`,
      [username, hash]
    );

    console.log('Cashier account successfully configured in database!');
    await connection.end();
  } catch (err) {
    console.error('Database error:', err.message);
  }
}

seedCashier();

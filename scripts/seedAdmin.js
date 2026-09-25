'use strict';

require('dotenv').config();
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

async function seed() {
  const username = process.argv[2] || 'admin';
  const password = process.argv[3] || 'GiansAdmin2026!';

  console.log(`Hashing password for admin user "${username}"...`);
  const salt = await bcrypt.genSalt(12);
  const hash = await bcrypt.hash(password, salt);

  console.log('\n--- Generated Password Hash ---');
  console.log(`Username: ${username}`);
  console.log(`Password: ${password}`);
  console.log(`Hash:     ${hash}`);
  console.log('-------------------------------\n');

  if (!process.env.DB_HOST || process.env.DB_HOST === 'your_hostinger_host') {
    console.log('No live DB configured in .env yet.');
    console.log('You can insert this directly into MySQLyog / Hostinger MySQL:');
    console.log(`\nINSERT INTO admins (username, password_hash) VALUES ('${username}', '${hash}');\n`);
    return;
  }

  try {
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: parseInt(process.env.DB_PORT, 10) || 3306,
    });

    console.log('Connected to MySQL. Inserting admin record...');
    await connection.execute(
      'INSERT INTO admins (username, password_hash) VALUES (?, ?) ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)',
      [username, hash]
    );

    console.log('Admin account successfully configured in database!');
    await connection.end();
  } catch (err) {
    console.error('Database connection error:', err.message);
    console.log('\nYou can manually insert the admin with this SQL in MySQLyog:');
    console.log(`INSERT INTO admins (username, password_hash) VALUES ('${username}', '${hash}');`);
  }
}

seed();

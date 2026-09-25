'use strict';

require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

async function migrate() {
  console.log('Connecting to MySQL database...');

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    multipleStatements: true,
  });

  try {
    console.log('1. Applying schema changes (tables and columns)...');
    const schemaSql = fs.readFileSync(
      path.join(__dirname, '../database/cashier_and_inventory.sql'),
      'utf8'
    );
    await connection.query(schemaSql);
    console.log('Schema tables verified / updated.');

    console.log('2. Applying stored procedures...');
    const procsSql = fs.readFileSync(
      path.join(__dirname, '../database/cashier_and_inventory_procs.sql'),
      'utf8'
    );

    // Stored procedures need to be split on $$
    const cleaned = procsSql
      .replace(/DELIMITER\s+\$\$/gi, '')
      .replace(/DELIMITER\s+;/gi, '');

    const chunks = cleaned
      .split('$$')
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    for (const chunk of chunks) {
      if (chunk.length > 0) {
        await connection.query(chunk);
      }
    }
    console.log('Stored procedures created successfully.');

    console.log('3. Seeding Cashier account...');
    const cashierUsername = 'cashier';
    const cashierPassword = 'GiansCashier2026!';
    const salt = await bcrypt.genSalt(12);
    const cashierHash = await bcrypt.hash(cashierPassword, salt);

    await connection.execute(
      `INSERT INTO admins (username, password_hash, role) 
       VALUES (?, ?, 'cashier') 
       ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), role = 'cashier'`,
      [cashierUsername, cashierHash]
    );
    console.log(`Cashier account seeded! (Username: ${cashierUsername}, Password: ${cashierPassword})`);

    // Ensure existing admin has role 'admin'
    await connection.execute(
      `UPDATE admins SET role = 'admin' WHERE username = 'admin' AND (role IS NULL OR role = '')`
    );

    console.log('4. Seeding sample raw stock items...');
    const sampleStocks = [
      ['Fresh Whole Milk', 'Dairy', 24.00, 'Liters', 6.00, 95.00, 'Arla / Cowhead fresh milk for lattes and cappuccinos'],
      ['Arabica Coffee Beans', 'Coffee & Beans', 18.50, 'Kilograms', 5.00, 650.00, 'Single-origin espresso roast beans'],
      ['Robusta Coffee Blend', 'Coffee & Beans', 12.00, 'Kilograms', 4.00, 420.00, 'Signature dark roast house blend'],
      ['Condensed Milk', 'Dairy', 36.00, 'Cans', 8.00, 48.00, 'Sweetened condensed milk for Spanish Latte and iced drinks'],
      ['Beef Burger Patties', 'Frozen & Meat', 65.00, 'Pieces', 20.00, 38.00, '100% seasoned beef patties for burger specials'],
      ['French Fries (Shoestring)', 'Frozen & Meat', 22.00, 'Kilograms', 6.00, 160.00, 'Crispy cut frozen fries'],
      ['Brioche Burger Buns', 'Bakery', 70.00, 'Pieces', 25.00, 18.00, 'Daily fresh delivered burger buns'],
      ['Cheddar Cheese Slices', 'Dairy', 50.00, 'Packs', 15.00, 85.00, 'Melted cheese slices for sandwiches and burgers'],
      ['Caramel & Vanilla Syrups', 'Condiments', 10.00, 'Bottles', 3.00, 320.00, 'Flavor infusions for special drinks'],
      ['Paper Cups & Lids (16oz)', 'Packaging', 350.00, 'Pieces', 100.00, 4.50, 'Biodegradable branded takeaway cups']
    ];

    for (const stock of sampleStocks) {
      await connection.execute(
        `INSERT INTO inventory_stocks (item_name, category, quantity, unit, min_quantity, cost_per_unit, notes)
         SELECT ?, ?, ?, ?, ?, ?, ?
         WHERE NOT EXISTS (SELECT 1 FROM inventory_stocks WHERE item_name = ?)`,
        [...stock, stock[0]]
      );
    }
    console.log('Sample raw stocks seeded successfully.');

    console.log('\n==============================================');
    console.log('ALL CASHIER & INVENTORY MIGRATIONS COMPLETED!');
    console.log('==============================================');
  } catch (err) {
    console.error('Migration failed:', err);
    throw err;
  } finally {
    await connection.end();
  }
}

migrate()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));

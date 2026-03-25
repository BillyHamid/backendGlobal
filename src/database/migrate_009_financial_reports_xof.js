/**
 * Ajoute la colonne currency (XOF) sur financial_reports.
 * Usage : npm run db:migrate:financial-reports-xof
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');

async function main() {
  const filePath = path.join(__dirname, 'migrations', '009_financial_reports_xof.sql');
  const sql = fs.readFileSync(filePath, 'utf8');
  console.log('📦 Applying 009_financial_reports_xof.sql...');
  try {
    await pool.query(sql);
    console.log('✅ Colonne currency (XOF) ajoutée sur financial_reports.');
  } catch (err) {
    console.error('❌', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();

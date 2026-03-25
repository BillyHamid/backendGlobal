/**
 * Applique uniquement la migration 008 (rapports financiers).
 * Utile si db:migrate:extra s’est arrêté avant ou pour une base déjà à jour sauf 008.
 *
 * Usage : npm run db:migrate:financial-reports
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');

async function main() {
  const filePath = path.join(__dirname, 'migrations', '008_financial_reports.sql');
  const sql = fs.readFileSync(filePath, 'utf8');
  console.log('📦 Applying 008_financial_reports.sql...');
  try {
    await pool.query(sql);
    console.log('✅ Tables financial_reports et financial_report_items créées.');
  } catch (err) {
    console.error('❌', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();

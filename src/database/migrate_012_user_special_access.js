const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const { pool } = require('../config/database');

async function main() {
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'migrations/012_user_special_access.sql'), 'utf8');
    await pool.query(sql);
    const result = await pool.query(`SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'has_special_access'`);
    if (result.rowCount !== 1) throw new Error('Colonne absente');
    console.log('Migration 012 vérifiée : users.has_special_access');
  } finally { await pool.end(); }
}

main().catch(error => { console.error('Migration 012 échouée :', error.code || error.name); process.exitCode = 1; });

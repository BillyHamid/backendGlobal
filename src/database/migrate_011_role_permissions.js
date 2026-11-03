const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const { pool } = require('../config/database');

async function main() {
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'migrations/011_role_permissions.sql'), 'utf8');
    await pool.query(sql);
    const result = await pool.query("SELECT to_regclass('public.role_permissions') AS table_name");
    console.log('Migration 011 vérifiée :', result.rows[0].table_name);
  } finally { await pool.end(); }
}

main().catch(error => { console.error('Migration 011 échouée :', error.code || error.name); process.exitCode = 1; });

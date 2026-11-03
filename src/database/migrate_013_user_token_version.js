const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const { pool } = require('../config/database');

async function main() {
  try {
    await pool.query(fs.readFileSync(path.join(__dirname, 'migrations/013_user_token_version.sql'), 'utf8'));
    const result = await pool.query(`SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'token_version'`);
    if (result.rowCount !== 1) throw new Error('Colonne absente');
    console.log('Migration 013 vérifiée : users.token_version');
  } finally { await pool.end(); }
}

main().catch(error => { console.error('Migration 013 échouée :', error.code || error.name); process.exitCode = 1; });

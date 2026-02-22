require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');

async function applyMigration(migrationFile) {
  const migrationPath = path.join(__dirname, 'migrations', migrationFile);
  
  if (!fs.existsSync(migrationPath)) {
    console.error(`❌ Migration file not found: ${migrationFile}`);
    process.exit(1);
  }
  
  const sql = fs.readFileSync(migrationPath, 'utf8');
  
  try {
    await pool.query(sql);
    console.log(`✅ Migration applied: ${migrationFile}`);
  } catch (error) {
    console.error(`❌ Migration failed: ${migrationFile}`, error.message);
    process.exit(1);
  }
}

async function main() {
  const migrationFile = process.argv[2] || '003_add_transfer_confirmation.sql';
  
  console.log(`📦 Applying migration: ${migrationFile}`);
  await applyMigration(migrationFile);
  await pool.end();
}

main();

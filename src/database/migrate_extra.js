/**
 * Applique les migrations numérotées 002→009 dans l'ordre.
 * Bases déjà initialisées : npm run db:migrate:extra
 * Nouvelle base vide : npm run db:migrate:all (schéma + ce fichier).
 * Option prod : RUN_MIGRATIONS_ON_START=1 dans server.js.
 */
const path = require('path');
const fs = require('fs');

const MIGRATIONS = [
  '002_push_subscriptions.sql',
  '003_add_transfer_confirmation.sql',
  '004_add_cash_accounts.sql',
  '005_add_ledger_entry_proof.sql',
  '006_special_expenses_loans.sql',
  '007_add_rate_reel.sql',
  '008_financial_reports.sql',
  '009_financial_reports_xof.sql',
];

async function applyExtraMigrations(pool) {
  console.log('📦 Applying extra migrations (002–009)...');
  for (const file of MIGRATIONS) {
    const filePath = path.join(__dirname, 'migrations', file);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Migration file not found: ${file}`);
    }
    const sql = fs.readFileSync(filePath, 'utf8');
    try {
      await pool.query(sql);
      console.log(`✅ ${file}`);
    } catch (err) {
      const msg = String(err.message || '');
      const skip =
        err.code === '42P07' ||
        err.code === '42710' ||
        msg.includes('already exists') ||
        msg.includes('existe déjà');
      if (skip) {
        console.log(`⏭️ ${file} (already applied)`);
      } else {
        throw err;
      }
    }
  }
}

async function main() {
  require('dotenv').config();
  const { pool } = require('../config/database');
  try {
    await applyExtraMigrations(pool);
  } finally {
    await pool.end();
  }
  console.log('Done.');
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { applyExtraMigrations, MIGRATIONS };

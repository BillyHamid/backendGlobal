require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');
const { applyExtraMigrations } = require('./migrate_extra');

async function migrate() {
  console.log('🚀 Starting database migration...');

  try {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    await pool.query(schema);

    console.log('✅ Base schema applied (14 tables)');
    console.log('');

    await applyExtraMigrations(pool);

    console.log('');
    console.log('🎉 Database fully migrated and ready!');
    console.log('');
    console.log('Tables:');
    console.log('  - users');
    console.log('  - senders');
    console.log('  - beneficiaries');
    console.log('  - transfers');
    console.log('  - exchange_rates');
    console.log('  - audit_logs');
    console.log('  - push_subscriptions');
    console.log('  - accounts');
    console.log('  - ledger_entries');
    console.log('  - special_expenses');
    console.log('  - personal_wallets');
    console.log('  - loans');
    console.log('  - financial_reports');
    console.log('  - financial_report_items');
    console.log('');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();

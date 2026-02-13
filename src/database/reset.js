require('dotenv').config();
const { pool } = require('../config/database');

async function reset() {
  console.log('⚠️  Resetting database...');
  console.log('');
  
  try {
    // Drop all tables in reverse order of dependencies
    await pool.query(`
      DROP TABLE IF EXISTS audit_logs CASCADE;
      DROP TABLE IF EXISTS transfers CASCADE;
      DROP TABLE IF EXISTS exchange_rates CASCADE;
      DROP TABLE IF EXISTS beneficiaries CASCADE;
      DROP TABLE IF EXISTS senders CASCADE;
      DROP TABLE IF EXISTS users CASCADE;
      DROP FUNCTION IF EXISTS update_updated_at_column CASCADE;
    `);
    
    console.log('✅ All tables dropped');
    console.log('');
    console.log('Run the following commands to recreate:');
    console.log('  npm run db:migrate');
    console.log('  npm run db:seed');
    console.log('');

  } catch (error) {
    console.error('❌ Reset failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

reset();

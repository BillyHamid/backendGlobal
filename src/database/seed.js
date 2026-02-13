require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('../config/database');

async function seed() {
  console.log('🌱 Seeding database...');
  
  try {
    // Hash password (same for all demo users)
    const hashedPassword = await bcrypt.hash('password123', 10);
    
    // Insert users
    const users = [
      {
        email: 'admin@globalexchange.com',
        password: hashedPassword,
        name: 'Admin Système',
        phone: '+1 555 000 0001',
        role: 'admin',
        country: 'USA',
        agent_code: null
      },
      {
        email: 'superviseur@globalexchange.com',
        password: hashedPassword,
        name: 'Jean Superviseur',
        phone: '+1 555 000 0002',
        role: 'supervisor',
        country: 'USA',
        agent_code: null
      },
      {
        email: 'razack@globalexchange.com',
        password: hashedPassword,
        name: 'Zongo Razack',
        phone: '+1 555 123 4567',
        role: 'sender_agent',
        country: 'USA',
        agent_code: 'USA-001'
      },
      {
        email: 'bernadette@globalexchange.com',
        password: hashedPassword,
        name: 'Bernadette Tassembedo',
        phone: '+226 70 00 00 01',
        role: 'payer_agent',
        country: 'Burkina Faso',
        agent_code: 'BF-001'
      },
      {
        email: 'abibata@globalexchange.com',
        password: hashedPassword,
        name: 'Abibata Zougrana',
        phone: '+226 70 00 00 02',
        role: 'payer_agent',
        country: 'Burkina Faso',
        agent_code: 'BF-002'
      },
      {
        email: 'mohamadi@globalexchange.com',
        password: hashedPassword,
        name: 'Mohamadi Sana',
        phone: '+226 70 00 00 03',
        role: 'payer_agent',
        country: 'Burkina Faso',
        agent_code: 'BF-003'
      }
    ];

    for (const user of users) {
      await pool.query(
        `INSERT INTO users (email, password, name, phone, role, country, agent_code)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (email) DO NOTHING`,
        [user.email, user.password, user.name, user.phone, user.role, user.country, user.agent_code]
      );
    }
    console.log('✅ Users seeded');

    // Insert exchange rates
    const rates = [
      { from: 'USD', to: 'XOF', rate: 615 },
      { from: 'EUR', to: 'XOF', rate: 655.957 },
      { from: 'CAD', to: 'XOF', rate: 450 },
      { from: 'GBP', to: 'XOF', rate: 780 }
    ];

    for (const rate of rates) {
      await pool.query(
        `INSERT INTO exchange_rates (from_currency, to_currency, rate)
         VALUES ($1, $2, $3)
         ON CONFLICT (from_currency, to_currency) DO UPDATE SET rate = $3`,
        [rate.from, rate.to, rate.rate]
      );
    }
    console.log('✅ Exchange rates seeded');

    console.log('');
    console.log('🎉 Database seeding completed!');
    console.log('');
    console.log('Demo accounts created:');
    console.log('  📧 admin@globalexchange.com (Admin)');
    console.log('  📧 razack@globalexchange.com (Agent USA)');
    console.log('  📧 bernadette@globalexchange.com (Agent BF)');
    console.log('  📧 abibata@globalexchange.com (Agent BF)');
    console.log('  📧 mohamadi@globalexchange.com (Agent BF)');
    console.log('');
    console.log('Password for all accounts: password123');
    console.log('');

  } catch (error) {
    console.error('❌ Seeding failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seed();

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('../config/database');

const PASS_ROOT = 'MonC0mpte#';

async function seed() {
  console.log('🌱 Seeding database...');
  
  try {
    // Mot de passe démo : racine PASS_ROOT + suffixe (ex. MonC0mpte#admin)
    const userDefs = [
      {
        email: 'admin@globalexchange.com',
        passSuffix: 'admin',
        name: 'SANA Djibrill',
        phone: '+1 555 000 0001',
        role: 'admin',
        country: 'USA',
        agent_code: null
      },
      {
        email: 'superviseur@globalexchange.com',
        passSuffix: 'super',
        name: 'Jean Superviseur',
        phone: '+1 555 000 0002',
        role: 'supervisor',
        country: 'USA',
        agent_code: null
      },
      {
        email: 'razack@globalexchange.com',
        passSuffix: 'razack',
        name: 'Zongo Razack',
        phone: '+1 555 123 4567',
        role: 'sender_agent',
        country: 'USA',
        agent_code: 'USA-001'
      },
      {
        email: 'bernadette@globalexchange.com',
        passSuffix: 'bernadette',
        name: 'Bernadette Tassembedo',
        phone: '+226 70 00 00 01',
        role: 'payer_agent',
        country: 'Burkina Faso',
        agent_code: 'BF-001'
      },
      {
        email: 'abibata@globalexchange.com',
        passSuffix: 'abibata',
        name: 'Abibata Zougrana',
        phone: '+226 70 00 00 02',
        role: 'payer_agent',
        country: 'Burkina Faso',
        agent_code: 'BF-002'
      },
      {
        email: 'mohamadi@globalexchange.com',
        passSuffix: 'mohamadi',
        name: 'Mohamadi Sana',
        phone: '+226 70 00 00 03',
        role: 'payer_agent',
        country: 'Burkina Faso',
        agent_code: 'BF-003'
      },
      {
        email: 'adjara@globalexchange.com',
        passSuffix: 'adjara',
        name: 'Adjara',
        phone: '+1 555 000 0010',
        role: 'sender_agent',
        country: 'USA',
        agent_code: 'USA-002'
      }
    ];

    for (const u of userDefs) {
      const plainPassword = `${PASS_ROOT}${u.passSuffix}`;
      const hashedPassword = await bcrypt.hash(plainPassword, 10);
      await pool.query(
        `INSERT INTO users (email, password, name, phone, role, country, agent_code)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (email) DO UPDATE SET
           password = EXCLUDED.password,
           name = EXCLUDED.name,
           phone = EXCLUDED.phone,
           role = EXCLUDED.role,
           country = EXCLUDED.country,
           agent_code = EXCLUDED.agent_code`,
        [u.email, hashedPassword, u.name, u.phone, u.role, u.country, u.agent_code]
      );
    }
    // S'assurer que l'admin a le bon nom (même si déjà inséré)
    await pool.query(
      `UPDATE users SET name = 'SANA Djibrill' WHERE email = 'admin@globalexchange.com'`
    );
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
  console.log('  📧 adjara@globalexchange.com (Agent USA)');
    console.log('');
    console.log(`Password pattern: ${PASS_ROOT}<suffix> (ex: ${PASS_ROOT}admin)`);
    console.log('');

  } catch (error) {
    console.error('❌ Seeding failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seed();

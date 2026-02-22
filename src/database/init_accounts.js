require('dotenv').config();
const { query } = require('../config/database');

async function initAccounts() {
  console.log('🔍 Vérification des comptes...');
  
  try {
    // Vérifier si la table accounts existe
    const tableExists = await query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'accounts'
      );
    `);
    
    if (!tableExists.rows[0].exists) {
      console.log('❌ La table accounts n\'existe pas. Veuillez appliquer la migration 004_add_cash_accounts.sql d\'abord.');
      process.exit(1);
    }
    
    // Vérifier si les comptes existent
    const usaAccount = await query('SELECT * FROM accounts WHERE name = $1', ['USA']);
    const burkinaAccount = await query('SELECT * FROM accounts WHERE name = $1', ['BURKINA']);
    
    if (usaAccount.rows.length === 0) {
      console.log('➕ Création du compte USA...');
      await query(
        `INSERT INTO accounts (name, currency, current_balance) 
         VALUES ('USA', 'USD', 0) 
         ON CONFLICT (name) DO NOTHING`
      );
      console.log('✅ Compte USA créé');
    } else {
      console.log('✅ Compte USA existe déjà');
    }
    
    if (burkinaAccount.rows.length === 0) {
      console.log('➕ Création du compte BURKINA...');
      await query(
        `INSERT INTO accounts (name, currency, current_balance) 
         VALUES ('BURKINA', 'XOF', 0) 
         ON CONFLICT (name) DO NOTHING`
      );
      console.log('✅ Compte BURKINA créé');
    } else {
      console.log('✅ Compte BURKINA existe déjà');
    }
    
    // Afficher les comptes
    const allAccounts = await query('SELECT * FROM accounts ORDER BY name');
    console.log('\n📊 Comptes disponibles:');
    allAccounts.rows.forEach(acc => {
      console.log(`  - ${acc.name}: ${acc.current_balance} ${acc.currency}`);
    });
    
    console.log('\n✅ Initialisation terminée!');
    
  } catch (error) {
    console.error('❌ Erreur:', error.message);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

initAccounts();

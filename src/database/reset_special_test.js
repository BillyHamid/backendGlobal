/**
 * Remet à zéro les données « Dépenses spéciales » pour les tests :
 * - supprime toutes les lignes de special_expenses (compteur dépense simple → 0)
 * - supprime toutes les lignes de loans (compteur prêt → 0)
 * - remet balance = 0 sur personal_wallets
 *
 * Usage : depuis backend/ → npm run db:reset:special-test
 * Nécessite .env avec DATABASE_URL (ou config locale comme migrate.js).
 */
require('dotenv').config();
const { pool } = require('../config/database');

async function run() {
  console.log('🧪 Reset dépenses simples + prêts (test)...\n');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const delExp = await client.query('DELETE FROM special_expenses');
    const delLoans = await client.query('DELETE FROM loans');

    let walletsUpdated = 0;
    try {
      const up = await client.query(
        'UPDATE personal_wallets SET balance = 0, updated_at = CURRENT_TIMESTAMP'
      );
      walletsUpdated = up.rowCount ?? 0;
    } catch (e) {
      if (e.code === '42P01') {
        console.warn('⚠️  Table personal_wallets absente (migration 006 non appliquée ?). Ignoré.');
      } else {
        throw e;
      }
    }

    await client.query('COMMIT');

    console.log(`✅ special_expenses : ${delExp.rowCount} ligne(s) supprimée(s).`);
    console.log(`✅ loans            : ${delLoans.rowCount} ligne(s) supprimée(s).`);
    console.log(`✅ personal_wallets : ${walletsUpdated} ligne(s) remise(s) à 0 USD.`);
    console.log('\nTerminé. Recharge la page « Dépenses Spéciales » dans l’app.\n');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '42P01') {
      console.error(
        '❌ Table manquante. Applique d’abord les migrations (dont 006_special_expenses_loans.sql).'
      );
    } else {
      console.error('❌ Erreur:', err.message);
    }
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();

/**
 * Vérifie que les objets attendus par l’API existent (évite les 500 silencieux
 * quand migrate_extra n’a pas été exécuté sur un environnement).
 */
let lastCheck = null;

async function runSchemaVerification(pool) {
  const issues = [];

  const reg = await pool.query(
    `SELECT to_regclass('public.financial_reports') AS reg`
  );
  if (!reg.rows[0]?.reg) {
    issues.push('Table public.financial_reports absente');
  } else {
    const col = await pool.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'financial_reports' AND column_name = 'currency'`
    );
    if (col.rowCount === 0) {
      issues.push('Colonne financial_reports.currency absente (migrations 008/009)');
    }
  }

  lastCheck = {
    ok: issues.length === 0,
    issues,
    checkedAt: new Date().toISOString(),
  };
  return lastCheck;
}

function getLastSchemaCheck() {
  return lastCheck;
}

module.exports = {
  runSchemaVerification,
  getLastSchemaCheck,
};

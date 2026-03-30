/**
 * Met à jour uniquement les mots de passe des comptes démo (bcrypt).
 * À lancer si la connexion échoue après changement de règle MonC0mpte#…
 *
 *   cd backend && npm run db:sync-demo-passwords
 *
 * Les lignes doivent exister (sinon lancer npm run db:seed avant).
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('../config/database');
const { DEMO_USER_DEFS, plainPasswordFor, PASS_ROOT } = require('../config/demoCredentials');

async function main() {
  console.log('🔑 Synchronisation des mots de passe démo (', PASS_ROOT + '*', ')...\n');
  let ok = 0;
  let missing = 0;
  for (const u of DEMO_USER_DEFS) {
    const plain = plainPasswordFor(u);
    const hash = await bcrypt.hash(plain, 10);
    const r = await pool.query('UPDATE users SET password = $1 WHERE LOWER(TRIM(email)) = LOWER(TRIM($2))', [
      hash,
      u.email,
    ]);
    if (r.rowCount > 0) {
      console.log('  ✓', u.email, '→', plain);
      ok += 1;
    } else {
      console.log('  ⚠ absent en base :', u.email, '(lancez npm run db:seed)');
      missing += 1;
    }
  }
  await pool.end();
  console.log('\nTerminé :', ok, 'mis à jour,', missing, 'absents.');
  if (missing > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

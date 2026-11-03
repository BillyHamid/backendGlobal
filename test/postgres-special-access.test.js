const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');

// Facultatif : uniquement une base PostgreSQL de test locale, vide et jetable.
// Ce fichier ne charge jamais .env et ne lit jamais DATABASE_URL.
test('special access migration and HTTP flows on isolated PostgreSQL', {
  skip: !process.env.TEST_POSTGRES_URL,
}, async t => {
  const url = new URL(process.env.TEST_POSTGRES_URL);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
  assert.match(url.pathname, /^\/codex_test_[a-z0-9_]+$/);
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: url.href, ssl: false });
  let server;
  try {
    assert.equal((await pool.query("SELECT to_regclass('public.users') AS users")).rows[0].users, null, 'Use an empty disposable database');
    const sqlFile = name => fs.readFileSync(path.join(__dirname, '../src/database', name), 'utf8');
    await pool.query(sqlFile('schema.sql'));
    await pool.query(sqlFile('migrations/011_role_permissions.sql'));
    const bcrypt = require('bcryptjs');
    const password = await bcrypt.hash('isolated-test-password', 4);
    const addUser = async (email, role, name) => (await pool.query(
      'INSERT INTO users (email, password, name, role, country) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [email, password, name, role, 'USA'],
    )).rows[0].id;
    const admin = await addUser('admin@example.test', 'admin', 'Admin test');
    const idrissa = await addUser('idrissa@example.test', 'sender_agent', 'Idrissa test');
    const razack = await addUser('razack@globalexchange.com', 'sender_agent', 'Ancien compte test');
    const ordinary = await addUser('ordinary@example.test', 'sender_agent', 'Agent ordinaire test');

    await t.test('migration preserves legacy access once and never restores a revoked grant', async () => {
      const migration = sqlFile('migrations/012_user_special_access.sql');
      await pool.query(migration);
      assert.equal((await pool.query('SELECT has_special_access FROM users WHERE id = $1', [razack])).rows[0].has_special_access, true);
      assert.equal((await pool.query('SELECT has_special_access FROM users WHERE id = $1', [idrissa])).rows[0].has_special_access, false);
      await pool.query('UPDATE users SET has_special_access = false, is_active = false WHERE id = $1', [razack]);
      await pool.query(migration);
      assert.equal((await pool.query('SELECT has_special_access FROM users WHERE id = $1', [razack])).rows[0].has_special_access, false);
    });

    // Le contrôleur et ses transactions s'exécutent réellement sur cette base isolée.
    require.cache[require.resolve('../src/config/database')] = { exports: { pool, query: (sql, params) => pool.query(sql, params) } };
    process.env.JWT_SECRET = 'isolated-postgres-test-secret';
    const jwt = require('jsonwebtoken');
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use('/api/users', require('../src/routes/user.routes'));
    app.use('/api/auth', require('../src/routes/auth.routes'));
    app.use('/api/special-expenses', require('../src/routes/specialExpenses.routes'));
    app.use((err, req, res, next) => res.status(err.statusCode || 500).json({ message: err.message }));
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const tokens = new Map([admin, idrissa, ordinary, razack].map(id => [id, jwt.sign({ userId: id, role: 'admin' }, process.env.JWT_SECRET)]));
    const request = async (endpoint, { user = admin, method = 'GET', body } = {}) => {
      const res = await fetch(baseUrl + endpoint, {
        method, headers: { Authorization: `Bearer ${tokens.get(user)}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: await res.json() };
    };
    const loan = (user, borrower_id, extra = {}) => request('/api/special-expenses/loans', { user, method: 'POST', body: {
      amount: 25, reason: 'Prêt fictif de validation', loan_date: '2026-11-02', borrower_id, ...extra,
    } });

    await t.test('grant through the user API reaches login, current sessions and the module', async () => {
      assert.equal((await request('/api/special-expenses/wallets', { user: idrissa })).status, 403);
      const updated = await request(`/api/users/${idrissa}`, { method: 'PUT', body: { specialAccess: true } });
      assert.equal(updated.status, 200);
      assert.equal(updated.body.data.role, 'sender_agent');
      assert.equal(updated.body.data.specialAccess, true);
      const me = await request('/api/auth/me', { user: idrissa });
      assert.ok(me.body.data.permissions.includes('special_expenses.manage'));
      assert.ok(me.body.data.permissions.includes('transfers.edit'));
      assert.ok(me.body.data.permissions.includes('transfers.cancel'));
      assert.equal((await request('/api/special-expenses/tfees-balance', { user: idrissa })).status, 200);
      const login = await request('/api/auth/login', { method: 'POST', body: { email: 'idrissa@example.test', password: 'isolated-test-password' } });
      assert.equal(login.status, 200);
      assert.equal(login.body.data.user.specialAccess, true);
      const wallets = await request('/api/special-expenses/wallets', { user: idrissa });
      assert.deepEqual(wallets.body.data.map(w => w.userId).sort(), [admin, idrissa].sort());
      assert.equal((await request('/api/special-expenses/wallets', { user: ordinary })).status, 403);
    });

    await t.test('loans debit Idrissa and credit the chosen recipient; old wallets and history remain intact', async () => {
      await pool.query('INSERT INTO personal_wallets (user_id, balance) VALUES ($1, 17.50)', [razack]);
      const oldLoan = (await pool.query(`INSERT INTO loans (lender_id, borrower_id, amount, reason, loan_date, created_by)
        VALUES ($1, $2, 17.50, 'Historique fictif', '2026-01-01', $1) RETURNING id`, [admin, razack])).rows[0].id;
      const created = await loan(idrissa, admin, { lender_id: razack });
      assert.equal(created.status, 201);
      assert.equal(created.body.data.lenderId, idrissa);
      assert.equal(created.body.data.borrowerId, admin);
      const balances = (await pool.query('SELECT user_id, balance FROM personal_wallets')).rows;
      assert.equal(Number(balances.find(w => w.user_id === idrissa).balance), -25);
      assert.equal(Number(balances.find(w => w.user_id === admin).balance), 25);
      assert.equal(Number(balances.find(w => w.user_id === razack).balance), 17.5);
      assert.equal((await pool.query('SELECT borrower_id FROM loans WHERE id = $1', [oldLoan])).rows[0].borrower_id, razack);
      for (const recipient of [idrissa, ordinary, razack, 'unknown']) assert.equal((await loan(idrissa, recipient)).status, 400);
      assert.equal((await loan(ordinary, idrissa)).status, 403);
      assert.equal((await pool.query('SELECT COUNT(*) FROM loans')).rows[0].count, '2');
    });

    await t.test('multiple admins require a recipient and always debit the actual signed-in lender', async () => {
      const secondAdmin = await addUser('admin2@example.test', 'admin', 'Deuxième admin test');
      tokens.set(secondAdmin, jwt.sign({ userId: secondAdmin }, process.env.JWT_SECRET));
      assert.equal((await loan(secondAdmin, undefined)).status, 400);
      const created = await loan(secondAdmin, idrissa);
      assert.equal(created.status, 201);
      assert.equal(created.body.data.lenderId, secondAdmin);
      assert.equal(created.body.data.borrowerId, idrissa);
      // Idrissa peut aussi être admin : aucune comparaison d'email et aucun auto-prêt.
      await request(`/api/users/${idrissa}`, { method: 'PUT', body: { role: 'admin' } });
      const asAdmin = await loan(idrissa, admin);
      assert.equal(asAdmin.status, 201);
      assert.equal(asAdmin.body.data.lenderId, idrissa);
      assert.equal(asAdmin.body.data.borrowerId, admin);
    });

    await t.test('revocation is immediate even for a token with old admin claims', async () => {
      const revoked = await request(`/api/users/${idrissa}`, { method: 'PUT', body: { role: 'sender_agent', specialAccess: false } });
      assert.equal(revoked.status, 200);
      assert.equal((await request('/api/special-expenses/wallets', { user: idrissa })).status, 403);
      assert.equal((await loan(idrissa, admin)).status, 403);
      const wallets = await request('/api/special-expenses/wallets');
      assert.ok(!wallets.body.data.some(w => w.userId === idrissa));
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await pool.end();
  }
});

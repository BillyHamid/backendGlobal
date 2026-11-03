const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { app, users, policies, adminId, agentId, tokenFor, reset } = require('./helpers/roles-fixture');
let server;
let url;
const request = async (path, { token = tokenFor(adminId), method = 'GET', body } = {}) => {
  const response = await fetch(`${url}${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};

before(async () => { server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); url = `http://127.0.0.1:${server.address().port}`; });
after(() => new Promise(resolve => server.close(resolve)));
beforeEach(reset);

test('admin can change an assignment; an existing token uses the new role', async () => {
  const token = tokenFor(agentId, 'payer_agent');
  assert.equal((await request('/api/users', { token })).status, 403);
  const updated = await request(`/api/users/${agentId}`, { method: 'PUT', body: { role: 'supervisor' } });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.role, 'supervisor');
  assert.equal((await request('/api/users', { token })).status, 200);
});

test('configured permissions persist and are granted/revoked with the same token', async () => {
  const token = tokenFor(agentId, 'payer_agent');
  assert.equal((await request('/protected/transfers.pay', { token })).status, 200);
  assert.equal((await request('/api/roles/payer_agent', { method: 'PUT', body: { permissions: ['transfers.view', 'transfers.edit'] } })).status, 200);
  assert.equal((await request('/protected/transfers.pay', { token })).status, 403);
  assert.equal((await request('/protected/transfers.edit', { token })).status, 200);
  const roles = await request('/api/roles');
  assert.deepEqual(roles.body.data.roles.find(role => role.role === 'payer_agent').permissions, ['transfers.view', 'transfers.edit']);
  const me = await request('/api/auth/me', { token });
  assert.deepEqual(me.body.data.permissions, ['transfers.view', 'transfers.edit']);
});

test('empty permission list denies operations, including cash', async () => {
  const token = tokenFor(agentId);
  await request('/api/roles/payer_agent', { method: 'PUT', body: { permissions: [] } });
  for (const permission of ['transfers.view', 'cash.view', 'cash.entry', 'cash.expense', 'users.view']) {
    assert.equal((await request(`/protected/${permission}`, { token })).status, 403);
  }
});

test('role configuration and assignments remain admin-only despite stale admin claims', async () => {
  const token = tokenFor(agentId, 'admin');
  assert.equal((await request('/api/roles', { token })).status, 403);
  assert.equal((await request('/api/roles/payer_agent', { token, method: 'PUT', body: { permissions: [] } })).status, 403);
  assert.equal((await request(`/api/users/${agentId}`, { token, method: 'PUT', body: { role: 'admin' } })).status, 403);
});

test('invalid roles, invalid permissions and missing dependencies are rejected', async () => {
  assert.equal((await request(`/api/users/${agentId}`, { method: 'PUT', body: { role: 'owner' } })).status, 400);
  for (const permissions of [['users.edit'], ['transfers.pay'], 'transfers.view', null]) {
    assert.equal((await request('/api/roles/payer_agent', { method: 'PUT', body: { permissions } })).status, 400);
  }
  assert.equal((await request('/api/roles/owner', { method: 'PUT', body: { permissions: [] } })).status, 400);
  assert.equal((await request('/api/roles/admin', { method: 'PUT', body: { permissions: [] } })).status, 403);
});

test('disabled/deleted accounts lose access even with an unexpired token', async () => {
  const token = tokenFor(agentId);
  users.get(agentId).is_active = false;
  assert.equal((await request('/protected/transfers.view', { token })).status, 401);
  users.delete(agentId);
  assert.equal((await request('/protected/transfers.view', { token })).status, 401);
});

test('admin cannot remove their own access', async () => {
  assert.equal((await request(`/api/users/${adminId}`, { method: 'PUT', body: { role: 'payer_agent' } })).status, 400);
  assert.equal((await request(`/api/users/${adminId}`, { method: 'DELETE' })).status, 400);
  assert.equal((await request(`/api/users/${adminId}/toggle-active`, { method: 'PATCH' })).status, 400);
});

test('role counts use actual users and explicit personal access is preserved', async () => {
  const result = await request('/api/roles');
  assert.equal(result.body.data.roles.find(role => role.role === 'supervisor').usersCount, 0);
  assert.equal(result.body.data.roles.find(role => role.role === 'payer_agent').usersCount, 1);
  users.get(agentId).has_special_access = true;
  policies.set('payer_agent', []);
  const token = tokenFor(agentId);
  assert.equal((await request('/protected/transfers.edit', { token })).status, 200);
  assert.equal((await request('/protected/transfers.pay', { token })).status, 403);
});

test('Idrissa inherits special rights without becoming admin, and revocation affects existing tokens', async () => {
  Object.assign(users.get(agentId), { name: 'Idrissa test', email: 'idrissa@example.test', role: 'sender_agent' });
  const token = tokenFor(agentId, 'sender_agent');
  assert.equal((await request('/api/special-expenses/tfees-balance', { token })).status, 403);
  const grant = await request(`/api/users/${agentId}`, { method: 'PUT', body: { specialAccess: true } });
  assert.equal(grant.status, 200);
  assert.equal(grant.body.data.specialAccess, true);
  assert.equal(grant.body.data.role, 'sender_agent');
  for (const permission of ['transfers.edit', 'transfers.cancel', 'special_expenses.manage']) {
    assert.equal((await request(`/protected/${permission}`, { token })).status, 200);
  }
  assert.equal((await request('/api/special-expenses/tfees-balance', { token })).status, 200);
  assert.equal((await request('/api/auth/me', { token })).body.data.specialAccess, true);
  assert.equal((await request(`/api/users/${agentId}`)).body.data.specialAccess, true);
  assert.equal((await request('/api/users')).body.data.find(u => u.id === agentId).specialAccess, true);
  // Les autres agents du même rôle ne reçoivent pas ce droit.
  const ordinaryId = '10000000-0000-4000-8000-000000000003';
  users.set(ordinaryId, { ...users.get(agentId), id: ordinaryId, has_special_access: false });
  assert.equal((await request('/api/special-expenses/wallets', { token: tokenFor(ordinaryId) })).status, 403);
  // Changer l'identité ne révoque pas le droit individuel.
  Object.assign(users.get(agentId), { name: 'Nouveau nom', email: 'new@example.test' });
  assert.equal((await request('/api/special-expenses/wallets', { token })).status, 200);
  await request(`/api/users/${agentId}`, { method: 'PUT', body: { specialAccess: false } });
  for (const permission of ['transfers.edit', 'transfers.cancel', 'special_expenses.manage']) {
    assert.equal((await request(`/protected/${permission}`, { token })).status, 403);
  }
});

test('old Razack email alone no longer grants any personal privilege', async () => {
  users.get(agentId).email = 'razack@globalexchange.com';
  const token = tokenFor(agentId);
  assert.equal((await request('/protected/transfers.edit', { token })).status, 403);
  assert.equal((await request('/api/special-expenses/wallets', { token })).status, 403);
});

test('only admins can grant special access; malformed flags are rejected', async () => {
  assert.equal((await request(`/api/users/${agentId}`, { token: tokenFor(agentId), method: 'PUT', body: { specialAccess: true } })).status, 403);
  for (const specialAccess of ['false', 'true', 1, null, {}]) {
    assert.equal((await request(`/api/users/${agentId}`, { method: 'PUT', body: { specialAccess } })).status, 400);
  }
  assert.equal(users.get(agentId).has_special_access, false);
});

test('new users can receive special access and login returns effective permissions', async () => {
  const created = await request('/api/users', { method: 'POST', body: {
    email: 'replacement@example.test', name: 'Remplaçant test', role: 'sender_agent',
    password: 'isolated-test-password', specialAccess: true,
  } });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.specialAccess, true);
  const login = await request('/api/auth/login', { method: 'POST', body: { email: 'replacement@example.test', password: 'isolated-test-password' } });
  assert.equal(login.status, 200);
  assert.equal(login.body.data.user.specialAccess, true);
  assert.ok(login.body.data.user.permissions.includes('special_expenses.manage'));
});

test('wallet recipients follow active accounts and special access, not a former email', async () => {
  users.get(agentId).has_special_access = true;
  users.get(agentId).email = 'idrissa@example.test';
  const formerId = '10000000-0000-4000-8000-000000000003';
  users.set(formerId, { ...users.get(agentId), id: formerId, email: 'razack@globalexchange.com', is_active: false });
  const wallets = await request('/api/special-expenses/wallets');
  assert.equal(wallets.status, 200);
  assert.deepEqual(wallets.body.data.map(w => w.userId).sort(), [adminId, agentId]);
  for (const borrower_id of [formerId, adminId, 'unknown']) {
    const loan = await request('/api/special-expenses/loans', { method: 'POST', body: { borrower_id, amount: 10, reason: 'Test', loan_date: '2026-11-02' } });
    assert.equal(loan.status, 400);
  }
});

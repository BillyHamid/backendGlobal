const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const bcrypt = require('bcryptjs');
const { app, users, adminId, agentId, tokenFor, reset } = require('./helpers/roles-fixture');
let server;
let baseUrl;
before(async () => { server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); baseUrl = `http://127.0.0.1:${server.address().port}`; });
after(() => new Promise(resolve => server.close(resolve)));
beforeEach(reset);
const request = async (path, { token = tokenFor(adminId), method = 'GET', body } = {}) => {
  const res = await fetch(baseUrl + path, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};
const newPassword = 'new-isolated-test-password';
const resetPassword = (id, options = {}) => request(`/api/users/${id}/password`, {
  method: 'PUT', body: { newPassword, confirmPassword: newPassword }, ...options,
});
const login = (email, password) => request('/api/auth/login', { method: 'POST', body: { email, password } });

test('admin resets a password, old credentials and sessions fail, new login succeeds', async () => {
  const oldToken = tokenFor(agentId);
  assert.equal((await request('/api/auth/me', { token: oldToken })).status, 200);
  const updated = await resetPassword(agentId);
  assert.equal(updated.status, 200);
  assert.equal(users.get(agentId).token_version, 1);
  assert.notEqual(users.get(agentId).password, newPassword);
  assert.ok(await bcrypt.compare(newPassword, users.get(agentId).password));
  assert.equal(users.get(agentId).role, 'payer_agent');
  assert.equal(users.get(agentId).is_active, true);
  assert.equal((await request('/api/auth/me', { token: oldToken })).status, 401);
  assert.equal((await login('agent@example.test', 'local-test-password')).status, 401);
  const signedIn = await login('agent@example.test', newPassword);
  assert.equal(signedIn.status, 200);
  assert.equal((await request('/api/auth/me', { token: signedIn.body.data.token })).status, 200);
  assert.equal((await request('/api/auth/me')).status, 200, 'Admin session remains valid');
  assert.equal(JSON.stringify(updated.body).includes(newPassword), false);
  assert.equal(JSON.stringify(updated.body).includes(users.get(agentId).password), false);
});

test('non-admin users cannot reset passwords even with old admin claims', async () => {
  for (const role of ['payer_agent', 'sender_agent', 'supervisor']) {
    users.get(agentId).role = role;
    assert.equal((await resetPassword(adminId, { token: tokenFor(agentId, 'admin') })).status, 403);
    assert.equal((await resetPassword(agentId, { token: tokenFor(agentId, 'admin') })).status, 403);
  }
  assert.equal(users.get(agentId).token_version, 0);
  assert.equal(users.get(adminId).token_version, 0);
});

test('missing, mismatched, short and oversized passwords are rejected without echoing secrets', async () => {
  for (const body of [
    {}, { newPassword }, { newPassword: 'short', confirmPassword: 'short' },
    { newPassword, confirmPassword: 'different-password' },
    { newPassword: 123456789, confirmPassword: 123456789 },
    { newPassword: 'é'.repeat(37), confirmPassword: 'é'.repeat(37) },
  ]) {
    const res = await request(`/api/users/${agentId}/password`, { method: 'PUT', body });
    assert.equal(res.status, 400);
    for (const error of res.body.errors) assert.equal(Object.hasOwn(error, 'value'), false);
  }
  assert.equal(users.get(agentId).token_version, 0);
  assert.ok(await bcrypt.compare('local-test-password', users.get(agentId).password));
});

test('unknown user returns 404; resetting an inactive user does not reactivate it', async () => {
  assert.equal((await resetPassword('10000000-0000-4000-8000-000000000099')).status, 404);
  users.get(agentId).is_active = false;
  assert.equal((await resetPassword(agentId)).status, 200);
  assert.equal(users.get(agentId).is_active, false);
  assert.equal((await login('agent@example.test', newPassword)).status, 401);
});

test('admin can change their own password and must sign in again', async () => {
  assert.equal((await resetPassword(adminId)).status, 200);
  assert.equal((await request('/api/auth/me')).status, 401);
  const signedIn = await login('admin@example.test', newPassword);
  assert.equal(signedIn.status, 200);
  assert.equal((await request('/api/users', { token: signedIn.body.data.token })).status, 200);
});

test('self-service password changes also revoke old sessions', async () => {
  const token = tokenFor(agentId);
  const wrong = await request('/api/auth/change-password', { token, method: 'POST', body: { currentPassword: 'incorrect', newPassword } });
  assert.equal(wrong.status, 401);
  assert.equal(users.get(agentId).token_version, 0);
  const changed = await request('/api/auth/change-password', { token, method: 'POST', body: { currentPassword: 'local-test-password', newPassword } });
  assert.equal(changed.status, 200);
  assert.equal((await request('/api/auth/me', { token })).status, 401);
  assert.equal((await login('agent@example.test', newPassword)).status, 200);
});

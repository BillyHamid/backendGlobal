const express = require('express');
const jwt = require('jsonwebtoken');
// Base en mémoire : ces tests ne chargent jamais .env ni PostgreSQL.
process.env.JWT_SECRET = 'isolated-roles-test-secret';
const adminId = '10000000-0000-4000-8000-000000000001';
const agentId = '10000000-0000-4000-8000-000000000002';
const users = new Map();
const policies = new Map();
const query = async (sql, params = []) => {
  const result = rows => ({ rows, rowCount: rows.length });
  if (sql.startsWith('INSERT INTO role_permissions')) {
    policies.set(params[0], JSON.parse(params[1]));
    return result([]);
  }
  if (sql.includes('FROM role_permissions')) return result([...policies].filter(([role]) => !params.length || role === params[0]).map(([role, permissions]) => ({ role, permissions })));
  if (sql.includes('GROUP BY role')) {
    const counts = {};
    users.forEach(user => { counts[user.role] = (counts[user.role] || 0) + 1; });
    return result(Object.entries(counts).map(([role, count]) => ({ role, count })));
  }
  if (sql.includes('UPDATE users SET password')) {
    const user = users.get(params[1]);
    if (!user) return result([]);
    user.password = params[0];
    user.token_version += 1;
    return result([{ id: user.id }]);
  }
  if (sql.includes('UPDATE users')) {
    const user = users.get(params[6]);
    ['name', 'phone', 'country', 'agent_code', 'role', 'has_special_access'].forEach((key, i) => { if (params[i] != null) user[key] = params[i]; });
    return result([{ ...user }]);
  }
  if (sql.includes('INSERT INTO users')) {
    const id = require('node:crypto').randomUUID();
    const user = { id, is_active: true, has_special_access: false, token_version: 0 };
    ['email', 'password', 'name', 'phone', 'role', 'country', 'agent_code', 'has_special_access'].forEach((key, i) => { if (params[i] != null) user[key] = params[i]; });
    users.set(id, user);
    return result([{ ...user }]);
  }
  if (sql.includes('FROM personal_wallets')) return result([]);
  if (sql.includes('AS available_tfees')) return result([{ available_tfees: 100 }]);
  if (sql.includes('COUNT(*) FROM special_expenses') || sql.includes('COUNT(*) FROM loans')) return result([{ count: 0 }]);
  if (sql.includes('FROM special_expenses se') || sql.includes('FROM loans l')) return result([]);
  if (sql.includes('FROM users') && sql.includes('has_special_access = true')) return result([...users.values()].filter(u => u.is_active && (u.role === 'admin' || u.has_special_access)));
  if (sql.includes('FROM users WHERE email = $1')) return result([...users.values()].filter(user => user.email === params[0]));
  if (sql.includes('FROM users WHERE id = $1')) return result(users.has(params[0]) ? [{ ...users.get(params[0]) }] : []);
  if (sql.includes('COUNT(*) FROM users')) return result([{ count: users.size }]);
  if (sql.includes('FROM users')) return result([...users.values()]);
  throw new Error(`Unexpected SQL in test: ${sql}`);
};
require.cache[require.resolve('../../src/config/database')] = { loaded: true, exports: {
  query,
  pool: { connect: async () => { throw new Error('Use the isolated PostgreSQL test for loan transactions'); } },
} };
const { authenticate, hasPermission } = require('../../src/middleware/auth.middleware');
const app = express();
app.use(require('cors')({ origin: 'http://127.0.0.1:5174' }));
app.use(express.json());
app.get('/api/health', (req, res) => res.json({ status: 'OK' }));
app.use('/api/roles', require('../../src/routes/role.routes'));
app.use('/api/users', require('../../src/routes/user.routes'));
app.use('/api/auth', require('../../src/routes/auth.routes'));
app.use('/api/special-expenses', require('../../src/routes/specialExpenses.routes'));
app.get('/protected/:permission', authenticate, (req, res, next) => hasPermission(req.params.permission)(req, res, next), (req, res) => res.json({ success: true }));
app.use((err, req, res, next) => res.status(err.statusCode || 500).json({ message: err.message }));
const reset = () => {
  users.clear();
  const records = [
    [adminId, { id: adminId, name: 'Admin test', role: 'admin', email: 'admin@example.test', is_active: true }],
    [agentId, { id: agentId, name: 'Agent test', role: 'payer_agent', email: 'agent@example.test', is_active: true }],
  ];
  const password = require('bcryptjs').hashSync('local-test-password', 4);
  records.forEach(([id, user]) => users.set(id, { ...user, password, has_special_access: false, token_version: 0 }));
  policies.clear();
};
const tokenFor = (id, role = 'admin') => jwt.sign({ userId: id, role, email: 'old@example.test', isActive: true }, process.env.JWT_SECRET);
module.exports = { app, users, policies, adminId, agentId, tokenFor, reset };

if (require.main === module) {
  reset();
  app.listen(5099, '127.0.0.1', () => console.log('Isolated roles fixture: http://127.0.0.1:5099; login admin@example.test / local-test-password'));
}

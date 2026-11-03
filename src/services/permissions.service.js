const { query } = require('../config/database');
const { DEFAULT_PERMISSIONS } = require('../config/permissions');

// Droits individuels attribuables par l'administrateur, indépendants du nom/email.
const SPECIAL_ACCESS_PERMISSIONS = ['transfers.view', 'transfers.edit', 'transfers.cancel', 'special_expenses.manage'];

async function getPermissions(user) {
  if (user.role === 'admin') return [...new Set([...DEFAULT_PERMISSIONS.admin, ...SPECIAL_ACCESS_PERMISSIONS])];
  const result = await query('SELECT permissions FROM role_permissions WHERE role = $1', [user.role]);
  const permissions = result.rows[0]?.permissions ?? DEFAULT_PERMISSIONS[user.role] ?? [];
  const personalPermissions = user.has_special_access === true ? SPECIAL_ACCESS_PERMISSIONS : [];
  return [...new Set([...permissions, ...personalPermissions])];
}

module.exports = { getPermissions };

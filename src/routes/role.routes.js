const express = require('express');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { asyncHandler, ApiError } = require('../middleware/error.middleware');
const { query } = require('../config/database');
const { PERMISSIONS, DEFAULT_PERMISSIONS, DEPENDENCIES } = require('../config/permissions');

const router = express.Router();
router.use(authenticate, authorize('admin'));

router.get('/', asyncHandler(async (req, res) => {
  const [configured, counts] = await Promise.all([
    query('SELECT role, permissions FROM role_permissions'),
    query('SELECT role, COUNT(*)::int AS count FROM users GROUP BY role'),
  ]);
  res.json({ success: true, data: {
    catalog: PERMISSIONS,
    dependencies: DEPENDENCIES,
    roles: Object.entries(DEFAULT_PERMISSIONS).map(([role, defaults]) => ({
      id: role,
      role,
      permissions: configured.rows.find(row => row.role === role)?.permissions ?? defaults,
      usersCount: counts.rows.find(row => row.role === role)?.count ?? 0,
      editable: role !== 'admin',
    })),
  } });
}));

router.put('/:role', asyncHandler(async (req, res) => {
  const { role } = req.params;
  if (!Object.hasOwn(DEFAULT_PERMISSIONS, role)) throw new ApiError(400, 'Rôle invalide.');
  if (role === 'admin') throw new ApiError(403, 'Le rôle administrateur conserve tous ses droits.');
  const { permissions } = req.body;
  const validIds = new Set(PERMISSIONS.map(permission => permission.id));
  if (!Array.isArray(permissions) || permissions.some(permission => !validIds.has(permission))) {
    throw new ApiError(400, 'Liste de permissions invalide.');
  }
  const selected = [...new Set(permissions)];
  for (const permission of selected) {
    if ((DEPENDENCIES[permission] || []).some(required => !selected.includes(required))) {
      throw new ApiError(400, 'Activez aussi la consultation du module concerné.');
    }
  }
  await query(
    `INSERT INTO role_permissions (role, permissions, updated_by)
     VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (role) DO UPDATE SET permissions = EXCLUDED.permissions,
       updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [role, JSON.stringify(selected), req.user.id]
  );
  res.json({ success: true, data: { role, permissions: selected } });
}));

module.exports = router;

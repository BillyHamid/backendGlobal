const bcrypt = require('bcryptjs');
const { query } = require('../config/database');
const { asyncHandler, ApiError } = require('../middleware/error.middleware');

// @desc    Get all users
// @route   GET /api/users
const getAll = asyncHandler(async (req, res) => {
  const { role, isActive, page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;

  let sql = `
    SELECT id, email, name, role, phone, country, agent_code, is_active, created_at
    FROM users
    WHERE 1=1
  `;
  const params = [];
  let paramCount = 0;

  if (role) {
    paramCount++;
    sql += ` AND role = $${paramCount}`;
    params.push(role);
  }

  if (isActive !== undefined) {
    paramCount++;
    sql += ` AND is_active = $${paramCount}`;
    params.push(isActive === 'true');
  }

  sql += ' ORDER BY created_at DESC';
  sql += ` LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
  params.push(limit, offset);

  const result = await query(sql, params);

  // Get total count
  const countResult = await query('SELECT COUNT(*) FROM users');
  const total = parseInt(countResult.rows[0].count);

  res.json({
    success: true,
    data: result.rows.map(user => ({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      phone: user.phone,
      country: user.country,
      agentCode: user.agent_code,
      isActive: user.is_active,
      createdAt: user.created_at
    })),
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / limit)
    }
  });
});

// @desc    Get user by ID
// @route   GET /api/users/:id
const getById = asyncHandler(async (req, res) => {
  const result = await query(
    'SELECT id, email, name, role, phone, country, agent_code, is_active, created_at FROM users WHERE id = $1',
    [req.params.id]
  );

  if (result.rows.length === 0) {
    throw new ApiError(404, 'Utilisateur non trouvé');
  }

  const user = result.rows[0];

  res.json({
    success: true,
    data: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      phone: user.phone,
      country: user.country,
      agentCode: user.agent_code,
      isActive: user.is_active,
      createdAt: user.created_at
    }
  });
});

// @desc    Create user
// @route   POST /api/users
const create = asyncHandler(async (req, res) => {
  const { email, password, name, phone, role, country, agentCode } = req.body;

  // Check if email exists
  const existing = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
  if (existing.rows.length > 0) {
    throw new ApiError(409, 'Cet email est déjà utilisé');
  }

  // Hash password
  const hashedPassword = await bcrypt.hash(password, 10);

  const result = await query(
    `INSERT INTO users (email, password, name, phone, role, country, agent_code)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, email, name, role, phone, country, agent_code, is_active, created_at`,
    [email.toLowerCase(), hashedPassword, name, phone, role, country, agentCode]
  );

  const user = result.rows[0];

  res.status(201).json({
    success: true,
    message: 'Utilisateur créé avec succès',
    data: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      phone: user.phone,
      country: user.country,
      agentCode: user.agent_code,
      isActive: user.is_active,
      createdAt: user.created_at
    }
  });
});

// @desc    Update user
// @route   PUT /api/users/:id
const update = asyncHandler(async (req, res) => {
  const { name, phone, country, agentCode, role } = req.body;

  // Check if user exists
  const existing = await query('SELECT id FROM users WHERE id = $1', [req.params.id]);
  if (existing.rows.length === 0) {
    throw new ApiError(404, 'Utilisateur non trouvé');
  }

  const result = await query(
    `UPDATE users 
     SET name = COALESCE($1, name),
         phone = COALESCE($2, phone),
         country = COALESCE($3, country),
         agent_code = COALESCE($4, agent_code),
         role = COALESCE($5, role)
     WHERE id = $6
     RETURNING id, email, name, role, phone, country, agent_code, is_active, created_at`,
    [name, phone, country, agentCode, role, req.params.id]
  );

  const user = result.rows[0];

  res.json({
    success: true,
    message: 'Utilisateur mis à jour',
    data: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      phone: user.phone,
      country: user.country,
      agentCode: user.agent_code,
      isActive: user.is_active,
      createdAt: user.created_at
    }
  });
});

// @desc    Delete user
// @route   DELETE /api/users/:id
const deleteUser = asyncHandler(async (req, res) => {
  const result = await query('DELETE FROM users WHERE id = $1 RETURNING id', [req.params.id]);

  if (result.rows.length === 0) {
    throw new ApiError(404, 'Utilisateur non trouvé');
  }

  res.json({
    success: true,
    message: 'Utilisateur supprimé'
  });
});

// @desc    Toggle user active status
// @route   PATCH /api/users/:id/toggle-active
const toggleActive = asyncHandler(async (req, res) => {
  const result = await query(
    `UPDATE users SET is_active = NOT is_active WHERE id = $1
     RETURNING id, email, name, is_active`,
    [req.params.id]
  );

  if (result.rows.length === 0) {
    throw new ApiError(404, 'Utilisateur non trouvé');
  }

  const user = result.rows[0];

  res.json({
    success: true,
    message: user.is_active ? 'Utilisateur activé' : 'Utilisateur désactivé',
    data: { isActive: user.is_active }
  });
});

module.exports = {
  getAll,
  getById,
  create,
  update,
  delete: deleteUser,
  toggleActive
};

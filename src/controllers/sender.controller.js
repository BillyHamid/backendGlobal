const { query } = require('../config/database');
const { asyncHandler, ApiError } = require('../middleware/error.middleware');

// @desc    Get all senders
// @route   GET /api/senders
const getAll = asyncHandler(async (req, res) => {
  const { search, country, page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;

  let sql = `
    SELECT s.*, u.name as created_by_name
    FROM senders s
    LEFT JOIN users u ON s.created_by = u.id
    WHERE 1=1
  `;
  const params = [];
  let paramCount = 0;

  if (search) {
    paramCount++;
    sql += ` AND (
      s.first_name ILIKE $${paramCount} OR 
      s.last_name ILIKE $${paramCount} OR 
      s.phone ILIKE $${paramCount}
    )`;
    params.push(`%${search}%`);
  }

  if (country) {
    paramCount++;
    sql += ` AND s.country = $${paramCount}`;
    params.push(country);
  }

  let countParams = [];
  if (search) countParams.push(`%${search}%`);
  if (country) countParams.push(country);
  let countWhere = 'WHERE 1=1';
  let c = 0;
  if (search) { c++; countWhere += ` AND (s.first_name ILIKE $${c} OR s.last_name ILIKE $${c} OR s.phone ILIKE $${c})`; }
  if (country) { c++; countWhere += ` AND s.country = $${c}`; }
  const countResult = await query(`SELECT COUNT(*) FROM senders s ${countWhere}`, countParams);
  const total = parseInt(countResult.rows[0].count);

  sql += ' ORDER BY s.created_at DESC';
  sql += ` LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
  params.push(limit, offset);

  const result = await query(sql, params);

  res.json({
    success: true,
    data: result.rows.map(s => ({
      id: s.id,
      firstName: s.first_name,
      lastName: s.last_name,
      phone: s.phone,
      email: s.email,
      country: s.country,
      address: s.address,
      idType: s.id_type,
      idNumber: s.id_number,
      createdBy: s.created_by_name,
      createdAt: s.created_at
    })),
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / limit)
    }
  });
});

// @desc    Get sender by ID
// @route   GET /api/senders/:id
const getById = asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT s.*, u.name as created_by_name
     FROM senders s
     LEFT JOIN users u ON s.created_by = u.id
     WHERE s.id = $1`,
    [req.params.id]
  );

  if (result.rows.length === 0) {
    throw new ApiError(404, 'Expéditeur non trouvé');
  }

  const s = result.rows[0];

  res.json({
    success: true,
    data: {
      id: s.id,
      firstName: s.first_name,
      lastName: s.last_name,
      phone: s.phone,
      email: s.email,
      country: s.country,
      address: s.address,
      idType: s.id_type,
      idNumber: s.id_number,
      createdBy: s.created_by_name,
      createdAt: s.created_at
    }
  });
});

// @desc    Create sender
// @route   POST /api/senders
const create = asyncHandler(async (req, res) => {
  const { firstName, lastName, phone, email, country, address, idType, idNumber } = req.body;

  const result = await query(
    `INSERT INTO senders (first_name, last_name, phone, email, country, address, id_type, id_number, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [firstName, lastName, phone, email || null, country, address || null, idType || null, idNumber || null, req.user.id]
  );

  const s = result.rows[0];

  res.status(201).json({
    success: true,
    message: 'Expéditeur créé avec succès',
    data: {
      id: s.id,
      firstName: s.first_name,
      lastName: s.last_name,
      phone: s.phone,
      country: s.country
    }
  });
});

// @desc    Update sender
// @route   PUT /api/senders/:id
const update = asyncHandler(async (req, res) => {
  const { firstName, lastName, phone, email, country, address, idType, idNumber } = req.body;

  const existing = await query('SELECT id FROM senders WHERE id = $1', [req.params.id]);
  if (existing.rows.length === 0) {
    throw new ApiError(404, 'Expéditeur non trouvé');
  }

  const result = await query(
    `UPDATE senders 
     SET first_name = COALESCE($1, first_name),
         last_name = COALESCE($2, last_name),
         phone = COALESCE($3, phone),
         email = COALESCE($4, email),
         country = COALESCE($5, country),
         address = COALESCE($6, address),
         id_type = COALESCE($7, id_type),
         id_number = COALESCE($8, id_number)
     WHERE id = $9
     RETURNING *`,
    [firstName, lastName, phone, email, country, address, idType, idNumber, req.params.id]
  );

  const s = result.rows[0];

  res.json({
    success: true,
    message: 'Expéditeur mis à jour',
    data: {
      id: s.id,
      firstName: s.first_name,
      lastName: s.last_name,
      phone: s.phone,
      country: s.country
    }
  });
});

// @desc    Delete sender
// @route   DELETE /api/senders/:id
const deleteSender = asyncHandler(async (req, res) => {
  const result = await query('DELETE FROM senders WHERE id = $1 RETURNING id', [req.params.id]);

  if (result.rows.length === 0) {
    throw new ApiError(404, 'Expéditeur non trouvé');
  }

  res.json({
    success: true,
    message: 'Expéditeur supprimé'
  });
});

// @desc    Search sender by phone
// @route   GET /api/senders/search/:phone
const searchByPhone = asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT * FROM senders WHERE phone ILIKE $1 ORDER BY created_at DESC LIMIT 10`,
    [`%${req.params.phone}%`]
  );

  res.json({
    success: true,
    data: result.rows.map(s => ({
      id: s.id,
      firstName: s.first_name,
      lastName: s.last_name,
      phone: s.phone,
      email: s.email,
      country: s.country
    }))
  });
});

module.exports = {
  getAll,
  getById,
  create,
  update,
  delete: deleteSender,
  searchByPhone
};

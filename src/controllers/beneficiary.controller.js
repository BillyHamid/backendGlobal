const { query } = require('../config/database');
const { asyncHandler, ApiError } = require('../middleware/error.middleware');

// @desc    Get all beneficiaries
// @route   GET /api/beneficiaries
const getAll = asyncHandler(async (req, res) => {
  const { search, country, page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;

  let sql = `
    SELECT b.*, u.name as created_by_name
    FROM beneficiaries b
    LEFT JOIN users u ON b.created_by = u.id
    WHERE 1=1
  `;
  const params = [];
  let paramCount = 0;

  if (search) {
    paramCount++;
    sql += ` AND (
      b.first_name ILIKE $${paramCount} OR 
      b.last_name ILIKE $${paramCount} OR 
      b.phone ILIKE $${paramCount}
    )`;
    params.push(`%${search}%`);
  }

  if (country) {
    paramCount++;
    sql += ` AND b.country = $${paramCount}`;
    params.push(country);
  }

  let countParams = [];
  if (search) countParams.push(`%${search}%`);
  if (country) countParams.push(country);
  let countWhere = 'WHERE 1=1';
  let c = 0;
  if (search) { c++; countWhere += ` AND (b.first_name ILIKE $${c} OR b.last_name ILIKE $${c} OR b.phone ILIKE $${c})`; }
  if (country) { c++; countWhere += ` AND b.country = $${c}`; }
  const countResult = await query(`SELECT COUNT(*) FROM beneficiaries b ${countWhere}`, countParams);
  const total = parseInt(countResult.rows[0].count);

  sql += ' ORDER BY b.created_at DESC';
  sql += ` LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
  params.push(limit, offset);

  const result = await query(sql, params);

  res.json({
    success: true,
    data: result.rows.map(b => ({
      id: b.id,
      firstName: b.first_name,
      lastName: b.last_name,
      phone: b.phone,
      country: b.country,
      city: b.city,
      address: b.address,
      idType: b.id_type,
      idNumber: b.id_number,
      createdBy: b.created_by_name,
      createdAt: b.created_at
    })),
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / limit)
    }
  });
});

// @desc    Get beneficiary by ID
// @route   GET /api/beneficiaries/:id
const getById = asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT b.*, u.name as created_by_name
     FROM beneficiaries b
     LEFT JOIN users u ON b.created_by = u.id
     WHERE b.id = $1`,
    [req.params.id]
  );

  if (result.rows.length === 0) {
    throw new ApiError(404, 'Bénéficiaire non trouvé');
  }

  const b = result.rows[0];

  res.json({
    success: true,
    data: {
      id: b.id,
      firstName: b.first_name,
      lastName: b.last_name,
      phone: b.phone,
      country: b.country,
      city: b.city,
      address: b.address,
      idType: b.id_type,
      idNumber: b.id_number,
      createdBy: b.created_by_name,
      createdAt: b.created_at
    }
  });
});

// @desc    Create beneficiary
// @route   POST /api/beneficiaries
const create = asyncHandler(async (req, res) => {
  const { firstName, lastName, phone, country, city, address, idType, idNumber } = req.body;

  const result = await query(
    `INSERT INTO beneficiaries (first_name, last_name, phone, country, city, address, id_type, id_number, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [firstName, lastName, phone, country, city, address || null, idType || null, idNumber || null, req.user.id]
  );

  const b = result.rows[0];

  res.status(201).json({
    success: true,
    message: 'Bénéficiaire créé avec succès',
    data: {
      id: b.id,
      firstName: b.first_name,
      lastName: b.last_name,
      phone: b.phone,
      country: b.country,
      city: b.city
    }
  });
});

// @desc    Update beneficiary
// @route   PUT /api/beneficiaries/:id
const update = asyncHandler(async (req, res) => {
  const { firstName, lastName, phone, country, city, address, idType, idNumber } = req.body;

  const existing = await query('SELECT id FROM beneficiaries WHERE id = $1', [req.params.id]);
  if (existing.rows.length === 0) {
    throw new ApiError(404, 'Bénéficiaire non trouvé');
  }

  const result = await query(
    `UPDATE beneficiaries 
     SET first_name = COALESCE($1, first_name),
         last_name = COALESCE($2, last_name),
         phone = COALESCE($3, phone),
         country = COALESCE($4, country),
         city = COALESCE($5, city),
         address = COALESCE($6, address),
         id_type = COALESCE($7, id_type),
         id_number = COALESCE($8, id_number)
     WHERE id = $9
     RETURNING *`,
    [firstName, lastName, phone, country, city, address, idType, idNumber, req.params.id]
  );

  const b = result.rows[0];

  res.json({
    success: true,
    message: 'Bénéficiaire mis à jour',
    data: {
      id: b.id,
      firstName: b.first_name,
      lastName: b.last_name,
      phone: b.phone,
      country: b.country,
      city: b.city
    }
  });
});

// @desc    Delete beneficiary
// @route   DELETE /api/beneficiaries/:id
const deleteBeneficiary = asyncHandler(async (req, res) => {
  const result = await query('DELETE FROM beneficiaries WHERE id = $1 RETURNING id', [req.params.id]);

  if (result.rows.length === 0) {
    throw new ApiError(404, 'Bénéficiaire non trouvé');
  }

  res.json({
    success: true,
    message: 'Bénéficiaire supprimé'
  });
});

// @desc    Search beneficiary by phone
// @route   GET /api/beneficiaries/search/:phone
const searchByPhone = asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT * FROM beneficiaries WHERE phone ILIKE $1 ORDER BY created_at DESC LIMIT 10`,
    [`%${req.params.phone}%`]
  );

  res.json({
    success: true,
    data: result.rows.map(b => ({
      id: b.id,
      firstName: b.first_name,
      lastName: b.last_name,
      phone: b.phone,
      country: b.country,
      city: b.city
    }))
  });
});

module.exports = {
  getAll,
  getById,
  create,
  update,
  delete: deleteBeneficiary,
  searchByPhone
};

const { query } = require('../config/database');
const { asyncHandler, ApiError } = require('../middleware/error.middleware');
const { v4: uuidv4 } = require('uuid');
const { FEE_TIERS } = require('../config/constants');
const { notifyPayerAgents, notifyTransferPaid } = require('../services/pushNotification.service');

// Generate unique reference
const generateReference = () => {
  const year = new Date().getFullYear();
  const random = Math.floor(Math.random() * 999999).toString().padStart(6, '0');
  return `GX-${year}-${random}`;
};

// Calculate fees based on amount
// Structure: 
// - $1-$100: $5
// - $101-$200: $8
// - $201-$500: $10
// - $501-$800: $15
// - $801-$1000: $20
// - >$1000: $20 par tranche de $1000
const calculateFees = (amount, currency) => {
  // Only USD supported (USA to BF only)
  if (currency !== 'USD') {
    throw new Error('Seule la devise USD est supportée');
  }
  
  // Montants supérieurs à $1000: $20 par tranche de $1000
  if (amount > 1000) {
    const thousands = Math.floor(amount / 1000);
    return thousands * 20; // $20 par tranche de $1000
  }
  
  // Montants <= $1000: utiliser les tranches fixes
  for (const tier of FEE_TIERS) {
    if (amount >= tier.minAmount && amount <= tier.maxAmount) {
      return tier.fee.USD;
    }
  }
  
  // Fallback (ne devrait jamais arriver)
  return 5;
};

// @desc    Get all transfers
// @route   GET /api/transfers
const getAll = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;
  const user = req.user;

  let sql = `
    SELECT 
      t.*,
      s.first_name as sender_first_name, s.last_name as sender_last_name, s.phone as sender_phone,
      b.first_name as beneficiary_first_name, b.last_name as beneficiary_last_name, b.phone as beneficiary_phone,
      creator.name as created_by_name,
      payer.name as paid_by_name
    FROM transfers t
    LEFT JOIN senders s ON t.sender_id = s.id
    LEFT JOIN beneficiaries b ON t.beneficiary_id = b.id
    LEFT JOIN users creator ON t.created_by = creator.id
    LEFT JOIN users payer ON t.paid_by = payer.id
    WHERE 1=1
  `;
  const params = [];
  let paramCount = 0;

  // Filter by role - agents only see their own transfers
  if (user.role === 'sender_agent' || user.role === 'payer_agent') {
    paramCount++;
    sql += ` AND (t.created_by = $${paramCount} OR t.paid_by = $${paramCount})`;
    params.push(user.id);
  }

  if (status) {
    paramCount++;
    sql += ` AND t.status = $${paramCount}`;
    params.push(status);
  }

  sql += ' ORDER BY t.created_at DESC';
  sql += ` LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
  params.push(limit, offset);

  const result = await query(sql, params);

  // Get total count
  let countSql = 'SELECT COUNT(*) FROM transfers t WHERE 1=1';
  const countParams = [];
  
  if (user.role === 'sender_agent' || user.role === 'payer_agent') {
    countSql += ' AND (t.created_by = $1 OR t.paid_by = $1)';
    countParams.push(user.id);
  }
  
  const countResult = await query(countSql, countParams);
  const total = parseInt(countResult.rows[0].count);

  res.json({
    success: true,
    data: result.rows.map(t => ({
      id: t.id,
      reference: t.reference,
      sender: {
        id: t.sender_id,
        firstName: t.sender_first_name,
        lastName: t.sender_last_name,
        phone: t.sender_phone,
        country: t.sender_country
      },
      beneficiary: {
        id: t.beneficiary_id,
        firstName: t.beneficiary_first_name,
        lastName: t.beneficiary_last_name,
        phone: t.beneficiary_phone,
        country: t.beneficiary_country,
        city: t.beneficiary_city
      },
      amountSent: parseFloat(t.amount_sent),
      currencySent: t.currency_sent,
      exchangeRate: parseFloat(t.exchange_rate),
      fees: parseFloat(t.fees),
      amountReceived: parseFloat(t.amount_received),
      currencyReceived: t.currency_received,
      sendMethod: t.send_method,
      status: t.status,
      createdBy: { id: t.created_by, name: t.created_by_name },
      paidBy: t.paid_by ? { id: t.paid_by, name: t.paid_by_name } : null,
      createdAt: t.created_at,
      paidAt: t.paid_at,
      notes: t.notes
    })),
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / limit)
    }
  });
});

// @desc    Get pending transfers
// @route   GET /api/transfers/pending
const getPending = asyncHandler(async (req, res) => {
  const user = req.user;

  let sql = `
    SELECT 
      t.*,
      s.first_name as sender_first_name, s.last_name as sender_last_name, s.phone as sender_phone,
      b.first_name as beneficiary_first_name, b.last_name as beneficiary_last_name, b.phone as beneficiary_phone,
      creator.name as created_by_name
    FROM transfers t
    LEFT JOIN senders s ON t.sender_id = s.id
    LEFT JOIN beneficiaries b ON t.beneficiary_id = b.id
    LEFT JOIN users creator ON t.created_by = creator.id
    WHERE t.status = 'pending'
  `;

  // For payer agents, filter by beneficiary country (only BF)
  if (user.role === 'payer_agent') {
    sql += ` AND t.beneficiary_country = 'BFA'`;
  }

  sql += ' ORDER BY t.created_at ASC';

  const result = await query(sql);

  res.json({
    success: true,
    data: result.rows.map(t => ({
      id: t.id,
      reference: t.reference,
      sender: {
        firstName: t.sender_first_name,
        lastName: t.sender_last_name,
        phone: t.sender_phone,
        country: t.sender_country
      },
      beneficiary: {
        firstName: t.beneficiary_first_name,
        lastName: t.beneficiary_last_name,
        phone: t.beneficiary_phone,
        country: t.beneficiary_country,
        city: t.beneficiary_city
      },
      amountReceived: parseFloat(t.amount_received),
      currencyReceived: t.currency_received,
      status: t.status,
      createdBy: t.created_by_name,
      createdAt: t.created_at
    }))
  });
});

// @desc    Get transfer by ID
// @route   GET /api/transfers/:id
const getById = asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT 
      t.*,
      s.first_name as sender_first_name, s.last_name as sender_last_name, 
      s.phone as sender_phone, s.email as sender_email,
      b.first_name as beneficiary_first_name, b.last_name as beneficiary_last_name, 
      b.phone as beneficiary_phone, b.id_type as beneficiary_id_type, b.id_number as beneficiary_id_number,
      creator.name as created_by_name,
      payer.name as paid_by_name
    FROM transfers t
    LEFT JOIN senders s ON t.sender_id = s.id
    LEFT JOIN beneficiaries b ON t.beneficiary_id = b.id
    LEFT JOIN users creator ON t.created_by = creator.id
    LEFT JOIN users payer ON t.paid_by = payer.id
    WHERE t.id = $1`,
    [req.params.id]
  );

  if (result.rows.length === 0) {
    throw new ApiError(404, 'Transfert non trouvé');
  }

  const t = result.rows[0];

  res.json({
    success: true,
    data: {
      id: t.id,
      reference: t.reference,
      sender: {
        id: t.sender_id,
        firstName: t.sender_first_name,
        lastName: t.sender_last_name,
        phone: t.sender_phone,
        email: t.sender_email,
        country: t.sender_country
      },
      beneficiary: {
        id: t.beneficiary_id,
        firstName: t.beneficiary_first_name,
        lastName: t.beneficiary_last_name,
        phone: t.beneficiary_phone,
        country: t.beneficiary_country,
        city: t.beneficiary_city,
        idType: t.beneficiary_id_type,
        idNumber: t.beneficiary_id_number
      },
      amountSent: parseFloat(t.amount_sent),
      currencySent: t.currency_sent,
      exchangeRate: parseFloat(t.exchange_rate),
      fees: parseFloat(t.fees),
      amountReceived: parseFloat(t.amount_received),
      currencyReceived: t.currency_received,
      sendMethod: t.send_method,
      status: t.status,
      createdBy: { id: t.created_by, name: t.created_by_name },
      paidBy: t.paid_by ? { id: t.paid_by, name: t.paid_by_name } : null,
      createdAt: t.created_at,
      paidAt: t.paid_at,
      cancelledAt: t.cancelled_at,
      notes: t.notes,
      cancellationReason: t.cancellation_reason
    }
  });
});

// @desc    Get transfer by reference
// @route   GET /api/transfers/reference/:ref
const getByReference = asyncHandler(async (req, res) => {
  const result = await query(
    'SELECT id FROM transfers WHERE reference = $1',
    [req.params.ref]
  );

  if (result.rows.length === 0) {
    throw new ApiError(404, 'Transfert non trouvé');
  }

  // Redirect to getById
  req.params.id = result.rows[0].id;
  return getById(req, res);
});

// @desc    Create new transfer
// @route   POST /api/transfers
const create = asyncHandler(async (req, res) => {
  const { sender, beneficiary, amountSent, currency, exchangeRate, sendMethod, notes, fees: customFees } = req.body;
  const user = req.user;

  // Calculate fees and amount received
  const calculatedFees = calculateFees(amountSent, currency);
  
  // Allow custom fees but ensure they don't exceed calculated fees (can only reduce)
  let fees = calculatedFees;
  if (customFees !== undefined && customFees !== null) {
    if (customFees < 0) {
      throw new ApiError(400, 'Les frais ne peuvent pas être négatifs');
    }
    if (customFees > calculatedFees) {
      throw new ApiError(400, `Les frais ne peuvent pas dépasser ${calculatedFees} ${currency}`);
    }
    fees = customFees;
  }
  
  const amountReceived = Math.round(amountSent * exchangeRate);

  // Create or find sender
  let senderResult = await query(
    'SELECT id FROM senders WHERE phone = $1 AND first_name = $2 AND last_name = $3',
    [sender.phone, sender.firstName, sender.lastName]
  );

  let senderId;
  if (senderResult.rows.length === 0) {
    const newSender = await query(
      `INSERT INTO senders (first_name, last_name, phone, email, country, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [sender.firstName, sender.lastName, sender.phone, sender.email || null, sender.country, user.id]
    );
    senderId = newSender.rows[0].id;
  } else {
    senderId = senderResult.rows[0].id;
  }

  // Create or find beneficiary
  let beneficiaryResult = await query(
    'SELECT id FROM beneficiaries WHERE phone = $1 AND first_name = $2 AND last_name = $3',
    [beneficiary.phone, beneficiary.firstName, beneficiary.lastName]
  );

  let beneficiaryId;
  if (beneficiaryResult.rows.length === 0) {
    const newBeneficiary = await query(
      `INSERT INTO beneficiaries (first_name, last_name, phone, country, city, id_type, id_number, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [beneficiary.firstName, beneficiary.lastName, beneficiary.phone, beneficiary.country, 
       beneficiary.city, beneficiary.idType || null, beneficiary.idNumber || null, user.id]
    );
    beneficiaryId = newBeneficiary.rows[0].id;
  } else {
    beneficiaryId = beneficiaryResult.rows[0].id;
  }

  // Generate unique reference
  let reference = generateReference();
  
  // Create transfer
  const transferResult = await query(
    `INSERT INTO transfers (
      reference, sender_id, sender_country, send_method,
      beneficiary_id, beneficiary_country, beneficiary_city,
      amount_sent, currency_sent, exchange_rate, fees, amount_received, currency_received,
      status, created_by, notes
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    RETURNING *`,
    [
      reference, senderId, sender.country, sendMethod,
      beneficiaryId, beneficiary.country, beneficiary.city,
      amountSent, currency, exchangeRate, fees, amountReceived, 'XOF',
      'pending', user.id, notes || null
    ]
  );

  const transfer = transferResult.rows[0];

  // Send push notification to payer agents
  try {
    await notifyPayerAgents({
      id: transfer.id,
      reference: transfer.reference,
      amountReceived: parseFloat(transfer.amount_received),
      beneficiaryName: `${beneficiary.firstName} ${beneficiary.lastName}`,
      beneficiaryCity: beneficiary.city
    }, beneficiary.country);
  } catch (notifError) {
    console.error('Push notification error:', notifError);
    // Don't fail the transfer creation if notification fails
  }

  res.status(201).json({
    success: true,
    message: 'Transfert créé avec succès',
    data: {
      id: transfer.id,
      reference: transfer.reference,
      amountSent: parseFloat(transfer.amount_sent),
      currencySent: transfer.currency_sent,
      fees: parseFloat(transfer.fees),
      amountReceived: parseFloat(transfer.amount_received),
      currencyReceived: transfer.currency_received,
      status: transfer.status,
      createdAt: transfer.created_at
    }
  });
});

// @desc    Mark transfer as paid
// @route   PATCH /api/transfers/:id/pay
const markAsPaid = asyncHandler(async (req, res) => {
  const user = req.user;

  // Check if transfer exists and is pending
  const existing = await query(
    'SELECT id, status, reference, created_by FROM transfers WHERE id = $1',
    [req.params.id]
  );

  if (existing.rows.length === 0) {
    throw new ApiError(404, 'Transfert non trouvé');
  }

  if (existing.rows[0].status !== 'pending') {
    throw new ApiError(400, `Ce transfert ne peut pas être payé (statut: ${existing.rows[0].status})`);
  }

  // Update transfer
  const result = await query(
    `UPDATE transfers 
     SET status = 'paid', paid_by = $1, paid_at = CURRENT_TIMESTAMP
     WHERE id = $2
     RETURNING *`,
    [user.id, req.params.id]
  );

  const transfer = result.rows[0];

  // Notify the sender agent who created the transfer
  try {
    await notifyTransferPaid({
      id: transfer.id,
      reference: transfer.reference
    }, existing.rows[0].created_by);
  } catch (notifError) {
    console.error('Push notification error:', notifError);
  }

  res.json({
    success: true,
    message: `Transfert ${transfer.reference} payé avec succès`,
    data: {
      id: transfer.id,
      reference: transfer.reference,
      status: transfer.status,
      paidAt: transfer.paid_at
    }
  });
});

// @desc    Cancel transfer
// @route   PATCH /api/transfers/:id/cancel
const cancel = asyncHandler(async (req, res) => {
  const { reason } = req.body;

  // Check if transfer exists and can be cancelled
  const existing = await query(
    'SELECT id, status, reference FROM transfers WHERE id = $1',
    [req.params.id]
  );

  if (existing.rows.length === 0) {
    throw new ApiError(404, 'Transfert non trouvé');
  }

  if (existing.rows[0].status === 'paid') {
    throw new ApiError(400, 'Un transfert payé ne peut pas être annulé');
  }

  if (existing.rows[0].status === 'cancelled') {
    throw new ApiError(400, 'Ce transfert est déjà annulé');
  }

  // Update transfer
  const result = await query(
    `UPDATE transfers 
     SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP, cancellation_reason = $1
     WHERE id = $2
     RETURNING *`,
    [reason || 'Annulé par l\'utilisateur', req.params.id]
  );

  const transfer = result.rows[0];

  res.json({
    success: true,
    message: `Transfert ${transfer.reference} annulé`,
    data: {
      id: transfer.id,
      reference: transfer.reference,
      status: transfer.status,
      cancelledAt: transfer.cancelled_at
    }
  });
});

module.exports = {
  getAll,
  getPending,
  getById,
  getByReference,
  create,
  markAsPaid,
  cancel
};

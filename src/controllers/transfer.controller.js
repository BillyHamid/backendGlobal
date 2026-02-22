const { query } = require('../config/database');
const { asyncHandler, ApiError } = require('../middleware/error.middleware');
const { v4: uuidv4 } = require('uuid');
const { FEE_TIERS } = require('../config/constants');
const { notifyPayerAgents, notifyTransferPaid } = require('../services/pushNotification.service');
const { sendTransferPaidToSender } = require('../services/whatsapp.service');
const { getSecureRelativePath } = require('../services/fileSecurity.service');
const { logConfirmation, logProofDownload, logAction } = require('../services/audit.service');
const { createLedgerEntry } = require('../services/ledger.service');

// Generate unique reference
const generateReference = () => {
  const year = new Date().getFullYear();
  const random = Math.floor(Math.random() * 999999).toString().padStart(6, '0');
  return `GX-${year}-${random}`;
};

// Calculate fees based on amount
// Structure pour USD (USA → BF): 
// - $1-$100: $5
// - $101-$200: $8
// - $201-$500: $10
// - $501-$800: $15
// - $801-$1000: $20
// - >$1000: $20 par tranche de $1000
// Structure pour XOF (BF → USA):
// - 1-61500 XOF (~$1-$100): 3075 XOF (~$5)
// - 61501-123000 XOF (~$101-$200): 4920 XOF (~$8)
// - 123001-307500 XOF (~$201-$500): 6150 XOF (~$10)
// - 307501-492000 XOF (~$501-$800): 9225 XOF (~$15)
// - 492001-615000 XOF (~$801-$1000): 12300 XOF (~$20)
// - >615000 XOF: 12300 XOF par tranche de 615000 XOF (~$20 par $1000)
const calculateFees = (amount, currency) => {
  if (currency === 'USD') {
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
  } else if (currency === 'XOF') {
    // Frais en XOF pour BF → USA
    // Basé sur l'équivalent USD (taux ~615 XOF/USD)
    const equivalentUSD = amount / 615;
    
    // Montants supérieurs à 615000 XOF (~$1000): 12300 XOF par tranche de 615000 XOF
    if (amount > 615000) {
      const tranches = Math.floor(amount / 615000);
      return tranches * 12300; // 12300 XOF par tranche (~$20 par $1000)
    }
    
    // Montants <= 615000 XOF: utiliser les tranches fixes en XOF
    if (amount >= 1 && amount <= 61500) return 3075; // ~$5
    if (amount >= 61501 && amount <= 123000) return 4920; // ~$8
    if (amount >= 123001 && amount <= 307500) return 6150; // ~$10
    if (amount >= 307501 && amount <= 492000) return 9225; // ~$15
    if (amount >= 492001 && amount <= 615000) return 12300; // ~$20
    
    // Fallback
    return 3075;
  } else {
    throw new Error(`Devise non supportée: ${currency}. Seules USD et XOF sont supportées.`);
  }
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
      creator.country as created_by_country,
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

  // Admin/supervisor see all. Agents (USA et BF) voient tous les transferts (tous peuvent créer et payer)
  // Pas de filtre par agent

  if (status) {
    paramCount++;
    sql += ` AND t.status = $${paramCount}`;
    params.push(status);
  }

  sql += ' ORDER BY t.created_at DESC';
  sql += ` LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
  params.push(limit, offset);

  const result = await query(sql, params);

  // Get total count (same filters as main query)
  let countSql = 'SELECT COUNT(*) FROM transfers t WHERE 1=1';
  const countParams = [];
  if (status) {
    countParams.push(status);
    countSql += ' AND t.status = $1';
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
      createdBy: { id: t.created_by, name: t.created_by_name, country: t.created_by_country },
      paidBy: t.paid_by ? { id: t.paid_by, name: t.paid_by_name || 'Utilisateur inconnu' } : null,
      createdAt: t.created_at,
      paidAt: t.paid_at,
      proofFilePath: t.proof_file_path,
      confirmationComment: t.confirmation_comment,
      confirmedAt: t.confirmed_at,
      confirmationIp: t.confirmation_ip,
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
      creator.name as created_by_name,
      creator.country as created_by_country,
      payer.name as paid_by_name
    FROM transfers t
    LEFT JOIN senders s ON t.sender_id = s.id
    LEFT JOIN beneficiaries b ON t.beneficiary_id = b.id
    LEFT JOIN users creator ON t.created_by = creator.id
    LEFT JOIN users payer ON t.paid_by = payer.id
    WHERE t.status = 'pending'
  `;

  // Tous les agents voient tous les transferts en attente (USA et BF peuvent créer et payer)
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
      createdBy: { id: t.created_by, name: t.created_by_name, country: t.created_by_country },
      paidBy: t.paid_by ? { id: t.paid_by, name: t.paid_by_name || 'Utilisateur inconnu' } : null,
      createdAt: t.created_at,
      paidAt: t.paid_at,
      proofFilePath: t.proof_file_path,
      confirmationComment: t.confirmation_comment,
      confirmedAt: t.confirmed_at
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
      creator.country as created_by_country,
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
      createdBy: { id: t.created_by, name: t.created_by_name, country: t.created_by_country },
      paidBy: t.paid_by ? { id: t.paid_by, name: t.paid_by_name } : null,
      createdAt: t.created_at,
      paidAt: t.paid_at,
      cancelledAt: t.cancelled_at,
      proofFilePath: t.proof_file_path,
      confirmationComment: t.confirmation_comment,
      confirmedAt: t.confirmed_at,
      confirmationIp: t.confirmation_ip,
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
  const { sender, beneficiary, amountSent, currency, exchangeRate, sendMethod, notes, fees: customFees, currencyReceived } = req.body;
  const user = req.user;
  
  // Debug: Log user info to verify correct user
  console.log('Creating transfer - User ID:', user.id, 'User Name:', user.name, 'User Email:', user.email);

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
  
  // Calculer le montant reçu selon la direction du transfert
  // USA → BF : multiplier (USD * taux = XOF)
  // BF → USA : diviser (XOF / taux = USD)
  const isUSAtoBF = sender.country === 'USA' && beneficiary.country === 'BFA';
  const isBFtoUSA = sender.country === 'BFA' && beneficiary.country === 'USA';
  
  let amountReceived;
  let finalCurrencyReceived;
  
  if (isUSAtoBF) {
    // USA → BF : multiplier
    amountReceived = Math.round(amountSent * exchangeRate);
    finalCurrencyReceived = currencyReceived || 'XOF';
  } else if (isBFtoUSA) {
    // BF → USA : diviser et arrondir à 2 décimales
    amountReceived = Math.round((amountSent / exchangeRate) * 100) / 100;
    finalCurrencyReceived = currencyReceived || 'USD';
  } else {
    // Fallback (ne devrait pas arriver)
    amountReceived = Math.round(amountSent * exchangeRate);
    finalCurrencyReceived = currencyReceived || 'XOF';
  }

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
      amountSent, currency, exchangeRate, fees, amountReceived, finalCurrencyReceived,
      'pending', user.id, notes || null
    ]
  );
  
  // Debug: Verify created_by
  console.log('Transfer created - created_by:', user.id, 'Reference:', reference);

  const transfer = transferResult.rows[0];

  // Créer écriture comptable: CREDIT caisse USA (montant USD reçu)
  // Seulement si le transfert est créé depuis USA
  try {
    if (sender.country === 'USA' || sender.country === 'États-Unis') {
      await createLedgerEntry(
        'USA',
        'CREDIT',
        parseFloat(transfer.amount_sent),
        'USD',
        `Transfert ${transfer.reference} - Réception ${parseFloat(transfer.amount_sent)} USD`,
        transfer.id,
        user.id
      );
    } else if (sender.country === 'BFA' || sender.country === 'Burkina Faso') {
      // Burkina → USA : client donne XOF → caisse Burkina augmente (CREDIT BURKINA).
      // Burkina → BF (fallback) : idem, CREDIT BURKINA.
      if (beneficiary.country === 'USA') {
        // BF → USA : client donne XOF au BF → caisse Burkina augmente
        await createLedgerEntry(
          'BURKINA',
          'CREDIT',
          parseFloat(transfer.amount_sent),
          'XOF',
          `Transfert ${transfer.reference} - Réception ${parseFloat(transfer.amount_sent)} XOF (client BF → USA)`,
          transfer.id,
          user.id
        );
      } else {
        // BF → BF (fallback, ne devrait pas arriver)
        await createLedgerEntry(
          'BURKINA',
          'CREDIT',
          parseFloat(transfer.amount_sent),
          'XOF',
          `Transfert ${transfer.reference} - Réception ${parseFloat(transfer.amount_sent)} XOF`,
          transfer.id,
          user.id
        );
      }
    }
  } catch (ledgerError) {
    console.error('Erreur création écriture comptable:', ledgerError);
    // Ne pas faire échouer la création du transfert si l'écriture échoue
    // Mais idéalement on devrait rollback la transaction
  }

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

// @desc    Confirm transfer with proof (secure upload)
// @route   POST /api/transfers/:id/confirm
const confirmWithProof = asyncHandler(async (req, res) => {
  const user = req.user;
  const { comment } = req.body;
  const transferId = req.params.id;
  
  // Vérifier que le fichier a été uploadé
  if (!req.file) {
    throw new ApiError(400, 'Le fichier de preuve est obligatoire pour confirmer la transaction');
  }
  
  // Vérifier que la transaction existe et est en statut PENDING
  // Récupérer aussi le pays de l'agent qui a créé le transfert
  const existing = await query(
    `SELECT t.id, t.status, t.reference, t.created_by, t.proof_file_path, 
            creator.country as creator_country
     FROM transfers t
     LEFT JOIN users creator ON t.created_by = creator.id
     WHERE t.id = $1`,
    [transferId]
  );
  
  if (existing.rows.length === 0) {
    // Supprimer le fichier uploadé si la transaction n'existe pas
    const fs = require('fs');
    if (req.file.path) {
      try { fs.unlinkSync(req.file.path); } catch {}
    }
    throw new ApiError(404, 'Transfert non trouvé');
  }
  
  const transfer = existing.rows[0];
  
  if (transfer.status !== 'pending') {
    // Supprimer le fichier uploadé si le statut est invalide
    const fs = require('fs');
    if (req.file.path) {
      try { fs.unlinkSync(req.file.path); } catch {}
    }
    throw new ApiError(400, `Ce transfert ne peut pas être confirmé (statut: ${transfer.status}). Seuls les transferts en attente peuvent être confirmés.`);
  }
  
  // Vérifier que l'agent qui confirme est du bon pays
  // Si l'agent créateur est du BF, seul un agent USA peut confirmer
  // Si l'agent créateur est des USA, seul un agent BF peut confirmer
  const creatorCountry = transfer.creator_country;
  const confirmerCountry = user.country;
  
  if (creatorCountry === 'BFA' || creatorCountry === 'Burkina Faso') {
    // Agent BF a créé → seul agent USA peut confirmer
    if (confirmerCountry !== 'USA' && confirmerCountry !== 'États-Unis' && user.role !== 'admin' && user.role !== 'supervisor') {
      const fs = require('fs');
      if (req.file.path) {
        try { fs.unlinkSync(req.file.path); } catch {}
      }
      throw new ApiError(403, 'Seuls les agents des USA peuvent confirmer un transfert initié par un agent du Burkina Faso');
    }
  } else if (creatorCountry === 'USA' || creatorCountry === 'États-Unis') {
    // Agent USA a créé → seul agent BF peut confirmer
    if (confirmerCountry !== 'BFA' && confirmerCountry !== 'Burkina Faso' && user.role !== 'admin' && user.role !== 'supervisor') {
      const fs = require('fs');
      if (req.file.path) {
        try { fs.unlinkSync(req.file.path); } catch {}
      }
      throw new ApiError(403, 'Seuls les agents du Burkina Faso peuvent confirmer un transfert initié par un agent des USA');
    }
  }
  
  if (transfer.proof_file_path) {
    // Supprimer l'ancien fichier s'il existe
    const fs = require('fs');
    const { uploadDir } = require('../services/fileSecurity.service');
    const oldFilePath = require('path').join(uploadDir, require('path').basename(transfer.proof_file_path));
    try { fs.unlinkSync(oldFilePath); } catch {}
  }
  
  // Obtenir l'adresse IP du client
  const ipAddress = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
  const userAgent = req.headers['user-agent'] || 'unknown';
  
  // Générer le chemin relatif sécurisé
  const securePath = getSecureRelativePath(req.file.filename);
  
  // Mettre à jour le transfert avec la preuve (statut = 'paid')
  const result = await query(
    `UPDATE transfers 
     SET status = 'paid',
         proof_file_path = $1,
         confirmation_comment = $2,
         confirmed_at = CURRENT_TIMESTAMP,
         confirmation_ip = $3,
         paid_by = $4,
         paid_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $5
     RETURNING *`,
    [securePath, comment || null, ipAddress, user.id, transferId]
  );
  
  const updatedTransfer = result.rows[0];
  
  // Créer écriture comptable: DEBIT caisse BURKINA (paiement XOF)
  // Quand un agent BF confirme un transfert créé par USA
  try {
    if (creatorCountry === 'USA' || creatorCountry === 'États-Unis') {
      // Transfert créé depuis USA → paiement depuis BF
      await createLedgerEntry(
        'BURKINA',
        'DEBIT',
        parseFloat(updatedTransfer.amount_received),
        'XOF',
        `Transfert ${updatedTransfer.reference} - Paiement ${parseFloat(updatedTransfer.amount_received)} XOF`,
        updatedTransfer.id,
        user.id
      );
    } else if (creatorCountry === 'BFA' || creatorCountry === 'Burkina Faso') {
      // Transfert créé depuis BF → USA : paiement depuis USA (débiter caisse USA avec montant USD)
      // Le montant à débiter est amount_received (USD) car c'est ce qui est payé au bénéficiaire
      await createLedgerEntry(
        'USA',
        'DEBIT',
        parseFloat(updatedTransfer.amount_received),
        'USD',
        `Transfert ${updatedTransfer.reference} - Paiement ${parseFloat(updatedTransfer.amount_received)} USD`,
        updatedTransfer.id,
        user.id
      );
    }
  } catch (ledgerError) {
    console.error('Erreur création écriture comptable:', ledgerError);
    // Ne pas faire échouer la confirmation si l'écriture échoue
  }
  
  // Journaliser l'action d'audit
  await logConfirmation(
    transferId,
    user.id,
    securePath,
    comment || null,
    ipAddress,
    userAgent
  );
  
  // Notifier l'agent qui a créé le transfert (web push)
  try {
    await notifyTransferPaid({
      id: updatedTransfer.id,
      reference: updatedTransfer.reference
    }, transfer.created_by);
  } catch (notifError) {
    console.error('Push notification error:', notifError);
  }

  // Notifier l'expéditeur (client) par WhatsApp via WhatChimp
  try {
    const senderBeneficiary = await query(
      `SELECT s.phone as sender_phone, s.first_name as sender_first_name, s.last_name as sender_last_name, s.country as sender_country,
              b.first_name as ben_first_name, b.last_name as ben_last_name
       FROM transfers t
       JOIN senders s ON t.sender_id = s.id
       JOIN beneficiaries b ON t.beneficiary_id = b.id
       WHERE t.id = $1`,
      [updatedTransfer.id]
    );
    if (senderBeneficiary.rows.length > 0) {
      const r = senderBeneficiary.rows[0];
      const senderName = [r.sender_first_name, r.sender_last_name].filter(Boolean).join(' ') || 'Client';
      const beneficiaryName = [r.ben_first_name, r.ben_last_name].filter(Boolean).join(' ') || 'Bénéficiaire';
      await sendTransferPaidToSender({
        senderPhone: r.sender_phone,
        senderCountry: r.sender_country,
        senderName,
        reference: updatedTransfer.reference,
        amountReceived: parseFloat(updatedTransfer.amount_received),
        currencyReceived: updatedTransfer.currency_received,
        beneficiaryName
      });
    }
  } catch (whatsappErr) {
    console.error('WhatsApp notification error:', whatsappErr);
  }

  res.json({
    success: true,
    message: `Transfert ${updatedTransfer.reference} confirmé avec succès`,
    data: {
      id: updatedTransfer.id,
      reference: updatedTransfer.reference,
      status: updatedTransfer.status,
      proofFile: securePath,
      confirmedAt: updatedTransfer.confirmed_at
    }
  });
});

// @desc    Download proof file (secure access)
// @route   GET /api/transfers/:id/proof
const downloadProof = asyncHandler(async (req, res) => {
  const user = req.user;
  const transferId = req.params.id;
  
  // Vérifier que la transaction existe
  const transfer = await query(
    'SELECT id, reference, proof_file_path FROM transfers WHERE id = $1',
    [transferId]
  );
  
  if (transfer.rows.length === 0) {
    throw new ApiError(404, 'Transfert non trouvé');
  }
  
  const proofPath = transfer.rows[0].proof_file_path;
  
  if (!proofPath) {
    throw new ApiError(404, 'Aucune preuve disponible pour ce transfert');
  }
  
  // Journaliser le téléchargement
  const ipAddress = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
  const userAgent = req.headers['user-agent'] || 'unknown';
  await logProofDownload(transferId, user.id, ipAddress, userAgent);
  
  // Servir le fichier de manière sécurisée
  const fs = require('fs');
  const path = require('path');
  const { validateFilePath, uploadDir } = require('../services/fileSecurity.service');
  
  try {
    // Le proofPath stocké est relatif (transactions/filename.ext)
    // Extraire le nom du fichier
    const filename = path.basename(proofPath);
    const filePath = path.join(uploadDir, filename);
    
    // Vérifier que le fichier existe et est dans le dossier sécurisé
    if (!fs.existsSync(filePath)) {
      throw new ApiError(404, 'Fichier de preuve non trouvé');
    }
    
    // Vérifier que le chemin est sécurisé (pas de directory traversal)
    const resolvedPath = path.resolve(filePath);
    const resolvedDir = path.resolve(uploadDir);
    if (!resolvedPath.startsWith(resolvedDir)) {
      throw new ApiError(403, 'Accès non autorisé');
    }
    
    // Déterminer le type MIME
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.pdf': 'application/pdf'
    };
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    
    const fileStream = fs.createReadStream(filePath);
    fileStream.on('error', () => {
      throw new ApiError(500, 'Erreur lors de la lecture du fichier');
    });
    fileStream.pipe(res);
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(500, 'Erreur lors du téléchargement du fichier');
  }
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

// @desc    Delete transfer (admin only)
// @route   DELETE /api/transfers/:id
const deleteTransfer = asyncHandler(async (req, res) => {
  const user = req.user;
  const transferId = req.params.id;

  // Vérifier que la transaction existe
  const existing = await query(
    'SELECT id, reference, proof_file_path FROM transfers WHERE id = $1',
    [transferId]
  );

  if (existing.rows.length === 0) {
    throw new ApiError(404, 'Transfert non trouvé');
  }

  const transfer = existing.rows[0];

  // Supprimer le fichier de preuve s'il existe
  if (transfer.proof_file_path) {
    try {
      const fs = require('fs');
      const path = require('path');
      const { uploadDir } = require('../services/fileSecurity.service');
      const filePath = path.join(uploadDir, path.basename(transfer.proof_file_path));
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (fileError) {
      console.error('Erreur lors de la suppression du fichier de preuve:', fileError);
      // Continuer même si la suppression du fichier échoue
    }
  }

  // Supprimer le transfert
  await query('DELETE FROM transfers WHERE id = $1', [transferId]);

  // Journaliser la suppression
  const ipAddress = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
  const userAgent = req.headers['user-agent'] || 'unknown';
  await logAction(
    user.id,
    'TRANSFER_DELETED',
    'transfer',
    transferId,
    { reference: transfer.reference },
    null,
    ipAddress,
    userAgent
  );

  res.json({
    success: true,
    message: `Transfert ${transfer.reference} supprimé avec succès`
  });
});

module.exports = {
  getAll,
  getPending,
  getById,
  getByReference,
  create,
  markAsPaid,
  confirmWithProof,
  downloadProof,
  cancel,
  deleteTransfer
};

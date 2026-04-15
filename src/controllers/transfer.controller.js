const { query, getClient } = require('../config/database');
const { asyncHandler, ApiError } = require('../middleware/error.middleware');
const { v4: uuidv4 } = require('uuid');
const { FEE_TIERS } = require('../config/constants');
const { notifyPayerAgents, notifyTransferPaid } = require('../services/pushNotification.service');
const { sendTransferPaidToSender } = require('../services/whatsapp.service');
const { getSecureRelativePath } = require('../services/fileSecurity.service');
const { logConfirmation, logProofDownload, logAction } = require('../services/audit.service');
const { createLedgerEntry } = require('../services/ledger.service');
const { fetchUsdToXofRate } = require('../services/exchangeRate.service');

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

/** Frais optionnels (body JSON / payload multipart). undefined|null|'' = laisser le calcul serveur. */
function parseOptionalFeesInput(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

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
      b.id_proof_filename as beneficiary_id_proof_filename,
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
        idNumber: t.beneficiary_id_number,
        hasIdProof: Boolean(t.beneficiary_id_proof_filename),
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
  const { sender, beneficiary, amountSent, currency, exchangeRate, sendMethod, notes, fees: customFees, feeCurrency, currencyReceived } = req.body;
  const user = req.user;
  
  console.log('Creating transfer - User ID:', user.id, 'User Name:', user.name, 'User Email:', user.email);

  const isUSAtoBF = sender.country === 'USA' && beneficiary.country === 'BFA';
  const isBFtoUSA = sender.country === 'BFA' && beneficiary.country === 'USA';

  // Taux réel du marché (API), stocké pour traçabilité
  const rateReel = await fetchUsdToXofRate();

  // BF → USA : frais = (montant / taux_reel) - (montant / taux_paiement) → USD
  // USA → BF : grille fixe en USD
  let fees;
  if (isBFtoUSA) {
    const ratePaiement = exchangeRate;
    const calculatedFees = ratePaiement > rateReel
      ? Math.round(((amountSent / rateReel) - (amountSent / ratePaiement)) * 100) / 100
      : 0;
    const feeVal = parseOptionalFeesInput(customFees);
    fees = feeVal !== null && feeVal >= 0
      ? Math.min(feeVal, calculatedFees)
      : calculatedFees;
  } else {
    // USA → BF : calculateFees() = grille indicative uniquement (défaut si le client n’envoie pas de frais).
    // Ne jamais rejeter si frais saisis > grille (ex. prod historique : « ne peuvent pas dépasser 20 USD » pour ~1200 USD).
    // Seule contrainte : frais ≥ 0.
    const calculatedFees = calculateFees(amountSent, currency);
    fees = calculatedFees;
    const feeVal = parseOptionalFeesInput(customFees);
    if (feeVal !== null) {
      if (feeVal < 0) {
        throw new ApiError(400, 'Les frais ne peuvent pas être négatifs');
      }
      fees = feeVal;
    }
    if (process.env.NODE_ENV === 'development') {
      console.log('[USA→BF frais]', { amountSent, grilleIndicativeUSD: calculatedFees, fraisRetenus: fees, clientEnvoyé: feeVal });
    }
  }
  
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
      amount_sent, currency_sent, exchange_rate, rate_reel, fees, amount_received, currency_received,
      status, created_by, notes
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
    RETURNING *`,
    [
      reference, senderId, sender.country, sendMethod,
      beneficiaryId, beneficiary.country, beneficiary.city,
      amountSent, currency, exchangeRate, rateReel, fees, amountReceived, finalCurrencyReceived,
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

  if (req.file) {
    const pathMod = require('path');
    const fn = pathMod.basename(req.file.filename);
    await query(
      `UPDATE beneficiaries SET id_proof_filename = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [fn, beneficiaryId]
    );
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

const moneyClose = (a, b) => Math.abs(parseFloat(a) - parseFloat(b)) < 0.015;

/** Contre-passer les écritures liées au transfert (même logique que annulation, sans changer le statut) */
const reverseLedgerForTransferTx = async (client, transferId, reference, userId) => {
  const ledgerRows = await client.query(
    `SELECT le.id, le.type, le.amount, le.currency, a.name as account_name
     FROM ledger_entries le
     JOIN accounts a ON le.account_id = a.id
     WHERE le.transaction_id = $1`,
    [transferId]
  );
  for (const entry of ledgerRows.rows) {
    const reverseType = entry.type === 'CREDIT' ? 'DEBIT' : 'CREDIT';
    const accountResult = await client.query('SELECT id FROM accounts WHERE name = $1', [entry.account_name]);
    if (accountResult.rows.length === 0) {
      throw new ApiError(500, `Compte ${entry.account_name} introuvable`);
    }
    await client.query(
      `INSERT INTO ledger_entries (account_id, transaction_id, type, amount, currency, description, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        accountResult.rows[0].id,
        transferId,
        reverseType,
        entry.amount,
        entry.currency,
        `MODIFICATION ${reference} - Contre-passation ${entry.type} ${entry.amount} ${entry.currency}`,
        userId
      ]
    );
  }
  return ledgerRows.rows.length;
};

/** Recréer l'écriture « réception caisse » à la création (transfert pending) — aligné sur create() */
const appendInitialLedgerForTransferTx = async (client, {
  reference, transferId, senderCountry, beneficiaryCountry, amountSent, userId
}) => {
  const amt = parseFloat(amountSent);
  const insertCredit = async (accountName, currency, description) => {
    const acc = await client.query('SELECT id FROM accounts WHERE name = $1', [accountName]);
    if (acc.rows.length === 0) {
      throw new ApiError(500, `Compte ${accountName} introuvable`);
    }
    await client.query(
      `INSERT INTO ledger_entries (account_id, transaction_id, type, amount, currency, description, created_by)
       VALUES ($1, $2, 'CREDIT', $3, $4, $5, $6)`,
      [acc.rows[0].id, transferId, amt, currency, description, userId]
    );
  };

  if (senderCountry === 'USA' || senderCountry === 'États-Unis') {
    await insertCredit('USA', 'USD', `Transfert ${reference} - Réception ${amt} USD`);
  } else if (senderCountry === 'BFA' || senderCountry === 'Burkina Faso') {
    if (beneficiaryCountry === 'USA') {
      await insertCredit('BURKINA', 'XOF', `Transfert ${reference} - Réception ${amt} XOF (client BF → USA)`);
    } else {
      await insertCredit('BURKINA', 'XOF', `Transfert ${reference} - Réception ${amt} XOF`);
    }
  }
};

// @desc    Mettre à jour un transfert en attente (admin ou Razack uniquement)
// @route   PATCH /api/transfers/:id
const updateTransfer = asyncHandler(async (req, res) => {
  const transferId = req.params.id;
  const user = req.user;
  const {
    sender,
    beneficiary,
    amountSent,
    currency,
    exchangeRate,
    sendMethod,
    notes,
    fees: customFees,
    currencyReceived
  } = req.body;

  const existingResult = await query('SELECT * FROM transfers WHERE id = $1', [transferId]);

  if (existingResult.rows.length === 0) {
    throw new ApiError(404, 'Transfert non trouvé');
  }

  const row = existingResult.rows[0];

  if (row.status !== 'pending') {
    throw new ApiError(400, 'Seuls les transferts en attente peuvent être modifiés');
  }

  if (!row.sender_id || !row.beneficiary_id) {
    throw new ApiError(400, 'Transfert incomplet (expéditeur ou bénéficiaire manquant)');
  }

  const isUSAtoBF = sender.country === 'USA' && beneficiary.country === 'BFA';
  const isBFtoUSA = sender.country === 'BFA' && beneficiary.country === 'USA';
  if (!isUSAtoBF && !isBFtoUSA) {
    throw new ApiError(400, 'Corridor invalide : uniquement USA ↔ Burkina Faso');
  }

  const rateReel = await fetchUsdToXofRate();

  let fees;
  if (isBFtoUSA) {
    const ratePaiement = exchangeRate;
    const calculatedFees = ratePaiement > rateReel
      ? Math.round(((amountSent / rateReel) - (amountSent / ratePaiement)) * 100) / 100
      : 0;
    const feeVal = parseOptionalFeesInput(customFees);
    fees = feeVal !== null && feeVal >= 0
      ? Math.min(feeVal, calculatedFees)
      : calculatedFees;
  } else {
    // USA → BF : même règle que create (grille = indicative ; pas de plafond sur les frais saisis).
    const calculatedFees = calculateFees(amountSent, currency);
    fees = calculatedFees;
    const feeVal = parseOptionalFeesInput(customFees);
    if (feeVal !== null) {
      if (feeVal < 0) {
        throw new ApiError(400, 'Les frais ne peuvent pas être négatifs');
      }
      fees = feeVal;
    }
  }

  let amountReceived;
  let finalCurrencyReceived;
  if (isUSAtoBF) {
    amountReceived = Math.round(amountSent * exchangeRate);
    finalCurrencyReceived = currencyReceived || 'XOF';
  } else if (isBFtoUSA) {
    amountReceived = Math.round((amountSent / exchangeRate) * 100) / 100;
    finalCurrencyReceived = currencyReceived || 'USD';
  } else {
    amountReceived = Math.round(amountSent * exchangeRate);
    finalCurrencyReceived = currencyReceived || 'XOF';
  }

  const ledgerNeedsRefresh =
    !moneyClose(amountSent, row.amount_sent) ||
    row.currency_sent !== currency ||
    !moneyClose(exchangeRate, row.exchange_rate) ||
    !moneyClose(fees, row.fees) ||
    !moneyClose(amountReceived, row.amount_received) ||
    row.currency_received !== finalCurrencyReceived ||
    row.sender_country !== sender.country ||
    row.beneficiary_country !== beneficiary.country;

  const ipAddress = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
  const userAgent = req.headers['user-agent'] || 'unknown';

  const client = await getClient();
  try {
    await client.query('BEGIN');

    if (ledgerNeedsRefresh) {
      await reverseLedgerForTransferTx(client, transferId, row.reference, user.id);
    }

    await client.query(
      `UPDATE senders SET first_name = $1, last_name = $2, phone = $3, email = $4, country = $5, updated_at = CURRENT_TIMESTAMP
       WHERE id = $6`,
      [
        sender.firstName,
        sender.lastName,
        sender.phone,
        sender.email || null,
        sender.country,
        row.sender_id
      ]
    );

    await client.query(
      `UPDATE beneficiaries SET first_name = $1, last_name = $2, phone = $3, country = $4, city = $5,
        id_type = $6, id_number = $7, updated_at = CURRENT_TIMESTAMP
       WHERE id = $8`,
      [
        beneficiary.firstName,
        beneficiary.lastName,
        beneficiary.phone,
        beneficiary.country,
        beneficiary.city,
        beneficiary.idType || null,
        beneficiary.idNumber || null,
        row.beneficiary_id
      ]
    );

    await client.query(
      `UPDATE transfers SET
        sender_country = $1, send_method = $2,
        beneficiary_country = $3, beneficiary_city = $4,
        amount_sent = $5, currency_sent = $6, exchange_rate = $7, rate_reel = $8,
        fees = $9, amount_received = $10, currency_received = $11,
        notes = $12, updated_at = CURRENT_TIMESTAMP
       WHERE id = $13`,
      [
        sender.country,
        sendMethod,
        beneficiary.country,
        beneficiary.city,
        amountSent,
        currency,
        exchangeRate,
        rateReel,
        fees,
        amountReceived,
        finalCurrencyReceived,
        notes || null,
        transferId
      ]
    );

    if (ledgerNeedsRefresh) {
      await appendInitialLedgerForTransferTx(client, {
        reference: row.reference,
        transferId,
        senderCountry: sender.country,
        beneficiaryCountry: beneficiary.country,
        amountSent,
        userId: user.id
      });
    }

    await client.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        user.id,
        'TRANSFER_UPDATED',
        'transfer',
        transferId,
        JSON.stringify({
          reference: row.reference,
          ledgerAdjusted: ledgerNeedsRefresh,
          previousAmountSent: parseFloat(row.amount_sent),
          previousAmountReceived: parseFloat(row.amount_received)
        }),
        JSON.stringify({
          amountSent,
          amountReceived,
          senderCountry: sender.country,
          beneficiaryCountry: beneficiary.country
        }),
        ipAddress,
        userAgent
      ]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  req.params.id = transferId;
  return getById(req, res);
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
// @desc    Télécharger la pièce d'identité du bénéficiaire (upload à la création)
// @route   GET /api/transfers/:id/beneficiary-id-proof
const downloadBeneficiaryIdProof = asyncHandler(async (req, res) => {
  const transferId = req.params.id;

  const row = await query(
    `SELECT b.id_proof_filename
     FROM transfers t
     JOIN beneficiaries b ON t.beneficiary_id = b.id
     WHERE t.id = $1`,
    [transferId]
  );

  if (row.rows.length === 0) {
    throw new ApiError(404, 'Transfert non trouvé');
  }

  const stored = row.rows[0].id_proof_filename;
  if (!stored) {
    throw new ApiError(404, 'Aucune pièce d\'identité enregistrée pour ce bénéficiaire');
  }

  const fs = require('fs');
  const path = require('path');
  const { uploadDir } = require('../middleware/beneficiaryIdProof.upload');
  const filename = path.basename(stored);
  const filePath = path.join(uploadDir, filename);
  const resolvedPath = path.resolve(filePath);
  const resolvedDir = path.resolve(uploadDir);

  if (!resolvedPath.startsWith(resolvedDir)) {
    throw new ApiError(403, 'Accès non autorisé');
  }

  if (!fs.existsSync(resolvedPath)) {
    throw new ApiError(404, 'Fichier introuvable');
  }

  const ext = path.extname(filename).toLowerCase();
  const mimeTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.pdf': 'application/pdf',
  };
  const contentType = mimeTypes[ext] || 'application/octet-stream';
  const stat = fs.statSync(resolvedPath);
  const safeFilename = filename.replace(/[^\w.-]/g, '_');

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');

  try {
    await new Promise((resolve, reject) => {
      const fileStream = fs.createReadStream(resolvedPath, { flags: 'r' });
      fileStream.on('error', reject);
      res.on('finish', resolve);
      fileStream.pipe(res);
    });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(500, 'Erreur lors de la lecture du fichier');
  }
});

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
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;

    const safeFilename = filename.replace(/[^\w.-]/g, '_');

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', fileSize);
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.setHeader('Accept-Ranges', 'bytes');

    const fileStream = fs.createReadStream(filePath, { flags: 'r' });
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
  const user = req.user;
  const { reason } = req.body;
  const transferId = req.params.id;

  const existing = await query(
    `SELECT t.id, t.status, t.reference, t.amount_sent, t.amount_received,
            t.sender_country, t.beneficiary_country, t.currency_sent, t.currency_received,
            t.proof_file_path
     FROM transfers t
     WHERE t.id = $1`,
    [transferId]
  );

  if (existing.rows.length === 0) {
    throw new ApiError(404, 'Transfert non trouvé');
  }

  const t = existing.rows[0];

  if (t.status === 'cancelled') {
    throw new ApiError(400, 'Ce transfert est déjà annulé');
  }

  const proofPathBeforeCancel = t.proof_file_path;

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // 1. Récupérer toutes les écritures comptables liées à ce transfert
    const ledgerRows = await client.query(
      `SELECT le.id, le.type, le.amount, le.currency, a.name as account_name
       FROM ledger_entries le
       JOIN accounts a ON le.account_id = a.id
       WHERE le.transaction_id = $1`,
      [transferId]
    );

    // 2. Créer une écriture inverse pour chaque écriture existante
    for (const entry of ledgerRows.rows) {
      const reverseType = entry.type === 'CREDIT' ? 'DEBIT' : 'CREDIT';
      const accountResult = await client.query(
        'SELECT id FROM accounts WHERE name = $1', [entry.account_name]
      );
      await client.query(
        `INSERT INTO ledger_entries (account_id, transaction_id, type, amount, currency, description, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          accountResult.rows[0].id,
          transferId,
          reverseType,
          entry.amount,
          entry.currency,
          `ANNULATION ${t.reference} - Contre-passation ${entry.type} ${entry.amount} ${entry.currency}`,
          user.id
        ]
      );
    }

    // 3. Passer le transfert en annulé et effacer les infos de paiement / preuve (comme une clôture métier)
    const result = await client.query(
      `UPDATE transfers
       SET status = 'cancelled',
           cancelled_at = CURRENT_TIMESTAMP,
           cancellation_reason = $1,
           paid_at = NULL,
           paid_by = NULL,
           proof_file_path = NULL,
           confirmation_comment = NULL,
           confirmed_at = NULL,
           confirmation_ip = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING *`,
      [reason || 'Annulé par l\'utilisateur', transferId]
    );

    // 4. Journaliser
    const ipAddress = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    await client.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_values, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        user.id, 'TRANSFER_CANCELLED', 'transfer', transferId,
        JSON.stringify({ reference: t.reference, previousStatus: t.status, reason: reason || null, reversedEntries: ledgerRows.rows.length }),
        ipAddress, userAgent
      ]
    );

    await client.query('COMMIT');

    const transfer = result.rows[0];

    // Fichier de preuve : retirer du disque après succès SQL (hors transaction)
    if (proofPathBeforeCancel) {
      try {
        const fs = require('fs');
        const path = require('path');
        const { uploadDir } = require('../services/fileSecurity.service');
        const filePath = path.join(uploadDir, path.basename(proofPathBeforeCancel));
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (fileErr) {
        console.error('Erreur suppression fichier preuve après annulation:', fileErr);
      }
    }

    res.json({
      success: true,
      message: `Transfert ${transfer.reference} annulé — ${ledgerRows.rows.length} écriture(s) comptable(s) contre-passée(s)`,
      data: {
        id: transfer.id,
        reference: transfer.reference,
        status: transfer.status,
        cancelledAt: transfer.cancelled_at,
        reversedEntries: ledgerRows.rows.length
      }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// @desc    Delete transfer (admin only)
// @route   DELETE /api/transfers/:id
const deleteTransfer = asyncHandler(async (req, res) => {
  const user = req.user;
  const transferId = req.params.id;

  const existing = await query(
    'SELECT id, reference, status, proof_file_path, amount_sent, amount_received, sender_country, beneficiary_country, currency_sent, currency_received FROM transfers WHERE id = $1',
    [transferId]
  );

  if (existing.rows.length === 0) {
    throw new ApiError(404, 'Transfert non trouvé');
  }

  const transfer = existing.rows[0];

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // 1. Récupérer toutes les écritures comptables liées
    const ledgerRows = await client.query(
      `SELECT le.id, le.type, le.amount, le.currency, a.name as account_name
       FROM ledger_entries le
       JOIN accounts a ON le.account_id = a.id
       WHERE le.transaction_id = $1`,
      [transferId]
    );

    // 2. Créer les contre-passations pour corriger les soldes
    for (const entry of ledgerRows.rows) {
      const reverseType = entry.type === 'CREDIT' ? 'DEBIT' : 'CREDIT';
      const accountResult = await client.query(
        'SELECT id FROM accounts WHERE name = $1', [entry.account_name]
      );
      await client.query(
        `INSERT INTO ledger_entries (account_id, transaction_id, type, amount, currency, description, created_by)
         VALUES ($1, NULL, $2, $3, $4, $5, $6)`,
        [
          accountResult.rows[0].id,
          reverseType,
          entry.amount,
          entry.currency,
          `SUPPRESSION ${transfer.reference} - Contre-passation ${entry.type} ${entry.amount} ${entry.currency}`,
          user.id
        ]
      );
    }

    // 3. Supprimer les écritures comptables originales (transaction_id sera NULL après DELETE du transfert de toute façon)
    await client.query(
      'DELETE FROM ledger_entries WHERE transaction_id = $1',
      [transferId]
    );

    // 4. Supprimer le transfert
    await client.query('DELETE FROM transfers WHERE id = $1', [transferId]);

    // 5. Journaliser dans audit_logs
    const ipAddress = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    await client.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_values, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        user.id, 'TRANSFER_DELETED', 'transfer', transferId,
        JSON.stringify({
          reference: transfer.reference,
          status: transfer.status,
          amountSent: parseFloat(transfer.amount_sent),
          amountReceived: parseFloat(transfer.amount_received),
          senderCountry: transfer.sender_country,
          beneficiaryCountry: transfer.beneficiary_country,
          reversedEntries: ledgerRows.rows.length
        }),
        ipAddress, userAgent
      ]
    );

    await client.query('COMMIT');

    // 6. Supprimer le fichier de preuve (hors transaction SQL car c'est du filesystem)
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
        console.error('Erreur suppression fichier preuve:', fileError);
      }
    }

    res.json({
      success: true,
      message: `Transfert ${transfer.reference} supprimé — ${ledgerRows.rows.length} écriture(s) comptable(s) corrigée(s)`
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

module.exports = {
  getAll,
  getPending,
  getById,
  getByReference,
  create,
  updateTransfer,
  markAsPaid,
  confirmWithProof,
  downloadBeneficiaryIdProof,
  downloadProof,
  cancel,
  deleteTransfer
};

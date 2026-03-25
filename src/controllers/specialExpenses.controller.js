/**
 * Controller: Dépenses Spéciales
 * Accès RBAC : admin + Zongo Razack (razack@globalexchange.com)
 *
 * - Dépenses simples → déduites de TFEES (frais USA→BF payés cumulés)
 * - Prêts           → entre admin et Zongo, avec caisses personnelles
 */

const path = require('path');
const fs = require('fs');
const { query, pool } = require('../config/database');
const { asyncHandler, ApiError } = require('../middleware/error.middleware');
const logger = require('../utils/logger');

// ─────────────────────────────────────────────
// HELPERS RBAC
// ─────────────────────────────────────────────

/** Identifie les deux utilisateurs autorisés */
const RAZACK_EMAIL = 'razack@globalexchange.com';

const isAuthorized = (user) =>
  user.role === 'admin' || user.email === RAZACK_EMAIL;

const assertAuthorized = (user) => {
  if (!isAuthorized(user)) {
    throw new ApiError(403, 'Accès refusé. Module réservé à l\'Admin et à Zongo Razack.');
  }
};

// ─────────────────────────────────────────────
// HELPER : calcul TFEES disponible
// TFEES = somme des frais des transferts USA→BF payés
//          - somme des dépenses spéciales déjà validées
// ─────────────────────────────────────────────
const computeAvailableTfees = async () => {
  const result = await query(`
    SELECT
      COALESCE(
        (SELECT SUM(fees) FROM transfers
         WHERE sender_country = 'USA'
           AND beneficiary_country = 'BFA'
           AND status = 'paid'), 0
      )
      -
      COALESCE(
        (SELECT SUM(amount) FROM special_expenses
         WHERE type = 'simple_expense'), 0
      ) AS available_tfees
  `);
  return parseFloat(result.rows[0].available_tfees) || 0;
};

// ─────────────────────────────────────────────
// HELPER : obtenir (ou créer) le wallet personnel
// ─────────────────────────────────────────────
const getOrCreateWallet = async (userId, client) => {
  const existing = await client.query(
    'SELECT * FROM personal_wallets WHERE user_id = $1 FOR UPDATE',
    [userId]
  );
  if (existing.rows.length > 0) return existing.rows[0];

  const created = await client.query(
    `INSERT INTO personal_wallets (user_id, balance, currency)
     VALUES ($1, 0, 'USD') RETURNING *`,
    [userId]
  );
  return created.rows[0];
};

// ─────────────────────────────────────────────
// DÉPENSES SIMPLES
// ─────────────────────────────────────────────

// GET /api/special-expenses/tfees-balance
const getTfeesBalance = asyncHandler(async (req, res) => {
  assertAuthorized(req.user);

  const available = await computeAvailableTfees();
  res.json({ success: true, data: { availableTfees: available } });
});

// GET /api/special-expenses
const listExpenses = asyncHandler(async (req, res) => {
  assertAuthorized(req.user);

  const { page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const [rows, countResult] = await Promise.all([
    query(
      `SELECT se.*, u.name AS created_by_name
       FROM special_expenses se
       JOIN users u ON se.created_by = u.id
       ORDER BY se.created_at DESC
       LIMIT $1 OFFSET $2`,
      [parseInt(limit), offset]
    ),
    query('SELECT COUNT(*) FROM special_expenses'),
  ]);

  res.json({
    success: true,
    data: {
      expenses: rows.rows.map(formatExpense),
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
    },
  });
});

// POST /api/special-expenses
const createExpense = asyncHandler(async (req, res) => {
  assertAuthorized(req.user);

  const { amount, description, expense_date } = req.body;

  if (!amount || !description || !expense_date) {
    if (req.file) cleanupFile(req.file.path);
    throw new ApiError(400, 'Champs obligatoires manquants : montant, description, date.');
  }

  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    if (req.file) cleanupFile(req.file.path);
    throw new ApiError(400, 'Le montant doit être un nombre positif.');
  }

  // Vérifier TFEES disponible
  const available = await computeAvailableTfees();
  if (parsedAmount > available) {
    if (req.file) cleanupFile(req.file.path);
    throw new ApiError(400, `Solde TFEES insuffisant. Disponible : ${available.toFixed(2)} USD.`);
  }

  const receiptImage = req.file ? req.file.filename : null;

  const result = await query(
    `INSERT INTO special_expenses (amount, description, expense_date, created_by, receipt_image)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [parsedAmount, description.trim(), expense_date, req.user.id, receiptImage]
  );

  logger.info('special_expense.created', {
    id: result.rows[0].id,
    amount: parsedAmount,
    by: req.user.email,
  });

  res.status(201).json({ success: true, data: formatExpense(result.rows[0]) });
});

// GET /api/special-expenses/:id/receipt
const downloadReceipt = asyncHandler(async (req, res) => {
  assertAuthorized(req.user);

  const { id } = req.params;
  const result = await query('SELECT receipt_image FROM special_expenses WHERE id = $1', [id]);

  if (!result.rows.length || !result.rows[0].receipt_image) {
    throw new ApiError(404, 'Aucune pièce justificative pour cette dépense.');
  }

  const { uploadDir } = require('../middleware/specialExpenses.upload');
  const filename = result.rows[0].receipt_image;
  const filePath = path.join(uploadDir, filename);

  if (!fs.existsSync(filePath)) {
    throw new ApiError(404, 'Fichier introuvable sur le serveur.');
  }

  const ext = path.extname(filename).toLowerCase();
  const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.pdf': 'application/pdf' };
  const contentType = mimeMap[ext] || 'application/octet-stream';
  const safeFilename = filename.replace(/[^\w.-]/g, '_');

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', fs.statSync(filePath).size);
  res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"`);
  res.setHeader('Accept-Ranges', 'bytes');
  fs.createReadStream(filePath, { flags: 'r' }).pipe(res);
});

// ─────────────────────────────────────────────
// PRÊTS
// ─────────────────────────────────────────────

// GET /api/special-expenses/wallets
const getWallets = asyncHandler(async (req, res) => {
  assertAuthorized(req.user);

  // Récupérer les deux utilisateurs autorisés
  const usersResult = await query(
    `SELECT id, name, email, role
     FROM users
     WHERE role = 'admin' OR email = $1
     ORDER BY role DESC`,
    [RAZACK_EMAIL]
  );

  const wallets = await Promise.all(
    usersResult.rows.map(async (u) => {
      const w = await query(
        'SELECT * FROM personal_wallets WHERE user_id = $1',
        [u.id]
      );
      return {
        userId: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        balance: w.rows.length ? parseFloat(w.rows[0].balance) : 0,
        currency: 'USD',
      };
    })
  );

  res.json({ success: true, data: wallets });
});

// GET /api/special-expenses/loans
const listLoans = asyncHandler(async (req, res) => {
  assertAuthorized(req.user);

  const { page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const [rows, countResult] = await Promise.all([
    query(
      `SELECT l.*,
              lender.name  AS lender_name,
              lender.email AS lender_email,
              borrower.name  AS borrower_name,
              borrower.email AS borrower_email,
              creator.name   AS created_by_name
       FROM loans l
       JOIN users lender   ON l.lender_id   = lender.id
       JOIN users borrower ON l.borrower_id = borrower.id
       JOIN users creator  ON l.created_by  = creator.id
       ORDER BY l.created_at DESC
       LIMIT $1 OFFSET $2`,
      [parseInt(limit), offset]
    ),
    query('SELECT COUNT(*) FROM loans'),
  ]);

  res.json({
    success: true,
    data: {
      loans: rows.rows.map(formatLoan),
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
    },
  });
});

// POST /api/special-expenses/loans
const createLoan = asyncHandler(async (req, res) => {
  assertAuthorized(req.user);

  const { amount, reason, loan_date } = req.body;

  if (!amount || !reason || !loan_date) {
    throw new ApiError(400, 'Champs obligatoires manquants : montant, motif, date.');
  }

  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    throw new ApiError(400, 'Le montant doit être un nombre positif.');
  }

  // Identifier les deux utilisateurs autorisés
  const usersResult = await query(
    `SELECT id, name, email, role FROM users WHERE role = 'admin' OR email = $1`,
    [RAZACK_EMAIL]
  );

  const adminUser = usersResult.rows.find((u) => u.role === 'admin');
  const razackUser = usersResult.rows.find((u) => u.email === RAZACK_EMAIL);

  if (!adminUser || !razackUser) {
    throw new ApiError(500, 'Utilisateurs autorisés introuvables dans la base.');
  }

  // L'utilisateur connecté est le borrower (receveur), l'autre est le lender (donneur)
  const currentIsAdmin = req.user.role === 'admin';
  const borrowerId = currentIsAdmin ? razackUser.id : adminUser.id;
  const lenderId = currentIsAdmin ? adminUser.id : razackUser.id;

  // Transaction atomique
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Obtenir / créer les wallets avec verrou FOR UPDATE
    const lenderWallet = await getOrCreateWallet(lenderId, client);
    const borrowerWallet = await getOrCreateWallet(borrowerId, client);

    // Débiter le prêteur (le solde peut devenir négatif)
    await client.query(
      'UPDATE personal_wallets SET balance = balance - $1, updated_at = NOW() WHERE user_id = $2',
      [parsedAmount, lenderId]
    );
    // Créditer l'emprunteur
    await client.query(
      'UPDATE personal_wallets SET balance = balance + $1, updated_at = NOW() WHERE user_id = $2',
      [parsedAmount, borrowerId]
    );

    // Enregistrer le prêt
    const loanResult = await client.query(
      `INSERT INTO loans (lender_id, borrower_id, amount, reason, loan_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [lenderId, borrowerId, parsedAmount, reason.trim(), loan_date, req.user.id]
    );

    await client.query('COMMIT');

    logger.info('loan.created', {
      id: loanResult.rows[0].id,
      lender: lenderId,
      borrower: borrowerId,
      amount: parsedAmount,
      by: req.user.email,
    });

    res.status(201).json({ success: true, data: formatLoan(loanResult.rows[0]) });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────
// FORMATTERS
// ─────────────────────────────────────────────

const formatExpense = (row) => ({
  id: row.id,
  type: row.type,
  amount: parseFloat(row.amount),
  description: row.description,
  expenseDate: row.expense_date,
  receiptImage: row.receipt_image || null,
  createdBy: row.created_by,
  createdByName: row.created_by_name || null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const formatLoan = (row) => ({
  id: row.id,
  lenderId: row.lender_id,
  lenderName: row.lender_name || null,
  lenderEmail: row.lender_email || null,
  borrowerId: row.borrower_id,
  borrowerName: row.borrower_name || null,
  borrowerEmail: row.borrower_email || null,
  amount: parseFloat(row.amount),
  reason: row.reason,
  loanDate: row.loan_date,
  createdBy: row.created_by,
  createdByName: row.created_by_name || null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const cleanupFile = (filePath) => {
  try { fs.unlinkSync(filePath); } catch {}
};

module.exports = {
  getTfeesBalance,
  listExpenses,
  createExpense,
  downloadReceipt,
  getWallets,
  listLoans,
  createLoan,
};

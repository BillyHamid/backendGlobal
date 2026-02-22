const path = require('path');
const fs = require('fs');
const { query } = require('../config/database');
const { asyncHandler, ApiError } = require('../middleware/error.middleware');
const { getAllAccounts, getAccountByName, accountExists } = require('../services/account.service');
const { getAllLedgerEntries, createLedgerEntry } = require('../services/ledger.service');
const { cashEntryUploadDir } = require('../middleware/upload.middleware');

/** Agent BF : ne peut voir/agir que sur la caisse BURKINA */
const isAgentBF = (user) => {
  if (!user || !user.country) return false;
  const c = user.country;
  return c === 'BFA' || c === 'Burkina Faso' || String(c).toLowerCase().includes('burkina');
};
const isAgentRole = (user) => user && (user.role === 'sender_agent' || user.role === 'payer_agent');
const restrictToBurkina = (user) => isAgentBF(user) && isAgentRole(user);

/**
 * Contrôleur pour le dashboard de gestion de caisse
 */

// @desc    Get cash dashboard statistics
// @route   GET /api/cash/dashboard
const getCashDashboard = asyncHandler(async (req, res) => {
  // S'assurer que les comptes existent, sinon les créer
  if (!(await accountExists('USA'))) {
    await query(
      `INSERT INTO accounts (name, currency, current_balance) 
       VALUES ('USA', 'USD', 0) 
       ON CONFLICT (name) DO NOTHING`
    );
  }
  
  if (!(await accountExists('BURKINA'))) {
    await query(
      `INSERT INTO accounts (name, currency, current_balance) 
       VALUES ('BURKINA', 'XOF', 0) 
       ON CONFLICT (name) DO NOTHING`
    );
  }
  
  // Obtenir les soldes des deux caisses
  const accounts = await getAllAccounts();
  const usaAccount = accounts.find(a => a.name === 'USA');
  const burkinaAccount = accounts.find(a => a.name === 'BURKINA');
  
  const usaBalance = usaAccount ? usaAccount.currentBalance : 0;
  const burkinaBalance = burkinaAccount ? burkinaAccount.currentBalance : 0;
  
  // Règles métier:
  // - Tmount = UNIQUEMENT USA → Burkina (sorties USD vers BF). Ne concerne PAS BFA → USA.
  // - Le solde USA est lié à Tmount (entrées USD des clients USA, moins paiements vers USA pour BF→USA).
  // - Cas 1 USA→BF: client donne USD → CREDIT USA, on paie au BF → DEBIT BURKINA.
  // - Cas 2 BF→USA: client donne XOF → CREDIT BURKINA, on paie aux USA → DEBIT USA.
  const totalsResult = await query(`
    SELECT 
      COALESCE(SUM(CASE WHEN sender_country = 'USA' AND beneficiary_country = 'BFA' AND status = 'paid' THEN amount_sent ELSE 0 END), 0) as tmount_usd,
      COALESCE(SUM(CASE WHEN sender_country = 'USA' AND beneficiary_country = 'BFA' AND status = 'paid' THEN fees ELSE 0 END), 0) as tfees_usd,
      COALESCE(SUM(CASE WHEN sender_country = 'USA' AND beneficiary_country = 'BFA' AND status = 'paid' THEN amount_received ELSE 0 END), 0) as tmount_xof,
      COALESCE(SUM(CASE WHEN sender_country = 'BFA' AND beneficiary_country = 'USA' AND status = 'paid' THEN fees ELSE 0 END), 0) as tfees_xof_bf_usa,
      COALESCE(SUM(CASE WHEN sender_country = 'BFA' AND beneficiary_country = 'USA' AND status = 'paid' THEN amount_sent ELSE 0 END), 0) as bfa_to_usa_amount_sent_xof,
      COALESCE(SUM(CASE WHEN sender_country = 'BFA' AND beneficiary_country = 'USA' AND status = 'paid' THEN amount_received ELSE 0 END), 0) as bfa_to_usa_amount_received_usd,
      COUNT(*) FILTER (WHERE sender_country = 'USA' AND beneficiary_country = 'BFA' AND status = 'paid') as total_paid_usa_to_bf,
      COUNT(*) FILTER (WHERE sender_country = 'BFA' AND beneficiary_country = 'USA' AND status = 'paid') as total_paid_bf_to_usa,
      COUNT(*) FILTER (WHERE status = 'paid') as total_paid_transfers
    FROM transfers
  `);
  
  const totals = totalsResult.rows[0];
  const tmountUSD = parseFloat(totals.tmount_usd);
  const tfeesUSD = parseFloat(totals.tfees_usd);
  const tmountXOF = parseFloat(totals.tmount_xof);
  const tfeesXOFBfUsa = parseFloat(totals.tfees_xof_bf_usa);
  const bfaToUsaAmountSentXOF = parseFloat(totals.bfa_to_usa_amount_sent_xof);
  const bfaToUsaAmountReceivedUSD = parseFloat(totals.bfa_to_usa_amount_received_usd);
  
  // Bénéfice total = frais USA→BF (Tmount) uniquement pour le partage partenaire
  const totalProfitUSD = tfeesUSD;
  const partnerShareUSD = totalProfitUSD / 2;
  
  // Obtenir l'historique récent des écritures (20 dernières)
  const recentEntries = await getAllLedgerEntries(20);
  
  res.json({
    success: true,
    data: {
      accounts: {
        usa: {
          name: 'USA',
          currency: 'USD',
          balance: usaBalance,
          formattedBalance: `$${usaBalance.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        },
        burkina: {
          name: 'BURKINA',
          currency: 'XOF',
          balance: burkinaBalance,
          formattedBalance: `${burkinaBalance.toLocaleString('fr-FR')} FCFA`
        }
      },
      totals: {
        tmountUSD: tmountUSD,
        tfeesUSD: tfeesUSD,
        tmountXOF: tmountXOF,
        tfeesXOF: tfeesXOFBfUsa,
        totalPaidTransfers: parseInt(totals.total_paid_transfers),
        totalPaidUsaToBf: parseInt(totals.total_paid_usa_to_bf),
        totalPaidBfToUsa: parseInt(totals.total_paid_bf_to_usa),
        bfaToUsaAmountSentXOF: bfaToUsaAmountSentXOF,
        bfaToUsaAmountReceivedUSD: bfaToUsaAmountReceivedUSD,
      },
      profit: {
        totalUSD: totalProfitUSD,
        formattedTotal: `$${totalProfitUSD.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        partnerShareUSD: partnerShareUSD,
        formattedPartnerShare: `$${partnerShareUSD.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      },
      recentEntries: recentEntries
    }
  });
});

// @desc    Get ledger history for a specific account
// @route   GET /api/cash/ledger/:accountName
const getLedgerHistory = asyncHandler(async (req, res) => {
  const { accountName } = req.params;
  const { limit = 50 } = req.query;
  
  if (accountName !== 'USA' && accountName !== 'BURKINA') {
    return res.status(400).json({
      success: false,
      message: 'Nom de compte invalide. Utilisez USA ou BURKINA'
    });
  }

  // Les agents BF ne peuvent consulter que le journal de la caisse BURKINA
  if (restrictToBurkina(req.user) && accountName === 'USA') {
    throw new ApiError(403, 'Vous ne pouvez consulter que la caisse Burkina Faso.');
  }
  
  const { getLedgerHistory } = require('../services/ledger.service');
  const entries = await getLedgerHistory(accountName, parseInt(limit));
  
  res.json({
    success: true,
    data: entries
  });
});

// @desc    Add manual cash entry (CREDIT) — preuve (photo/PDF) obligatoire
// @route   POST /api/cash/entry (multipart/form-data: accountName, amount, description, proof_file)
const addCashEntry = asyncHandler(async (req, res) => {
  const { accountName, amount, description } = req.body;
  const user = req.user;
  
  // Preuve obligatoire (vérifiée par validateCashEntryProofUpload, on double-check)
  if (!req.file || !req.file.filename) {
    throw new ApiError(400, 'La preuve (photo ou PDF) est obligatoire pour enregistrer une entrée d\'argent');
  }
  const proofFilePath = 'cash_entries/' + req.file.filename;
  
  // Validation
  if (!accountName || (accountName !== 'USA' && accountName !== 'BURKINA')) {
    throw new ApiError(400, 'Nom de compte invalide. Utilisez USA ou BURKINA');
  }
  
  const numAmount = parseFloat(amount);
  if (!amount || isNaN(numAmount) || numAmount <= 0) {
    throw new ApiError(400, 'Le montant doit être positif');
  }
  
  if (!description || String(description).trim().length === 0) {
    throw new ApiError(400, 'La description est requise');
  }

  // Les agents BF ne peuvent ajouter des entrées que sur la caisse BURKINA
  if (restrictToBurkina(user) && accountName !== 'BURKINA') {
    throw new ApiError(403, 'Vous ne pouvez effectuer des opérations que sur la caisse Burkina Faso.');
  }
  
  // Obtenir le compte pour vérifier la devise
  const account = await getAccountByName(accountName);
  const currency = account.currency;
  
  // Créer l'écriture CREDIT dans le ledger (avec preuve)
  const entry = await createLedgerEntry(
    accountName,
    'CREDIT',
    numAmount,
    currency,
    String(description).trim(),
    null,
    user.id,
    proofFilePath
  );
  
  // Obtenir le nouveau solde
  const updatedAccount = await getAccountByName(accountName);
  
  res.status(201).json({
    success: true,
    message: `Entrée de ${amount} ${currency} enregistrée avec succès`,
    data: {
      entry: {
        id: entry.id,
        accountName: entry.accountName,
        type: entry.type,
        amount: entry.amount,
        currency: entry.currency,
        description: entry.description,
        proofFilePath: entry.proofFilePath,
        createdAt: entry.createdAt
      },
      account: {
        name: updatedAccount.name,
        currency: updatedAccount.currency,
        balance: parseFloat(updatedAccount.current_balance),
        formattedBalance: currency === 'USD' 
          ? `$${parseFloat(updatedAccount.current_balance).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          : `${parseFloat(updatedAccount.current_balance).toLocaleString('fr-FR')} FCFA`
      }
    }
  });
});

// @desc    Add manual cash expense (DEBIT)
// @route   POST /api/cash/expense
const addCashExpense = asyncHandler(async (req, res) => {
  const { accountName, amount, description } = req.body;
  const user = req.user;
  
  // Validation
  if (!accountName || (accountName !== 'USA' && accountName !== 'BURKINA')) {
    throw new ApiError(400, 'Nom de compte invalide. Utilisez USA ou BURKINA');
  }
  
  if (!amount || amount <= 0) {
    throw new ApiError(400, 'Le montant doit être positif');
  }
  
  if (!description || description.trim().length === 0) {
    throw new ApiError(400, 'La description est requise');
  }

  // Les agents BF ne peuvent enregistrer des dépenses que sur la caisse BURKINA
  if (restrictToBurkina(user) && accountName !== 'BURKINA') {
    throw new ApiError(403, 'Vous ne pouvez effectuer des opérations que sur la caisse Burkina Faso.');
  }
  
  // Obtenir le compte pour vérifier la devise et le solde
  const account = await getAccountByName(accountName);
  const currency = account.currency;
  const currentBalance = parseFloat(account.current_balance);
  
  // Vérifier que le solde est suffisant (optionnel - on peut autoriser les découverts)
  // Pour l'instant, on autorise les découverts mais on peut ajouter une vérification si nécessaire
  
  // Créer l'écriture DEBIT dans le ledger
  const entry = await createLedgerEntry(
    accountName,
    'DEBIT',
    parseFloat(amount),
    currency,
    description.trim(),
    null, // Pas de transaction_id pour les dépenses manuelles
    user.id
  );
  
  // Obtenir le nouveau solde
  const updatedAccount = await getAccountByName(accountName);
  
  res.status(201).json({
    success: true,
    message: `Dépense de ${amount} ${currency} enregistrée avec succès`,
    data: {
      entry: {
        id: entry.id,
        accountName: entry.accountName,
        type: entry.type,
        amount: entry.amount,
        currency: entry.currency,
        description: entry.description,
        createdAt: entry.createdAt
      },
      account: {
        name: updatedAccount.name,
        currency: updatedAccount.currency,
        balance: parseFloat(updatedAccount.current_balance),
        formattedBalance: currency === 'USD' 
          ? `$${parseFloat(updatedAccount.current_balance).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          : `${parseFloat(updatedAccount.current_balance).toLocaleString('fr-FR')} FCFA`
      }
    }
  });
});

// @desc    Télécharger / afficher la preuve d'une entrée de caisse
// @route   GET /api/cash/entry/:id/proof
const downloadEntryProof = asyncHandler(async (req, res) => {
  const entryId = req.params.id;
  const user = req.user;

  const result = await query(
    `SELECT le.id, le.proof_file_path, a.name as account_name
     FROM ledger_entries le
     JOIN accounts a ON le.account_id = a.id
     WHERE le.id = $1`,
    [entryId]
  );

  if (result.rows.length === 0) {
    throw new ApiError(404, 'Écriture non trouvée');
  }

  const row = result.rows[0];
  const proofPath = row.proof_file_path;
  const accountName = row.account_name;

  if (!proofPath) {
    throw new ApiError(404, 'Aucune preuve disponible pour cette entrée');
  }

  if (restrictToBurkina(user) && accountName !== 'BURKINA') {
    throw new ApiError(403, 'Vous ne pouvez accéder qu\'aux preuves de la caisse Burkina.');
  }

  const filename = path.basename(proofPath);
  const filePath = path.join(cashEntryUploadDir, filename);

  if (!fs.existsSync(filePath)) {
    throw new ApiError(404, 'Fichier de preuve non trouvé');
  }

  const resolvedPath = path.resolve(filePath);
  const resolvedDir = path.resolve(cashEntryUploadDir);
  if (!resolvedPath.startsWith(resolvedDir)) {
    throw new ApiError(403, 'Accès non autorisé');
  }

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
});

module.exports = {
  getCashDashboard,
  getLedgerHistory,
  addCashEntry,
  addCashExpense,
  downloadEntryProof
};

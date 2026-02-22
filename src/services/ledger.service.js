const { query } = require('../config/database');
const { getAccountByName } = require('./account.service');

/**
 * Service de gestion du journal comptable (Ledger)
 * Toutes les opérations financières passent par ici
 */

/**
 * Créer une écriture comptable
 * @param {string} accountName - 'USA' ou 'BURKINA'
 * @param {string} type - 'DEBIT' ou 'CREDIT'
 * @param {number} amount - Montant
 * @param {string} currency - 'USD' ou 'XOF'
 * @param {string} description - Description de l'opération
 * @param {string} transactionId - ID du transfert (optionnel)
 * @param {string} userId - ID de l'utilisateur (optionnel)
 * @param {string} proofFilePath - Chemin relatif du fichier preuve (optionnel, requis pour entrées manuelles CREDIT)
 * @returns {Promise<Object>} L'écriture créée
 */
const createLedgerEntry = async (accountName, type, amount, currency, description, transactionId = null, userId = null, proofFilePath = null) => {
  // Vérifier que le compte existe
  const account = await getAccountByName(accountName);
  
  // Vérifier que le montant est positif
  if (amount <= 0) {
    throw new Error('Le montant doit être positif');
  }
  
  // Vérifier que le type est valide
  if (type !== 'DEBIT' && type !== 'CREDIT') {
    throw new Error('Type invalide: doit être DEBIT ou CREDIT');
  }
  
  // Vérifier que la devise correspond au compte
  const expectedCurrency = account.currency;
  if (currency !== expectedCurrency) {
    throw new Error(`Devise invalide: le compte ${accountName} utilise ${expectedCurrency}, pas ${currency}`);
  }
  
  // Créer l'écriture (le trigger mettra à jour le solde automatiquement)
  const result = await query(
    `INSERT INTO ledger_entries 
     (account_id, transaction_id, type, amount, currency, description, created_by, proof_file_path)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [account.id, transactionId, type, amount, currency, description, userId, proofFilePath]
  );
  
  const row = result.rows[0];
  return {
    id: row.id,
    accountId: row.account_id,
    accountName: accountName,
    transactionId: row.transaction_id,
    type: row.type,
    amount: parseFloat(row.amount),
    currency: row.currency,
    description: row.description,
    proofFilePath: row.proof_file_path || undefined,
    createdAt: row.created_at
  };
};

/**
 * Obtenir l'historique des écritures d'un compte
 * @param {string} accountName - 'USA' ou 'BURKINA'
 * @param {number} limit - Nombre d'écritures à retourner
 * @returns {Promise<Array>} Liste des écritures
 */
const getLedgerHistory = async (accountName, limit = 50) => {
  const account = await getAccountByName(accountName);
  
  const result = await query(
    `SELECT le.*, u.name as created_by_name, t.reference as transfer_reference
     FROM ledger_entries le
     LEFT JOIN users u ON le.created_by = u.id
     LEFT JOIN transfers t ON le.transaction_id = t.id
     WHERE le.account_id = $1
     ORDER BY le.created_at DESC
     LIMIT $2`,
    [account.id, limit]
  );
  
  return result.rows.map(row => ({
    id: row.id,
    accountName: accountName,
    transactionId: row.transaction_id,
    transferReference: row.transfer_reference,
    type: row.type,
    amount: parseFloat(row.amount),
    currency: row.currency,
    description: row.description,
    proofFilePath: row.proof_file_path || undefined,
    createdBy: row.created_by_name,
    createdAt: row.created_at
  }));
};

/**
 * Obtenir toutes les écritures récentes (tous comptes)
 * @param {number} limit - Nombre d'écritures à retourner
 * @returns {Promise<Array>} Liste des écritures
 */
const getAllLedgerEntries = async (limit = 100) => {
  const result = await query(
    `SELECT le.*, a.name as account_name, u.name as created_by_name, t.reference as transfer_reference
     FROM ledger_entries le
     JOIN accounts a ON le.account_id = a.id
     LEFT JOIN users u ON le.created_by = u.id
     LEFT JOIN transfers t ON le.transaction_id = t.id
     ORDER BY le.created_at DESC
     LIMIT $1`,
    [limit]
  );
  
  return result.rows.map(row => ({
    id: row.id,
    accountName: row.account_name,
    transactionId: row.transaction_id,
    transferReference: row.transfer_reference,
    type: row.type,
    amount: parseFloat(row.amount),
    currency: row.currency,
    description: row.description,
    proofFilePath: row.proof_file_path || undefined,
    createdBy: row.created_by_name,
    createdAt: row.created_at
  }));
};

module.exports = {
  createLedgerEntry,
  getLedgerHistory,
  getAllLedgerEntries
};

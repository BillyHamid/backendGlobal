const { query } = require('../config/database');

/**
 * Service de journalisation d'audit
 * Enregistre toutes les actions importantes pour traçabilité légale
 */

/**
 * Enregistrer une action d'audit
 */
const logAction = async (userId, action, entityType, entityId, oldValues = null, newValues = null, ipAddress = null, userAgent = null) => {
  try {
    await query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId, action, entityType, entityId, oldValues ? JSON.stringify(oldValues) : null, newValues ? JSON.stringify(newValues) : null, ipAddress, userAgent]
    );
  } catch (error) {
    console.error('Erreur lors de l\'enregistrement de l\'audit:', error);
    // Ne pas faire échouer l'opération principale si l'audit échoue
  }
};

/**
 * Enregistrer une confirmation de transaction avec preuve
 */
const logConfirmation = async (transferId, userId, proofFilePath, comment, ipAddress, userAgent) => {
  await logAction(
    userId,
    'CONFIRMATION_WITH_PROOF',
    'transfer',
    transferId,
    null,
    {
      proof_file_path: proofFilePath,
      comment: comment,
      confirmed_at: new Date().toISOString()
    },
    ipAddress,
    userAgent
  );
};

/**
 * Enregistrer le téléchargement d'une preuve
 */
const logProofDownload = async (transferId, userId, ipAddress, userAgent) => {
  await logAction(
    userId,
    'PROOF_DOWNLOAD',
    'transfer',
    transferId,
    null,
    { downloaded_at: new Date().toISOString() },
    ipAddress,
    userAgent
  );
};

module.exports = {
  logAction,
  logConfirmation,
  logProofDownload
};

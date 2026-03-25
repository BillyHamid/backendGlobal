/**
 * Rapports financiers avec justificatifs.
 * Création / soumission : Bernadette (bernadette@globalexchange.com)
 * Validation : administrateur (SANA Djibrill)
 */

const path = require('path');
const fs = require('fs');
const { query, pool } = require('../config/database');
const { asyncHandler, ApiError } = require('../middleware/error.middleware');
const logger = require('../utils/logger');
const { uploadDir } = require('../middleware/financialReports.upload');

const BERNADETTE_EMAIL = 'bernadette@globalexchange.com';

const assertBernadette = (user) => {
  if (user.email !== BERNADETTE_EMAIL) {
    throw new ApiError(403, 'Seule Bernadette peut créer et modifier ses rapports financiers.');
  }
};

const assertAdminValidator = (user) => {
  if (user.role !== 'admin') {
    throw new ApiError(403, 'Seul l\'administrateur peut consulter la file de validation et approuver / rejeter.');
  }
};

const canViewReport = (user, reportRow) =>
  user.role === 'admin' || reportRow.created_by === user.id;

function formatItem(row) {
  return {
    id: row.id,
    reportId: row.report_id,
    label: row.label,
    amount: Math.round(parseFloat(row.amount)),
    proofFile: row.proof_file,
    createdAt: row.created_at,
  };
}

/** Montants rapports financiers en XOF (entiers F CFA). */
function formatReport(row, itemRows = []) {
  const items = itemRows.map(formatItem);
  const totalJustified = items.reduce((s, i) => s + i.amount, 0);
  const totalAmount = Math.round(parseFloat(row.total_amount));
  const currency = row.currency || 'XOF';
  return {
    id: row.id,
    createdBy: row.created_by,
    creatorName: row.creator_name || null,
    totalAmount,
    currency,
    comment: row.comment,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    submittedAt: row.submitted_at,
    validatedBy: row.validated_by,
    validatorName: row.validator_name || null,
    validatedAt: row.validated_at,
    rejectionReason: row.rejection_reason,
    totalJustified,
    remainingAmount: Math.max(0, totalAmount - totalJustified),
    items,
  };
}

async function loadReport(id) {
  const r = await query(
    `SELECT fr.*, c.name AS creator_name, v.name AS validator_name
     FROM financial_reports fr
     JOIN users c ON fr.created_by = c.id
     LEFT JOIN users v ON fr.validated_by = v.id
     WHERE fr.id = $1`,
    [id]
  );
  if (!r.rows.length) return null;
  const items = await query(
    `SELECT * FROM financial_report_items WHERE report_id = $1 ORDER BY created_at ASC`,
    [id]
  );
  return formatReport(r.rows[0], items.rows);
}

// POST /api/financial-reports
const create = asyncHandler(async (req, res) => {
  assertBernadette(req.user);
  const { total_amount: totalAmount, comment } = req.body;
  const amt = parseFloat(totalAmount);
  if (Number.isNaN(amt) || amt <= 0) {
    throw new ApiError(400, 'Montant global invalide (nombre > 0 requis).');
  }

  const result = await query(
    `INSERT INTO financial_reports (created_by, total_amount, comment, status, currency)
     VALUES ($1, $2, $3, 'DRAFT', 'XOF') RETURNING *`,
    [req.user.id, amt, comment?.trim() || null]
  );
  const row = result.rows[0];
  const full = await loadReport(row.id);
  logger.info('financial_report.created', { id: row.id, by: req.user.email });
  res.status(201).json({ success: true, data: full });
});

// GET /api/financial-reports/mine
const listMine = asyncHandler(async (req, res) => {
  assertBernadette(req.user);
  const rows = await query(
    `SELECT fr.*, c.name AS creator_name, v.name AS validator_name
     FROM financial_reports fr
     JOIN users c ON fr.created_by = c.id
     LEFT JOIN users v ON fr.validated_by = v.id
     WHERE fr.created_by = $1
     ORDER BY fr.created_at DESC`,
    [req.user.id]
  );

  const data = await Promise.all(
    rows.rows.map(async (row) => {
      const items = await query(
        `SELECT * FROM financial_report_items WHERE report_id = $1 ORDER BY created_at ASC`,
        [row.id]
      );
      return formatReport(row, items.rows);
    })
  );

  res.json({ success: true, data: data });
});

// GET /api/financial-reports/pending-review
const listPendingReview = asyncHandler(async (req, res) => {
  assertAdminValidator(req.user);
  const rows = await query(
    `SELECT fr.*, c.name AS creator_name, v.name AS validator_name
     FROM financial_reports fr
     JOIN users c ON fr.created_by = c.id
     LEFT JOIN users v ON fr.validated_by = v.id
     WHERE fr.status = 'PENDING'
     ORDER BY fr.submitted_at ASC NULLS LAST, fr.created_at ASC`
  );

  const data = await Promise.all(
    rows.rows.map(async (row) => {
      const items = await query(
        `SELECT * FROM financial_report_items WHERE report_id = $1 ORDER BY created_at ASC`,
        [row.id]
      );
      return formatReport(row, items.rows);
    })
  );

  res.json({ success: true, data });
});

// GET /api/financial-reports/all  (admin, historique)
const listAll = asyncHandler(async (req, res) => {
  assertAdminValidator(req.user);
  const { status } = req.query;
  let sql = `SELECT fr.*, c.name AS creator_name, v.name AS validator_name
     FROM financial_reports fr
     JOIN users c ON fr.created_by = c.id
     LEFT JOIN users v ON fr.validated_by = v.id`;
  const params = [];
  if (status && ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED'].includes(status)) {
    sql += ' WHERE fr.status = $1';
    params.push(status);
  }
  sql += ' ORDER BY fr.created_at DESC LIMIT 200';

  const rows = await query(sql, params);
  const data = await Promise.all(
    rows.rows.map(async (row) => {
      const items = await query(
        `SELECT * FROM financial_report_items WHERE report_id = $1 ORDER BY created_at ASC`,
        [row.id]
      );
      return formatReport(row, items.rows);
    })
  );
  res.json({ success: true, data });
});

// GET /api/financial-reports/:id
const getById = asyncHandler(async (req, res) => {
  const full = await loadReport(req.params.id);
  if (!full) throw new ApiError(404, 'Rapport introuvable.');
  const raw = await query('SELECT created_by FROM financial_reports WHERE id = $1', [req.params.id]);
  if (!canViewReport(req.user, raw.rows[0])) {
    throw new ApiError(403, 'Accès refusé à ce rapport.');
  }
  res.json({ success: true, data: full });
});

// PATCH /api/financial-reports/:id
const update = asyncHandler(async (req, res) => {
  assertBernadette(req.user);
  const { id } = req.params;
  const { total_amount: totalAmount, comment } = req.body;

  const existing = await query('SELECT * FROM financial_reports WHERE id = $1', [id]);
  if (!existing.rows.length) throw new ApiError(404, 'Rapport introuvable.');
  const rep = existing.rows[0];
  if (rep.created_by !== req.user.id) throw new ApiError(403, 'Ce rapport ne vous appartient pas.');
  if (rep.status !== 'DRAFT') throw new ApiError(400, 'Seuls les brouillons peuvent être modifiés.');

  const amt = totalAmount !== undefined ? parseFloat(totalAmount) : parseFloat(rep.total_amount);
  if (Number.isNaN(amt) || amt <= 0) throw new ApiError(400, 'Montant global invalide.');

  const sumR = await query(
    `SELECT COALESCE(SUM(amount), 0)::float AS s FROM financial_report_items WHERE report_id = $1`,
    [id]
  );
  const sumItems = parseFloat(sumR.rows[0].s) || 0;
  if (sumItems > amt + 0.005) {
    throw new ApiError(
      400,
      `La somme des lignes (${sumItems.toFixed(2)}) dépasse le nouveau montant global. Ajustez ou supprimez des lignes.`
    );
  }

  await query(
    `UPDATE financial_reports SET total_amount = $1, comment = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
    [amt, comment !== undefined ? comment?.trim() || null : rep.comment, id]
  );
  const full = await loadReport(id);
  res.json({ success: true, data: full });
});

// POST /api/financial-reports/:id/items (multipart)
const addItem = asyncHandler(async (req, res) => {
  assertBernadette(req.user);
  const { id } = req.params;
  const { label, amount } = req.body;

  const existing = await query('SELECT * FROM financial_reports WHERE id = $1', [id]);
  if (!existing.rows.length) throw new ApiError(404, 'Rapport introuvable.');
  const rep = existing.rows[0];
  if (rep.created_by !== req.user.id) throw new ApiError(403, 'Ce rapport ne vous appartient pas.');
  if (rep.status !== 'DRAFT') throw new ApiError(400, 'Impossible d\'ajouter des lignes hors brouillon.');

  if (!label || !String(label).trim()) throw new ApiError(400, 'Libellé requis.');
  const itemAmt = parseFloat(amount);
  if (Number.isNaN(itemAmt) || itemAmt <= 0) throw new ApiError(400, 'Montant de ligne invalide.');

  const sumR = await query(
    `SELECT COALESCE(SUM(amount), 0)::float AS s FROM financial_report_items WHERE report_id = $1`,
    [id]
  );
  const currentSum = parseFloat(sumR.rows[0].s) || 0;
  const total = parseFloat(rep.total_amount);
  if (currentSum + itemAmt > total + 0.005) {
    throw new ApiError(
      400,
      `Cette ligne dépasse le montant global restant à justifier (reste ${(total - currentSum).toFixed(2)}).`
    );
  }

  const proofFilename = req.file ? req.file.filename : null;
  const ins = await query(
    `INSERT INTO financial_report_items (report_id, label, amount, proof_file)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [id, String(label).trim(), itemAmt, proofFilename]
  );

  logger.info('financial_report.item_added', { reportId: id, itemId: ins.rows[0].id });
  const full = await loadReport(id);
  res.status(201).json({ success: true, data: { item: formatItem(ins.rows[0]), report: full } });
});

// DELETE /api/financial-reports/:id/items/:itemId
const deleteItem = asyncHandler(async (req, res) => {
  assertBernadette(req.user);
  const { id, itemId } = req.params;

  const existing = await query('SELECT * FROM financial_reports WHERE id = $1', [id]);
  if (!existing.rows.length) throw new ApiError(404, 'Rapport introuvable.');
  const rep = existing.rows[0];
  if (rep.created_by !== req.user.id) throw new ApiError(403, 'Accès refusé.');
  if (rep.status !== 'DRAFT') throw new ApiError(400, 'Impossible de supprimer une ligne hors brouillon.');

  const item = await query(
    'SELECT proof_file FROM financial_report_items WHERE id = $1 AND report_id = $2',
    [itemId, id]
  );
  if (!item.rows.length) throw new ApiError(404, 'Ligne introuvable.');

  const filename = item.rows[0].proof_file;
  await query('DELETE FROM financial_report_items WHERE id = $1', [itemId]);
  if (filename) {
    const fp = path.join(uploadDir, filename);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }

  const full = await loadReport(id);
  res.json({ success: true, data: full });
});

// DELETE /api/financial-reports/:id (brouillon uniquement)
const removeDraft = asyncHandler(async (req, res) => {
  assertBernadette(req.user);
  const { id } = req.params;
  const existing = await query(
    `SELECT id FROM financial_reports WHERE id = $1 AND created_by = $2 AND status = 'DRAFT'`,
    [id, req.user.id]
  );
  if (!existing.rows.length) throw new ApiError(404, 'Brouillon introuvable ou non supprimable.');

  const items = await query('SELECT proof_file FROM financial_report_items WHERE report_id = $1', [id]);
  for (const row of items.rows) {
    if (row.proof_file) {
      const fp = path.join(uploadDir, row.proof_file);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
  }
  await query('DELETE FROM financial_reports WHERE id = $1', [id]);
  res.json({ success: true, message: 'Rapport supprimé.' });
});

// POST /api/financial-reports/:id/submit
const submit = asyncHandler(async (req, res) => {
  assertBernadette(req.user);
  const { id } = req.params;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query('SELECT * FROM financial_reports WHERE id = $1 FOR UPDATE', [id]);
    if (!r.rows.length) throw new ApiError(404, 'Rapport introuvable.');
    const rep = r.rows[0];
    if (rep.created_by !== req.user.id) throw new ApiError(403, 'Accès refusé.');
    if (rep.status !== 'DRAFT') throw new ApiError(400, 'Ce rapport a déjà été soumis ou traité.');

    const items = await client.query(
      'SELECT COALESCE(SUM(amount), 0)::float AS s, COUNT(*)::int AS c FROM financial_report_items WHERE report_id = $1',
      [id]
    );
    const sumItems = parseFloat(items.rows[0].s) || 0;
    const cnt = parseInt(items.rows[0].c, 10);
    const total = parseFloat(rep.total_amount);

    if (cnt === 0) throw new ApiError(400, 'Ajoutez au moins une ligne de dépense avec justificatif avant de soumettre.');
    if (sumItems > total + 0.005) {
      throw new ApiError(400, 'La somme des lignes dépasse le montant global. Corrigez avant soumission.');
    }

    await client.query(
      `UPDATE financial_reports
       SET status = 'PENDING', submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [id]
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  logger.info('financial_report.submitted', { id, by: req.user.email });
  const full = await loadReport(id);
  res.json({ success: true, data: full });
});

// POST /api/financial-reports/:id/approve
const approve = asyncHandler(async (req, res) => {
  assertAdminValidator(req.user);
  const { id } = req.params;
  const result = await query(
    `UPDATE financial_reports
     SET status = 'APPROVED',
         validated_by = $1,
         validated_at = CURRENT_TIMESTAMP,
         rejection_reason = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $2 AND status = 'PENDING'
     RETURNING id`,
    [req.user.id, id]
  );
  if (!result.rows.length) throw new ApiError(400, 'Rapport introuvable ou déjà traité.');
  logger.info('financial_report.approved', { id, by: req.user.email });
  const full = await loadReport(id);
  res.json({ success: true, data: full });
});

// POST /api/financial-reports/:id/reject
const reject = asyncHandler(async (req, res) => {
  assertAdminValidator(req.user);
  const { id } = req.params;
  const { reason } = req.body;
  const result = await query(
    `UPDATE financial_reports
     SET status = 'REJECTED',
         validated_by = $1,
         validated_at = CURRENT_TIMESTAMP,
         rejection_reason = $3,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $2 AND status = 'PENDING'
     RETURNING id`,
    [req.user.id, id, reason?.trim() || 'Sans motif']
  );
  if (!result.rows.length) throw new ApiError(400, 'Rapport introuvable ou déjà traité.');
  logger.info('financial_report.rejected', { id, by: req.user.email });
  const full = await loadReport(id);
  res.json({ success: true, data: full });
});

// GET /api/financial-reports/:id/items/:itemId/proof
const downloadProof = asyncHandler(async (req, res) => {
  const { id, itemId } = req.params;
  const raw = await query('SELECT created_by FROM financial_reports WHERE id = $1', [id]);
  if (!raw.rows.length) throw new ApiError(404, 'Rapport introuvable.');
  if (!canViewReport(req.user, raw.rows[0])) throw new ApiError(403, 'Accès refusé.');

  const item = await query(
    'SELECT proof_file FROM financial_report_items WHERE id = $1 AND report_id = $2',
    [itemId, id]
  );
  if (!item.rows.length || !item.rows[0].proof_file) {
    throw new ApiError(404, 'Aucun justificatif pour cette ligne.');
  }
  const filename = item.rows[0].proof_file;
  const filePath = path.join(uploadDir, filename);
  if (!fs.existsSync(filePath)) throw new ApiError(404, 'Fichier introuvable sur le serveur.');

  const ext = path.extname(filename).toLowerCase();
  const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.pdf': 'application/pdf' };
  const contentType = mimeMap[ext] || 'application/octet-stream';

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', fs.statSync(filePath).size);
  res.setHeader('Content-Disposition', `inline; filename="${filename.replace(/[^\w.-]/g, '_')}"`);
  fs.createReadStream(filePath).pipe(res);
});

module.exports = {
  create,
  listMine,
  listPendingReview,
  listAll,
  getById,
  update,
  addItem,
  deleteItem,
  removeDraft,
  submit,
  approve,
  reject,
  downloadProof,
};

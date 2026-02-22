const express = require('express');
const { body, param, query } = require('express-validator');
const transferController = require('../controllers/transfer.controller');
const { validate } = require('../middleware/validate.middleware');
const { authenticate, hasPermission } = require('../middleware/auth.middleware');
const { uploadProof, validateProofUpload } = require('../middleware/upload.middleware');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// GET /api/transfers - List transfers
router.get('/', hasPermission('transfers.view'), [
  query('status').optional().isIn(['pending', 'in_progress', 'paid', 'cancelled']),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  validate
], transferController.getAll);

// GET /api/transfers/pending - Get pending transfers (for payer agents)
router.get('/pending', hasPermission('transfers.view'), transferController.getPending);

// GET /api/transfers/:id - Get transfer by ID
router.get('/:id', hasPermission('transfers.view'), [
  param('id').isUUID().withMessage('ID invalide'),
  validate
], transferController.getById);

// GET /api/transfers/reference/:ref - Get transfer by reference
router.get('/reference/:ref', hasPermission('transfers.view'), transferController.getByReference);

// POST /api/transfers - Create new transfer
router.post('/', hasPermission('transfers.create'), [
  // Sender validation
  body('sender.firstName').notEmpty().withMessage('Prénom expéditeur requis'),
  body('sender.lastName').notEmpty().withMessage('Nom expéditeur requis'),
  body('sender.phone').notEmpty().withMessage('Téléphone expéditeur requis'),
  body('sender.country').notEmpty().withMessage('Pays expéditeur requis'),
  body('sendMethod').isIn(['cash', 'zelle', 'orange_money', 'wave', 'bank_transfer']).withMessage('Méthode de paiement invalide'),
  
  // Beneficiary validation
  body('beneficiary.firstName').notEmpty().withMessage('Prénom bénéficiaire requis'),
  body('beneficiary.lastName').notEmpty().withMessage('Nom bénéficiaire requis'),
  body('beneficiary.phone').notEmpty().withMessage('Téléphone bénéficiaire requis'),
  body('beneficiary.country').notEmpty().withMessage('Pays bénéficiaire requis'),
  body('beneficiary.city').notEmpty().withMessage('Ville bénéficiaire requise'),
  
  // Financial validation
  body('amountSent').isFloat({ min: 1 }).withMessage('Montant invalide'),
  body('currency').isIn(['USD', 'XOF']).withMessage('Seules les devises USD et XOF sont supportées'),
  body('exchangeRate').isFloat({ min: 1 }).withMessage('Taux de change invalide'),
  body('fees').optional().isFloat({ min: 0 }).withMessage('Frais invalides'),
  
  validate
], transferController.create);

// PATCH /api/transfers/:id/pay - Mark transfer as paid (legacy - sans preuve)
router.patch('/:id/pay', hasPermission('transfers.pay'), [
  param('id').isUUID().withMessage('ID invalide'),
  validate
], transferController.markAsPaid);

// POST /api/transfers/:id/confirm - Confirm transfer with proof (OBLIGATOIRE)
router.post('/:id/confirm', hasPermission('transfers.pay'), [
  param('id').isUUID().withMessage('ID invalide'),
  validate
], (req, res, next) => {
  // Middleware pour gérer les erreurs multer
  uploadProof(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        success: false,
        message: err.message || 'Erreur lors de l\'upload du fichier'
      });
    }
    next();
  });
}, validateProofUpload, transferController.confirmWithProof);

// GET /api/transfers/:id/proof - Download proof file (secure access)
router.get('/:id/proof', hasPermission('transfers.view'), [
  param('id').isUUID().withMessage('ID invalide'),
  validate
], transferController.downloadProof);

// PATCH /api/transfers/:id/cancel - Cancel transfer
router.patch('/:id/cancel', hasPermission('transfers.cancel'), [
  param('id').isUUID().withMessage('ID invalide'),
  body('reason').optional().isString(),
  validate
], transferController.cancel);

// DELETE /api/transfers/:id - Delete transfer (admin only)
router.delete('/:id', [
  param('id').isUUID().withMessage('ID invalide'),
  validate
], (req, res, next) => {
  // Vérifier que l'utilisateur est admin
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Seuls les administrateurs peuvent supprimer des transferts'
    });
  }
  next();
}, transferController.deleteTransfer);

module.exports = router;

const express = require('express');
const { body } = require('express-validator');
const cashController = require('../controllers/cash.controller');
const { authenticate, hasPermission } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validate.middleware');
const { uploadCashEntryProofFile, validateCashEntryProofUpload } = require('../middleware/upload.middleware');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// GET /api/cash/dashboard - Get cash dashboard statistics
router.get('/dashboard', hasPermission('transfers.view'), cashController.getCashDashboard);

// GET /api/cash/ledger/:accountName - Get ledger history for an account
router.get('/ledger/:accountName', hasPermission('transfers.view'), cashController.getLedgerHistory);

// GET /api/cash/entry/:id/proof - Download / view proof file for a cash entry
router.get('/entry/:id/proof', hasPermission('transfers.view'), cashController.downloadEntryProof);

// POST /api/cash/entry - Add manual cash entry (CREDIT), preuve obligatoire (multipart)
router.post('/entry', hasPermission('transfers.view'), uploadCashEntryProofFile, validateCashEntryProofUpload, cashController.addCashEntry);

// POST /api/cash/expense - Add manual cash expense (DEBIT)
router.post('/expense', hasPermission('transfers.view'), [
  body('accountName').isIn(['USA', 'BURKINA']).withMessage('Nom de compte invalide'),
  body('amount').isFloat({ min: 0.01 }).withMessage('Le montant doit être positif'),
  body('description').notEmpty().trim().withMessage('La description est requise'),
  validate
], cashController.addCashExpense);

module.exports = router;

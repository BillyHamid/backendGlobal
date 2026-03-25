const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { uploadReceiptFile } = require('../middleware/specialExpenses.upload');
const {
  getTfeesBalance,
  listExpenses,
  createExpense,
  downloadReceipt,
  getWallets,
  listLoans,
  createLoan,
} = require('../controllers/specialExpenses.controller');

// Toutes les routes nécessitent une authentification JWT
router.use(authenticate);

// ── Dépenses simples ─────────────────────────
router.get('/tfees-balance', getTfeesBalance);
router.get('/', listExpenses);
router.post('/', uploadReceiptFile, createExpense);
router.get('/:id/receipt', downloadReceipt);

// ── Prêts ────────────────────────────────────
router.get('/wallets', getWallets);
router.get('/loans', listLoans);
router.post('/loans', createLoan);

module.exports = router;

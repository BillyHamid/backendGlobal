const express = require('express');
const { body, param, query } = require('express-validator');
const senderController = require('../controllers/sender.controller');
const { validate } = require('../middleware/validate.middleware');
const { authenticate, hasPermission } = require('../middleware/auth.middleware');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// GET /api/senders - List senders
router.get('/', hasPermission('senders.view'), [
  query('search').optional().isString(),
  query('country').optional().isString(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  validate
], senderController.getAll);

// GET /api/senders/:id - Get sender by ID
router.get('/:id', hasPermission('senders.view'), [
  param('id').isUUID().withMessage('ID invalide'),
  validate
], senderController.getById);

// POST /api/senders - Create sender
router.post('/', hasPermission('senders.create'), [
  body('firstName').notEmpty().withMessage('Prénom requis'),
  body('lastName').notEmpty().withMessage('Nom requis'),
  body('phone').notEmpty().withMessage('Téléphone requis'),
  body('country').notEmpty().withMessage('Pays requis'),
  validate
], senderController.create);

// PUT /api/senders/:id - Update sender
router.put('/:id', hasPermission('senders.edit'), [
  param('id').isUUID().withMessage('ID invalide'),
  validate
], senderController.update);

// DELETE /api/senders/:id - Delete sender
router.delete('/:id', hasPermission('senders.edit'), [
  param('id').isUUID().withMessage('ID invalide'),
  validate
], senderController.delete);

// GET /api/senders/search/:phone - Search by phone
router.get('/search/:phone', hasPermission('senders.view'), senderController.searchByPhone);

module.exports = router;

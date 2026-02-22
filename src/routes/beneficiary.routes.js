const express = require('express');
const { body, param, query } = require('express-validator');
const beneficiaryController = require('../controllers/beneficiary.controller');
const { validate } = require('../middleware/validate.middleware');
const { authenticate, hasPermission } = require('../middleware/auth.middleware');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// GET /api/beneficiaries - List beneficiaries
router.get('/', hasPermission('beneficiaries.view'), [
  query('search').optional().isString(),
  query('country').optional().isString(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  validate
], beneficiaryController.getAll);

// GET /api/beneficiaries/:id - Get beneficiary by ID
router.get('/:id', hasPermission('beneficiaries.view'), [
  param('id').isUUID().withMessage('ID invalide'),
  validate
], beneficiaryController.getById);

// POST /api/beneficiaries - Create beneficiary
router.post('/', hasPermission('beneficiaries.create'), [
  body('firstName').notEmpty().withMessage('Prénom requis'),
  body('lastName').notEmpty().withMessage('Nom requis'),
  body('phone').notEmpty().withMessage('Téléphone requis'),
  body('country').notEmpty().withMessage('Pays requis'),
  body('city').notEmpty().withMessage('Ville requise'),
  validate
], beneficiaryController.create);

// PUT /api/beneficiaries/:id - Update beneficiary
router.put('/:id', hasPermission('beneficiaries.edit'), [
  param('id').isUUID().withMessage('ID invalide'),
  validate
], beneficiaryController.update);

// DELETE /api/beneficiaries/:id - Delete beneficiary
router.delete('/:id', hasPermission('beneficiaries.edit'), [
  param('id').isUUID().withMessage('ID invalide'),
  validate
], beneficiaryController.delete);

// GET /api/beneficiaries/search/:phone - Search by phone
router.get('/search/:phone', hasPermission('beneficiaries.view'), beneficiaryController.searchByPhone);

module.exports = router;

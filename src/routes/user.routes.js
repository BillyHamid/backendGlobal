const express = require('express');
const { body, param } = require('express-validator');
const userController = require('../controllers/user.controller');
const { validate } = require('../middleware/validate.middleware');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { ROLES } = require('../config/constants');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// GET /api/users - List all users (admin, supervisor)
router.get('/', authorize(ROLES.ADMIN, ROLES.SUPERVISOR), userController.getAll);

// GET /api/users/:id - Get user by ID
router.get('/:id', [
  param('id').isUUID().withMessage('ID invalide'),
  validate
], userController.getById);

// POST /api/users - Create user (admin only)
router.post('/', authorize(ROLES.ADMIN), [
  body('email').isEmail().withMessage('Email invalide'),
  body('password').isLength({ min: 6 }).withMessage('Mot de passe: 6 caractères minimum'),
  body('name').notEmpty().withMessage('Nom requis'),
  body('role').isIn(['admin', 'supervisor', 'sender_agent', 'payer_agent']).withMessage('Rôle invalide'),
  validate
], userController.create);

// PUT /api/users/:id - Update user (admin only)
router.put('/:id', authorize(ROLES.ADMIN), [
  param('id').isUUID().withMessage('ID invalide'),
  body('name').optional().notEmpty().withMessage('Nom invalide'),
  body('email').optional().isEmail().withMessage('Email invalide'),
  validate
], userController.update);

// DELETE /api/users/:id - Delete user (admin only)
router.delete('/:id', authorize(ROLES.ADMIN), [
  param('id').isUUID().withMessage('ID invalide'),
  validate
], userController.delete);

// PATCH /api/users/:id/toggle-active - Toggle user active status (admin only)
router.patch('/:id/toggle-active', authorize(ROLES.ADMIN), [
  param('id').isUUID().withMessage('ID invalide'),
  validate
], userController.toggleActive);

module.exports = router;

const express = require('express');
const { body, param } = require('express-validator');
const userController = require('../controllers/user.controller');
const { validate } = require('../middleware/validate.middleware');
const { authenticate, authorize, hasPermission } = require('../middleware/auth.middleware');
const { ROLES } = require('../config/constants');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// GET /api/users - List all users (admin, supervisor)
router.get('/', hasPermission('users.view'), userController.getAll);

// GET /api/users/:id - Get user by ID
router.get('/:id', hasPermission('users.view'), [
  param('id').isUUID().withMessage('ID invalide'),
  validate
], userController.getById);

// POST /api/users - Create user (admin only)
router.post('/', authorize(ROLES.ADMIN), [
  body('email').isEmail().withMessage('Email invalide'),
  body('password').isLength({ min: 6 }).withMessage('Mot de passe: 6 caractères minimum'),
  body('name').notEmpty().withMessage('Nom requis'),
  body('role').isIn(['admin', 'supervisor', 'sender_agent', 'payer_agent']).withMessage('Rôle invalide'),
  body('specialAccess').optional().isBoolean({ strict: true }).withMessage('Accès spécial invalide'),
  validate
], userController.create);

// PUT /api/users/:id - Update user (admin only)
router.put('/:id', authorize(ROLES.ADMIN), [
  param('id').isUUID().withMessage('ID invalide'),
  body('name').optional().notEmpty().withMessage('Nom invalide'),
  body('email').optional().isEmail().withMessage('Email invalide'),
  body('role').optional().isIn(Object.values(ROLES)).withMessage('Rôle invalide'),
  body('specialAccess').optional().isBoolean({ strict: true }).withMessage('Accès spécial invalide'),
  validate
], userController.update);

// PUT /api/users/:id/password - Réinitialisation réservée aux administrateurs.
router.put('/:id/password', authorize(ROLES.ADMIN), [
  param('id').isUUID().withMessage('ID invalide'),
  body('newPassword').isString().withMessage('Mot de passe requis').bail()
    .isLength({ min: 6 }).withMessage('Mot de passe : 6 caractères minimum').bail()
    .custom(value => Buffer.byteLength(value, 'utf8') <= 72)
    .withMessage('Mot de passe trop long (72 octets maximum)'),
  body('confirmPassword').isString().withMessage('Confirmation requise').bail()
    .custom((value, { req }) => value === req.body.newPassword)
    .withMessage('Les deux mots de passe doivent être identiques'),
  validate
], userController.resetPassword);

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

const express = require('express');
const { body } = require('express-validator');
const authController = require('../controllers/auth.controller');
const { validate } = require('../middleware/validate.middleware');
const { authenticate } = require('../middleware/auth.middleware');

const router = express.Router();

// POST /api/auth/login
router.post('/login', [
  body('email').isEmail().withMessage('Email invalide'),
  body('password').notEmpty().withMessage('Mot de passe requis'),
  validate
], authController.login);

// POST /api/auth/register (admin only in production)
router.post('/register', [
  body('email').isEmail().withMessage('Email invalide'),
  body('password').isLength({ min: 6 }).withMessage('Mot de passe: 6 caractères minimum'),
  body('name').notEmpty().withMessage('Nom requis'),
  body('role').isIn(['admin', 'supervisor', 'sender_agent', 'payer_agent']).withMessage('Rôle invalide'),
  validate
], authController.register);

// GET /api/auth/me - Get current user
router.get('/me', authenticate, authController.getMe);

// POST /api/auth/logout
router.post('/logout', authenticate, authController.logout);

// POST /api/auth/change-password
router.post('/change-password', authenticate, [
  body('currentPassword').notEmpty().withMessage('Mot de passe actuel requis'),
  body('newPassword').isLength({ min: 6 }).withMessage('Nouveau mot de passe: 6 caractères minimum'),
  validate
], authController.changePassword);

module.exports = router;

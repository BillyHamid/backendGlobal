const express = require('express');
const { body } = require('express-validator');
const notificationController = require('../controllers/notification.controller');
const { validate } = require('../middleware/validate.middleware');
const { authenticate } = require('../middleware/auth.middleware');

const router = express.Router();

// GET /api/notifications/vapid-public-key - Get VAPID public key (public)
router.get('/vapid-public-key', notificationController.getVapidPublicKey);

// Protected routes
router.use(authenticate);

// POST /api/notifications/subscribe - Subscribe to push notifications
router.post('/subscribe', [
  body('subscription').notEmpty().withMessage('Subscription requise'),
  body('subscription.endpoint').isURL().withMessage('Endpoint invalide'),
  body('subscription.keys.p256dh').notEmpty().withMessage('Clé p256dh requise'),
  body('subscription.keys.auth').notEmpty().withMessage('Clé auth requise'),
  validate
], notificationController.subscribe);

// POST /api/notifications/unsubscribe - Unsubscribe from push notifications
router.post('/unsubscribe', [
  body('endpoint').isURL().withMessage('Endpoint invalide'),
  validate
], notificationController.unsubscribe);

// GET /api/notifications/status - Check subscription status
router.get('/status', notificationController.getStatus);

// POST /api/notifications/test - Send test notification (to self)
router.post('/test', notificationController.sendTest);

module.exports = router;

const { asyncHandler } = require('../middleware/error.middleware');
const pushService = require('../services/pushNotification.service');

// @desc    Get VAPID public key
// @route   GET /api/notifications/vapid-public-key
const getVapidPublicKey = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: {
      publicKey: process.env.VAPID_PUBLIC_KEY
    }
  });
});

// @desc    Subscribe to push notifications
// @route   POST /api/notifications/subscribe
const subscribe = asyncHandler(async (req, res) => {
  const { subscription } = req.body;
  const userId = req.user.id;

  await pushService.saveSubscription(userId, subscription);

  res.json({
    success: true,
    message: 'Notifications activées'
  });
});

// @desc    Unsubscribe from push notifications
// @route   POST /api/notifications/unsubscribe
const unsubscribe = asyncHandler(async (req, res) => {
  const { endpoint } = req.body;

  await pushService.removeSubscription(endpoint);

  res.json({
    success: true,
    message: 'Notifications désactivées'
  });
});

// @desc    Get subscription status
// @route   GET /api/notifications/status
const getStatus = asyncHandler(async (req, res) => {
  const subscriptions = await pushService.getUserSubscriptions(req.user.id);

  res.json({
    success: true,
    data: {
      subscribed: subscriptions.length > 0,
      subscriptionCount: subscriptions.length
    }
  });
});

// @desc    Send test notification
// @route   POST /api/notifications/test
const sendTest = asyncHandler(async (req, res) => {
  const result = await pushService.sendCustomNotification(
    req.user.id,
    '🔔 Test Notification',
    'Les notifications fonctionnent correctement !',
    { test: true }
  );

  res.json({
    success: true,
    message: `Notification envoyée (${result.successful}/${result.total} appareils)`,
    data: result
  });
});

module.exports = {
  getVapidPublicKey,
  subscribe,
  unsubscribe,
  getStatus,
  sendTest
};

const webpush = require('web-push');
const { query } = require('../config/database');

// Configure web-push with VAPID keys
const initializePush = () => {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
      `mailto:${process.env.VAPID_EMAIL || 'admin@globalexchange.com'}`,
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );
    console.log('📱 Web Push notifications initialized');
  } else {
    console.warn('⚠️ VAPID keys not configured - Push notifications disabled');
  }
};

// Save push subscription to database
const saveSubscription = async (userId, subscription) => {
  const { endpoint, keys } = subscription;
  
  // Check if subscription already exists
  const existing = await query(
    'SELECT id FROM push_subscriptions WHERE endpoint = $1',
    [endpoint]
  );

  if (existing.rows.length > 0) {
    // Update existing subscription
    await query(
      `UPDATE push_subscriptions 
       SET user_id = $1, p256dh = $2, auth = $3, updated_at = CURRENT_TIMESTAMP
       WHERE endpoint = $4`,
      [userId, keys.p256dh, keys.auth, endpoint]
    );
  } else {
    // Create new subscription
    await query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4)`,
      [userId, endpoint, keys.p256dh, keys.auth]
    );
  }

  return { success: true };
};

// Remove push subscription
const removeSubscription = async (endpoint) => {
  await query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
  return { success: true };
};

// Get all subscriptions for a user
const getUserSubscriptions = async (userId) => {
  const result = await query(
    'SELECT * FROM push_subscriptions WHERE user_id = $1',
    [userId]
  );
  return result.rows;
};

// Get subscriptions by role (e.g., all payer_agents)
const getSubscriptionsByRole = async (role) => {
  const result = await query(
    `SELECT ps.* FROM push_subscriptions ps
     JOIN users u ON ps.user_id = u.id
     WHERE u.role = $1 AND u.is_active = true`,
    [role]
  );
  return result.rows;
};

// Get subscriptions by country
const getSubscriptionsByCountry = async (country) => {
  const result = await query(
    `SELECT ps.* FROM push_subscriptions ps
     JOIN users u ON ps.user_id = u.id
     WHERE u.country = $1 AND u.is_active = true`,
    [country]
  );
  return result.rows;
};

// Send notification to a single subscription
const sendNotification = async (subscription, payload) => {
  const pushSubscription = {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: subscription.p256dh,
      auth: subscription.auth
    }
  };

  try {
    await webpush.sendNotification(
      pushSubscription,
      JSON.stringify(payload)
    );
    return { success: true };
  } catch (error) {
    console.error('Push notification error:', error);
    
    // If subscription is expired/invalid, remove it
    if (error.statusCode === 410 || error.statusCode === 404) {
      await removeSubscription(subscription.endpoint);
    }
    
    return { success: false, error: error.message };
  }
};

// Send notification to multiple subscriptions
const sendToMany = async (subscriptions, payload) => {
  const results = await Promise.allSettled(
    subscriptions.map(sub => sendNotification(sub, payload))
  );
  
  const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
  const failed = results.length - successful;
  
  return { successful, failed, total: results.length };
};

// Send notification to all payer agents (when new transfer is created)
const notifyPayerAgents = async (transfer, beneficiaryCountry) => {
  // Get all payer_agent subscriptions
  const subscriptions = await getSubscriptionsByRole('payer_agent');
  
  if (subscriptions.length === 0) {
    console.log('No payer agent subscriptions found');
    return { successful: 0, failed: 0, total: 0 };
  }

  const payload = {
    type: 'NEW_TRANSFER',
    title: '💸 Nouveau Transfert',
    body: `${transfer.amountReceived.toLocaleString()} XOF à payer à ${transfer.beneficiaryName}`,
    data: {
      transferId: transfer.id,
      reference: transfer.reference,
      amount: transfer.amountReceived,
      currency: 'XOF',
      beneficiary: transfer.beneficiaryName,
      city: transfer.beneficiaryCity,
      url: `/transfers/${transfer.id}`
    },
    icon: '/icons/money-transfer.png',
    badge: '/icons/badge.png',
    vibrate: [200, 100, 200],
    tag: `transfer-${transfer.reference}`,
    requireInteraction: true,
    actions: [
      { action: 'view', title: 'Voir détails' },
      { action: 'pay', title: 'Marquer payé' }
    ]
  };

  const result = await sendToMany(subscriptions, payload);
  console.log(`📱 Push sent: ${result.successful}/${result.total} delivered`);
  
  return result;
};

// Send notification when transfer is paid
const notifyTransferPaid = async (transfer, senderAgentId) => {
  // Notify the sender agent who created the transfer
  const subscriptions = await getUserSubscriptions(senderAgentId);
  
  if (subscriptions.length === 0) {
    return { successful: 0, failed: 0, total: 0 };
  }

  const payload = {
    type: 'TRANSFER_PAID',
    title: '✅ Transfert Payé',
    body: `Le transfert ${transfer.reference} a été payé`,
    data: {
      transferId: transfer.id,
      reference: transfer.reference,
      url: `/transfers/${transfer.id}`
    },
    icon: '/icons/check.png',
    tag: `paid-${transfer.reference}`
  };

  return await sendToMany(subscriptions, payload);
};

// Send custom notification
const sendCustomNotification = async (userId, title, body, data = {}) => {
  const subscriptions = await getUserSubscriptions(userId);
  
  if (subscriptions.length === 0) {
    return { successful: 0, failed: 0, total: 0 };
  }

  const payload = {
    type: 'CUSTOM',
    title,
    body,
    data,
    icon: '/icons/notification.png'
  };

  return await sendToMany(subscriptions, payload);
};

module.exports = {
  initializePush,
  saveSubscription,
  removeSubscription,
  getUserSubscriptions,
  getSubscriptionsByRole,
  getSubscriptionsByCountry,
  sendNotification,
  sendToMany,
  notifyPayerAgents,
  notifyTransferPaid,
  sendCustomNotification
};

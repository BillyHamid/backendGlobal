const jwt = require('jsonwebtoken');
const { query } = require('../config/database');

// Verify JWT token
const authenticate = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Accès non autorisé. Token manquant.'
      });
    }

    const token = authHeader.split(' ')[1];

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Debug: Log decoded token
    console.log('Auth middleware - Decoded userId:', decoded.userId);

    // Get user from database
    const result = await query(
      'SELECT id, email, name, role, country, agent_code, is_active FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Utilisateur non trouvé.'
      });
    }

    const user = result.rows[0];

    if (!user.is_active) {
      return res.status(401).json({
        success: false,
        message: 'Compte désactivé. Contactez l\'administrateur.'
      });
    }

    // Debug: Log authenticated user
    console.log('Auth middleware - Authenticated user:', user.name, 'ID:', user.id, 'Email:', user.email);

    // Attach user to request
    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      country: user.country,
      agentCode: user.agent_code
    };

    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Token invalide.'
      });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expiré. Veuillez vous reconnecter.'
      });
    }
    next(error);
  }
};

// Check if user has required role(s)
const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentification requise.'
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Accès refusé. Vous n\'avez pas les permissions nécessaires.'
      });
    }

    next();
  };
};

// Check specific permission
const hasPermission = (permission) => {
  const rolePermissions = {
    admin: [
      'transfers.create', 'transfers.view', 'transfers.edit', 'transfers.cancel', 'transfers.pay', 'transfers.delete',
      'users.create', 'users.view', 'users.edit', 'users.delete',
      'beneficiaries.create', 'beneficiaries.view', 'beneficiaries.edit',
      'senders.create', 'senders.view', 'senders.edit',
      'reports.view', 'reports.export',
      'settings.view', 'settings.edit',
      'audit.view'
    ],
    supervisor: [
      'transfers.view', 'transfers.edit', 'transfers.cancel',
      'users.view',
      'beneficiaries.view',
      'senders.view',
      'reports.view', 'reports.export'
    ],
    // Tous les agents (USA et BF) peuvent créer des transferts ET marquer comme payé
    sender_agent: [
      'transfers.create', 'transfers.view', 'transfers.pay',
      'beneficiaries.create', 'beneficiaries.view',
      'senders.create', 'senders.view'
    ],
    payer_agent: [
      'transfers.create', 'transfers.view', 'transfers.pay',
      'beneficiaries.create', 'beneficiaries.view',
      'senders.create', 'senders.view'
    ]
  };

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentification requise.'
      });
    }

    const userPermissions = rolePermissions[req.user.role] || [];
    
    if (!userPermissions.includes(permission)) {
      return res.status(403).json({
        success: false,
        message: `Permission '${permission}' requise.`
      });
    }

    next();
  };
};

module.exports = {
  authenticate,
  authorize,
  hasPermission
};

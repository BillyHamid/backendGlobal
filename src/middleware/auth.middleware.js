const jwt = require('jsonwebtoken');

// Verify JWT token - utilise les claims du JWT (pas de SELECT à chaque requête)
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Accès non autorisé. Token manquant.'
      });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // JWT avec claims complets (login/register récents) : pas de DB
    if (decoded.role !== undefined && decoded.email !== undefined) {
      if (decoded.isActive === false) {
        return res.status(401).json({
          success: false,
          message: 'Compte désactivé. Contactez l\'administrateur.'
        });
      }
      req.user = {
        id: decoded.userId,
        email: decoded.email,
        name: decoded.name,
        role: decoded.role,
        country: decoded.country ?? null,
        agentCode: decoded.agentCode ?? null
      };
      return next();
    }

    // JWT legacy (userId seul) : fallback DB pour rétrocompatibilité
    const { query } = require('../config/database');
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

/** Annulation de transfert : admin, superviseur, ou Zongo Razack (même email que modification privilégiée) */
const canCancelTransferPrivileged = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentification requise.'
    });
  }
  const { RAZACK_TRANSFER_EDIT_EMAIL } = require('../config/constants');
  const email = (req.user.email || '').toLowerCase();
  if (req.user.role === 'admin' || req.user.role === 'supervisor') {
    return next();
  }
  if (email === RAZACK_TRANSFER_EDIT_EMAIL) {
    return next();
  }
  return res.status(403).json({
    success: false,
    message: 'Permission \'transfers.cancel\' requise.'
  });
};

/** Modification de transfert : admin ou compte Razack uniquement (pas superviseur ni autres agents) */
const canModifyTransferAdminOrRazack = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentification requise.'
    });
  }
  const { RAZACK_TRANSFER_EDIT_EMAIL } = require('../config/constants');
  const email = (req.user.email || '').toLowerCase();
  if (req.user.role === 'admin' || email === RAZACK_TRANSFER_EDIT_EMAIL) {
    return next();
  }
  return res.status(403).json({
    success: false,
    message: 'Seuls l\'administrateur et Razack peuvent modifier un transfert.'
  });
};

module.exports = {
  authenticate,
  authorize,
  hasPermission,
  canCancelTransferPrivileged,
  canModifyTransferAdminOrRazack
};

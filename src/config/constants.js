// User roles
const ROLES = {
  ADMIN: 'admin',
  SUPERVISOR: 'supervisor',
  SENDER_AGENT: 'sender_agent',
  PAYER_AGENT: 'payer_agent'
};

// Transfer statuses
const TRANSFER_STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  PAID: 'paid', // Payé (avec ou sans preuve)
  CANCELLED: 'cancelled'
};

// Payment methods (valeurs stockées en send_method)
const PAYMENT_METHODS = {
  CASH: 'cash',
  ZELLE: 'zelle',
  ORANGE_MONEY: 'orange_money',
  WAVE: 'wave',
  BANK_TRANSFER: 'bank_transfer',
  APPEL: 'appel',
};

/** Liste pour validation API création de transfert */
const VALID_SEND_METHODS = Object.values(PAYMENT_METHODS);

// Countries configuration - Only USA and Burkina Faso
const COUNTRIES = {
  SEND: [
    { code: 'USA', name: 'États-Unis', currency: 'USD' }
  ],
  RECEIVE: [
    { code: 'BFA', name: 'Burkina Faso', currency: 'XOF' }
  ]
};

// Exchange rates (base rates - should come from database in production)
const EXCHANGE_RATES = {
  USD_XOF: 615
};

// Fee calculation tiers
// Structure: { minAmount, maxAmount, fee }
// Pour les montants > $1000: $20 par tranche de $1000
// Only USD fees (USA to BF only)
const FEE_TIERS = [
  { minAmount: 1, maxAmount: 100, fee: { USD: 5 } },
  { minAmount: 101, maxAmount: 200, fee: { USD: 8 } },
  { minAmount: 201, maxAmount: 500, fee: { USD: 10 } },
  { minAmount: 501, maxAmount: 800, fee: { USD: 15 } },
  { minAmount: 801, maxAmount: 1000, fee: { USD: 20 } },
  // Pour > $1000: $20 par tranche de $1000 (géré dans calculateFees)
];

/** Compte autorisé à modifier les transferts (en plus du rôle admin) — aligné seed / dépenses spéciales */
const RAZACK_TRANSFER_EDIT_EMAIL = (
  process.env.RAZACK_TRANSFER_EDIT_EMAIL || 'razack@globalexchange.com'
).toLowerCase();

module.exports = {
  ROLES,
  TRANSFER_STATUS,
  PAYMENT_METHODS,
  VALID_SEND_METHODS,
  COUNTRIES,
  EXCHANGE_RATES,
  FEE_TIERS,
  RAZACK_TRANSFER_EDIT_EMAIL
};

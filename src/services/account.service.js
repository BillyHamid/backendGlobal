const { query } = require('../config/database');
const { asyncHandler, ApiError } = require('../middleware/error.middleware');

/**
 * Service de gestion des comptes (caisses)
 */

// Obtenir un compte par nom (USA ou BURKINA)
// Crée automatiquement le compte s'il n'existe pas
const getAccountByName = async (name) => {
  let result = await query(
    'SELECT * FROM accounts WHERE name = $1',
    [name]
  );
  
  // Si le compte n'existe pas, le créer automatiquement
  if (result.rows.length === 0) {
    // Déterminer la devise selon le nom du compte
    const currency = name === 'USA' ? 'USD' : name === 'BURKINA' ? 'XOF' : null;
    
    if (!currency) {
      throw new ApiError(400, `Nom de compte invalide: ${name}. Utilisez 'USA' ou 'BURKINA'`);
    }
    
    // Créer le compte
    await query(
      `INSERT INTO accounts (name, currency, current_balance) 
       VALUES ($1, $2, 0) 
       ON CONFLICT (name) DO NOTHING`,
      [name, currency]
    );
    
    // Récupérer le compte créé
    result = await query(
      'SELECT * FROM accounts WHERE name = $1',
      [name]
    );
    
    if (result.rows.length === 0) {
      throw new ApiError(500, `Erreur lors de la création du compte ${name}`);
    }
  }
  
  return result.rows[0];
};

// Obtenir tous les comptes
const getAllAccounts = async () => {
  const result = await query(
    'SELECT * FROM accounts ORDER BY name'
  );
  return result.rows.map(acc => ({
    id: acc.id,
    name: acc.name,
    currency: acc.currency,
    currentBalance: parseFloat(acc.current_balance),
    createdAt: acc.created_at,
    updatedAt: acc.updated_at
  }));
};

// Obtenir le solde d'un compte
const getAccountBalance = async (accountName) => {
  const account = await getAccountByName(accountName);
  return parseFloat(account.current_balance);
};

// Vérifier qu'un compte existe
const accountExists = async (accountName) => {
  const result = await query(
    'SELECT id FROM accounts WHERE name = $1',
    [accountName]
  );
  return result.rows.length > 0;
};

module.exports = {
  getAccountByName,
  getAllAccounts,
  getAccountBalance,
  accountExists
};

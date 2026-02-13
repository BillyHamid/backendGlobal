const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../config/database');
const { asyncHandler, ApiError } = require('../middleware/error.middleware');

// Generate JWT token
const generateToken = (userId) => {
  return jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

// @desc    Login user
// @route   POST /api/auth/login
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  // Find user by email
  const result = await query(
    'SELECT * FROM users WHERE email = $1',
    [email.toLowerCase()]
  );

  if (result.rows.length === 0) {
    throw new ApiError(401, 'Email ou mot de passe incorrect');
  }

  const user = result.rows[0];

  // Check if user is active
  if (!user.is_active) {
    throw new ApiError(401, 'Compte désactivé. Contactez l\'administrateur.');
  }

  // Verify password
  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    throw new ApiError(401, 'Email ou mot de passe incorrect');
  }

  // Generate token
  const token = generateToken(user.id);

  // Return user data (without password)
  res.json({
    success: true,
    message: 'Connexion réussie',
    data: {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        phone: user.phone,
        country: user.country,
        agentCode: user.agent_code,
        isActive: user.is_active,
        createdAt: user.created_at
      }
    }
  });
});

// @desc    Register new user
// @route   POST /api/auth/register
const register = asyncHandler(async (req, res) => {
  const { email, password, name, phone, role, country, agentCode } = req.body;

  // Check if email already exists
  const existing = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
  if (existing.rows.length > 0) {
    throw new ApiError(409, 'Cet email est déjà utilisé');
  }

  // Hash password
  const hashedPassword = await bcrypt.hash(password, 10);

  // Insert user
  const result = await query(
    `INSERT INTO users (email, password, name, phone, role, country, agent_code)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, email, name, role, phone, country, agent_code, is_active, created_at`,
    [email.toLowerCase(), hashedPassword, name, phone, role, country, agentCode]
  );

  const user = result.rows[0];
  const token = generateToken(user.id);

  res.status(201).json({
    success: true,
    message: 'Compte créé avec succès',
    data: {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        phone: user.phone,
        country: user.country,
        agentCode: user.agent_code,
        isActive: user.is_active,
        createdAt: user.created_at
      }
    }
  });
});

// @desc    Get current user
// @route   GET /api/auth/me
const getMe = asyncHandler(async (req, res) => {
  const result = await query(
    'SELECT id, email, name, role, phone, country, agent_code, is_active, created_at FROM users WHERE id = $1',
    [req.user.id]
  );

  if (result.rows.length === 0) {
    throw new ApiError(404, 'Utilisateur non trouvé');
  }

  const user = result.rows[0];

  res.json({
    success: true,
    data: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      phone: user.phone,
      country: user.country,
      agentCode: user.agent_code,
      isActive: user.is_active,
      createdAt: user.created_at
    }
  });
});

// @desc    Logout user
// @route   POST /api/auth/logout
const logout = asyncHandler(async (req, res) => {
  // In a real app, you might blacklist the token here
  res.json({
    success: true,
    message: 'Déconnexion réussie'
  });
});

// @desc    Change password
// @route   POST /api/auth/change-password
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  // Get current user with password
  const result = await query('SELECT password FROM users WHERE id = $1', [req.user.id]);
  
  if (result.rows.length === 0) {
    throw new ApiError(404, 'Utilisateur non trouvé');
  }

  // Verify current password
  const isMatch = await bcrypt.compare(currentPassword, result.rows[0].password);
  if (!isMatch) {
    throw new ApiError(401, 'Mot de passe actuel incorrect');
  }

  // Hash new password
  const hashedPassword = await bcrypt.hash(newPassword, 10);

  // Update password
  await query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, req.user.id]);

  res.json({
    success: true,
    message: 'Mot de passe modifié avec succès'
  });
});

module.exports = {
  login,
  register,
  getMe,
  logout,
  changePassword
};

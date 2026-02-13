// Global error handler middleware
const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);

  // Default error
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Une erreur interne est survenue';

  // Validation errors
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = err.message;
  }

  // PostgreSQL errors
  if (err.code) {
    switch (err.code) {
      case '23505': // Unique violation
        statusCode = 409;
        message = 'Cette entrée existe déjà.';
        break;
      case '23503': // Foreign key violation
        statusCode = 400;
        message = 'Référence invalide.';
        break;
      case '23502': // Not null violation
        statusCode = 400;
        message = 'Champ obligatoire manquant.';
        break;
      case 'ECONNREFUSED':
        statusCode = 503;
        message = 'Service de base de données indisponible.';
        break;
    }
  }

  // Send response
  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && { 
      stack: err.stack,
      details: err 
    })
  });
};

// Async error wrapper
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Custom API Error class
class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'ApiError';
  }
}

module.exports = {
  errorHandler,
  asyncHandler,
  ApiError
};

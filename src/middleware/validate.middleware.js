const { validationResult } = require('express-validator');

// Middleware to check validation results - messages explicites pour le debug frontend
const validate = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const errorList = errors.array().map(err => ({
      field: err.path || err.param,
      message: err.msg,
      value: err.value
    }));
    const summary = errorList.map(e => `${e.field}: ${e.message}`).join('; ');
    return res.status(400).json({
      success: false,
      message: `Validation échouée: ${summary}`,
      errors: errorList
    });
  }

  next();
};

module.exports = { validate };

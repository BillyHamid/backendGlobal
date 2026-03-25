const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const uploadPaths = require('../config/uploadPaths');

const ALLOWED_MIME_TYPES = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'application/pdf': ['.pdf'],
};
const MAX_FILE_SIZE = 5 * 1024 * 1024;

const uploadDir = uploadPaths.special_expenses;

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `expense_${uuidv4()}${ext}`);
  },
});

const fileFilter = (_req, file, cb) => {
  if (!ALLOWED_MIME_TYPES[file.mimetype]) {
    return cb(new Error('Type de fichier non autorisé. Types acceptés: JPG, PNG, PDF'));
  }
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_MIME_TYPES[file.mimetype].includes(ext)) {
    return cb(new Error('Extension non autorisée pour ce type MIME'));
  }
  cb(null, true);
};

const uploadReceiptFile = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
}).single('receipt_image');

module.exports = { uploadReceiptFile, uploadDir };

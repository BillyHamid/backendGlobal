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

const uploadDir = uploadPaths.financial_reports;

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `fr_item_${uuidv4()}${ext}`);
  },
});

const fileFilter = (_req, file, cb) => {
  if (!ALLOWED_MIME_TYPES[file.mimetype]) {
    return cb(new Error('Type non autorisé (JPG, PNG, PDF).'));
  }
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_MIME_TYPES[file.mimetype].includes(ext)) {
    return cb(new Error('Extension incompatible avec le type de fichier.'));
  }
  cb(null, true);
};

const uploadItemProof = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
}).single('proof');

module.exports = { uploadItemProof, uploadDir };

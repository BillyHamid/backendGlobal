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

const uploadDir = uploadPaths.beneficiary_ids;

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `ben_id_${uuidv4()}${ext}`);
  },
});

const fileFilter = (_req, file, cb) => {
  if (!ALLOWED_MIME_TYPES[file.mimetype]) {
    return cb(new Error('Pièce d’identité : JPG, PNG ou PDF uniquement.'));
  }
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_MIME_TYPES[file.mimetype].includes(ext)) {
    return cb(new Error('Extension incompatible avec le type de fichier.'));
  }
  cb(null, true);
};

const uploadBeneficiaryIdProof = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
}).single('beneficiary_id_proof');

module.exports = { uploadBeneficiaryIdProof, uploadDir };

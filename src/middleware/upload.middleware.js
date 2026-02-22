const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { ApiError } = require('./error.middleware');

// Allowed MIME types (vérification stricte)
const ALLOWED_MIME_TYPES = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'application/pdf': ['.pdf']
};

// Taille maximale : 5 MB
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB en bytes

// Créer le dossier d'upload sécurisé s'il n'existe pas
const uploadDir = path.join(__dirname, '../../secure_uploads/transactions');
const cashEntryUploadDir = path.join(__dirname, '../../secure_uploads/cash_entries');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
if (!fs.existsSync(cashEntryUploadDir)) {
  fs.mkdirSync(cashEntryUploadDir, { recursive: true });
}

// Configuration du stockage (transactions)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueName = `${uuidv4()}${ext}`;
    cb(null, uniqueName);
  }
});

// Stockage pour preuves des entrées de caisse
const cashEntryStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, cashEntryUploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueName = `entry_${uuidv4()}${ext}`;
    cb(null, uniqueName);
  }
});

// Filtre de validation des fichiers
const fileFilter = (req, file, cb) => {
  // Vérifier le type MIME réel (pas seulement l'extension)
  const mimeType = file.mimetype;
  
  if (!ALLOWED_MIME_TYPES[mimeType]) {
    return cb(new Error(`Type de fichier non autorisé. Types acceptés: JPG, JPEG, PNG, PDF`));
  }
  
  // Vérifier l'extension
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExts = ALLOWED_MIME_TYPES[mimeType];
  
  if (!allowedExts.includes(ext)) {
    return cb(new Error(`Extension de fichier non autorisée pour ce type MIME`));
  }
  
  cb(null, true);
};

// Configuration multer (transactions)
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1
  }
});

// Multer pour preuve d'entrée de caisse (même règles MIME / taille)
const uploadCashEntryProof = multer({
  storage: cashEntryStorage,
  fileFilter: fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1
  }
});

// Middleware pour upload de preuve de transaction
const uploadProof = upload.single('proof_file');

// Middleware pour upload de preuve d'entrée de caisse
const uploadCashEntryProofFile = uploadCashEntryProof.single('proof_file');

// Middleware de validation après upload
const validateProofUpload = (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: 'Le fichier de preuve est obligatoire'
    });
  }
  
  // Vérification supplémentaire du type MIME réel du fichier uploadé
  // (protection contre les fichiers renommés)
  const filePath = req.file.path;
  const fileExt = path.extname(filePath).toLowerCase();
  
  // Vérifier que l'extension correspond au type MIME
  const mimeType = req.file.mimetype;
  const allowedExts = ALLOWED_MIME_TYPES[mimeType];
  
  if (!allowedExts.includes(fileExt)) {
    // Supprimer le fichier invalide
    fs.unlinkSync(filePath);
    return res.status(400).json({
      success: false,
      message: 'Type de fichier invalide détecté'
    });
  }
  
  next();
};

// Validation preuve entrée caisse (fichier obligatoire)
const validateCashEntryProofUpload = (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: 'La preuve (photo ou PDF) est obligatoire pour enregistrer une entrée d\'argent'
    });
  }
  const filePath = req.file.path;
  const fileExt = path.extname(filePath).toLowerCase();
  const mimeType = req.file.mimetype;
  const allowedExts = ALLOWED_MIME_TYPES[mimeType];
  if (!allowedExts || !allowedExts.includes(fileExt)) {
    try { fs.unlinkSync(filePath); } catch {}
    return res.status(400).json({
      success: false,
      message: 'Type de fichier invalide. Utilisez JPG, PNG ou PDF.'
    });
  }
  next();
};

module.exports = {
  uploadProof,
  validateProofUpload,
  uploadCashEntryProofFile,
  validateCashEntryProofUpload,
  uploadDir,
  cashEntryUploadDir
};

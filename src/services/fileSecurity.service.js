const fs = require('fs');
const path = require('path');
const { uploadDir } = require('../middleware/upload.middleware');

/**
 * Service de gestion sécurisée des fichiers
 * Empêche l'exécution de scripts et garantit la sécurité des uploads
 */

// Créer un fichier .htaccess ou équivalent pour empêcher l'exécution
const createSecurityFile = () => {
  const securityFilePath = path.join(uploadDir, '.htaccess');
  const securityContent = `# Empêcher l'exécution de scripts
<FilesMatch "\.(php|php3|php4|php5|phtml|pl|py|jsp|asp|sh|cgi)$">
  Deny from all
</FilesMatch>

# Empêcher l'accès direct aux fichiers
# Les fichiers doivent être servis via l'API uniquement
Options -Indexes
`;

  if (!fs.existsSync(securityFilePath)) {
    fs.writeFileSync(securityFilePath, securityContent);
  }
};

// Initialiser la sécurité au démarrage
createSecurityFile();

/**
 * Vérifier que le fichier existe et est dans le dossier sécurisé
 */
const validateFilePath = (filePath) => {
  const resolvedPath = path.resolve(uploadDir, path.basename(filePath));
  const uploadDirResolved = path.resolve(uploadDir);
  
  // Vérifier que le fichier est bien dans le dossier d'upload
  if (!resolvedPath.startsWith(uploadDirResolved)) {
    throw new Error('Chemin de fichier invalide');
  }
  
  // Vérifier que le fichier existe
  if (!fs.existsSync(resolvedPath)) {
    throw new Error('Fichier non trouvé');
  }
  
  return resolvedPath;
};

/**
 * Supprimer un fichier de preuve (pour nettoyage)
 */
const deleteProofFile = (filePath) => {
  try {
    const fullPath = validateFilePath(filePath);
    fs.unlinkSync(fullPath);
    return true;
  } catch (error) {
    console.error('Erreur lors de la suppression du fichier:', error);
    return false;
  }
};

/**
 * Obtenir le chemin relatif sécurisé (pour stockage en BDD)
 */
const getSecureRelativePath = (filename) => {
  return `transactions/${filename}`;
};

module.exports = {
  validateFilePath,
  deleteProofFile,
  getSecureRelativePath,
  uploadDir
};

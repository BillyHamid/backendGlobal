const { uploadBeneficiaryIdProof } = require('./beneficiaryIdProof.upload');

/**
 * Si Content-Type = multipart (payload JSON + fichier pièce d'identité optionnel),
 * parse le body pour que express-validator voie le même objet qu'en application/json.
 */
function maybeMultipartTransferCreate(req, res, next) {
  const ct = req.headers['content-type'] || '';
  if (!ct.includes('multipart/form-data')) {
    return next();
  }

  uploadBeneficiaryIdProof(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        success: false,
        message: err.message || 'Erreur lors de l’upload de la pièce d’identité',
      });
    }
    try {
      const raw = req.body.payload;
      if (raw === undefined || raw === null) {
        return res.status(400).json({
          success: false,
          message: 'Champ « payload » (JSON) manquant pour la création du transfert',
        });
      }
      if (typeof raw !== 'string') {
        return res.status(400).json({
          success: false,
          message: 'Le champ « payload » doit être une chaîne JSON',
        });
      }
      const parsed = JSON.parse(raw);
      req.body = parsed;
    } catch (e) {
      return res.status(400).json({
        success: false,
        message: 'JSON du transfert invalide dans « payload »',
      });
    }
    next();
  });
}

module.exports = { maybeMultipartTransferCreate };

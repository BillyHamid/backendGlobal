const express = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const controller = require('../controllers/financialReports.controller');
const { uploadItemProof } = require('../middleware/financialReports.upload');

const router = express.Router();
router.use(authenticate);

const handleMulter = (req, res, next) => {
  uploadItemProof(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        success: false,
        message: err.message || 'Erreur upload fichier',
      });
    }
    next();
  });
};

router.post('/', controller.create);
router.get('/mine', controller.listMine);
router.get('/for-review', controller.listPendingReview);
router.get('/history', controller.listAll);

router.get('/:id/items/:itemId/proof', controller.downloadProof);

router.get('/:id', controller.getById);
router.patch('/:id', controller.update);
router.delete('/:id', controller.removeDraft);
router.post('/:id/submit', controller.submit);
router.post('/:id/approve', controller.approve);
router.post('/:id/reject', controller.reject);

router.post('/:id/items', handleMulter, controller.addItem);
router.delete('/:id/items/:itemId', controller.deleteItem);

module.exports = router;

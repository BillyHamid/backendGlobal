const express = require('express');
const { fetchUsdToXofRate, FALLBACK_RATE } = require('../services/exchangeRate.service');

const router = express.Router();

// Marge fixe appliquée au taux réel : taux_paiement = taux_reel + MARGE_FIXE
const MARGE_FIXE = 30;

// GET /api/exchange-rates - Taux USD/XOF du jour
router.get('/', async (req, res) => {
  try {
    const rateReel = await fetchUsdToXofRate();
    const ratePaiement = rateReel + MARGE_FIXE;
    res.json({
      success: true,
      data: {
        USD_XOF: ratePaiement,
        rateReel,
        ratePaiement,
        marge: MARGE_FIXE,
        from: 'USD',
        to: 'XOF',
        source: process.env.EXCHANGE_RATE_USD_XOF ? 'env (override)' : 'moneyconvert.net'
      }
    });
  } catch (err) {
    const rateReel = FALLBACK_RATE;
    const ratePaiement = rateReel + MARGE_FIXE;
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération du taux',
      data: {
        USD_XOF: ratePaiement,
        rateReel,
        ratePaiement,
        marge: MARGE_FIXE,
        source: 'fallback'
      }
    });
  }
});

module.exports = router;

const express = require('express');
const statsController = require('../controllers/stats.controller');
const { authenticate } = require('../middleware/auth.middleware');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// GET /api/stats/dashboard - Get dashboard statistics
router.get('/dashboard', statsController.getDashboardStats);

// GET /api/stats/transfers - Get transfer statistics
router.get('/transfers', statsController.getTransferStats);

// GET /api/stats/agents - Get agent performance stats (admin/supervisor)
router.get('/agents', statsController.getAgentStats);

// GET /api/stats/journal - Get transaction journal with cumulative totals
router.get('/journal', statsController.getJournal);

// GET /api/stats/by-country - Get statistics by country (USA vs BF)
router.get('/by-country', statsController.getStatsByCountry);

module.exports = router;

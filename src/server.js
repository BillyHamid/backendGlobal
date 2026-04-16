const path = require('path');
// Toujours charger le .env à la racine du backend (parent de src/), même si PM2 a un cwd différent
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

if (!process.env.JWT_SECRET) {
  console.error('❌ JWT_SECRET manquant dans .env. Tous les tokens seront invalides.');
  process.exit(1);
}

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

// Import routes
const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const transferRoutes = require('./routes/transfer.routes');
const beneficiaryRoutes = require('./routes/beneficiary.routes');
const senderRoutes = require('./routes/sender.routes');
const cashRoutes = require('./routes/cash.routes');
const statsRoutes = require('./routes/stats.routes');
const notificationRoutes = require('./routes/notification.routes');
const exchangeRateRoutes = require('./routes/exchangeRate.routes');
const specialExpensesRoutes = require('./routes/specialExpenses.routes');
const financialReportsRoutes = require('./routes/financialReports.routes');

// Import middleware
const { errorHandler } = require('./middleware/error.middleware');

// Import services
const { initializePush } = require('./services/pushNotification.service');

const app = express();
const PORT = process.env.PORT || 5000;

// ===================
// MIDDLEWARE
// ===================

// Security headers (désactiver certaines restrictions pour CORS)
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// CORS configuration
const { isAllowedCorsOrigin } = require('./config/corsConfig');

app.use(cors({
  origin: function(origin, callback) {
    if (isAllowedCorsOrigin(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning'],
  exposedHeaders: ['Content-Disposition']
}));

// Request logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===================
// ROUTES
// ===================

// Vérification Ngrok
app.get('/', (req, res) => {
  res.send('Le serveur backend est bien en ligne et relié à Ngrok !');
});

// Health check (inclut l’état du schéma si la vérif au démarrage a tourné)
app.get('/api/health', (req, res) => {
  const { getLastSchemaCheck } = require('./database/verifySchema');
  const schema = getLastSchemaCheck();
  const strict = process.env.STRICT_HEALTH_SCHEMA === '1';
  if (strict && schema && !schema.ok) {
    return res.status(503).json({
      status: 'DEGRADED',
      message: 'Schéma base de données incomplet — exécutez npm run db:migrate:extra',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
      databaseSchema: { ok: false, issues: schema.issues },
    });
  }
  const payload = {
    status: 'OK',
    message: 'Global Exchange API is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
  };
  if (schema) {
    payload.databaseSchema = { ok: schema.ok, issues: schema.issues };
  }
  res.json(payload);
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/transfers', transferRoutes);
app.use('/api/beneficiaries', beneficiaryRoutes);
app.use('/api/senders', senderRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/cash', cashRoutes);
app.use('/api/exchange-rates', exchangeRateRoutes);
app.use('/api/special-expenses', specialExpensesRoutes);
app.use('/api/financial-reports', financialReportsRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    success: false, 
    message: `Route ${req.originalUrl} not found` 
  });
});

// Error handler
app.use(errorHandler);

// ===================
// START SERVER
// ===================

// En production (ex. Render), écouter sur 0.0.0.0 pour accepter les requêtes externes
const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : undefined;

async function start() {
  const { pool } = require('./config/database');

  if (process.env.RUN_MIGRATIONS_ON_START === '1') {
    try {
      const { applyExtraMigrations } = require('./database/migrate_extra');
      await applyExtraMigrations(pool);
    } catch (e) {
      console.error('❌ RUN_MIGRATIONS_ON_START : échec des migrations :', e.message);
      process.exit(1);
    }
  }

  if (process.env.SKIP_SCHEMA_VERIFY !== '1') {
    try {
      const { runSchemaVerification } = require('./database/verifySchema');
      const check = await runSchemaVerification(pool);
      if (!check.ok) {
        console.error('\n⚠️  SCHÉMA BASE DE DONNÉES INCOMPLET');
        check.issues.forEach((issue) => console.error('   -', issue));
        console.error('   → Base déjà en service : npm run db:migrate:extra');
        console.error('   → Nouvelle base vide    : npm run db:migrate:all\n');
      }
    } catch (e) {
      console.error('⚠️  Vérification schéma impossible (base injoignable ?):', e.message);
    }
  }

  app.listen(PORT, host, () => {
    initializePush();

    const apiUrl = process.env.RENDER_EXTERNAL_URL
      ? `${process.env.RENDER_EXTERNAL_URL}/api`
      : `http://localhost:${PORT}/api`;

    console.log('\n🌍 GLOBAL EXCHANGE API');
    console.log('   Port:', PORT, '| Env:', process.env.NODE_ENV || 'development');
    console.log('   API:', apiUrl, '\n');
  });
}

start();

module.exports = app;


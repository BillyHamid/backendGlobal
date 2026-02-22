require('dotenv').config();
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

// Import middleware
const { errorHandler } = require('./middleware/error.middleware');

// Import services
const { initializePush } = require('./services/pushNotification.service');

const app = express();
const PORT = process.env.PORT || 5000;

// ===================
// MIDDLEWARE
// ===================

// Security headers
app.use(helmet());

// CORS configuration
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://127.0.0.1:5173',
  process.env.FRONTEND_URL
].filter(Boolean);

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    // In development, allow all localhost origins
    if (process.env.NODE_ENV === 'development' && origin.includes('localhost')) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
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

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Global Exchange API is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV
  });
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

app.listen(PORT, () => {
  // Initialize push notifications
  initializePush();
  
  console.log(`
╔═══════════════════════════════════════════════════╗
║                                                   ║
║   🌍 GLOBAL EXCHANGE API                          ║
║                                                   ║
║   Server running on: http://localhost:${PORT}        ║
║   Environment: ${process.env.NODE_ENV || 'development'}                        ║
║                                                   ║
╚═══════════════════════════════════════════════════╝
  `);
});

module.exports = app;


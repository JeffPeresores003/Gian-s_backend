'use strict';

require('dotenv').config();

const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');

const logger = require('./config/logger');
const authRoutes = require('./routes/authRoutes');
const productRoutes = require('./routes/productRoutes');
const orderRoutes = require('./routes/orderRoutes');
const inventoryRoutes = require('./routes/inventoryRoutes');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();

// ─── Security headers ────────────────────────────────────────────────────────
app.use(helmet());

// ─── CORS — strict allowlist ─────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow non-browser tools in development (e.g. Postman) when no origin header
      if (!origin && process.env.NODE_ENV !== 'production') return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      logger.warn('CORS blocked origin', { origin });
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  })
);

// ─── Rate limiting ────────────────────────────────────────────────────────────
app.use(
  '/api/auth/login',
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10,
    message: { message: 'Too many login attempts. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// ─── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

// ─── HTTP request logging ─────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
} else {
  app.use(
    morgan('combined', {
      stream: { write: (msg) => logger.info(msg.trim()) },
    })
  );
}

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// ─── Static — serve uploaded images ─────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api', productRoutes);
app.use('/api', orderRoutes);
app.use('/api', inventoryRoutes);

// ─── 404 handler ──────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ message: 'Resource not found.' }));

// ─── Global error handler ─────────────────────────────────────────────────────
app.use(errorHandler);

module.exports = app;

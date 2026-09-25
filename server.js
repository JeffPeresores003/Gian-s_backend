'use strict';

require('dotenv').config();

const app = require('./src/app');
const logger = require('./src/config/logger');

const PORT = parseInt(process.env.PORT, 10) || 5000;

const server = app.listen(PORT, () => {
  logger.info(`Gian's Cafe API running on port ${PORT} [${process.env.NODE_ENV}]`);
});

// Graceful shutdown
const shutdown = (signal) => {
  logger.info(`Received ${signal}. Shutting down gracefully.`);
  server.close(() => {
    logger.info('HTTP server closed.');
    process.exit(0);
  });

  // Force exit if not closed within 10 s
  setTimeout(() => {
    logger.error('Force shutdown after timeout.');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

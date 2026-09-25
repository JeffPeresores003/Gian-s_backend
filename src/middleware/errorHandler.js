'use strict';

const logger = require('../config/logger');

/**
 * Centralized error handler.
 * Logs detailed info server-side; returns only generic messages to the client.
 */
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;

  logger.error('Unhandled error', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  // Never expose internal details to the client
  const clientMessage =
    statusCode < 500
      ? err.message // Intentional 4xx messages are safe to surface
      : 'An unexpected error occurred. Please try again later.';

  return res.status(statusCode).json({ message: clientMessage });
};

module.exports = { errorHandler };

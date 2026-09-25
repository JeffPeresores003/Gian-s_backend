'use strict';

const jwt = require('jsonwebtoken');
const logger = require('../config/logger');

/**
 * Verifies the JWT stored in an HTTP-only cookie or Authorization header.
 * Attaches decoded user payload to req.user and req.admin.
 */
const authenticate = (req, res, next) => {
  let token = req.cookies?.adminToken;

  if (!token && req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ message: 'Authentication required. Please sign in.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    req.admin = decoded; // backward compatibility for existing controllers
    next();
  } catch (err) {
    logger.warn('JWT verification failed', { error: err.message });
    return res.status(401).json({ message: 'Invalid or expired session. Please sign in again.' });
  }
};

/**
 * Role-based access control middleware.
 * Usage: requireRole('admin') or requireRole('admin', 'cashier')
 */
const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      logger.warn('Access denied: insufficient permissions', {
        user: req.user?.username,
        role: req.user?.role,
        allowedRoles,
      });
      return res.status(403).json({ message: 'Access denied: insufficient permissions.' });
    }
    next();
  };
};

module.exports = { authenticate, requireRole };

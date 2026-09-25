'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const logger = require('../config/logger');

const COOKIE_NAME = 'adminToken';
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.COOKIE_SECURE === 'true',
  sameSite: 'strict',
  maxAge: 8 * 60 * 60 * 1000, // 8 hours
};

/**
 * POST /api/auth/login
 * Validates credentials via stored procedure, issues HTTP-only JWT cookie.
 */
const login = async (req, res, next) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required.' });
    }

    // Call stored procedure — never inline SQL
    const [rows] = await pool.execute('CALL sp_GetAdminByUsername(?)', [username]);
    const admin = rows[0]?.[0];

    if (!admin) {
      logger.warn('Login attempt for unknown username', { username });
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    const passwordMatch = await bcrypt.compare(password, admin.password_hash);

    if (!passwordMatch) {
      logger.warn('Failed login — bad password', { username });
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    const userRole = admin.role || 'admin';

    const token = jwt.sign(
      { id: admin.id, username: admin.username, role: userRole },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);
    logger.info('User login successful', { username, role: userRole });

    return res.status(200).json({
      message: 'Login successful.',
      role: userRole,
      username: admin.username,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/auth/logout
 * Clears the auth cookie.
 */
const logout = (req, res) => {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'strict' });
  return res.status(200).json({ message: 'Logged out successfully.' });
};

/**
 * GET /api/auth/me
 * Returns current authenticated admin info (used by frontend to check session).
 */
const me = (req, res) => {
  return res.status(200).json({
    id: req.admin.id,
    username: req.admin.username,
    role: req.admin.role,
  });
};

module.exports = { login, logout, me };

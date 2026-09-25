'use strict';

const { Router } = require('express');
const { body } = require('express-validator');
const { login, logout, me } = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');

const router = Router();

// POST /api/auth/login
router.post(
  '/login',
  [
    body('username').trim().notEmpty().withMessage('Username is required.'),
    body('password').notEmpty().withMessage('Password is required.'),
  ],
  login
);

// POST /api/auth/logout
router.post('/logout', authenticate, logout);

// GET /api/auth/me
router.get('/me', authenticate, me);

module.exports = router;

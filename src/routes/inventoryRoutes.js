'use strict';

const { Router } = require('express');
const {
  getStocks,
  createStock,
  updateStock,
  adjustStock,
  deleteStock,
} = require('../controllers/inventoryController');
const { authenticate, requireRole } = require('../middleware/auth');

const router = Router();

// View stocks (accessible by both admin & cashier)
router.get('/admin/inventory', authenticate, getStocks);

// Quick adjust (+/-)
router.patch('/admin/inventory/:id/adjust', authenticate, adjustStock);

// Admin-only mutation: create, update, delete
router.post('/admin/inventory', authenticate, requireRole('admin'), createStock);
router.put('/admin/inventory/:id', authenticate, requireRole('admin'), updateStock);
router.delete('/admin/inventory/:id', authenticate, requireRole('admin'), deleteStock);

module.exports = router;

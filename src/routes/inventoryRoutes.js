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

// Authentication required
router.use(authenticate);

// View stocks (accessible by both admin & cashier)
router.get('/admin/inventory', getStocks);

// Quick adjust (+/-)
router.patch('/admin/inventory/:id/adjust', adjustStock);

// Admin-only mutation: create, update, delete
router.post('/admin/inventory', requireRole('admin'), createStock);
router.put('/admin/inventory/:id', requireRole('admin'), updateStock);
router.delete('/admin/inventory/:id', requireRole('admin'), deleteStock);

module.exports = router;

'use strict';

const { Router } = require('express');
const {
  createOrder,
  getOrders,
  getOrderDetails,
  getSalesReport,
} = require('../controllers/orderController');
const {
  listOrders: adminListOrders,
  getOrder: adminGetOrder,
  updateOrder: adminUpdateOrder,
  refundOrder: adminRefundOrder,
} = require('../controllers/adminOrderController');
const { authenticate, requireRole } = require('../middleware/auth');

const router = Router();

// Reports (cashier + admin)
router.get('/reports/sales', authenticate, getSalesReport);

// Orders CRUD (cashier + admin)
router.post('/orders', authenticate, createOrder);
router.get('/orders', authenticate, getOrders);
router.get('/orders/:id', authenticate, getOrderDetails);

// Admin-only Order Management (Edit, Refund, Audit, Comprehensive History)
router.get('/admin/orders', authenticate, requireRole('admin'), adminListOrders);
router.get('/admin/orders/:id', authenticate, requireRole('admin'), adminGetOrder);
router.put('/admin/orders/:id', authenticate, requireRole('admin'), adminUpdateOrder);
router.post('/admin/orders/:id/refund', authenticate, requireRole('admin'), adminRefundOrder);

module.exports = router;


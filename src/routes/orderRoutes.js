'use strict';

const { Router } = require('express');
const {
  createOrder,
  getOrders,
  getOrderDetails,
  getSalesReport,
} = require('../controllers/orderController');
const { authenticate } = require('../middleware/auth');

const router = Router();

// All order & sales reporting routes require authenticated user (cashier or admin)
router.use(authenticate);

// Reports
router.get('/reports/sales', getSalesReport);

// Orders CRUD
router.post('/orders', createOrder);
router.get('/orders', getOrders);
router.get('/orders/:id', getOrderDetails);

module.exports = router;

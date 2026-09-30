'use strict';

const { Router } = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const {
  placeOnlineOrder,
  trackOrder,
  getPendingOrders,
  confirmOrder,
  cancelOrderByCashier,
  addUpdatedItem,
  getOnlineOrderHistory,
  getOnlineOrderReceipt,
  getConfirmedForRider,
  markToDeliver,
  verifyQR,
  markDelivered,
  cancelOrderByRider,
} = require('../controllers/onlineOrderController');

const router = Router();

// ── PUBLIC (no auth) ──────────────────────────────────────────
// Customer places an order
router.post('/online-orders', placeOnlineOrder);
// Customer tracks order by OTN
router.get('/online-orders/track/:otn', trackOrder);

// ── CASHIER + ADMIN ───────────────────────────────────────────
router.get(
  '/online-orders/pending',
  authenticate,
  requireRole('cashier', 'admin'),
  getPendingOrders
);
router.post(
  '/online-orders/:id/confirm',
  authenticate,
  requireRole('cashier', 'admin'),
  confirmOrder
);
router.post(
  '/online-orders/:id/cancel-cashier',
  authenticate,
  requireRole('cashier', 'admin'),
  cancelOrderByCashier
);
router.post(
  '/online-orders/:id/update-item',
  authenticate,
  requireRole('cashier', 'admin'),
  addUpdatedItem
);
router.get(
  '/online-orders/history',
  authenticate,
  requireRole('cashier', 'admin'),
  getOnlineOrderHistory
);
router.get(
  '/online-orders/:id/receipt',
  authenticate,
  requireRole('cashier', 'admin'),
  getOnlineOrderReceipt
);

// ── RIDER + ADMIN ─────────────────────────────────────────────
router.get(
  '/online-orders/rider/confirmed',
  authenticate,
  requireRole('rider', 'admin'),
  getConfirmedForRider
);
router.post(
  '/online-orders/:id/to-deliver',
  authenticate,
  requireRole('rider', 'admin'),
  markToDeliver
);
router.post(
  '/online-orders/verify-qr',
  authenticate,
  requireRole('rider', 'admin'),
  verifyQR
);
router.post(
  '/online-orders/deliver',
  authenticate,
  requireRole('rider', 'admin'),
  markDelivered
);
router.post(
  '/online-orders/:id/deliver',
  authenticate,
  requireRole('rider', 'admin'),
  markDelivered
);
router.post(
  '/online-orders/cancel-rider',
  authenticate,
  requireRole('rider', 'admin'),
  cancelOrderByRider
);
router.post(
  '/online-orders/:id/cancel-rider',
  authenticate,
  requireRole('rider', 'admin'),
  cancelOrderByRider
);

module.exports = router;

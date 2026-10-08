'use strict';

const pool = require('../config/db');
const logger = require('../config/logger');

/** "Fries" + "Cheese" => "Fries (Cheese)" (idempotent). */
const flavorLabel = (name, flavor) => {
  const f = typeof flavor === 'string' ? flavor.trim() : '';
  if (!f || String(name).endsWith(`(${f})`)) return name;
  return `${name} (${f})`;
};

// ─────────────────────────────────────────────────────────────
// CUSTOMER — POST /api/online-orders
// ─────────────────────────────────────────────────────────────
const placeOnlineOrder = async (req, res, next) => {
  try {
    const {
      customer_name,
      contact_number,
      delivery_address,
      delivery_fee = 0.00,
      items,
      total_amount,
      notes = null,
    } = req.body;

    if (!customer_name?.trim()) {
      return res.status(400).json({ message: 'Full name is required.' });
    }
    if (!contact_number?.trim()) {
      return res.status(400).json({ message: 'Contact number is required.' });
    }
    if (!delivery_address?.trim()) {
      return res.status(400).json({ message: 'Delivery address is required.' });
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Order must contain at least one item.' });
    }

    const total = parseFloat(total_amount);
    if (isNaN(total) || total <= 0) {
      return res.status(400).json({ message: 'Invalid total amount.' });
    }

    const fee = !isNaN(parseFloat(delivery_fee)) ? parseFloat(delivery_fee) : 0.00;

    // 1. Create order header via stored procedure (6 parameters: name, contact, address, delivery_fee, total, notes)
    const [orderRows] = await pool.execute(
      'CALL sp_PlaceOnlineOrder(?, ?, ?, ?, ?, ?)',
      [
        customer_name.trim(),
        contact_number.trim(),
        delivery_address.trim(),
        fee,
        total,
        notes || null,
      ]
    );

    const result = orderRows[0]?.[0];
    if (!result?.new_id) {
      throw new Error('Failed to create online order.');
    }

    const { new_id: newOrderId, order_number, qr_token } = result;

    // 2. Insert order items
    for (const item of items) {
      const unitPrice = parseFloat(item.price ?? item.unit_price);
      const qty = parseInt(item.quantity, 10) || 1;
      const subtotal = unitPrice * qty;

      await pool.execute('CALL sp_CreateOrderItem(?, ?, ?, ?, ?, ?)', [
        newOrderId,
        item.id ?? item.product_id ?? null,
        flavorLabel(item.name ?? item.product_name, item.flavor),
        unitPrice,
        qty,
        subtotal,
      ]);
    }

    logger.info('Online order placed', { orderId: newOrderId, order_number, total });

    return res.status(201).json({
      message: 'Order placed successfully.',
      order_number,
      qr_token,
      order_id: newOrderId,
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────
// CUSTOMER — GET /api/online-orders/track/:otn  (public)
// ─────────────────────────────────────────────────────────────
const trackOrder = async (req, res, next) => {
  try {
    const otn = req.params.otn?.trim().toUpperCase();
    if (!otn) {
      return res.status(400).json({ message: 'Order tracking number is required.' });
    }

    const [results] = await pool.execute('CALL sp_GetOnlineOrderByOTN(?)', [otn]);
    const order = results[0]?.[0];
    const items = results[1] || [];

    if (!order) {
      return res.status(404).json({ message: 'Order not found. Please check your OTN.' });
    }

    return res.status(200).json({ order: { ...order, items } });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────
// CASHIER — GET /api/online-orders/pending
// ─────────────────────────────────────────────────────────────
const getPendingOrders = async (req, res, next) => {
  try {
    const search = req.query.search?.trim() || null;
    const [rows] = await pool.execute('CALL sp_GetPendingOnlineOrders(?)', [search]);
    const orders = rows[0] || [];
    return res.status(200).json({ orders });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────
// CASHIER — POST /api/online-orders/:id/confirm
// ─────────────────────────────────────────────────────────────
const confirmOrder = async (req, res, next) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    if (!orderId || isNaN(orderId)) {
      return res.status(400).json({ message: 'Invalid order ID.' });
    }

    const { payment_method = 'cash', amount_paid } = req.body;
    const cashierName = req.user?.username || 'Cashier';

    const [rows] = await pool.execute('CALL sp_ConfirmOnlineOrder(?, ?, ?, ?)', [
      orderId,
      cashierName,
      payment_method,
      amount_paid ? parseFloat(amount_paid) : null,
    ]);

    const order = rows[0]?.[0];
    if (!order) {
      return res.status(404).json({ message: 'Order not found.' });
    }

    logger.info('Online order confirmed', { orderId, cashier: cashierName });
    return res.status(200).json({ message: 'Order confirmed.', order });
  } catch (err) {
    if (err.message?.includes('not in pending')) {
      return res.status(409).json({ message: 'Order is not in pending status.' });
    }
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────
// CASHIER — POST /api/online-orders/:id/cancel-cashier
// ─────────────────────────────────────────────────────────────
const cancelOrderByCashier = async (req, res, next) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    if (!orderId || isNaN(orderId)) {
      return res.status(400).json({ message: 'Invalid order ID.' });
    }

    const cashierName = req.user?.username || 'Cashier';
    const [rows] = await pool.execute('CALL sp_CancelOnlineOrderByCashier(?, ?)', [
      orderId,
      cashierName,
    ]);

    const order = rows[0]?.[0];
    logger.info('Online order cancelled by cashier', { orderId, cashier: cashierName });
    return res.status(200).json({ message: 'Order cancelled.', order });
  } catch (err) {
    if (err.message?.includes('cannot be cancelled')) {
      return res.status(409).json({ message: 'Order cannot be cancelled at this stage.' });
    }
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────
// CASHIER — POST /api/online-orders/:id/update-item
// ─────────────────────────────────────────────────────────────
const addUpdatedItem = async (req, res, next) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    if (!orderId || isNaN(orderId)) {
      return res.status(400).json({ message: 'Invalid order ID.' });
    }

    const { product_id, product_name, unit_price, quantity } = req.body;

    if (!product_name?.trim()) {
      return res.status(400).json({ message: 'Product name is required.' });
    }
    const price = parseFloat(unit_price);
    const qty = parseInt(quantity, 10) || 1;
    if (isNaN(price) || price < 0) {
      return res.status(400).json({ message: 'Invalid unit price.' });
    }

    const subtotal = price * qty;
    const [rows] = await pool.execute('CALL sp_AddUpdatedOrderItem(?, ?, ?, ?, ?, ?)', [
      orderId,
      product_id ?? null,
      product_name.trim(),
      price,
      qty,
      subtotal,
    ]);

    const result = rows[0]?.[0];
    logger.info('Item updated on online order', { orderId, product_name });
    return res.status(200).json({ message: 'Item added to order.', order: result });
  } catch (err) {
    if (err.message?.includes('pending orders')) {
      return res.status(409).json({ message: 'Order updates are only allowed on pending orders.' });
    }
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────
// CASHIER — GET /api/online-orders/history
// ─────────────────────────────────────────────────────────────
const getOnlineOrderHistory = async (req, res, next) => {
  try {
    const limit = Math.min(100, parseInt(req.query.limit, 10) || 50);
    const search = req.query.search?.trim() || null;
    const date = req.query.date?.trim() || null;

    const [rows] = await pool.execute('CALL sp_GetOnlineOrderHistory(?, ?, ?)', [
      limit,
      search,
      date,
    ]);
    const orders = rows[0] || [];
    return res.status(200).json({ orders });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────
// CASHIER — GET /api/online-orders/:id/receipt
// ─────────────────────────────────────────────────────────────
const getOnlineOrderReceipt = async (req, res, next) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    if (!orderId || isNaN(orderId)) {
      return res.status(400).json({ message: 'Invalid order ID.' });
    }

    const [results] = await pool.execute('CALL sp_GetOnlineOrderReceipt(?)', [orderId]);
    const order = results[0]?.[0];
    const items = results[1] || [];

    if (!order) {
      return res.status(404).json({ message: 'Order not found.' });
    }

    return res.status(200).json({ order: { ...order, items } });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────
// RIDER — GET /api/online-orders/rider/confirmed
// ─────────────────────────────────────────────────────────────
const getConfirmedForRider = async (req, res, next) => {
  try {
    const search = req.query.search?.trim() || null;
    const [rows] = await pool.execute('CALL sp_GetConfirmedOrdersForRider(?)', [search]);
    const orders = rows[0] || [];
    return res.status(200).json({ orders });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────
// RIDER — POST /api/online-orders/:id/to-deliver
// ─────────────────────────────────────────────────────────────
const markToDeliver = async (req, res, next) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    if (!orderId || isNaN(orderId)) {
      return res.status(400).json({ message: 'Invalid order ID.' });
    }

    const riderName = req.user?.username || 'Rider';
    const [rows] = await pool.execute('CALL sp_MarkOrderToDeliver(?, ?)', [orderId, riderName]);
    const order = rows[0]?.[0];

    logger.info('Order marked to_deliver', { orderId, rider: riderName });
    return res.status(200).json({ message: 'Order is now out for delivery.', order });
  } catch (err) {
    if (err.message?.includes('must be confirmed')) {
      return res.status(409).json({ message: 'Order must be confirmed before marking as out for delivery.' });
    }
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────
// RIDER — POST /api/online-orders/verify-qr
// Verifies QR token, OTN, or customer name and returns full order+items
// so rider can review before confirming delivery or cancelling.
// ─────────────────────────────────────────────────────────────
const verifyQR = async (req, res, next) => {
  try {
    let query = (
      req.body.query ||
      req.body.search ||
      req.body.qr_token ||
      req.body.order_number ||
      req.body.order_id ||
      ''
    ).toString().trim();

    if (!query) {
      return res.status(400).json({ message: 'QR token, OTN code, or customer name is required.' });
    }

    // Smart parse QR payloads (JSON objects, URLs, tokens)
    try {
      if (query.startsWith('{') && query.endsWith('}')) {
        const parsed = JSON.parse(query);
        query = (parsed.qr_token || parsed.order_number || parsed.otn || parsed.id || query).toString().trim();
      } else if (query.includes('/track/')) {
        query = query.split('/track/').pop().split(/[?#]/)[0].trim();
      } else if (query.includes('token=')) {
        const match = query.match(/token=([^&]+)/);
        if (match) query = decodeURIComponent(match[1]).trim();
      }
    } catch {}

    const [results] = await pool.execute('CALL sp_VerifyQRToken(?)', [query]);
    const order = results[0]?.[0];
    const items = results[1] || [];

    if (!order) {
      return res.status(404).json({ message: `No active delivery found matching "${query}".` });
    }

    return res.status(200).json({ order: { ...order, items } });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────
// RIDER — POST /api/online-orders/deliver (or /online-orders/:id/deliver)
// Marks order as delivered after QR scan or manual confirmation.
// ─────────────────────────────────────────────────────────────
const markDelivered = async (req, res, next) => {
  try {
    const identifier = (
      req.body.qr_token ||
      req.body.order_number ||
      req.body.order_id ||
      req.params.id ||
      ''
    ).toString().trim();

    if (!identifier) {
      return res.status(400).json({ message: 'Order identifier (QR token, OTN, or order ID) is required.' });
    }

    const riderName = req.user?.username || 'Rider';
    const [rows] = await pool.execute('CALL sp_MarkOrderDelivered(?, ?)', [
      identifier,
      riderName,
    ]);

    const order = rows[0]?.[0];
    logger.info('Order marked delivered', { identifier, rider: riderName });
    return res.status(200).json({ message: 'Order delivered successfully.', order });
  } catch (err) {
    if (err.message?.includes('not found') || err.message?.includes('Invalid')) {
      return res.status(404).json({ message: 'Order not found.' });
    }
    if (err.message?.includes('status') || err.message?.includes('already')) {
      return res.status(409).json({ message: err.message });
    }
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────
// RIDER — POST /api/online-orders/cancel-rider (or /online-orders/:id/cancel-rider)
// Cancels order on-site via QR scan or manual confirmation.
// ─────────────────────────────────────────────────────────────
const cancelOrderByRider = async (req, res, next) => {
  try {
    const identifier = (
      req.body.qr_token ||
      req.body.order_number ||
      req.body.order_id ||
      req.params.id ||
      ''
    ).toString().trim();

    if (!identifier) {
      return res.status(400).json({ message: 'Order identifier is required.' });
    }

    const riderName = req.user?.username || 'Rider';
    const [rows] = await pool.execute('CALL sp_CancelOrderByRider(?, ?)', [
      identifier,
      riderName,
    ]);

    const order = rows[0]?.[0];
    logger.info('Order cancelled by rider', { identifier, rider: riderName });
    return res.status(200).json({ message: 'Order cancelled.', order });
  } catch (err) {
    if (err.message?.includes('not found') || err.message?.includes('Invalid')) {
      return res.status(404).json({ message: 'Order not found.' });
    }
    if (err.message?.includes('cannot be cancelled')) {
      return res.status(409).json({ message: 'Order cannot be cancelled at this stage.' });
    }
    next(err);
  }
};

module.exports = {
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
};

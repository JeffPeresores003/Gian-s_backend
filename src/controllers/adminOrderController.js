'use strict';

/**
 * Admin-only Order Management
 *  - List all orders (POS + online) with sales/refund summary
 *  - View an order with its items and audit trail
 *  - Edit a placed order (fix wrong items, quantities, prices, discount, payment)
 *  - Refund an order (full, partial, or "missed discount" refund)
 *
 * All changes write to the shared `orders` / `order_items` tables, so the
 * Cashier POS history, receipts, and Sales Reports reflect them instantly.
 */

const pool = require('../config/db');
const logger = require('../config/logger');
const { isAdminSchemaReady } = require('../config/ensureSchema');
const { SALE_FILTER } = require('./orderController');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PAYMENT_METHODS = ['cash', 'gcash', 'card'];
const POS_TYPES = ['dine-in', 'take-out'];
const DISCOUNT_TAG_RE = /^\s*\[([^\]]*?)\s*\(-₱([\d.,]+)\)\]\s*/;

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const adminName = (req) => req.user?.username || 'Admin';

const isSale = (o) =>
  (o.order_type !== 'online' && o.status === 'completed') ||
  (o.order_type === 'online' && o.status === 'delivered');

const writeAudit = async (conn, { orderId, action, amount = null, reason = null, details = null, by }) => {
  if (!isAdminSchemaReady()) return;
  await conn.query(
    `INSERT INTO order_audit_log (order_id, action, amount, reason, details, performed_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [orderId, action, amount, reason, details ? JSON.stringify(details) : null, by]
  );
};

// ─────────────────────────────────────────────────────────────
// GET /api/admin/orders
// ?date=YYYY-MM-DD &search= &type=all|dine-in|take-out|online
// &status=all|sales|refunded|edited|cancelled|unpaid
// ─────────────────────────────────────────────────────────────
const listOrders = async (req, res, next) => {
  try {
    const limit = Math.min(500, parseInt(req.query.limit, 10) || 200);
    const date = req.query.date?.trim();
    const search = req.query.search?.trim();
    const type = req.query.type?.trim();
    const status = req.query.status?.trim();
    const ready = isAdminSchemaReady();

    const where = [];
    const params = [];
    if (date && DATE_RE.test(date)) {
      where.push('DATE(o.created_at) = ?');
      params.push(date);
    }
    if (search) {
      where.push('(o.order_number LIKE ? OR o.customer_name LIKE ? OR o.contact_number LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (type && type !== 'all') {
      where.push('o.order_type = ?');
      params.push(type);
    }
    if (status === 'sales') where.push(SALE_FILTER);
    if (status === 'cancelled') where.push("o.status = 'cancelled'");
    if (status === 'unpaid') {
      where.push("o.order_type = 'online' AND o.status IN ('pending', 'confirmed', 'to_deliver')");
    }
    if (status === 'refunded') {
      where.push(ready ? "(o.status = 'refunded' OR o.refund_amount > 0)" : "o.status = 'refunded'");
    }
    if (status === 'edited') where.push(ready ? 'o.edited_at IS NOT NULL' : '1 = 0');

    const [orders] = await pool.query(
      `SELECT o.*,
              (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count,
              (SELECT IFNULL(SUM(oi.quantity), 0) FROM order_items oi WHERE oi.order_id = o.id) AS item_qty
         FROM orders o
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY o.created_at DESC
        LIMIT ${limit}`,
      params
    );

    // Summary for the returned set (only "sale" orders count toward revenue)
    const summary = orders.reduce(
      (acc, o) => {
        const total = Number(o.total_amount) || 0;
        const refund = Number(o.refund_amount) || 0;
        acc.refunds += refund;
        if (isSale(o)) {
          acc.gross += total;
          acc.net += total - refund;
          acc.sales_count += 1;
        } else if (o.status === 'refunded') {
          acc.gross += total;
        }
        if (o.order_type === 'online' && ['pending', 'confirmed', 'to_deliver'].includes(o.status)) {
          acc.unpaid_online += 1;
        }
        return acc;
      },
      { gross: 0, refunds: 0, net: 0, sales_count: 0, unpaid_online: 0 }
    );

    return res.json({
      orders,
      summary: {
        ...summary,
        gross: round2(summary.gross),
        refunds: round2(summary.refunds),
        net: round2(summary.net),
        total_count: orders.length,
      },
      features: { refunds: ready, audit: ready },
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/admin/orders/:id
// ─────────────────────────────────────────────────────────────
const getOrder = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ message: 'Invalid order ID.' });

    const [[order]] = await pool.query('SELECT * FROM orders WHERE id = ? LIMIT 1', [id]);
    if (!order) return res.status(404).json({ message: 'Order not found.' });

    const [items] = await pool.query(
      `SELECT oi.*, p.category
         FROM order_items oi
         LEFT JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = ?
        ORDER BY oi.is_updated ASC, oi.id ASC`,
      [id]
    ).catch(async () =>
      // is_updated column may not exist on very old schemas
      pool.query(
        `SELECT oi.*, p.category FROM order_items oi
           LEFT JOIN products p ON p.id = oi.product_id
          WHERE oi.order_id = ? ORDER BY oi.id ASC`,
        [id]
      )
    );

    let audit = [];
    if (isAdminSchemaReady()) {
      const [rows] = await pool.query(
        'SELECT * FROM order_audit_log WHERE order_id = ? ORDER BY created_at DESC, id DESC',
        [id]
      );
      audit = rows;
    }

    return res.json({ order: { ...order, items }, audit });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────
// PUT /api/admin/orders/:id
// Body: { customer_name, order_type, payment_method, amount_paid?,
//         items: [{ product_id, product_name, unit_price, quantity }],
//         discount: { type: 'percent'|'fixed', value, label } | null,
//         notes, reason }
// ─────────────────────────────────────────────────────────────
const updateOrder = async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ message: 'Invalid order ID.' });

  const {
    customer_name,
    order_type,
    payment_method,
    amount_paid,
    items,
    discount = null,
    notes = '',
    reason = '',
  } = req.body || {};

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: 'An order must have at least one item.' });
  }
  if (!String(reason).trim()) {
    return res.status(400).json({ message: 'Please enter a reason for editing this order.' });
  }

  // Validate & normalise items
  const cleanItems = [];
  for (const it of items) {
    const name = String(it.product_name || it.name || '').trim();
    const price = round2(parseFloat(it.unit_price ?? it.price));
    const qty = parseInt(it.quantity, 10);
    if (!name) return res.status(400).json({ message: 'Every item needs a name.' });
    if (isNaN(price) || price < 0) return res.status(400).json({ message: `Invalid price for "${name}".` });
    if (!qty || qty < 1) return res.status(400).json({ message: `Invalid quantity for "${name}".` });
    cleanItems.push({
      product_id: it.product_id ? parseInt(it.product_id, 10) || null : null,
      product_name: name,
      unit_price: price,
      quantity: qty,
      subtotal: round2(price * qty),
      is_updated: it.is_updated ? 1 : 0,
    });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[order]] = await conn.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [id]);
    if (!order) {
      await conn.rollback();
      return res.status(404).json({ message: 'Order not found.' });
    }
    if (['cancelled', 'refunded'].includes(order.status)) {
      await conn.rollback();
      return res.status(400).json({ message: `A ${order.status} order can no longer be edited.` });
    }

    const [oldItems] = await conn.query('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', [id]);

    // Totals
    const subtotal = round2(cleanItems.reduce((s, i) => s + i.subtotal, 0));
    let discountAmount = 0;
    let discountLabel = '';
    if (discount && Number(discount.value) > 0) {
      const val = parseFloat(discount.value);
      if (discount.type === 'percent') {
        discountAmount = round2(Math.min(subtotal, (subtotal * Math.min(val, 100)) / 100));
        discountLabel = String(discount.label || `${val}% OFF`).trim();
      } else {
        discountAmount = round2(Math.min(subtotal, val));
        discountLabel = String(discount.label || `₱${val} OFF`).trim();
      }
    }
    const deliveryFee = order.order_type === 'online' ? Number(order.delivery_fee) || 0 : 0;
    const newTotal = round2(Math.max(0, subtotal - discountAmount + deliveryFee));

    const alreadyRefunded = Number(order.refund_amount) || 0;
    if (alreadyRefunded > newTotal + 0.001) {
      await conn.rollback();
      return res.status(400).json({
        message: `New total (₱${newTotal.toFixed(2)}) cannot be lower than the amount already refunded (₱${alreadyRefunded.toFixed(2)}).`,
      });
    }

    // Order type: online orders stay online; POS orders can switch dine-in / take-out
    const newType =
      order.order_type === 'online'
        ? 'online'
        : POS_TYPES.includes(order_type)
        ? order_type
        : order.order_type;

    const isUnpaidOnline =
      order.order_type === 'online' && ['pending'].includes(order.status);
    let newMethod = PAYMENT_METHODS.includes(payment_method) ? payment_method : order.payment_method;
    if (isUnpaidOnline && !PAYMENT_METHODS.includes(payment_method)) newMethod = order.payment_method;

    // Payment
    let newPaid;
    if (isUnpaidOnline) {
      newPaid = Number(order.amount_paid) || 0; // not paid yet
    } else if (newMethod !== 'cash') {
      newPaid = newTotal;
    } else if (amount_paid !== undefined && amount_paid !== null && amount_paid !== '') {
      newPaid = round2(parseFloat(amount_paid));
      if (isNaN(newPaid) || newPaid < newTotal) {
        await conn.rollback();
        return res.status(400).json({ message: 'Cash tendered must be at least the new total.' });
      }
    } else {
      newPaid = round2(Math.max(Number(order.amount_paid) || 0, newTotal));
    }
    const newChange = isUnpaidOnline ? 0 : round2(Math.max(0, newPaid - newTotal));

    // Notes: keep the same "[LABEL (-₱X)] note" format the POS uses
    const cleanNotes = String(notes || '').replace(DISCOUNT_TAG_RE, '').trim();
    const newNotes = discountAmount > 0
      ? `[${discountLabel} (-₱${discountAmount.toFixed(2)})] ${cleanNotes}`.trim()
      : cleanNotes || null;

    const sets = [
      'customer_name = ?',
      'order_type = ?',
      'payment_method = ?',
      'total_amount = ?',
      'amount_paid = ?',
      'change_amount = ?',
      'notes = ?',
    ];
    const vals = [
      String(customer_name || order.customer_name || 'Guest').trim() || 'Guest',
      newType,
      newMethod,
      newTotal,
      newPaid,
      newChange,
      newNotes,
    ];
    if (isAdminSchemaReady()) {
      sets.push('edited_at = NOW()', 'edited_by = ?');
      vals.push(adminName(req));
    }
    vals.push(id);
    await conn.query(`UPDATE orders SET ${sets.join(', ')} WHERE id = ?`, vals);

    // Replace items
    await conn.query('DELETE FROM order_items WHERE order_id = ?', [id]);
    for (const it of cleanItems) {
      await conn.query(
        `INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, subtotal${
          'is_updated' in (oldItems[0] || {}) ? ', is_updated' : ''
        })
         VALUES (?, ?, ?, ?, ?, ?${'is_updated' in (oldItems[0] || {}) ? ', ?' : ''})`,
        [
          id,
          it.product_id,
          it.product_name,
          it.unit_price,
          it.quantity,
          it.subtotal,
          ...('is_updated' in (oldItems[0] || {}) ? [it.is_updated] : []),
        ]
      );
    }

    await writeAudit(conn, {
      orderId: id,
      action: 'edit',
      amount: round2(newTotal - Number(order.total_amount)),
      reason: String(reason).trim(),
      by: adminName(req),
      details: {
        before: {
          total: Number(order.total_amount),
          payment_method: order.payment_method,
          items: oldItems.map((i) => ({ name: i.product_name, qty: i.quantity, price: Number(i.unit_price) })),
        },
        after: {
          total: newTotal,
          payment_method: newMethod,
          discount: discountAmount > 0 ? { label: discountLabel, amount: discountAmount } : null,
          items: cleanItems.map((i) => ({ name: i.product_name, qty: i.quantity, price: i.unit_price })),
        },
      },
    });

    await conn.commit();
    logger.info('Admin edited order', { orderId: id, by: adminName(req), newTotal });

    return res.json({
      message: 'Order updated successfully.',
      order: { id, total_amount: newTotal, amount_paid: newPaid, change_amount: newChange },
    });
  } catch (err) {
    await conn.rollback().catch(() => {});
    next(err);
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────────────────────
// POST /api/admin/orders/:id/refund
// Body: { mode: 'full'|'partial'|'discount', amount?, reason,
//         discount?: { type, value, label } }
// ─────────────────────────────────────────────────────────────
const refundOrder = async (req, res, next) => {
  if (!isAdminSchemaReady()) {
    return res.status(503).json({
      message: 'Refunds need a one-time database upgrade. Run database/admin_order_management.sql, then restart the API.',
    });
  }

  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ message: 'Invalid order ID.' });

  const { mode = 'partial', amount, reason = '', discount = null } = req.body || {};
  if (!String(reason).trim() && mode !== 'discount') {
    return res.status(400).json({ message: 'Please enter a reason for the refund.' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[order]] = await conn.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [id]);
    if (!order) {
      await conn.rollback();
      return res.status(404).json({ message: 'Order not found.' });
    }
    if (!isSale(order)) {
      await conn.rollback();
      return res.status(400).json({
        message:
          order.order_type === 'online'
            ? 'Only delivered online orders can be refunded.'
            : `This order is ${order.status} and cannot be refunded.`,
      });
    }

    const total = Number(order.total_amount) || 0;
    const already = Number(order.refund_amount) || 0;
    const remaining = round2(total - already);
    if (remaining <= 0) {
      await conn.rollback();
      return res.status(400).json({ message: 'This order has already been fully refunded.' });
    }

    let refund = 0;
    let finalReason = String(reason).trim();

    if (mode === 'full') {
      refund = remaining;
    } else if (mode === 'discount') {
      const [items] = await conn.query('SELECT subtotal FROM order_items WHERE order_id = ?', [id]);
      const subtotal = items.length > 0
        ? items.reduce((s, i) => s + Number(i.subtotal), 0)
        : Number(order.total_amount) || 0;
      const val = parseFloat(discount?.value);
      if (!val || val <= 0) {
        await conn.rollback();
        return res.status(400).json({ message: 'Choose a valid discount to refund.' });
      }
      refund =
        discount.type === 'percent'
          ? round2((subtotal * Math.min(val, 100)) / 100)
          : round2(val);
      const label = String(discount.label || (discount.type === 'percent' ? `${val}% OFF` : `₱${val} OFF`)).trim();
      finalReason = `Missed discount: ${label}${finalReason ? ` — ${finalReason}` : ''}`;
    } else {
      refund = round2(parseFloat(amount));
    }

    if (!refund || refund <= 0) {
      await conn.rollback();
      return res.status(400).json({ message: 'Refund amount must be greater than zero.' });
    }
    if (refund > remaining + 0.001) {
      await conn.rollback();
      return res.status(400).json({
        message: `Refund (₱${refund.toFixed(2)}) exceeds the refundable balance (₱${remaining.toFixed(2)}).`,
      });
    }

    const newRefund = round2(already + refund);
    const fullyRefunded = newRefund >= total - 0.001;
    const mergedReason = order.refund_reason ? `${order.refund_reason} | ${finalReason}` : finalReason;

    await conn.query(
      `UPDATE orders
          SET refund_amount = ?, refund_reason = ?, refunded_at = NOW(), refunded_by = ?
              ${fullyRefunded ? ", status = 'refunded'" : ''}
        WHERE id = ?`,
      [newRefund, mergedReason, adminName(req), id]
    );

    await writeAudit(conn, {
      orderId: id,
      action: fullyRefunded ? 'refund_full' : mode === 'discount' ? 'refund_discount' : 'refund_partial',
      amount: refund,
      reason: finalReason,
      by: adminName(req),
      details: { previous_status: order.status, refund_total: newRefund, order_total: total },
    });

    await conn.commit();
    logger.info('Admin refunded order', { orderId: id, refund, by: adminName(req) });

    return res.json({
      message: fullyRefunded
        ? `Order fully refunded (₱${refund.toFixed(2)}).`
        : `Refunded ₱${refund.toFixed(2)}. Net sale is now ₱${(total - newRefund).toFixed(2)}.`,
      order: { id, refund_amount: newRefund, status: fullyRefunded ? 'refunded' : order.status },
    });
  } catch (err) {
    await conn.rollback().catch(() => {});
    next(err);
  } finally {
    conn.release();
  }
};

module.exports = { listOrders, getOrder, updateOrder, refundOrder };

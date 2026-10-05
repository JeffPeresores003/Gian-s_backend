'use strict';

const pool = require('../config/db');
const logger = require('../config/logger');
const { isAdminSchemaReady } = require('../config/ensureSchema');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Which orders count as a SALE:
 *  - POS orders that are 'completed'
 *  - Online orders ONLY when the rider has marked them 'delivered'
 * ('refunded', 'cancelled', 'pending', 'confirmed', 'to_deliver' never count)
 */
const SALE_FILTER =
  "((IFNULL(o.order_type, '') <> 'online' AND o.status = 'completed') OR (o.order_type = 'online' AND o.status = 'delivered'))";

/** Net revenue per order (total minus any partial refund). */
const netExpr = () =>
  isAdminSchemaReady() ? '(o.total_amount - IFNULL(o.refund_amount, 0))' : 'o.total_amount';

/**
 * Generates human-friendly order reference code
 * Example: GC-0925-1042
 */
const generateOrderNumber = () => {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `GC-${mm}${dd}-${rand}`;
};

/**
 * POST /api/orders
 * Accepts customer orders at the counter (Cashier POS)
 */
const createOrder = async (req, res, next) => {
  try {
    const {
      customer_name,
      order_type = 'dine-in',
      items,
      total_amount,
      amount_paid,
      change_amount = 0,
      payment_method = 'cash',
      notes = '',
    } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Order must contain at least one item.' });
    }

    const total = parseFloat(total_amount);
    const paid = parseFloat(amount_paid);

    if (isNaN(total) || total < 0) {
      return res.status(400).json({ message: 'Invalid total amount.' });
    }

    if (isNaN(paid) || paid < total) {
      return res.status(400).json({ message: 'Amount paid must be greater than or equal to total amount.' });
    }

    const calculatedChange = Math.max(0, paid - total);
    const orderNumber = generateOrderNumber();
    const cashierName = req.user?.username || 'Cashier';

    // 1. Create order header
    const [orderRows] = await pool.execute(
      'CALL sp_CreateOrder(?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        orderNumber,
        customer_name || 'Guest',
        order_type,
        total,
        paid,
        calculatedChange,
        payment_method,
        cashierName,
        notes || null,
      ]
    );

    const newOrderId = orderRows[0]?.[0]?.new_id;
    if (!newOrderId) {
      throw new Error('Failed to retrieve newly created order ID.');
    }

    // 2. Insert order items
    for (const item of items) {
      const unitPrice = parseFloat(item.price || item.unit_price);
      const qty = parseInt(item.quantity, 10) || 1;
      const subtotal = unitPrice * qty;

      await pool.execute(
        'CALL sp_CreateOrderItem(?, ?, ?, ?, ?, ?)',
        [
          newOrderId,
          item.id || item.product_id || null,
          item.name || item.product_name,
          unitPrice,
          qty,
          subtotal,
        ]
      );
    }

    logger.info('New order created at counter', {
      orderId: newOrderId,
      orderNumber,
      total,
      cashier: cashierName,
    });

    return res.status(201).json({
      message: 'Order created successfully.',
      order: {
        id: newOrderId,
        order_number: orderNumber,
        customer_name: customer_name || 'Guest',
        order_type,
        total_amount: total,
        amount_paid: paid,
        change_amount: calculatedChange,
        payment_method,
        cashier_name: cashierName,
        item_count: items.length,
        created_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/orders
 * Returns recent orders with optional search and date filters.
 * Uses o.* so cashier screens also see admin edits / refunds.
 */
const getOrders = async (req, res, next) => {
  try {
    const limit = Math.min(200, parseInt(req.query.limit, 10) || 50);
    const search = req.query.search?.trim() || null;
    const date = req.query.date?.trim() || null; // YYYY-MM-DD

    const where = [];
    const params = [];
    if (search) {
      where.push('(o.order_number LIKE ? OR o.customer_name LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
    if (date && DATE_RE.test(date)) {
      where.push('DATE(o.created_at) = ?');
      params.push(date);
    }

    const [orders] = await pool.query(
      `SELECT o.*,
              (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
         FROM orders o
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY o.created_at DESC
        LIMIT ${limit}`,
      params
    );

    return res.status(200).json({ orders });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/orders/:id
 * Returns single order header and all line items
 */
const getOrderDetails = async (req, res, next) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    if (!orderId || isNaN(orderId)) {
      return res.status(400).json({ message: 'Invalid order ID.' });
    }

    const [[order]] = await pool.query('SELECT * FROM orders WHERE id = ? LIMIT 1', [orderId]);
    if (!order) {
      return res.status(404).json({ message: 'Order not found.' });
    }
    const [items] = await pool.query(
      'SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC',
      [orderId]
    );

    return res.status(200).json({ order: { ...order, items } });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/reports/sales
 * Returns day, week, month, and year sales summary and breakdowns.
 *
 * Sales rules:
 *  - Counter (POS) orders count when status = 'completed'.
 *  - Online orders count ONLY once the rider marks them 'delivered'.
 *  - Fully refunded orders (status = 'refunded') are excluded and partial
 *    refunds are subtracted, so revenue is always NET.
 */
const getSalesReport = async (req, res, next) => {
  try {
    const rawDate = req.query.date?.trim();
    const [[{ d: targetDate }]] = await pool.query(
      "SELECT DATE_FORMAT(IFNULL(STR_TO_DATE(?, '%Y-%m-%d'), CURDATE()), '%Y-%m-%d') AS d",
      [rawDate && DATE_RE.test(rawDate) ? rawDate : null]
    );

    const NET = netExpr();
    const SALE = SALE_FILTER;
    const inMonth = 'YEAR(o.created_at) = YEAR(?) AND MONTH(o.created_at) = MONTH(?)';
    const inYear = 'YEAR(o.created_at) = YEAR(?)';
    const inWeek =
      'DATE(o.created_at) BETWEEN DATE_SUB(?, INTERVAL WEEKDAY(?) DAY) AND DATE_ADD(DATE_SUB(?, INTERVAL WEEKDAY(?) DAY), INTERVAL 6 DAY)';
    const summary = (alias) =>
      `IFNULL(SUM(${NET}), 0) AS ${alias}_revenue, COUNT(*) AS ${alias}_orders, IFNULL(AVG(${NET}), 0) AS ${alias}_avg_ticket`;

    const D = targetDate;
    const q = (sql, params) => pool.query(sql, params).then(([rows]) => rows);

    const catSql = (filter) =>
      `SELECT COALESCE(p.category, 'General') AS category,
              IFNULL(SUM(oi.quantity), 0) AS items_sold, IFNULL(SUM(oi.subtotal), 0) AS total
         FROM order_items oi
         JOIN orders o ON oi.order_id = o.id
         LEFT JOIN products p ON oi.product_id = p.id
        WHERE ${filter} AND ${SALE}
        GROUP BY COALESCE(p.category, 'General')`;

    const prodSql = (filter) =>
      `SELECT COALESCE(p.category, 'General') AS category,
              oi.product_name,
              IFNULL(SUM(oi.quantity), 0) AS qty_sold,
              COUNT(DISTINCT o.id) AS order_count,
              IFNULL(SUM(oi.subtotal), 0) AS total
         FROM order_items oi
         JOIN orders o ON oi.order_id = o.id
         LEFT JOIN products p ON oi.product_id = p.id
        WHERE ${filter} AND ${SALE}
        GROUP BY COALESCE(p.category, 'General'), oi.product_name
        ORDER BY qty_sold DESC, total DESC`;

    const [
      dayRows,
      monthRows,
      yearRows,
      dailyBreakdown,
      monthlyBreakdown,
      weekRows,
      paymentMethods,
      orderTypes,
      paymentDaily,
      categoryDay,
      categoryMonth,
      categoryYear,
      productDay,
      productMonth,
      productYear,
    ] = await Promise.all([
      q(`SELECT ${summary('day')} FROM orders o WHERE DATE(o.created_at) = ? AND ${SALE}`, [D]),
      q(`SELECT ${summary('month')} FROM orders o WHERE ${inMonth} AND ${SALE}`, [D, D]),
      q(`SELECT ${summary('year')} FROM orders o WHERE ${inYear} AND ${SALE}`, [D]),
      q(
        `SELECT DATE_FORMAT(DATE(o.created_at), '%Y-%m-%d') AS sale_date,
                COUNT(*) AS orders_count, IFNULL(SUM(${NET}), 0) AS revenue
           FROM orders o WHERE ${inMonth} AND ${SALE}
          GROUP BY DATE(o.created_at) ORDER BY sale_date DESC`,
        [D, D]
      ),
      q(
        `SELECT MONTH(o.created_at) AS sale_month,
                COUNT(*) AS orders_count, IFNULL(SUM(${NET}), 0) AS revenue
           FROM orders o WHERE ${inYear} AND ${SALE}
          GROUP BY MONTH(o.created_at) ORDER BY sale_month DESC`,
        [D]
      ),
      q(`SELECT ${summary('week')} FROM orders o WHERE ${inWeek} AND ${SALE}`, [D, D, D, D]),
      q(
        `SELECT o.payment_method, COUNT(*) AS count, IFNULL(SUM(${NET}), 0) AS total
           FROM orders o WHERE ${inMonth} AND ${SALE}
          GROUP BY o.payment_method`,
        [D, D]
      ),
      q(
        `SELECT o.order_type, COUNT(*) AS count, IFNULL(SUM(${NET}), 0) AS total
           FROM orders o WHERE ${inMonth} AND ${SALE}
          GROUP BY o.order_type`,
        [D, D]
      ),
      q(
        `SELECT DATE_FORMAT(DATE(o.created_at), '%Y-%m-%d') AS sale_date,
                o.payment_method, COUNT(*) AS count, IFNULL(SUM(${NET}), 0) AS total
           FROM orders o WHERE ${inMonth} AND ${SALE}
          GROUP BY DATE(o.created_at), o.payment_method
          ORDER BY sale_date DESC`,
        [D, D]
      ),
      q(catSql('DATE(o.created_at) = ?'), [D]),
      q(catSql(inMonth), [D, D]),
      q(catSql(inYear), [D]),
      q(prodSql('DATE(o.created_at) = ?'), [D]),
      q(prodSql(inMonth), [D, D]),
      q(prodSql(inYear), [D]),
    ]);

    const num = (v) => parseFloat(v || 0);
    const int = (v) => parseInt(v || 0, 10);
    const day = dayRows[0] || {};
    const week = weekRows[0] || {};
    const month = monthRows[0] || {};
    const year = yearRows[0] || {};

    const mapCat = (cat) => ({
      category: cat.category,
      items_sold: int(cat.items_sold),
      total: num(cat.total),
    });

    const mapProd = (p) => ({
      category: p.category,
      product_name: p.product_name,
      qty_sold: int(p.qty_sold),
      order_count: int(p.order_count),
      total: num(p.total),
    });

    return res.status(200).json({
      report_date: targetDate,
      day: { revenue: num(day.day_revenue), orders: int(day.day_orders), avg_ticket: num(day.day_avg_ticket) },
      week: { revenue: num(week.week_revenue), orders: int(week.week_orders), avg_ticket: num(week.week_avg_ticket) },
      month: { revenue: num(month.month_revenue), orders: int(month.month_orders), avg_ticket: num(month.month_avg_ticket) },
      year: { revenue: num(year.year_revenue), orders: int(year.year_orders), avg_ticket: num(year.year_avg_ticket) },
      daily_breakdown: dailyBreakdown,
      monthly_breakdown: monthlyBreakdown,
      payment_methods: paymentMethods.map((pm) => ({
        method: pm.payment_method || 'unknown',
        count: int(pm.count),
        total: num(pm.total),
      })),
      category_breakdown: categoryMonth.map(mapCat),
      category_breakdown_daily: categoryDay.map(mapCat),
      category_breakdown_monthly: categoryMonth.map(mapCat),
      category_breakdown_yearly: categoryYear.map(mapCat),
      order_types: orderTypes.map((ot) => ({
        type: ot.order_type,
        count: int(ot.count),
        total: num(ot.total),
      })),
      product_breakdown: productMonth.map(mapProd),
      product_breakdown_daily: productDay.map(mapProd),
      product_breakdown_monthly: productMonth.map(mapProd),
      product_breakdown_yearly: productYear.map(mapProd),
      payment_daily: paymentDaily.map((p) => ({
        sale_date: p.sale_date,
        method: p.payment_method || 'unknown',
        count: int(p.count),
        total: num(p.total),
      })),
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createOrder,
  getOrders,
  getOrderDetails,
  getSalesReport,
  SALE_FILTER,
  netExpr,
};


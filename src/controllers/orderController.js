'use strict';

const pool = require('../config/db');
const logger = require('../config/logger');

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
 * Returns recent orders with optional search and date filters
 */
const getOrders = async (req, res, next) => {
  try {
    const limit = Math.min(100, parseInt(req.query.limit, 10) || 50);
    const search = req.query.search?.trim() || null;
    const date = req.query.date?.trim() || null; // YYYY-MM-DD

    const [rows] = await pool.execute('CALL sp_GetOrders(?, ?, ?)', [
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

    const [results] = await pool.execute('CALL sp_GetOrderDetails(?)', [orderId]);
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

/**
 * GET /api/reports/sales
 * Returns day, month, and year sales summary and breakdowns
 */
const getSalesReport = async (req, res, next) => {
  try {
    const targetDate = req.query.date?.trim() || null; // YYYY-MM-DD

    const [results] = await pool.execute('CALL sp_GetSalesReportSummary(?)', [targetDate]);

    const daySummary = results[0]?.[0] || { day_revenue: 0, day_orders: 0, day_avg_ticket: 0 };
    const monthSummary = results[1]?.[0] || { month_revenue: 0, month_orders: 0, month_avg_ticket: 0 };
    const yearSummary = results[2]?.[0] || { year_revenue: 0, year_orders: 0, year_avg_ticket: 0 };
    const dailyBreakdown = results[3] || [];
    const monthlyBreakdown = results[4] || [];
    const weekSummary = results[5]?.[0] || { week_revenue: 0, week_orders: 0, week_avg_ticket: 0 };
    const paymentMethods = results[6] || [];
    const categoryBreakdown = results[7] || [];
    const orderTypes = results[8] || [];

    return res.status(200).json({
      day: {
        revenue: parseFloat(daySummary.day_revenue || 0),
        orders: parseInt(daySummary.day_orders || 0, 10),
        avg_ticket: parseFloat(daySummary.day_avg_ticket || 0),
      },
      week: {
        revenue: parseFloat(weekSummary.week_revenue || 0),
        orders: parseInt(weekSummary.week_orders || 0, 10),
        avg_ticket: parseFloat(weekSummary.week_avg_ticket || 0),
      },
      month: {
        revenue: parseFloat(monthSummary.month_revenue || 0),
        orders: parseInt(monthSummary.month_orders || 0, 10),
        avg_ticket: parseFloat(monthSummary.month_avg_ticket || 0),
      },
      year: {
        revenue: parseFloat(yearSummary.year_revenue || 0),
        orders: parseInt(yearSummary.year_orders || 0, 10),
        avg_ticket: parseFloat(yearSummary.year_avg_ticket || 0),
      },
      daily_breakdown: dailyBreakdown,
      monthly_breakdown: monthlyBreakdown,
      payment_methods: paymentMethods.map((pm) => ({
        method: pm.payment_method,
        count: parseInt(pm.count || 0, 10),
        total: parseFloat(pm.total || 0),
      })),
      category_breakdown: categoryBreakdown.map((cat) => ({
        category: cat.category,
        items_sold: parseInt(cat.items_sold || 0, 10),
        total: parseFloat(cat.total || 0),
      })),
      order_types: orderTypes.map((ot) => ({
        type: ot.order_type,
        count: parseInt(ot.count || 0, 10),
        total: parseFloat(ot.total || 0),
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
};

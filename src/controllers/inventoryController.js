'use strict';

const pool = require('../config/db');
const logger = require('../config/logger');

/**
 * GET /api/admin/inventory
 * Returns all raw inventory stock items (milk, coffee beans, patties, fries, etc.)
 */
const getStocks = async (req, res, next) => {
  try {
    const [rows] = await pool.execute('CALL sp_GetInventoryStocks()');
    const stocks = rows[0] || [];
    return res.status(200).json({ stocks });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/admin/inventory
 * Admin: Add new raw stock item
 */
const createStock = async (req, res, next) => {
  try {
    const {
      item_name,
      category = 'General',
      quantity = 0,
      unit = 'Pieces',
      min_quantity = 5,
      cost_per_unit = null,
      notes = null,
    } = req.body;

    if (!item_name || !item_name.trim()) {
      return res.status(400).json({ message: 'Stock item name is required.' });
    }

    if (!unit || !unit.trim()) {
      return res.status(400).json({ message: 'Unit (e.g. Liters, kg, Pieces, Cans) is required.' });
    }

    const [rows] = await pool.execute(
      'CALL sp_CreateInventoryStock(?, ?, ?, ?, ?, ?, ?)',
      [
        item_name.trim(),
        category.trim(),
        parseFloat(quantity) || 0,
        unit.trim(),
        parseFloat(min_quantity) || 5,
        cost_per_unit !== null && cost_per_unit !== '' ? parseFloat(cost_per_unit) : null,
        notes?.trim() || null,
      ]
    );

    const newId = rows[0]?.[0]?.new_id;
    logger.info('Stock item created', { newId, item_name });

    return res.status(201).json({ message: 'Stock item added successfully.', id: newId });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/admin/inventory/:id
 * Admin: Update raw stock item details
 */
const updateStock = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id || isNaN(id)) {
      return res.status(400).json({ message: 'Invalid stock ID.' });
    }

    const {
      item_name,
      category = 'General',
      quantity = 0,
      unit = 'Pieces',
      min_quantity = 5,
      cost_per_unit = null,
      notes = null,
    } = req.body;

    if (!item_name || !item_name.trim()) {
      return res.status(400).json({ message: 'Stock item name is required.' });
    }

    await pool.execute(
      'CALL sp_UpdateInventoryStock(?, ?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        item_name.trim(),
        category.trim(),
        parseFloat(quantity) || 0,
        unit.trim(),
        parseFloat(min_quantity) || 5,
        cost_per_unit !== null && cost_per_unit !== '' ? parseFloat(cost_per_unit) : null,
        notes?.trim() || null,
      ]
    );

    logger.info('Stock item updated', { id, item_name });
    return res.status(200).json({ message: 'Stock item updated successfully.' });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/admin/inventory/:id/adjust
 * Quick adjust stock quantity (+delta or -delta)
 */
const adjustStock = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { delta } = req.body;

    const numDelta = parseFloat(delta);
    if (isNaN(numDelta) || numDelta === 0) {
      return res.status(400).json({ message: 'A valid non-zero delta is required (e.g. +5 or -2).' });
    }

    const [rows] = await pool.execute('CALL sp_AdjustStockQuantity(?, ?)', [id, numDelta]);
    const updated = rows[0]?.[0];

    logger.info('Stock quantity adjusted', { id, delta: numDelta });
    return res.status(200).json({ message: 'Stock quantity updated.', stock: updated });
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/admin/inventory/:id
 * Admin: Delete raw stock item
 */
const deleteStock = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id || isNaN(id)) {
      return res.status(400).json({ message: 'Invalid stock ID.' });
    }

    await pool.execute('CALL sp_DeleteInventoryStock(?)', [id]);
    logger.info('Stock item deleted', { id });

    return res.status(200).json({ message: 'Stock item removed successfully.' });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getStocks,
  createStock,
  updateStock,
  adjustStock,
  deleteStock,
};

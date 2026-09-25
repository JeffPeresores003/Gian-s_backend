'use strict';

const pool = require('../config/db');
const logger = require('../config/logger');

/**
 * GET /api/products
 * Public — returns only available products.
 * Supports optional query params: ?search=&category=&minPrice=&maxPrice=
 */
const getPublicProducts = async (req, res, next) => {
  try {
    const { search = '', category = '', minPrice, maxPrice } = req.query;

    const [rows] = await pool.execute('CALL sp_GetPublicProducts(?, ?, ?, ?)', [
      search || null,
      category || null,
      minPrice != null ? parseFloat(minPrice) : null,
      maxPrice != null ? parseFloat(maxPrice) : null,
    ]);

    return res.status(200).json({ products: rows[0] });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/admin/products
 * Admin — returns ALL products (available + unavailable).
 */
const getAllProducts = async (req, res, next) => {
  try {
    const [rows] = await pool.execute('CALL sp_GetAllProducts()');
    return res.status(200).json({ products: rows[0] });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/admin/products
 * Admin — add a new product.
 */
const createProduct = async (req, res, next) => {
  try {
    const { name, description, price, category, image_url, is_available } = req.body;

    if (!name || price == null || !category) {
      return res.status(400).json({ message: 'Name, price, and category are required.' });
    }

    const [rows] = await pool.execute('CALL sp_CreateProduct(?, ?, ?, ?, ?, ?)', [
      name,
      description || null,
      parseFloat(price),
      category,
      image_url || null,
      is_available !== undefined ? Boolean(is_available) : true,
    ]);

    const newProductId = rows[0]?.[0]?.new_id;
    logger.info('Product created', { id: newProductId, name });

    return res.status(201).json({ message: 'Product created.', id: newProductId });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/admin/products/:id
 * Admin — update a product.
 */
const updateProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, description, price, category, image_url, is_available } = req.body;

    if (!name || price == null || !category) {
      return res.status(400).json({ message: 'Name, price, and category are required.' });
    }

    await pool.execute('CALL sp_UpdateProduct(?, ?, ?, ?, ?, ?, ?)', [
      parseInt(id, 10),
      name,
      description || null,
      parseFloat(price),
      category,
      image_url || null,
      is_available !== undefined ? Boolean(is_available) : true,
    ]);

    logger.info('Product updated', { id });
    return res.status(200).json({ message: 'Product updated.' });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/admin/products/:id/availability
 * Admin — toggle product availability.
 */
const toggleAvailability = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { is_available } = req.body;

    if (is_available === undefined) {
      return res.status(400).json({ message: 'is_available field is required.' });
    }

    await pool.execute('CALL sp_ToggleProductAvailability(?, ?)', [
      parseInt(id, 10),
      Boolean(is_available),
    ]);

    logger.info('Product availability toggled', { id, is_available });
    return res.status(200).json({ message: 'Availability updated.' });
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/admin/products/:id
 * Admin — delete a product.
 */
const deleteProduct = async (req, res, next) => {
  try {
    const { id } = req.params;

    await pool.execute('CALL sp_DeleteProduct(?)', [parseInt(id, 10)]);

    logger.info('Product deleted', { id });
    return res.status(200).json({ message: 'Product deleted.' });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/categories
 * Public — returns all distinct categories.
 */
const getCategories = async (req, res, next) => {
  try {
    const [rows] = await pool.execute('CALL sp_GetCategories()');
    return res.status(200).json({ categories: rows[0] });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getPublicProducts,
  getAllProducts,
  createProduct,
  updateProduct,
  toggleAvailability,
  deleteProduct,
  getCategories,
};

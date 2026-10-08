'use strict';

const pool = require('../config/db');
const logger = require('../config/logger');

/** Normalise incoming flavors into [{ name, available }] (deduped, trimmed). */
const normalizeFlavors = (input) => {
  let list = input;
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch { list = []; }
  }
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const f of list) {
    const name = String(typeof f === 'string' ? f : f?.name ?? '').trim().slice(0, 50);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({ name, available: typeof f === 'object' && f.available !== undefined ? Boolean(f.available) : true });
  }
  return out;
};

const saveFlavors = async (id, flavors) => {
  const list = normalizeFlavors(flavors);
  await pool.query('UPDATE products SET flavors = ? WHERE id = ?', [
    list.length ? JSON.stringify(list) : null,
    id,
  ]);
};

const saveCostPrice = async (id, cost_price) => {
  const cp = Math.max(0, parseFloat(cost_price) || 0);
  await pool.query('UPDATE products SET cost_price = ? WHERE id = ?', [cp, id]);
};

/** Attach parsed `flavors` arrays and `cost_price` to product rows. */
const attachFlavors = async (products) => {
  if (!products?.length) return products || [];
  try {
    const [rows] = await pool.query('SELECT id, flavors, cost_price FROM products');
    const map = new Map(
      rows.map((r) => [
        r.id,
        {
          flavors: normalizeFlavors(r.flavors),
          cost_price: parseFloat(r.cost_price || 0),
        },
      ])
    );
    return products.map((p) => {
      const meta = map.get(p.id);
      return {
        ...p,
        cost_price: meta ? meta.cost_price : parseFloat(p.cost_price || 0),
        flavors: meta ? meta.flavors : [],
      };
    });
  } catch (err) {
    logger.warn('attachFlavors failed', { error: err.message });
    return products.map((p) => ({
      ...p,
      cost_price: parseFloat(p.cost_price || 0),
      flavors: [],
    }));
  }
};

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

    return res.status(200).json({ products: await attachFlavors(rows[0]) });
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
    return res.status(200).json({ products: await attachFlavors(rows[0]) });
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
    const { name, description, price, category, image_url, is_available, flavors, cost_price } = req.body;

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
    if (newProductId) {
      if (flavors !== undefined) await saveFlavors(newProductId, flavors);
      if (cost_price !== undefined) await saveCostPrice(newProductId, cost_price);
    }
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
    const { name, description, price, category, image_url, is_available, flavors, cost_price } = req.body;

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

    if (flavors !== undefined) await saveFlavors(parseInt(id, 10), flavors);
    if (cost_price !== undefined) await saveCostPrice(parseInt(id, 10), cost_price);

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

/**
 * PATCH /api/admin/products/:id/pricing
 * Admin — quick update for cost_price and/or price.
 */
const updatePricing = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { cost_price, price } = req.body;
    const prodId = parseInt(id, 10);

    const updates = [];
    const params = [];

    if (cost_price !== undefined && cost_price !== null && cost_price !== '') {
      updates.push('cost_price = ?');
      params.push(Math.max(0, parseFloat(cost_price) || 0));
    }
    if (price !== undefined && price !== null && price !== '') {
      updates.push('price = ?');
      params.push(Math.max(0, parseFloat(price) || 0));
    }

    if (updates.length > 0) {
      params.push(prodId);
      await pool.query(`UPDATE products SET ${updates.join(', ')} WHERE id = ?`, params);
    }

    const [rows] = await pool.query('SELECT * FROM products WHERE id = ?', [prodId]);
    const updated = (await attachFlavors(rows))[0];

    logger.info('Product pricing updated', { id: prodId, cost_price, price });
    return res.status(200).json({ message: 'Pricing updated successfully.', product: updated });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getPublicProducts,
  getAllProducts,
  createProduct,
  updateProduct,
  updatePricing,
  toggleAvailability,
  deleteProduct,
  getCategories,
};

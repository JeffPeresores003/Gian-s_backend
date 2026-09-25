'use strict';

const { Router } = require('express');
const { body, param } = require('express-validator');
const {
  getPublicProducts,
  getAllProducts,
  createProduct,
  updateProduct,
  toggleAvailability,
  deleteProduct,
  getCategories,
} = require('../controllers/productController');
const { authenticate } = require('../middleware/auth');
const { upload } = require('../middleware/upload');
const { uploadImage, deleteImage } = require('../controllers/uploadController');

const router = Router();

// ---------- Public routes ----------

// GET /api/products  — available products only
router.get('/products', getPublicProducts);

// GET /api/categories
router.get('/categories', getCategories);

// ---------- Admin routes (all require authentication) ----------

// GET /api/admin/products  — all products
router.get('/admin/products', authenticate, getAllProducts);

// POST /api/admin/products
router.post(
  '/admin/products',
  authenticate,
  [
    body('name').trim().notEmpty().withMessage('Name is required.'),
    body('price').isFloat({ min: 0 }).withMessage('Price must be a non-negative number.'),
    body('category').trim().notEmpty().withMessage('Category is required.'),
    body('image_url').optional({ nullable: true }).isURL().withMessage('Invalid image URL.'),
  ],
  createProduct
);

// PUT /api/admin/products/:id
router.put(
  '/admin/products/:id',
  authenticate,
  [
    param('id').isInt({ min: 1 }).withMessage('Invalid product ID.'),
    body('name').trim().notEmpty().withMessage('Name is required.'),
    body('price').isFloat({ min: 0 }).withMessage('Price must be a non-negative number.'),
    body('category').trim().notEmpty().withMessage('Category is required.'),
    body('image_url').optional({ nullable: true }).isURL().withMessage('Invalid image URL.'),
  ],
  updateProduct
);

// PATCH /api/admin/products/:id/availability
router.patch(
  '/admin/products/:id/availability',
  authenticate,
  [
    param('id').isInt({ min: 1 }).withMessage('Invalid product ID.'),
    body('is_available').isBoolean().withMessage('is_available must be a boolean.'),
  ],
  toggleAvailability
);

// DELETE /api/admin/products/:id
router.delete(
  '/admin/products/:id',
  authenticate,
  [param('id').isInt({ min: 1 }).withMessage('Invalid product ID.')],
  deleteProduct
);

// POST /api/admin/upload  — upload product image (multipart/form-data, field: 'image')
router.post('/admin/upload', authenticate, upload.single('image'), uploadImage);

// DELETE /api/admin/upload/:filename
router.delete('/admin/upload/:filename', authenticate, deleteImage);

module.exports = router;

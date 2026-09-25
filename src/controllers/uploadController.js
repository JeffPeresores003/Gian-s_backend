'use strict';

const path = require('path');
const fs = require('fs');
const logger = require('../config/logger');
const { uploadsDir } = require('../middleware/upload');

/**
 * POST /api/admin/upload
 * Admin — upload a product image. Returns the public URL.
 */
const uploadImage = (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No image file provided.' });
    }

    // Build the public URL (served from /uploads/* via Express static)
    const imageUrl = `/uploads/${req.file.filename}`;
    logger.info('Image uploaded', { filename: req.file.filename });

    return res.status(200).json({ image_url: imageUrl, filename: req.file.filename });
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/admin/upload/:filename
 * Admin — delete an uploaded image file.
 */
const deleteImage = (req, res, next) => {
  try {
    const { filename } = req.params;

    // Prevent directory traversal
    const safeFilename = path.basename(filename);
    const filePath = path.join(uploadsDir, safeFilename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: 'Image not found.' });
    }

    fs.unlinkSync(filePath);
    logger.info('Image deleted', { filename: safeFilename });

    return res.status(200).json({ message: 'Image deleted.' });
  } catch (err) {
    next(err);
  }
};

module.exports = { uploadImage, deleteImage };

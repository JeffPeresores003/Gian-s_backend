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

    // Use the API host for local file reference
    const imageUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;

    // Read image buffer to generate a permanent base64 data URI
    // This ensures product images are stored safely inside Hostinger MySQL (MEDIUMTEXT)
    // and never disappear when cloud hosts (like Render) restart or wipe ephemeral disks.
    let persistentDataUrl = imageUrl;
    try {
      const fileBuffer = fs.readFileSync(req.file.path);
      const mimeType = req.file.mimetype || 'image/jpeg';
      persistentDataUrl = `data:${mimeType};base64,${fileBuffer.toString('base64')}`;
    } catch (e) {
      logger.warn('Could not read uploaded file to base64, using relative URL', { error: e.message });
    }

    logger.info('Image uploaded', { filename: req.file.filename });

    return res.status(200).json({
      image_url: persistentDataUrl,
      local_url: imageUrl,
      filename: req.file.filename,
    });
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

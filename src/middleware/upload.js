'use strict';

const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `product-${uniqueSuffix}${ext}`);
  },
});

// Only allow image files
const fileFilter = (_req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|webp|gif|avif/;
  const extOk = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimeOk = allowedTypes.test(file.mimetype.split('/')[1]);

  if (extOk && mimeOk) {
    cb(null, true);
  } else {
    cb(new Error('Only image files (JPEG, PNG, WebP, GIF, AVIF) are allowed.'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
});

module.exports = { upload, uploadsDir };

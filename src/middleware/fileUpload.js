/**
 * File Upload Middleware
 * Configures multer for handling multipart form data
 */

const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir = process.env.UPLOAD_DIR || './uploads';

// Ensure upload directory exists
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Storage configuration for local filesystem
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const productId = req.params.id || req.body.productId;
    const dir = path.join(uploadDir, 'products', productId);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    cb(null, dir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename: img-{timestamp}-{random}.ext
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname);
    cb(null, `img-${uniqueSuffix}${ext}`);
  },
});

// File filter to allow only images
const fileFilter = (req, file, cb) => {
  const allowedMimes = (process.env.ALLOWED_MIME_TYPES || 'image/jpeg,image/png,image/webp').split(',');

  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type: ${file.mimetype}. Allowed: ${allowedMimes.join(', ')}`));
  }
};

// Multer upload middleware
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE || '5242880'), // 5MB default
    files: parseInt(process.env.MAX_FILES_PER_PRODUCT || '10'),
  },
});

module.exports = { upload, uploadDir };

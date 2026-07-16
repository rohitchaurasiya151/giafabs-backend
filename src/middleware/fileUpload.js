/**
 * File Upload Middleware
 * Configures multer to buffer uploads in memory so they can be streamed
 * straight to Cloudinary without ever touching local disk.
 */

const multer = require('multer');
const config = require('../config');

const storage = multer.memoryStorage();

// File filter to allow only images
const fileFilter = (req, file, cb) => {
  const allowedMimes = config.storage.allowedMimeTypes;

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
    fileSize: config.storage.maxFileSize,
    files: config.storage.maxFilesPerProduct,
  },
});

module.exports = { upload };

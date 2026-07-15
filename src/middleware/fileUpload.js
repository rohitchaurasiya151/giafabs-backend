/**
 * File Upload Middleware
 * Configures multer to buffer uploads in memory so they can be streamed
 * straight to Cloudinary without ever touching local disk.
 */

const multer = require('multer');

const storage = multer.memoryStorage();

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

module.exports = { upload };

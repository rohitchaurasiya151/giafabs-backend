/**
 * Image Validation Middleware
 * Validates image dimensions, file signatures, and MIME types directly
 * from the in-memory upload buffer (no disk writes).
 */

const sharp = require('sharp');
const config = require('../config');

/**
 * Check magic bytes (file signature) to prevent MIME type spoofing
 */
function validateMagicBytes(buffer) {
  const hex = buffer.subarray(0, 12).toString('hex');

  // JPEG: FF D8 FF
  if (hex.startsWith('ffd8ff')) return true;
  // PNG: 89 50 4E 47
  if (hex.startsWith('89504e47')) return true;
  // WebP: RIFF ... WEBP
  if (hex.startsWith('52494646') && hex.includes('57454250')) return true;

  return false;
}

/**
 * Middleware to validate uploaded images
 */
async function validateImageFiles(req, res, next) {
  if (!req.files || req.files.length === 0) {
    return next(); // No files to validate
  }

  try {
    for (const file of req.files) {
      // 1. Validate magic bytes
      if (!validateMagicBytes(file.buffer)) {
        return res.status(422).json({
          success: false,
          error: {
            code: 'INVALID_FILE_SIGNATURE',
            message: `File ${file.originalname} has invalid signature. Possible malicious file.`,
          },
        });
      }

      // 2. Validate dimensions using sharp
      try {
        const metadata = await sharp(file.buffer).metadata();

        const minWidth = config.storage.minImageWidth;
        const minHeight = config.storage.minImageHeight;

        if (metadata.width < minWidth || metadata.height < minHeight) {
          return res.status(422).json({
            success: false,
            error: {
              code: 'INVALID_IMAGE_DIMENSIONS',
              message: `Image must be at least ${minWidth}x${minHeight}px. Received: ${metadata.width}x${metadata.height}px`,
            },
          });
        }
      } catch (err) {
        return res.status(422).json({
          success: false,
          error: {
            code: 'IMAGE_PROCESSING_ERROR',
            message: `Failed to process image: ${err.message}`,
          },
        });
      }
    }

    next();
  } catch (error) {
    next(error);
  }
}

module.exports = { validateImageFiles, validateMagicBytes };

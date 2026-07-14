/**
 * Image Validation Middleware
 * Validates image dimensions, file signatures, and MIME types
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

/**
 * Check magic bytes (file signature) to prevent MIME type spoofing
 */
async function validateMagicBytes(filePath) {
  const fd = await fs.promises.open(filePath, 'r');
  const buffer = Buffer.alloc(12);
  await fd.read(buffer, 0, 12, 0);
  await fd.close();

  const hex = buffer.toString('hex');

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
      const isValidSignature = await validateMagicBytes(file.path);
      if (!isValidSignature) {
        // Delete the file
        await fs.promises.unlink(file.path);
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
        const metadata = await sharp(file.path).metadata();

        const minWidth = parseInt(process.env.MIN_IMAGE_WIDTH || '300');
        const minHeight = parseInt(process.env.MIN_IMAGE_HEIGHT || '300');

        if (metadata.width < minWidth || metadata.height < minHeight) {
          await fs.promises.unlink(file.path);
          return res.status(422).json({
            success: false,
            error: {
              code: 'INVALID_IMAGE_DIMENSIONS',
              message: `Image must be at least ${minWidth}x${minHeight}px. Received: ${metadata.width}x${metadata.height}px`,
            },
          });
        }

        // Store metadata in request for later use
        if (!req.fileMetadata) req.fileMetadata = {};
        req.fileMetadata[file.filename] = metadata;
      } catch (err) {
        await fs.promises.unlink(file.path);
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

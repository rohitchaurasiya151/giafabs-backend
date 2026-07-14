/**
 * Image Routes
 * Admin endpoints: POST/GET/DELETE/PATCH images
 * Public endpoints: GET images for product display
 */

const express = require('express');
const router = express.Router();
const ImageController = require('../controllers/imageController');
const { upload } = require('../middleware/fileUpload');
const { validateImageFiles } = require('../middleware/validateImage');
const { rateLimit } = require('../../core');

// Rate limiter for image uploads (10 per hour per user)
const uploadLimiter = (req, res, next) => {
  const userId = req.user?.id || req.ip;
  const isAllowed = rateLimit(userId, 10, 60 * 60 * 1000); // 10 uploads per hour
  if (!isAllowed) {
    return res.status(429).json({
      success: false,
      error: { code: 'RATE_LIMIT', message: 'Too many uploads. Max 10 per hour.' },
    });
  }
  next();
};

// ─────────── ADMIN ENDPOINTS (require auth) ───────────

/**
 * POST /api/images/admin/products/:id/upload
 * Upload images for a product
 */
router.post(
  '/admin/products/:id/upload',
  // requireAdmin('MANAGE_PRODUCTS'), // TODO: Add auth middleware
  uploadLimiter,
  upload.array('files', 10),
  validateImageFiles,
  ImageController.uploadImages
);

/**
 * GET /api/images/admin/products/:id
 * List all images for a product (admin view)
 */
router.get(
  '/admin/products/:id',
  // requireAdmin('VIEW_PRODUCTS'), // TODO: Add auth middleware
  ImageController.getProductImages
);

/**
 * DELETE /api/images/admin/products/:id/:imageId
 * Delete a specific image
 */
router.delete(
  '/admin/products/:id/:imageId',
  // requireAdmin('MANAGE_PRODUCTS'), // TODO: Add auth middleware
  ImageController.deleteImage
);

/**
 * PATCH /api/images/admin/products/:id/:imageId
 * Update image metadata
 */
router.patch(
  '/admin/products/:id/:imageId',
  // requireAdmin('MANAGE_PRODUCTS'), // TODO: Add auth middleware
  ImageController.updateImageMetadata
);

/**
 * POST /api/images/admin/products/:id/reorder
 * Reorder images in gallery
 */
router.post(
  '/admin/products/:id/reorder',
  // requireAdmin('MANAGE_PRODUCTS'), // TODO: Add auth middleware
  ImageController.reorderImages
);

/**
 * GET /api/images/admin/stats
 * Get image storage statistics
 */
router.get(
  '/admin/stats',
  // requireAdmin('VIEW_ANALYTICS'), // TODO: Add auth middleware
  ImageController.getImageStats
);

// ─────────── PUBLIC ENDPOINTS (no auth required) ───────────

/**
 * GET /api/images/products/:id
 * Get images for a product (customer view - optimized)
 */
router.get('/products/:id', async (req, res, next) => {
  try {
    const { id: productId } = req.params;

    if (!productId) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_PRODUCT_ID', message: 'Product ID is required' },
      });
    }

    const images = await ImageController.getProductImages(req, res, next);
  } catch (error) {
    next(error);
  }
});

module.exports = router;

/**
 * Image Controller
 * Handles image upload, deletion, and metadata management endpoints
 */

const ImageService = require('../services/imageService');
const { genId } = require('../../core');

class ImageController {
  /**
   * POST /api/admin/products/:id/images
   * Upload images for a product
   */
  static async uploadImages(req, res, next) {
    try {
      const { id: productId } = req.params;
      const files = req.files || [];

      // Validate product exists (TODO: add product service check)
      if (!productId) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_PRODUCT_ID', message: 'Product ID is required' },
        });
      }

      if (files.length === 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'NO_FILES', message: 'No files provided' },
        });
      }

      // Process each uploaded file
      const processedImages = [];
      const errors = [];

      // multer/busboy gives a plain string for a single field value and an
      // array only when the same field name repeats — normalize to an array
      // so indexing by file position is safe either way.
      const altTexts = req.body.alt_texts === undefined
        ? []
        : Array.isArray(req.body.alt_texts) ? req.body.alt_texts : [req.body.alt_texts];

      for (let i = 0; i < files.length; i++) {
        try {
          const file = files[i];
          const altText = altTexts[i] || '';

          const image = await ImageService.processUploadedImage(file, productId, altText);
          processedImages.push(image);
        } catch (error) {
          errors.push({
            file: files[i].originalname,
            error: error.message,
          });
        }
      }

      // If no images processed successfully, return error
      if (processedImages.length === 0) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'UPLOAD_FAILED',
            message: 'Failed to process any images',
            details: errors,
          },
        });
      }

      // Audit log
      if (req.user) {
        // TODO: Log to audit table
        // audit(req.user.id, 'UPLOAD_IMAGES', `product:${productId}`, { count: processedImages.length })
      }

      res.status(200).json({
        success: true,
        message: `${processedImages.length} image(s) uploaded successfully${errors.length > 0 ? `, ${errors.length} failed` : ''}`,
        data: {
          productId,
          images: processedImages,
          uploadedCount: processedImages.length,
          failedCount: errors.length,
          errors: errors.length > 0 ? errors : undefined,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/admin/products/:id/images
   * List all images for a product (admin view)
   */
  static async getProductImages(req, res, next) {
    try {
      const { id: productId } = req.params;

      if (!productId) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_PRODUCT_ID', message: 'Product ID is required' },
        });
      }

      const images = await ImageService.getProductImages(productId);

      res.status(200).json({
        success: true,
        data: {
          productId,
          images,
          total: images.length,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/admin/products/:id/images/:imageId
   * Delete a specific image
   */
  static async deleteImage(req, res, next) {
    try {
      const { id: productId, imageId } = req.params;

      if (!productId || !imageId) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_PARAMS', message: 'Product ID and Image ID are required' },
        });
      }

      const result = await ImageService.deleteImage(imageId, productId);

      // Audit log
      if (req.user) {
        // TODO: audit(req.user.id, 'DELETE_IMAGE', imageId, { productId })
      }

      res.status(200).json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      if (error.message === 'Image not found') {
        return res.status(404).json({
          success: false,
          error: { code: 'IMAGE_NOT_FOUND', message: error.message },
        });
      }
      next(error);
    }
  }

  /**
   * PATCH /api/admin/products/:id/images/:imageId
   * Update image metadata (alt text, order)
   */
  static async updateImageMetadata(req, res, next) {
    try {
      const { id: productId, imageId } = req.params;
      const { alt_text, display_order } = req.body;

      if (!productId || !imageId) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_PARAMS', message: 'Product ID and Image ID are required' },
        });
      }

      if (!alt_text && display_order === undefined) {
        return res.status(400).json({
          success: false,
          error: { code: 'NO_UPDATES', message: 'Provide alt_text or display_order to update' },
        });
      }

      const updatedImage = await ImageService.updateImageMetadata(imageId, productId, {
        alt_text,
        display_order,
      });

      if (!updatedImage) {
        return res.status(404).json({
          success: false,
          error: { code: 'IMAGE_NOT_FOUND', message: 'Image not found' },
        });
      }

      res.status(200).json({
        success: true,
        data: updatedImage,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/admin/products/:id/images/reorder
   * Reorder images in gallery
   */
  static async reorderImages(req, res, next) {
    try {
      const { id: productId } = req.params;
      const { order } = req.body;

      if (!productId) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_PRODUCT_ID', message: 'Product ID is required' },
        });
      }

      if (!order || !Array.isArray(order) || order.length === 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_ORDER', message: 'Provide an array of image IDs in desired order' },
        });
      }

      const result = await ImageService.reorderImages(productId, order);

      res.status(200).json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      if (error.message.includes('Invalid image IDs')) {
        return res.status(422).json({
          success: false,
          error: { code: 'INVALID_IMAGE_IDS', message: error.message },
        });
      }
      next(error);
    }
  }

  /**
   * GET /api/admin/images/stats
   * Get image storage statistics
   */
  static async getImageStats(req, res, next) {
    try {
      const stats = await ImageService.getImageStats();

      res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = ImageController;

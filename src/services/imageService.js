/**
 * Image Service
 * Handles image processing, optimization, and storage
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { query, queryOne } = require('../config/database');
const { genId } = require('../../core');

const uploadDir = process.env.UPLOAD_DIR || './uploads';
const enableOptimization = process.env.ENABLE_IMAGE_OPTIMIZATION === 'true';
const thumbWidth = parseInt(process.env.THUMBNAIL_WIDTH || '150');
const thumbHeight = parseInt(process.env.THUMBNAIL_HEIGHT || '150');
const mobileWidth = parseInt(process.env.MOBILE_WIDTH || '600');
const jpegQuality = parseInt(process.env.JPEG_QUALITY || '80');

class ImageService {
  /**
   * Process and store uploaded image variants
   * Generates: original, thumbnail, mobile
   */
  static async processUploadedImage(file, productId, altText = '') {
    try {
      const fileName = path.basename(file.path);
      const fileNameWithoutExt = path.parse(fileName).name;
      const productDir = path.join(uploadDir, 'products', productId);

      // 1. Process original image (optimize if enabled)
      const originalBuffer = await fs.promises.readFile(file.path);
      let processedOriginal = sharp(originalBuffer);

      if (enableOptimization) {
        processedOriginal = processedOriginal.jpeg({ quality: jpegQuality });
      }

      const originalPath = path.join(productDir, `${fileNameWithoutExt}.jpg`);
      await processedOriginal.toFile(originalPath);

      // 2. Generate thumbnail
      const thumbnailPath = path.join(productDir, `${fileNameWithoutExt}-thumb.jpg`);
      await sharp(originalBuffer)
        .resize(thumbWidth, thumbHeight, { fit: 'cover' })
        .jpeg({ quality: jpegQuality })
        .toFile(thumbnailPath);

      // 3. Generate mobile-optimized variant
      const mobilePath = path.join(productDir, `${fileNameWithoutExt}-mobile.jpg`);
      await sharp(originalBuffer)
        .resize(mobileWidth, mobileWidth * 1.5, { fit: 'cover' })
        .jpeg({ quality: jpegQuality })
        .toFile(mobilePath);

      // 4. Get file stats
      const fileStats = await fs.promises.stat(originalPath);

      // 5. Create database record
      const imageId = genId('IMG', Math.random().toString(36).substr(2, 9), 6);
      const imageUrl = `/uploads/products/${productId}/${path.basename(originalPath)}`;
      const thumbnailUrl = `/uploads/products/${productId}/${path.basename(thumbnailPath)}`;
      const mobileUrl = `/uploads/products/${productId}/${path.basename(mobilePath)}`;

      await query(
        `INSERT INTO product_images
         (id, product_id, image_url, thumbnail_url, mobile_url, alt_text, file_size, mime_type, original_filename, display_order, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
        [imageId, productId, imageUrl, thumbnailUrl, mobileUrl, altText || '', fileStats.size, 'image/jpeg', file.originalname, 0]
      );

      // 6. Clean up the raw upload — but only if it's a different file than
      // the processed "original" we just wrote. Multer saves uploads
      // directly into the product directory (not a separate /tmp staging
      // area), and for JPEG uploads `file.path` and `originalPath` resolve
      // to the identical filename, so unlinking unconditionally would
      // delete the very file we just created.
      if (path.resolve(file.path) !== path.resolve(originalPath)) {
        await fs.promises.unlink(file.path);
      }

      return {
        id: imageId,
        product_id: productId,
        image_url: imageUrl,
        thumbnail_url: thumbnailUrl,
        mobile_url: mobileUrl,
        alt_text: altText,
        file_size: fileStats.size,
        mime_type: 'image/jpeg',
        display_order: 0,
        created_at: new Date().toISOString(),
      };
    } catch (error) {
      // Clean up on error
      if (file.path && fs.existsSync(file.path)) {
        await fs.promises.unlink(file.path).catch(() => {});
      }
      throw error;
    }
  }

  /**
   * Get all images for a product
   */
  static async getProductImages(productId) {
    const images = await query(
      `SELECT id, product_id, image_url, thumbnail_url, mobile_url, alt_text,
              file_size, mime_type, display_order, created_at, uploaded_by, updated_at
       FROM product_images
       WHERE product_id = $1
       ORDER BY display_order ASC, created_at ASC`,
      [productId]
    );

    return images;
  }

  /**
   * Get single image
   */
  static async getImageById(imageId) {
    const image = await queryOne(
      `SELECT * FROM product_images WHERE id = $1`,
      [imageId]
    );

    return image;
  }

  /**
   * Delete image and associated files
   */
  static async deleteImage(imageId, productId) {
    try {
      // 1. Get image record
      const image = await queryOne(
        `SELECT * FROM product_images WHERE id = $1 AND product_id = $2`,
        [imageId, productId]
      );

      if (!image) {
        throw new Error('Image not found');
      }

      // 2. Delete physical files
      const fileName = path.basename(image.image_url);
      const fileNameWithoutExt = path.parse(fileName).name;
      const productDir = path.join(uploadDir, 'products', productId);

      const files = [
        path.join(productDir, `${fileNameWithoutExt}.jpg`),
        path.join(productDir, `${fileNameWithoutExt}-thumb.jpg`),
        path.join(productDir, `${fileNameWithoutExt}-mobile.jpg`),
      ];

      for (const filePath of files) {
        if (fs.existsSync(filePath)) {
          await fs.promises.unlink(filePath);
        }
      }

      // 3. Delete database record
      await query(
        `DELETE FROM product_images WHERE id = $1`,
        [imageId]
      );

      // 4. Reorder remaining images if this was primary
      if (image.display_order === 0) {
        const nextImage = await queryOne(
          `SELECT id FROM product_images WHERE product_id = $1 ORDER BY created_at ASC LIMIT 1`,
          [productId]
        );

        if (nextImage) {
          await query(
            `UPDATE product_images SET display_order = 0 WHERE id = $1`,
            [nextImage.id]
          );
        }
      }

      return { success: true, message: `Image ${imageId} deleted successfully` };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Update image metadata (alt text, order)
   */
  static async updateImageMetadata(imageId, productId, updates) {
    const { alt_text, display_order } = updates;

    const updateFields = [];
    const updateValues = [imageId, productId];
    let paramCount = 3;

    if (alt_text !== undefined) {
      updateFields.push(`alt_text = $${paramCount++}`);
      updateValues.push(alt_text);
    }

    if (display_order !== undefined) {
      updateFields.push(`display_order = $${paramCount++}`);
      updateValues.push(display_order);
    }

    if (updateFields.length === 0) {
      throw new Error('No fields to update');
    }

    updateFields.push(`updated_at = NOW()`);

    const result = await queryOne(
      `UPDATE product_images
       SET ${updateFields.join(', ')}
       WHERE id = $1 AND product_id = $2
       RETURNING *`,
      updateValues
    );

    return result;
  }

  /**
   * Reorder images for a product
   */
  static async reorderImages(productId, imageIds) {
    try {
      // Validate all images exist and belong to product
      const images = await query(
        `SELECT id FROM product_images WHERE product_id = $1`,
        [productId]
      );

      const existingIds = images.map(img => img.id);
      const invalidIds = imageIds.filter(id => !existingIds.includes(id));

      if (invalidIds.length > 0) {
        throw new Error(`Invalid image IDs: ${invalidIds.join(', ')}`);
      }

      // Update display_order for each image
      for (let i = 0; i < imageIds.length; i++) {
        await query(
          `UPDATE product_images SET display_order = $1 WHERE id = $2`,
          [i, imageIds[i]]
        );
      }

      return { success: true, message: 'Images reordered successfully' };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get image usage stats
   */
  static async getImageStats() {
    const stats = await queryOne(
      `SELECT
        COUNT(*) as total_images,
        COUNT(DISTINCT product_id) as products_with_images,
        COALESCE(SUM(file_size), 0) as total_storage_bytes,
        AVG(file_size) as avg_file_size
       FROM product_images`
    );

    return {
      total_images: parseInt(stats.total_images),
      products_with_images: parseInt(stats.products_with_images),
      total_storage_bytes: parseInt(stats.total_storage_bytes),
      total_storage_mb: (parseInt(stats.total_storage_bytes) / 1024 / 1024).toFixed(2),
      avg_file_size: Math.round(stats.avg_file_size),
    };
  }
}

module.exports = ImageService;

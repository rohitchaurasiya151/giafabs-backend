/**
 * Image Service
 * Handles image upload, delivery, and metadata management via Cloudinary
 */

const cloudinary = require('../config/cloudinary');
const { query, queryOne } = require('../config/database');
const { genId } = require('../../core');
const config = require('../config');

const thumbWidth = config.storage.thumbnailWidth;
const thumbHeight = config.storage.thumbnailHeight;
const mobileWidth = config.storage.mobileWidth;

/**
 * Upload a buffer to Cloudinary via the streaming API (avoids writing
 * the file to disk, since multer keeps uploads in memory).
 */
function uploadBufferToCloudinary(buffer, options) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) return reject(error);
      resolve(result);
    });
    uploadStream.end(buffer);
  });
}

class ImageService {
  /**
   * Upload image to Cloudinary and store its metadata.
   * Thumbnail/mobile variants are generated eagerly at upload time.
   */
  static async processUploadedImage(file, productId, altText = '') {
    const result = await uploadBufferToCloudinary(file.buffer, {
      folder: `giafabs/products/${productId}`,
      resource_type: 'image',
      quality_analysis: false,
      eager: [
        { width: thumbWidth, height: thumbHeight, crop: 'fill', gravity: 'auto', quality: 'auto', fetch_format: 'auto' },
        { width: mobileWidth, crop: 'fill', gravity: 'auto', quality: 'auto', fetch_format: 'auto' },
      ],
    });

    const imageId = genId('IMG', Math.random().toString(36).substr(2, 9), 6);
    const imageUrl = result.secure_url;
    const thumbnailUrl = result.eager?.[0]?.secure_url || imageUrl;
    const mobileUrl = result.eager?.[1]?.secure_url || imageUrl;

    await query(
      `INSERT INTO product_images
       (id, product_id, image_url, thumbnail_url, mobile_url, alt_text, file_size, mime_type, original_filename, cloudinary_public_id, display_order, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`,
      [imageId, productId, imageUrl, thumbnailUrl, mobileUrl, altText || '', result.bytes, file.mimetype, file.originalname, result.public_id, 0]
    );

    return {
      id: imageId,
      product_id: productId,
      image_url: imageUrl,
      thumbnail_url: thumbnailUrl,
      mobile_url: mobileUrl,
      alt_text: altText,
      file_size: result.bytes,
      mime_type: file.mimetype,
      display_order: 0,
      created_at: new Date().toISOString(),
    };
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
   * Delete image from Cloudinary and its database record
   */
  static async deleteImage(imageId, productId) {
    const image = await queryOne(
      `SELECT * FROM product_images WHERE id = $1 AND product_id = $2`,
      [imageId, productId]
    );

    if (!image) {
      throw new Error('Image not found');
    }

    if (image.cloudinary_public_id) {
      await cloudinary.uploader.destroy(image.cloudinary_public_id);
    }

    await query(
      `DELETE FROM product_images WHERE id = $1`,
      [imageId]
    );

    // Reorder remaining images if this was primary
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

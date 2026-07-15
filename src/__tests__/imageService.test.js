/**
 * Image Service Tests
 * Tests for Cloudinary upload/delete and database operations
 */

const ImageService = require('../services/imageService');
const cloudinary = require('../config/cloudinary');
const { query, queryOne } = require('../config/database');

// Mock database queries
jest.mock('../config/database', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
}));

// Mock Cloudinary client
jest.mock('../config/cloudinary', () => ({
  uploader: {
    upload_stream: jest.fn(),
    destroy: jest.fn(),
  },
}));

describe('ImageService', () => {
  const mockProductId = 'PRD001';
  const mockFile = {
    buffer: Buffer.from('fake image'),
    originalname: 'test-image.jpg',
    size: 2048576,
    mimetype: 'image/jpeg',
  };

  const mockCloudinaryResult = {
    public_id: 'giafabs/products/PRD001/abc123',
    secure_url: 'https://res.cloudinary.com/ly1x8sxn/image/upload/v1/giafabs/products/PRD001/abc123.jpg',
    bytes: 2048576,
    eager: [
      { secure_url: 'https://res.cloudinary.com/ly1x8sxn/image/upload/c_fill,h_150,w_150/giafabs/products/PRD001/abc123.jpg' },
      { secure_url: 'https://res.cloudinary.com/ly1x8sxn/image/upload/c_fill,w_600/giafabs/products/PRD001/abc123.jpg' },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    cloudinary.uploader.upload_stream.mockImplementation((options, callback) => {
      callback(null, mockCloudinaryResult);
      return { end: jest.fn() };
    });
  });

  // ─────────── Upload Tests ───────────────────────────────────

  describe('processUploadedImage', () => {
    test('should upload buffer to Cloudinary and create database record', async () => {
      query.mockResolvedValue([]);

      const image = await ImageService.processUploadedImage(mockFile, mockProductId, 'Front view');

      expect(cloudinary.uploader.upload_stream).toHaveBeenCalledWith(
        expect.objectContaining({ folder: `giafabs/products/${mockProductId}` }),
        expect.any(Function)
      );
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO product_images'),
        expect.arrayContaining([mockCloudinaryResult.public_id])
      );
      expect(image.image_url).toBe(mockCloudinaryResult.secure_url);
      expect(image.thumbnail_url).toBe(mockCloudinaryResult.eager[0].secure_url);
      expect(image.mobile_url).toBe(mockCloudinaryResult.eager[1].secure_url);
      expect(image.product_id).toBe(mockProductId);
    });

    test('should propagate Cloudinary upload errors', async () => {
      cloudinary.uploader.upload_stream.mockImplementation((options, callback) => {
        callback(new Error('Cloudinary upload failed'), null);
        return { end: jest.fn() };
      });

      await expect(
        ImageService.processUploadedImage(mockFile, mockProductId, '')
      ).rejects.toThrow('Cloudinary upload failed');
    });
  });

  // ─────────── Retrieve Tests ───────────────────────────────

  describe('getProductImages', () => {
    test('should return all images for a product', async () => {
      const mockImages = [
        {
          id: 'IMG-001',
          product_id: mockProductId,
          image_url: 'https://res.cloudinary.com/ly1x8sxn/image/upload/v1/giafabs/products/PRD001/img-001.jpg',
          thumbnail_url: 'https://res.cloudinary.com/ly1x8sxn/image/upload/c_fill,h_150,w_150/giafabs/products/PRD001/img-001.jpg',
          display_order: 0,
          alt_text: 'Front view',
        },
        {
          id: 'IMG-002',
          product_id: mockProductId,
          image_url: 'https://res.cloudinary.com/ly1x8sxn/image/upload/v1/giafabs/products/PRD001/img-002.jpg',
          thumbnail_url: 'https://res.cloudinary.com/ly1x8sxn/image/upload/c_fill,h_150,w_150/giafabs/products/PRD001/img-002.jpg',
          display_order: 1,
          alt_text: 'Back view',
        },
      ];

      query.mockResolvedValue(mockImages);

      const images = await ImageService.getProductImages(mockProductId);

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('FROM product_images'),
        [mockProductId]
      );
      expect(images).toHaveLength(2);
      expect(images[0].display_order).toBe(0);
      expect(images[1].display_order).toBe(1);
    });

    test('should return empty array if product has no images', async () => {
      query.mockResolvedValue([]);

      const images = await ImageService.getProductImages(mockProductId);

      expect(images).toEqual([]);
    });
  });

  describe('getImageById', () => {
    test('should return single image by ID', async () => {
      const mockImage = {
        id: 'IMG-001',
        product_id: mockProductId,
        image_url: 'https://res.cloudinary.com/ly1x8sxn/image/upload/v1/giafabs/products/PRD001/img-001.jpg',
      };

      queryOne.mockResolvedValue(mockImage);

      const image = await ImageService.getImageById('IMG-001');

      expect(queryOne).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = $1'),
        ['IMG-001']
      );
      expect(image).toEqual(mockImage);
    });

    test('should return null if image not found', async () => {
      queryOne.mockResolvedValue(null);

      const image = await ImageService.getImageById('NONEXISTENT');

      expect(image).toBeNull();
    });
  });

  // ─────────── Delete Tests ───────────────────────────────

  describe('deleteImage', () => {
    test('should destroy Cloudinary asset and delete database record', async () => {
      const mockImage = {
        id: 'IMG-001',
        product_id: mockProductId,
        cloudinary_public_id: 'giafabs/products/PRD001/abc123',
        display_order: 0,
      };

      queryOne.mockResolvedValue(mockImage);
      query.mockResolvedValue([]);
      cloudinary.uploader.destroy.mockResolvedValue({ result: 'ok' });

      const result = await ImageService.deleteImage('IMG-001', mockProductId);

      expect(cloudinary.uploader.destroy).toHaveBeenCalledWith(mockImage.cloudinary_public_id);
      expect(result.success).toBe(true);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM product_images'),
        ['IMG-001']
      );
    });

    test('should throw error if image not found', async () => {
      queryOne.mockResolvedValue(null);

      await expect(
        ImageService.deleteImage('NONEXISTENT', mockProductId)
      ).rejects.toThrow('Image not found');
    });
  });

  // ─────────── Metadata Tests ───────────────────────────────

  describe('updateImageMetadata', () => {
    test('should update alt_text', async () => {
      const updatedImage = {
        id: 'IMG-001',
        alt_text: 'Updated alt text',
        display_order: 0,
      };

      queryOne.mockResolvedValue(updatedImage);

      const result = await ImageService.updateImageMetadata('IMG-001', mockProductId, {
        alt_text: 'Updated alt text',
      });

      expect(result.alt_text).toBe('Updated alt text');
    });

    test('should update display_order', async () => {
      const updatedImage = {
        id: 'IMG-001',
        display_order: 2,
      };

      queryOne.mockResolvedValue(updatedImage);

      const result = await ImageService.updateImageMetadata('IMG-001', mockProductId, {
        display_order: 2,
      });

      expect(result.display_order).toBe(2);
    });

    test('should throw error if no fields to update', async () => {
      await expect(
        ImageService.updateImageMetadata('IMG-001', mockProductId, {})
      ).rejects.toThrow('No fields to update');
    });
  });

  // ─────────── Reorder Tests ───────────────────────────────

  describe('reorderImages', () => {
    test('should reorder images successfully', async () => {
      const imageIds = ['IMG-003', 'IMG-001', 'IMG-002'];

      query.mockResolvedValueOnce([
        { id: 'IMG-001' },
        { id: 'IMG-002' },
        { id: 'IMG-003' },
      ]).mockResolvedValue([]);

      const result = await ImageService.reorderImages(mockProductId, imageIds);

      expect(result.success).toBe(true);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE product_images SET display_order'),
        expect.any(Array)
      );
    });

    test('should throw error for invalid image IDs', async () => {
      query.mockResolvedValueOnce([{ id: 'IMG-001' }]); // Only 1 image exists

      await expect(
        ImageService.reorderImages(mockProductId, ['IMG-001', 'INVALID-ID'])
      ).rejects.toThrow('Invalid image IDs');
    });
  });

  // ─────────── Statistics Tests ───────────────────────────

  describe('getImageStats', () => {
    test('should return image statistics', async () => {
      const mockStats = {
        total_images: '10',
        products_with_images: '5',
        total_storage_bytes: '52428800', // 50MB
        avg_file_size: '5242880', // 5MB
      };

      queryOne.mockResolvedValue(mockStats);

      const stats = await ImageService.getImageStats();

      expect(stats.total_images).toBe(10);
      expect(stats.products_with_images).toBe(5);
      expect(stats.total_storage_bytes).toBe(52428800);
      expect(stats.total_storage_mb).toBeDefined();
    });
  });
});

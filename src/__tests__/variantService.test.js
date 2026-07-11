/**
 * VariantService Tests
 * Unit tests for product variant management
 */

const VariantService = require('../services/variantService');
const db = require('../config/database');

jest.mock('../config/database');

describe('VariantService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getProductWithVariants', () => {
    it('should return product with all variants', async () => {
      const mockProduct = {
        id: 'prod-1',
        name: 'Silk Saree',
        brand: 'GIAFABS',
        variants: [
          {
            id: 'var-1',
            sku: 'SILK-001-M',
            size: 'M',
            pricing: { mrp: 6999, selling_price: 5999 },
            inventory: { available: 50 }
          }
        ]
      };

      db.queryOne.mockResolvedValue(mockProduct);

      const result = await VariantService.getProductWithVariants('prod-1');

      expect(result).toEqual(mockProduct);
      expect(db.queryOne).toHaveBeenCalled();
    });

    it('should return null if product not found', async () => {
      db.queryOne.mockResolvedValue(null);

      const result = await VariantService.getProductWithVariants('invalid');

      expect(result).toBeNull();
    });
  });

  describe('getVariantDetails', () => {
    it('should return variant with costs and margin', async () => {
      const mockVariant = {
        variant_id: 'var-1',
        sku: 'SILK-001-M',
        selling_price: 5999,
        cogs: 3950,
        margin_pct: 34.1
      };

      db.queryOne.mockResolvedValue(mockVariant);

      const result = await VariantService.getVariantDetails('var-1');

      expect(result).toEqual(mockVariant);
      expect(result.margin_pct).toBeGreaterThan(20);
    });
  });

  describe('createProduct', () => {
    it('should create product with sizes', async () => {
      db.transaction.mockImplementation(async (callback) => {
        return callback({
          query: jest.fn()
            .mockResolvedValueOnce({ rows: [{ id: 'prod-1' }] })
            .mockResolvedValue({})
        });
      });

      const result = await VariantService.createProduct(
        { id: 'prod-1', name: 'Saree', category: 'Ethnic' },
        ['S', 'M', 'L']
      );

      expect(result).toBeDefined();
      expect(db.transaction).toHaveBeenCalled();
    });
  });

  describe('updatePricing', () => {
    it('should update variant pricing with history', async () => {
      db.transaction.mockImplementation(async (callback) => {
        return callback({
          query: jest.fn()
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({ rows: [{ id: 'price-1', selling_price: 5999 }] })
        });
      });

      const pricing = await VariantService.updatePricing(
        'var-1',
        { mrp: 6999, selling_price: 5999, discount_pct: 14 },
        'admin-1'
      );

      expect(pricing).toBeDefined();
      expect(db.transaction).toHaveBeenCalled();
    });

    it('should throw error if selling_price > mrp', async () => {
      await expect(
        VariantService.updatePricing(
          'var-1',
          { mrp: 5000, selling_price: 6000, discount_pct: 0 },
          'admin-1'
        )
      ).rejects.toThrow('Pricing validation failed');
    });

    it('should throw error if discount > 40%', async () => {
      await expect(
        VariantService.updatePricing(
          'var-1',
          { mrp: 6999, selling_price: 5999, discount_pct: 50 },
          'admin-1'
        )
      ).rejects.toThrow('Pricing validation failed');
    });
  });

  describe('updateCosts', () => {
    it('should update variant costs with margin validation', async () => {
      db.transaction.mockImplementation(async (callback) => {
        return callback({
          query: jest.fn()
            .mockResolvedValueOnce({ rows: [{ selling_price: 5999 }] })
            .mockResolvedValueOnce({ rows: [{ id: 'cost-1' }] })
        });
      });

      const costs = await VariantService.updateCosts(
        'var-1',
        { material_cost: 2500, labor_cost: 800, packaging_cost: 150, overhead_cost: 500 },
        'admin-1'
      );

      expect(costs).toBeDefined();
      expect(db.transaction).toHaveBeenCalled();
    });

    it('should throw error if margin < 20%', async () => {
      db.transaction.mockImplementation(async (callback) => {
        return callback({
          query: jest.fn().mockResolvedValueOnce({ rows: [{ selling_price: 1000 }] })
        });
      });

      await expect(
        VariantService.updateCosts(
          'var-1',
          { material_cost: 900, labor_cost: 100, packaging_cost: 0, overhead_cost: 0 },
          'admin-1'
        )
      ).rejects.toThrow('Margin too low');
    });
  });

  describe('calculateMargin', () => {
    it('should calculate margin percentage correctly', () => {
      const margin = VariantService.calculateMargin(5999, 3950);

      expect(margin).toBeCloseTo(34.1, 0);
    });

    it('should return 0 if selling price is 0', () => {
      const margin = VariantService.calculateMargin(0, 3950);

      expect(margin).toBe(0);
    });
  });

  describe('getPricingHistory', () => {
    it('should return pricing history', async () => {
      const mockHistory = [
        { mrp: 6999, selling_price: 5999, created_at: '2024-01-01' },
        { mrp: 7999, selling_price: 6999, created_at: '2023-12-01' }
      ];

      db.query.mockResolvedValue(mockHistory);

      const result = await VariantService.getPricingHistory('var-1', 10);

      expect(result).toEqual(mockHistory);
      expect(db.query).toHaveBeenCalled();
    });
  });
});

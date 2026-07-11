/**
 * CartService Tests
 * Unit tests for shopping cart operations
 */

const CartService = require('../services/cartService');
const db = require('../config/database');

jest.mock('../config/database');

describe('CartService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getCart', () => {
    it('should return cart items with pricing', async () => {
      const mockItems = [
        {
          customer_id: 'cust-1',
          product_id: 'prod-1',
          size: 'M',
          qty: 1,
          selling_price: 5999,
          mrp: 6999,
          discount_pct: 14
        }
      ];

      db.query.mockResolvedValue(mockItems);

      const result = await CartService.getCart('cust-1');

      expect(result).toEqual(mockItems);
      expect(db.query).toHaveBeenCalled();
    });

    it('should return empty array when cart is empty', async () => {
      db.query.mockResolvedValue([]);

      const result = await CartService.getCart('cust-1');

      expect(result).toEqual([]);
    });
  });

  describe('addToCart', () => {
    it('should add new item to cart with reservation', async () => {
      db.transaction.mockImplementation(async (callback) => {
        return callback({
          query: jest.fn().mockResolvedValue({ rows: [{ id: 'var-1', available_qty: 50 }] })
        });
      });

      await CartService.addToCart('cust-1', 'var-1', 'prod-1', 'M', 1);

      expect(db.transaction).toHaveBeenCalled();
    });

    it('should throw error if quantity is invalid', async () => {
      await expect(
        CartService.addToCart('cust-1', 'var-1', 'prod-1', 'M', 0)
      ).rejects.toThrow('INVALID_QUANTITY');
    });

    it('should throw error if quantity exceeds 100', async () => {
      await expect(
        CartService.addToCart('cust-1', 'var-1', 'prod-1', 'M', 101)
      ).rejects.toThrow('INVALID_QUANTITY');
    });

    it('should throw OUT_OF_STOCK error if stock unavailable', async () => {
      db.transaction.mockImplementation(async (callback) => {
        return callback({
          query: jest.fn().mockResolvedValue({ rows: [{ available_qty: 0 }] })
        });
      });

      const error = new Error('OUT_OF_STOCK');
      error.available = 0;

      await expect(
        CartService.addToCart('cust-1', 'var-1', 'prod-1', 'M', 1)
      ).rejects.toThrow();
    });
  });

  describe('updateCartItem', () => {
    it('should update item quantity', async () => {
      db.transaction.mockImplementation(async (callback) => {
        return callback({
          query: jest.fn()
            .mockResolvedValueOnce({ rows: [{ qty: 1 }] })
            .mockResolvedValueOnce({ rows: [{ available_qty: 50 }] })
        });
      });

      await CartService.updateCartItem('cust-1', 'prod-1', 'M', 2);

      expect(db.transaction).toHaveBeenCalled();
    });

    it('should throw error if item not in cart', async () => {
      db.transaction.mockImplementation(async (callback) => {
        return callback({
          query: jest.fn().mockResolvedValue({ rows: [] })
        });
      });

      await expect(
        CartService.updateCartItem('cust-1', 'prod-1', 'M', 2)
      ).rejects.toThrow();
    });
  });

  describe('removeFromCart', () => {
    it('should remove item from cart', async () => {
      db.transaction.mockImplementation(async (callback) => {
        return callback({
          query: jest.fn()
            .mockResolvedValueOnce({ rows: [{ qty: 1 }] })
            .mockResolvedValueOnce({ rows: [] })
        });
      });

      await CartService.removeFromCart('cust-1', 'prod-1', 'M');

      expect(db.transaction).toHaveBeenCalled();
    });
  });

  describe('clearCart', () => {
    it('should clear entire cart', async () => {
      db.transaction.mockImplementation(async (callback) => {
        return callback({
          query: jest.fn().mockResolvedValue({ rows: [] })
        });
      });

      await CartService.clearCart('cust-1');

      expect(db.transaction).toHaveBeenCalled();
    });
  });

  describe('calculateCartTotals', () => {
    it('should calculate cart totals with tax and shipping', async () => {
      const mockItems = [
        {
          selling_price: 5999,
          qty: 1,
          discount_pct: 14,
          gst_rate: 5
        }
      ];

      db.query.mockResolvedValue(mockItems);

      const totals = await CartService.calculateCartTotals('cust-1');

      expect(totals).toHaveProperty('subtotal');
      expect(totals).toHaveProperty('discount');
      expect(totals).toHaveProperty('gst');
      expect(totals).toHaveProperty('shipping');
      expect(totals).toHaveProperty('total');
    });

    it('should apply free shipping for orders over 999', async () => {
      const mockItems = [
        {
          selling_price: 1000,
          qty: 2,
          discount_pct: 0,
          gst_rate: 5
        }
      ];

      db.query.mockResolvedValue(mockItems);

      const totals = await CartService.calculateCartTotals('cust-1');

      expect(totals.shipping).toBe(0);
    });
  });
});

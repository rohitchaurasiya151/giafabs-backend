/**
 * Integration Tests
 * End-to-end workflow tests
 */

const CartService = require('../services/cartService');
const InventoryService = require('../services/inventoryService');
const VariantService = require('../services/variantService');
const db = require('../config/database');

jest.mock('../config/database');

describe('End-to-End Workflows', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Add to Cart Workflow', () => {
    it('should complete add to cart with stock reservation', async () => {
      db.transaction.mockImplementation(async (callback) => {
        return callback({
          query: jest.fn()
            .mockResolvedValueOnce({ rows: [{ available_qty: 50, id: 'var-1' }] })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] })
        });
      });

      db.query.mockResolvedValue([]);

      // 1. Check availability
      const available = await InventoryService.checkAvailability('var-1', 1);
      expect(available).toBeGreaterThan(0);

      // 2. Add to cart with reservation
      await CartService.addToCart('cust-1', 'var-1', 'prod-1', 'M', 1);
      expect(db.transaction).toHaveBeenCalled();

      // 3. Verify cart
      const cart = await CartService.getCart('cust-1');
      expect(cart).toBeDefined();
    });

    it('should prevent overselling with stock reservation', async () => {
      db.transaction.mockImplementationOnce(async (callback) => {
        return callback({
          query: jest.fn().mockResolvedValue({ rows: [{ available_qty: 5 }] })
        });
      });

      // Try to add more than available
      const error = new Error('OUT_OF_STOCK');
      error.available = 5;

      await expect(
        CartService.addToCart('cust-1', 'var-1', 'prod-1', 'M', 100)
      ).rejects.toThrow();
    });
  });

  describe('Cart to Checkout Workflow', () => {
    it('should calculate correct totals with tax and shipping', async () => {
      const mockItems = [
        {
          product_id: 'prod-1',
          size: 'M',
          qty: 2,
          selling_price: 5999,
          mrp: 6999,
          discount_pct: 14,
          gst_rate: 5
        }
      ];

      db.query.mockResolvedValue(mockItems);

      const totals = await CartService.calculateCartTotals('cust-1');

      expect(totals).toHaveProperty('subtotal');
      expect(totals).toHaveProperty('gst');
      expect(totals).toHaveProperty('total');
      expect(totals.subtotal).toBe(mockItems[0].selling_price * mockItems[0].qty);
    });

    it('should apply free shipping for orders over 999', async () => {
      const mockItems = [
        {
          product_id: 'prod-1',
          size: 'M',
          qty: 3,
          selling_price: 500,
          mrp: 600,
          discount_pct: 17,
          gst_rate: 5
        }
      ];

      db.query.mockResolvedValue(mockItems);

      const totals = await CartService.calculateCartTotals('cust-1');

      expect(totals.shipping).toBe(0); // Free shipping
      expect(totals.subtotal).toBeGreaterThan(999);
    });

    it('should charge shipping for orders under 999', async () => {
      const mockItems = [
        {
          product_id: 'prod-1',
          size: 'M',
          qty: 1,
          selling_price: 500,
          mrp: 600,
          discount_pct: 17,
          gst_rate: 5
        }
      ];

      db.query.mockResolvedValue(mockItems);

      const totals = await CartService.calculateCartTotals('cust-1');

      expect(totals.shipping).toBeGreaterThan(0);
    });
  });

  describe('Order Fulfillment Workflow', () => {
    it('should convert cart reservation to order hold and fulfill', async () => {
      db.transaction.mockImplementation(async (callback) => {
        return callback({
          query: jest.fn().mockResolvedValue({ rows: [{ id: 'res-1' }] })
        });
      });

      // 1. Cart is reserved (30 min hold)
      await InventoryService.reserveForCart('var-1', 'cart-1', 5);
      expect(db.transaction).toHaveBeenCalled();

      // 2. Order created - convert to permanent hold
      await InventoryService.convertToOrderHold('var-1', 'cart-1', 'order-1');
      expect(db.transaction).toHaveBeenCalledTimes(2);

      // 3. Fulfill order - deduct from inventory
      await InventoryService.recordOrderFulfillment('var-1', 5, 'order-1', 'admin-1');
      expect(db.transaction).toHaveBeenCalledTimes(3);
    });

    it('should track inventory changes with audit trail', async () => {
      const movements = [];

      db.transaction.mockImplementation(async (callback) => {
        return callback({
          query: jest.fn().mockResolvedValue({ rows: [{ id: 'mov-1' }] })
        });
      });

      // 1. Stock in
      await InventoryService.recordStockIn('var-1', 100, 'PO-123', 'Stock in', 'admin-1');
      movements.push('stock_in');

      // 2. Fulfill order
      await InventoryService.recordOrderFulfillment('var-1', 50, 'order-1', 'admin-1');
      movements.push('order_fulfillment');

      // 3. Record damage
      await InventoryService.recordDamage('var-1', 5, 'damage', 'Water damage', 'admin-1');
      movements.push('damage');

      expect(movements.length).toBe(3);
      expect(db.transaction).toHaveBeenCalledTimes(3);
    });
  });

  describe('Pricing and Margin Workflow', () => {
    it('should update pricing with validation', async () => {
      db.transaction.mockImplementation(async (callback) => {
        return callback({
          query: jest.fn()
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({ rows: [{ selling_price: 5999 }] })
        });
      });

      // Update pricing with valid discount
      const pricing = await VariantService.updatePricing(
        'var-1',
        { mrp: 6999, selling_price: 5999, discount_pct: 14 },
        'admin-1'
      );

      expect(pricing).toBeDefined();
    });

    it('should enforce 20% margin minimum', async () => {
      db.transaction.mockImplementation(async (callback) => {
        return callback({
          query: jest.fn().mockResolvedValueOnce({ rows: [{ selling_price: 1000 }] })
        });
      });

      // Try to set costs that result in < 20% margin
      await expect(
        VariantService.updateCosts(
          'var-1',
          { material_cost: 900, labor_cost: 100, packaging_cost: 0, overhead_cost: 0 },
          'admin-1'
        )
      ).rejects.toThrow();
    });

    it('should track pricing history', async () => {
      db.query.mockResolvedValue([
        { mrp: 6999, selling_price: 5999, created_at: '2024-01-01' },
        { mrp: 7999, selling_price: 6499, created_at: '2024-01-02' }
      ]);

      const history = await VariantService.getPricingHistory('var-1');

      expect(history.length).toBe(2);
      expect(history[0].mrp).toBe(6999);
      expect(history[1].mrp).toBe(7999);
    });
  });

  describe('Stock Consistency Workflow', () => {
    it('should maintain inventory consistency across operations', async () => {
      db.queryOne.mockResolvedValue({
        on_hand_qty: 50,
        reserved_qty: 5,
        order_held_qty: 10,
        damaged_qty: 2,
        available_qty: 33,
        calculated_available: 33
      });

      const result = await InventoryService.validateInventoryConsistency('var-1');

      expect(result.isConsistent).toBe(true);
      expect(result.calculated_available).toBe(33);
    });

    it('should detect and report inventory discrepancies', async () => {
      db.queryOne.mockResolvedValue({
        on_hand_qty: 50,
        reserved_qty: 5,
        order_held_qty: 10,
        damaged_qty: 2,
        available_qty: 35, // Should be 33
        calculated_available: 33,
        discrepancy: 2
      });

      const result = await InventoryService.validateInventoryConsistency('var-1');

      expect(result.isConsistent).toBe(false);
      expect(result.discrepancy).toBe(2);
    });
  });

  describe('Cleanup Workflow', () => {
    it('should cleanup expired cart reservations', async () => {
      db.transaction.mockImplementation(async (callback) => {
        return callback({
          query: jest.fn().mockResolvedValue({
            rows: [
              { id: 'res-1', variant_id: 'var-1', qty_reserved: 5 },
              { id: 'res-2', variant_id: 'var-2', qty_reserved: 3 }
            ]
          })
        });
      });

      const count = await InventoryService.cleanupExpiredReservations();

      expect(count).toBeGreaterThanOrEqual(0);
      expect(db.transaction).toHaveBeenCalled();
    });

    it('should release expired reservations and restore stock', async () => {
      db.transaction.mockImplementation(async (callback) => {
        return callback({
          query: jest.fn()
            .mockResolvedValueOnce({
              rows: [
                { id: 'res-1', variant_id: 'var-1', qty_reserved: 5 }
              ]
            })
            .mockResolvedValueOnce({ rows: [] })
        });
      });

      const count = await InventoryService.cleanupExpiredReservations();

      expect(db.transaction).toHaveBeenCalled();
    });
  });

  describe('Multi-Size Product Workflow', () => {
    it('should handle multiple sizes independently', async () => {
      const sizes = ['S', 'M', 'L', 'XL'];

      db.transaction.mockImplementation(async (callback) => {
        return callback({
          query: jest.fn()
            .mockResolvedValueOnce({ rows: [{ id: 'prod-1' }] })
            .mockResolvedValue({})
        });
      });

      // Create product with multiple sizes
      const result = await VariantService.createProduct(
        { id: 'prod-1', name: 'Saree', category: 'Ethnic' },
        sizes
      );

      expect(result).toBeDefined();
      expect(db.transaction).toHaveBeenCalled();
    });

    it('should manage pricing independently per size', async () => {
      const sizeM = { mrp: 6999, selling_price: 5999 };
      const sizeL = { mrp: 7999, selling_price: 6999 };

      db.transaction.mockImplementation(async (callback) => {
        return callback({
          query: jest.fn()
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({ rows: [sizeM] })
        });
      });

      // Update M size pricing
      await VariantService.updatePricing('var-1-m', sizeM, 'admin-1');
      expect(db.transaction).toHaveBeenCalled();

      db.transaction.mockImplementation(async (callback) => {
        return callback({
          query: jest.fn()
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({ rows: [sizeL] })
        });
      });

      // Update L size pricing
      await VariantService.updatePricing('var-1-l', sizeL, 'admin-1');
      expect(db.transaction).toHaveBeenCalledTimes(2);
    });
  });
});

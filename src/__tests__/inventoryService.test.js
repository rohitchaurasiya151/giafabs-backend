/**
 * InventoryService Tests
 * Unit tests for inventory operations
 */

const InventoryService = require('../services/inventoryService');
const db = require('../config/database');

jest.mock('../config/database');

describe('InventoryService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('checkAvailability', () => {
    it('should return available quantity', async () => {
      db.queryOne.mockResolvedValue({ available_qty: 50 });

      const result = await InventoryService.checkAvailability('var-1', 10);

      expect(result).toBe(50);
      expect(db.queryOne).toHaveBeenCalled();
    });

    it('should throw error if variant not found', async () => {
      db.queryOne.mockResolvedValue(null);

      await expect(
        InventoryService.checkAvailability('invalid-var', 10)
      ).rejects.toThrow('Variant not found');
    });

    it('should throw OUT_OF_STOCK error if insufficient stock', async () => {
      db.queryOne.mockResolvedValue({ available_qty: 5 });

      const error = new Error('OUT_OF_STOCK');
      error.available = 5;

      await expect(
        InventoryService.checkAvailability('var-1', 10)
      ).rejects.toMatchObject(error);
    });
  });

  describe('reserveForCart', () => {
    it('should reserve stock for cart', async () => {
      db.transaction.mockImplementation(async (callback) => {
        return callback({
          query: jest.fn()
            .mockResolvedValueOnce({ rows: [{ available_qty: 50 }] })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] })
        });
      });

      await InventoryService.reserveForCart('var-1', 'cart-1', 5);

      expect(db.transaction).toHaveBeenCalled();
    });

    it('should throw OUT_OF_STOCK if insufficient stock', async () => {
      db.transaction.mockImplementation(async (callback) => {
        return callback({
          query: jest.fn().mockResolvedValueOnce({ rows: [{ available_qty: 2 }] })
        });
      });

      const error = new Error('OUT_OF_STOCK');
      error.available = 2;

      await expect(
        InventoryService.reserveForCart('var-1', 'cart-1', 5)
      ).rejects.toMatchObject(error);
    });
  });

  describe('recordStockIn', () => {
    it('should record stock inbound', async () => {
      db.transaction.mockImplementation(async (callback) => {
        return callback({
          query: jest.fn().mockResolvedValue({ rows: [{ id: 'mov-1' }] })
        });
      });

      const result = await InventoryService.recordStockIn(
        'var-1',
        100,
        'PO-123',
        'Stock received',
        'admin-1'
      );

      expect(db.transaction).toHaveBeenCalled();
    });
  });

  describe('recordOrderFulfillment', () => {
    it('should record order fulfillment', async () => {
      db.transaction.mockImplementation(async (callback) => {
        return callback({
          query: jest.fn().mockResolvedValue({ rows: [{ id: 'mov-1' }] })
        });
      });

      await InventoryService.recordOrderFulfillment(
        'var-1',
        5,
        'order-123',
        'admin-1'
      );

      expect(db.transaction).toHaveBeenCalled();
    });
  });

  describe('recordDamage', () => {
    it('should record damaged inventory', async () => {
      db.transaction.mockImplementation(async (callback) => {
        return callback({
          query: jest.fn().mockResolvedValue({ rows: [{ id: 'mov-1' }] })
        });
      });

      await InventoryService.recordDamage(
        'var-1',
        3,
        'damage',
        'Water damage',
        'admin-1'
      );

      expect(db.transaction).toHaveBeenCalled();
    });
  });

  describe('validateInventoryConsistency', () => {
    it('should validate inventory consistency', async () => {
      db.queryOne.mockResolvedValue({
        on_hand_qty: 50,
        reserved_qty: 5,
        order_held_qty: 10,
        damaged_qty: 0,
        available_qty: 35,
        calculated_available: 35
      });

      const result = await InventoryService.validateInventoryConsistency('var-1');

      expect(result.isConsistent).toBe(true);
    });

    it('should detect inventory inconsistency', async () => {
      db.queryOne.mockResolvedValue({
        on_hand_qty: 50,
        reserved_qty: 5,
        order_held_qty: 10,
        damaged_qty: 0,
        available_qty: 35,
        calculated_available: 34 // Mismatch!
      });

      const result = await InventoryService.validateInventoryConsistency('var-1');

      expect(result.isConsistent).toBe(false);
    });
  });

  describe('cleanupExpiredReservations', () => {
    it('should cleanup expired cart reservations', async () => {
      db.transaction.mockImplementation(async (callback) => {
        return callback({
          query: jest.fn().mockResolvedValue({
            rows: [
              { id: 'res-1', variant_id: 'var-1', qty_reserved: 5 }
            ]
          })
        });
      });

      const count = await InventoryService.cleanupExpiredReservations();

      expect(count).toBeGreaterThanOrEqual(0);
      expect(db.transaction).toHaveBeenCalled();
    });
  });
});

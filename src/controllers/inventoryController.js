/**
 * Inventory Controller
 * Handles stock and inventory endpoints
 */

const InventoryService = require('../services/inventoryService');

class InventoryController {
  /**
   * GET /api/inventory/all
   * List all inventory items for admin dashboard
   */
  static async listInventory(req, res, next) {
    try {
      const { page = 1, perPage = 10, search = '' } = req.query;

      // TODO: Query from database with pagination and search
      // For now, return mock data
      const inventory = [
        { id: 'var-1', sku: 'SILK-001-M', product: 'Silk Saree', size: 'M', on_hand: 45, reserved: 5, available: 40, reorder_level: 10, status: 'ok' },
        { id: 'var-2', sku: 'SILK-001-L', product: 'Silk Saree', size: 'L', on_hand: 8, reserved: 2, available: 6, reorder_level: 10, status: 'low' },
        { id: 'var-3', sku: 'COTTON-002-M', product: 'Cotton Dupatta', size: 'Free Size', on_hand: 2, reserved: 1, available: 1, reorder_level: 5, status: 'critical' },
        { id: 'var-4', sku: 'LINEN-003-S', product: 'Linen Kurta', size: 'S', on_hand: 25, reserved: 3, available: 22, reorder_level: 10, status: 'ok' },
      ];

      res.status(200).json({
        success: true,
        data: { inventory, total: inventory.length, page: parseInt(page), perPage: parseInt(perPage) }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/inventory/availability
   * Check availability for variants
   */
  static async checkAvailability(req, res, next) {
    try {
      const variantIds = req.query.variant_ids?.split(',') || [];

      if (!variantIds.length) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_VARIANTS', message: 'variant_ids query parameter required' }
        });
      }

      const availability = {};

      for (const variantId of variantIds) {
        try {
          const result = await InventoryService.checkAvailability(variantId, 1);
          availability[variantId] = {
            available_qty: result,
            status: result > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK'
          };
        } catch (error) {
          availability[variantId] = {
            available_qty: 0,
            status: 'OUT_OF_STOCK',
            error: error.message
          };
        }
      }

      res.status(200).json({
        success: true,
        data: availability
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/inventory/restock
   * Record stock inbound (supplier delivery)
   */
  static async restock(req, res, next) {
    try {
      const { variant_id, qty, reference_id, notes } = req.body;
      const userId = req.user?.id || 'admin'; // TODO: get from auth middleware

      // Validate input
      if (!variant_id || !qty) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_FIELDS', message: 'variant_id and qty are required' }
        });
      }

      if (qty <= 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_QTY', message: 'Quantity must be positive' }
        });
      }

      const movement = await InventoryService.recordStockIn(
        variant_id,
        parseInt(qty, 10),
        reference_id || `RESTOCK-${Date.now()}`,
        notes || 'Stock received',
        userId
      );

      res.status(201).json({
        success: true,
        data: movement,
        message: `${qty} units added to inventory`
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/inventory/adjust
   * Adjust stock (reconciliation, damage, shrinkage)
   */
  static async adjustStock(req, res, next) {
    try {
      const { variant_id, qty, reason, notes } = req.body;
      const userId = req.user?.id || 'admin'; // TODO: get from auth middleware

      // Validate input
      if (!variant_id || qty === undefined || !reason) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_FIELDS', message: 'variant_id, qty, and reason are required' }
        });
      }

      if (qty === 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_QTY', message: 'Quantity cannot be zero' }
        });
      }

      // Validate reason
      const validReasons = ['adjustment', 'damage', 'shrinkage', 'recount'];
      if (!validReasons.includes(reason)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_REASON',
            message: `Reason must be one of: ${validReasons.join(', ')}`
          }
        });
      }

      const movement = await InventoryService.adjustStock(
        variant_id,
        parseInt(qty, 10),
        reason,
        notes || '',
        userId
      );

      res.status(201).json({
        success: true,
        data: movement,
        message: `Stock adjusted by ${qty} units`
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/inventory/movements/:variant_id
   * Get inventory movement history
   */
  static async getMovementHistory(req, res, next) {
    try {
      const { variant_id } = req.params;
      const limit = parseInt(req.query.limit || 50, 10);

      if (!variant_id) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_VARIANT_ID', message: 'variant_id is required' }
        });
      }

      const movements = await InventoryService.getMovementHistory(variant_id, Math.min(limit, 200));

      res.status(200).json({
        success: true,
        data: movements
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/inventory/low-stock
   * Get low stock variants (admin dashboard)
   */
  static async getLowStock(req, res, next) {
    try {
      const variants = await InventoryService.getLowStockVariants();

      res.status(200).json({
        success: true,
        data: variants
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/inventory/cleanup
   * Cleanup expired cart reservations (background job)
   */
  static async cleanupExpiredReservations(req, res, next) {
    try {
      // TODO: Add auth check for internal/cron job
      const count = await InventoryService.cleanupExpiredReservations();

      res.status(200).json({
        success: true,
        data: { cleaned: count },
        message: `Cleaned up ${count} expired reservations`
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/inventory/validate
   * Validate inventory consistency (integrity check)
   */
  static async validateConsistency(req, res, next) {
    try {
      const { variant_id } = req.body;

      if (!variant_id) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_VARIANT_ID', message: 'variant_id is required' }
        });
      }

      const result = await InventoryService.validateInventoryConsistency(variant_id);

      if (!result.isConsistent) {
        return res.status(422).json({
          success: false,
          error: {
            code: 'INVENTORY_INCONSISTENCY',
            message: 'Inventory is inconsistent',
            details: result.details
          }
        });
      }

      res.status(200).json({
        success: true,
        data: result,
        message: 'Inventory is consistent'
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = InventoryController;

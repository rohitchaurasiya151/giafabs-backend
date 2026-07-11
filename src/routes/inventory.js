/**
 * Inventory API Routes
 * GET /api/inventory/availability - Check stock
 * POST /api/inventory/restock - Add stock
 * POST /api/inventory/adjust - Adjust stock
 * GET /api/inventory/movements/:variant_id - Movement history
 * GET /api/inventory/low-stock - Low stock alerts
 * POST /api/inventory/cleanup - Cleanup expired carts
 * POST /api/inventory/validate - Validate consistency
 */

const express = require('express');
const router = express.Router();
const InventoryController = require('../controllers/inventoryController');

// GET /api/inventory/all
// List all inventory items for admin dashboard
router.get('/all', InventoryController.listInventory);

// GET /api/inventory/availability?variant_ids=id1,id2,id3
// Check stock availability for variants
router.get('/availability', InventoryController.checkAvailability);

// POST /api/inventory/restock
// Record stock inbound
router.post('/restock', InventoryController.restock);

// POST /api/inventory/adjust
// Adjust stock (damage, shrinkage, reconciliation)
router.post('/adjust', InventoryController.adjustStock);

// GET /api/inventory/movements/:variant_id
// Get inventory movement history
router.get('/movements/:variant_id', InventoryController.getMovementHistory);

// GET /api/inventory/low-stock
// Get low stock variants
router.get('/low-stock', InventoryController.getLowStock);

// POST /api/inventory/cleanup
// Cleanup expired cart reservations (background job)
router.post('/cleanup', InventoryController.cleanupExpiredReservations);

// POST /api/inventory/validate
// Validate inventory consistency
router.post('/validate', InventoryController.validateConsistency);

module.exports = router;

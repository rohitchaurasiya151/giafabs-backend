/**
 * Products API Routes
 * GET /api/products/:id - Get product with variants
 * GET /api/variants/:id - Get variant details
 * POST /api/variants/:id/pricing - Update pricing
 * POST /api/variants/:id/costs - Update costs
 * GET /api/variants/:id/pricing/history - Get pricing history
 */

const express = require('express');
const router = express.Router();
const ProductController = require('../controllers/productController');

// GET /api/products
// List all products with filters
router.get('/', ProductController.listProducts);

// GET /api/products/:id
// Get product with all variants and pricing
router.get('/:id', ProductController.getProduct);

// GET /api/variants/:id
// Get variant details (with costs for admin)
router.get('/variant/:id', ProductController.getVariant);

// POST /api/variants/:id/pricing
// Update variant pricing
router.post('/variant/:id/pricing', ProductController.updatePricing);

// POST /api/variants/:id/costs
// Update variant costs (COGS)
router.post('/variant/:id/costs', ProductController.updateCosts);

// GET /api/variants/:id/pricing/history
// Get pricing history for audit
router.get('/variant/:id/pricing/history', ProductController.getPricingHistory);

module.exports = router;

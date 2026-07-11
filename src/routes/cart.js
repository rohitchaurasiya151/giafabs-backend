/**
 * Cart API Routes
 * GET /api/cart - Get cart
 * POST /api/cart/add - Add to cart
 * PUT /api/cart/update - Update item quantity
 * DELETE /api/cart/item - Remove item
 * DELETE /api/cart - Clear cart
 */

const express = require('express');
const router = express.Router();
const CartController = require('../controllers/cartController');

// GET /api/cart
// Get customer's shopping cart
router.get('/', CartController.getCart);

// POST /api/cart/add
// Add item to cart (with stock reservation)
router.post('/add', CartController.addToCart);

// PUT /api/cart/update
// Update cart item quantity
router.put('/update', CartController.updateCart);

// DELETE /api/cart/item
// Remove item from cart
router.delete('/item', CartController.removeFromCart);

// DELETE /api/cart
// Clear entire cart
router.delete('/', CartController.clearCart);

module.exports = router;

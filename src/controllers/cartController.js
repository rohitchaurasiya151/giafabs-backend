/**
 * Cart Controller
 * Handles shopping cart endpoints
 */

const CartService = require('../services/cartService');
const InventoryService = require('../services/inventoryService');

class CartController {
  /**
   * GET /api/cart
   * Get customer's shopping cart
   */
  static async getCart(req, res, next) {
    try {
      const customerId = req.user?.id || req.query.customer_id; // TODO: get from auth middleware

      if (!customerId) {
        return res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Customer ID required' }
        });
      }

      const cartItems = await CartService.getCart(customerId);
      const totals = await CartService.calculateCartTotals(customerId);

      res.status(200).json({
        success: true,
        data: {
          items: cartItems,
          totals
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/cart/add
   * Add item to cart with stock reservation
   */
  static async addToCart(req, res, next) {
    try {
      const customerId = req.user?.id || req.body.customer_id; // TODO: get from auth middleware
      const { variant_id, product_id, size, qty } = req.body;

      // Validate input
      if (!customerId) {
        return res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Customer ID required' }
        });
      }

      if (!variant_id || !product_id || !size || !qty) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_FIELDS',
            message: 'variant_id, product_id, size, and qty are required'
          }
        });
      }

      try {
        await CartService.addToCart(customerId, variant_id, product_id, size, parseInt(qty, 10));

        const cartItems = await CartService.getCart(customerId);
        const totals = await CartService.calculateCartTotals(customerId);

        res.status(200).json({
          success: true,
          data: {
            items: cartItems,
            totals,
            message: 'Item added to cart'
          }
        });
      } catch (error) {
        if (error.message === 'OUT_OF_STOCK') {
          return res.status(409).json({
            success: false,
            error: {
              code: 'OUT_OF_STOCK',
              message: `Only ${error.available} units available`,
              available: error.available
            }
          });
        }
        if (error.message === 'INVALID_QUANTITY') {
          return res.status(400).json({
            success: false,
            error: { code: 'INVALID_QUANTITY', message: 'Quantity must be between 1 and 100' }
          });
        }
        throw error;
      }
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/cart/update
   * Update cart item quantity
   */
  static async updateCart(req, res, next) {
    try {
      const customerId = req.user?.id || req.body.customer_id; // TODO: get from auth middleware
      const { product_id, size, qty } = req.body;

      if (!customerId) {
        return res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Customer ID required' }
        });
      }

      if (!product_id || !size || !qty) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_FIELDS', message: 'product_id, size, and qty are required' }
        });
      }

      try {
        await CartService.updateCartItem(customerId, product_id, size, parseInt(qty, 10));

        const cartItems = await CartService.getCart(customerId);
        const totals = await CartService.calculateCartTotals(customerId);

        res.status(200).json({
          success: true,
          data: {
            items: cartItems,
            totals,
            message: 'Cart updated'
          }
        });
      } catch (error) {
        if (error.message === 'OUT_OF_STOCK') {
          return res.status(409).json({
            success: false,
            error: {
              code: 'OUT_OF_STOCK',
              message: `Only ${error.available} units available`,
              available: error.available
            }
          });
        }
        if (error.message === 'INVALID_QUANTITY') {
          return res.status(400).json({
            success: false,
            error: { code: 'INVALID_QUANTITY', message: 'Quantity must be between 1 and 100' }
          });
        }
        throw error;
      }
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/cart/item
   * Remove item from cart
   */
  static async removeFromCart(req, res, next) {
    try {
      const customerId = req.user?.id || req.query.customer_id; // TODO: get from auth middleware
      const { product_id, size } = req.query;

      if (!customerId) {
        return res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Customer ID required' }
        });
      }

      if (!product_id || !size) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_FIELDS', message: 'product_id and size are required' }
        });
      }

      await CartService.removeFromCart(customerId, product_id, size);

      const cartItems = await CartService.getCart(customerId);
      const totals = await CartService.calculateCartTotals(customerId);

      res.status(200).json({
        success: true,
        data: {
          items: cartItems,
          totals,
          message: 'Item removed from cart'
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/cart
   * Clear entire cart
   */
  static async clearCart(req, res, next) {
    try {
      const customerId = req.user?.id || req.query.customer_id; // TODO: get from auth middleware

      if (!customerId) {
        return res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Customer ID required' }
        });
      }

      await CartService.clearCart(customerId);

      res.status(200).json({
        success: true,
        data: { items: [], totals: { items: 0, subtotal: 0, discount: 0, gst: 0, shipping: 0, total: 0 } },
        message: 'Cart cleared'
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = CartController;

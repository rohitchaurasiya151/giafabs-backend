/**
 * Cart Service
 * Manages cart operations with inventory synchronization
 */

const db = require('../config/database');
const InventoryService = require('./inventoryService');
const VariantService = require('./variantService');

class CartService {
  /**
   * Get customer cart with current pricing
   */
  static async getCart(customerId) {
    const query = `
      SELECT
        ci.customer_id,
        ci.product_id,
        ci.size,
        ci.qty,
        vd.variant_id,
        vd.sku,
        vd.selling_price,
        vd.mrp,
        vd.discount_pct,
        vd.gst_rate,
        vd.available_qty,
        p.name,
        p.brand,
        p.category
      FROM cart_items ci
      LEFT JOIN v_variant_details vd ON ci.product_id = vd.product_id
        AND ci.size = vd.size
      LEFT JOIN products p ON ci.product_id = p.id
      WHERE ci.customer_id = $1
      ORDER BY ci.product_id;
    `;

    return db.query(query, [customerId]);
  }

  /**
   * Add item to cart with stock reservation
   */
  static async addToCart(customerId, variantId, productId, size, qty) {
    return db.transaction(async (client) => {
      // Validate quantity
      if (qty <= 0 || qty > 100) {
        throw new Error('INVALID_QUANTITY');
      }

      // Check variant exists and is active
      const variantQuery = `
        SELECT v.id, v.sku, vi.available_qty
        FROM product_variants v
        LEFT JOIN variant_inventory vi ON v.id = vi.variant_id
        WHERE v.id = $1 AND v.status = 'active';
      `;

      const variant = await client.query(variantQuery, [variantId]);

      if (variant.rows.length === 0) {
        throw new Error('VARIANT_NOT_FOUND');
      }

      const available = variant.rows[0].available_qty || 0;

      if (available < qty) {
        const error = new Error('OUT_OF_STOCK');
        error.available = available;
        throw error;
      }

      // Check if item already in cart
      const existingQuery = `
        SELECT qty FROM cart_items
        WHERE customer_id = $1 AND product_id = $2 AND size = $3;
      `;

      const existing = await client.query(existingQuery, [customerId, productId, size]);

      if (existing.rows.length > 0) {
        // Update quantity
        const updateQuery = `
          UPDATE cart_items
          SET qty = qty + $4
          WHERE customer_id = $1 AND product_id = $2 AND size = $3;
        `;

        await client.query(updateQuery, [customerId, productId, size, qty]);
      } else {
        // Insert new cart item
        const insertQuery = `
          INSERT INTO cart_items (customer_id, product_id, qty, size)
          VALUES ($1, $2, $3, $4);
        `;

        await client.query(insertQuery, [customerId, productId, qty, size]);
      }

      // Reserve stock for cart (30 min hold)
      const cartId = `${customerId}-cart`;
      const reservationQuery = `
        INSERT INTO stock_reservations (
          variant_id, cart_id, qty_reserved, reservation_type,
          expires_at, reason
        )
        VALUES ($1, $2, $3, 'cart', NOW() + INTERVAL '30 minutes', 'Cart hold')
        RETURNING *;
      `;

      await client.query(reservationQuery, [variantId, cartId, qty]);

      // Update inventory reserved_qty
      const updateInventoryQuery = `
        UPDATE variant_inventory
        SET reserved_qty = reserved_qty + $2
        WHERE variant_id = $1;
      `;

      await client.query(updateInventoryQuery, [variantId, qty]);
    });
  }

  /**
   * Update cart item quantity
   */
  static async updateCartItem(customerId, productId, size, qty) {
    return db.transaction(async (client) => {
      if (qty <= 0 || qty > 100) {
        throw new Error('INVALID_QUANTITY');
      }

      // Get current quantity
      const getCurrentQuery = `
        SELECT qty FROM cart_items
        WHERE customer_id = $1 AND product_id = $2 AND size = $3;
      `;

      const current = await client.query(getCurrentQuery, [customerId, productId, size]);

      if (current.rows.length === 0) {
        throw new Error('ITEM_NOT_IN_CART');
      }

      const currentQty = current.rows[0].qty;
      const qtyDelta = qty - currentQty;

      if (qtyDelta === 0) return; // No change

      // Get variant
      const variantQuery = `
        SELECT v.id, vi.available_qty
        FROM product_variants v
        LEFT JOIN variant_inventory vi ON v.id = vi.variant_id
        LEFT JOIN product_sizes ps ON v.size_id = ps.id
        WHERE v.product_id = $1 AND ps.size = $2 AND v.status = 'active';
      `;

      const variant = await client.query(variantQuery, [productId, size]);

      if (variant.rows.length === 0) {
        throw new Error('VARIANT_NOT_FOUND');
      }

      const variantId = variant.rows[0].id;
      const available = variant.rows[0].available_qty || 0;

      // Check if additional qty is available
      if (qtyDelta > 0 && available < qtyDelta) {
        const error = new Error('OUT_OF_STOCK');
        error.available = available;
        throw error;
      }

      // Update cart
      const updateQuery = `
        UPDATE cart_items
        SET qty = $4
        WHERE customer_id = $1 AND product_id = $2 AND size = $3;
      `;

      await client.query(updateQuery, [customerId, productId, size, qty]);

      // Update reservation
      const cartId = `${customerId}-cart`;
      const updateReservationQuery = `
        UPDATE stock_reservations
        SET qty_reserved = qty_reserved + $3
        WHERE variant_id = $1 AND cart_id = $2 AND status = 'active' AND reservation_type = 'cart';
      `;

      await client.query(updateReservationQuery, [variantId, cartId, qtyDelta]);

      // Update inventory
      const updateInventoryQuery = `
        UPDATE variant_inventory
        SET reserved_qty = reserved_qty + $2
        WHERE variant_id = $1;
      `;

      await client.query(updateInventoryQuery, [variantId, qtyDelta]);
    });
  }

  /**
   * Remove item from cart
   */
  static async removeFromCart(customerId, productId, size) {
    return db.transaction(async (client) => {
      // Get item
      const getQuery = `
        SELECT qty FROM cart_items
        WHERE customer_id = $1 AND product_id = $2 AND size = $3;
      `;

      const item = await client.query(getQuery, [customerId, productId, size]);

      if (item.rows.length === 0) {
        return; // Already removed
      }

      const qty = item.rows[0].qty;

      // Get variant
      const variantQuery = `
        SELECT v.id
        FROM product_variants v
        LEFT JOIN product_sizes ps ON v.size_id = ps.id
        WHERE v.product_id = $1 AND ps.size = $2 AND v.status = 'active';
      `;

      const variant = await client.query(variantQuery, [productId, size]);

      if (variant.rows.length === 0) {
        throw new Error('VARIANT_NOT_FOUND');
      }

      const variantId = variant.rows[0].id;

      // Remove from cart
      const deleteQuery = `
        DELETE FROM cart_items
        WHERE customer_id = $1 AND product_id = $2 AND size = $3;
      `;

      await client.query(deleteQuery, [customerId, productId, size]);

      // Release reservation
      const cartId = `${customerId}-cart`;
      const releaseQuery = `
        UPDATE stock_reservations
        SET status = 'released', released_at = NOW()
        WHERE variant_id = $1 AND cart_id = $2 AND status = 'active';
      `;

      await client.query(releaseQuery, [variantId, cartId]);

      // Update inventory
      const updateInventoryQuery = `
        UPDATE variant_inventory
        SET reserved_qty = reserved_qty - $2
        WHERE variant_id = $1;
      `;

      await client.query(updateInventoryQuery, [variantId, qty]);
    });
  }

  /**
   * Clear entire cart
   */
  static async clearCart(customerId) {
    return db.transaction(async (client) => {
      // Get all items
      const getItemsQuery = `
        SELECT ci.product_id, ci.size, ci.qty, v.id as variant_id
        FROM cart_items ci
        LEFT JOIN product_variants v ON ci.product_id = v.product_id
        LEFT JOIN product_sizes ps ON v.size_id = ps.id AND ps.size = ci.size
        WHERE ci.customer_id = $1;
      `;

      const items = await client.query(getItemsQuery, [customerId]);

      // Release all reservations
      const cartId = `${customerId}-cart`;
      const releaseQuery = `
        UPDATE stock_reservations
        SET status = 'released', released_at = NOW()
        WHERE cart_id = $1 AND status = 'active';
      `;

      await client.query(releaseQuery, [cartId]);

      // Update inventory for each item
      for (const item of items.rows) {
        const updateQuery = `
          UPDATE variant_inventory
          SET reserved_qty = reserved_qty - $2
          WHERE variant_id = $1;
        `;

        await client.query(updateQuery, [item.variant_id, item.qty]);
      }

      // Delete all cart items
      const deleteQuery = `
        DELETE FROM cart_items
        WHERE customer_id = $1;
      `;

      await client.query(deleteQuery, [customerId]);
    });
  }

  /**
   * Calculate cart totals with pricing
   */
  static async calculateCartTotals(customerId) {
    const cartItems = await this.getCart(customerId);

    let subtotal = 0;
    let totalDiscount = 0;
    let totalGst = 0;

    for (const item of cartItems) {
      const itemPrice = item.selling_price * item.qty;
      const itemDiscount = (itemPrice * item.discount_pct) / 100;
      const itemGst = (itemPrice - itemDiscount) * (item.gst_rate / 100);

      subtotal += itemPrice;
      totalDiscount += itemDiscount;
      totalGst += itemGst;
    }

    const shipping = subtotal > 999 || subtotal === 0 ? 0 : 99;
    const total = subtotal - totalDiscount + totalGst + shipping;

    return {
      items: cartItems.length,
      subtotal: parseFloat(subtotal.toFixed(2)),
      discount: parseFloat(totalDiscount.toFixed(2)),
      gst: parseFloat(totalGst.toFixed(2)),
      shipping,
      total: parseFloat(total.toFixed(2)),
    };
  }
}

module.exports = CartService;

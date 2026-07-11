/**
 * Inventory Service
 * Manages stock, reservations, and inventory movements
 */

const db = require('../config/database');

class InventoryService {
  /**
   * Check stock availability
   */
  static async checkAvailability(variantId, qty) {
    const query = `
      SELECT available_qty
      FROM variant_inventory
      WHERE variant_id = $1;
    `;

    const result = await db.queryOne(query, [variantId]);

    if (!result) {
      throw new Error('Variant not found');
    }

    const available = result.available_qty || 0;

    if (available < qty) {
      const error = new Error('OUT_OF_STOCK');
      error.available = available;
      error.requested = qty;
      throw error;
    }

    return available;
  }

  /**
   * Reserve stock for cart (30 minute hold)
   */
  static async reserveForCart(variantId, cartId, qty) {
    return db.transaction(async (client) => {
      // Lock row for update
      const lockQuery = `
        SELECT available_qty
        FROM variant_inventory
        WHERE variant_id = $1
        FOR UPDATE;
      `;

      const lockResult = await client.query(lockQuery, [variantId]);

      if (lockResult.rows.length === 0) {
        throw new Error('Variant not found');
      }

      const available = lockResult.rows[0].available_qty;

      if (available < qty) {
        const error = new Error('OUT_OF_STOCK');
        error.available = available;
        error.requested = qty;
        throw error;
      }

      // Update inventory
      const updateQuery = `
        UPDATE variant_inventory
        SET reserved_qty = reserved_qty + $2
        WHERE variant_id = $1;
      `;

      await client.query(updateQuery, [variantId, qty]);

      // Create reservation
      const reservationQuery = `
        INSERT INTO stock_reservations (
          variant_id, cart_id, qty_reserved, reservation_type,
          expires_at, reason
        )
        VALUES ($1, $2, $3, 'cart', NOW() + INTERVAL '30 minutes', 'Cart hold')
        RETURNING *;
      `;

      const result = await client.query(reservationQuery, [variantId, cartId, qty]);

      return result.rows[0];
    });
  }

  /**
   * Release cart reservation
   */
  static async releaseCartReservation(variantId, cartId) {
    return db.transaction(async (client) => {
      // Get reservation
      const getQuery = `
        SELECT qty_reserved
        FROM stock_reservations
        WHERE variant_id = $1 AND cart_id = $2 AND status = 'active';
      `;

      const reservation = await client.query(getQuery, [variantId, cartId]);

      if (reservation.rows.length === 0) {
        return; // Already released
      }

      const qtyReserved = reservation.rows[0].qty_reserved;

      // Release reservation
      const releaseQuery = `
        UPDATE stock_reservations
        SET status = 'released', released_at = NOW()
        WHERE variant_id = $1 AND cart_id = $2 AND status = 'active';
      `;

      await client.query(releaseQuery, [variantId, cartId]);

      // Update inventory
      const updateQuery = `
        UPDATE variant_inventory
        SET reserved_qty = reserved_qty - $2
        WHERE variant_id = $1;
      `;

      await client.query(updateQuery, [variantId, qtyReserved]);
    });
  }

  /**
   * Convert cart reservation to order hold (permanent)
   */
  static async convertToOrderHold(variantId, cartId, orderId) {
    return db.transaction(async (client) => {
      // Get cart reservation
      const getQuery = `
        SELECT id, qty_reserved
        FROM stock_reservations
        WHERE variant_id = $1 AND cart_id = $2 AND status = 'active';
      `;

      const reservation = await client.query(getQuery, [variantId, cartId]);

      if (reservation.rows.length === 0) {
        throw new Error('Reservation not found');
      }

      const reservationId = reservation.rows[0].id;
      const qtyReserved = reservation.rows[0].qty_reserved;

      // Update reservation
      const updateReservationQuery = `
        UPDATE stock_reservations
        SET status = 'converted', order_id = $2
        WHERE id = $1;
      `;

      await client.query(updateReservationQuery, [reservationId, orderId]);

      // Move from reserved to order_held
      const moveQuery = `
        UPDATE variant_inventory
        SET
          reserved_qty = reserved_qty - $2,
          order_held_qty = order_held_qty + $2
        WHERE variant_id = $1;
      `;

      await client.query(moveQuery, [variantId, qtyReserved]);
    });
  }

  /**
   * Record stock inbound (purchase order received)
   */
  static async recordStockIn(variantId, qty, referenceId, notes, userId) {
    return db.transaction(async (client) => {
      // Update inventory
      const updateQuery = `
        UPDATE variant_inventory
        SET on_hand_qty = on_hand_qty + $2
        WHERE variant_id = $1;
      `;

      await client.query(updateQuery, [variantId, qty]);

      // Log movement
      const movementQuery = `
        INSERT INTO inventory_movements (
          variant_id, movement_type, qty, reference_id, reason, created_by
        )
        VALUES ($1, 'stock_in', $2, $3, $4, $5)
        RETURNING *;
      `;

      const result = await client.query(movementQuery, [
        variantId,
        qty,
        referenceId,
        notes || 'Stock received',
        userId,
      ]);

      return result.rows[0];
    });
  }

  /**
   * Record order fulfillment (deduct from on_hand)
   */
  static async recordOrderFulfillment(variantId, qty, orderId, userId) {
    return db.transaction(async (client) => {
      // Deduct from on_hand and order_held
      const updateQuery = `
        UPDATE variant_inventory
        SET
          on_hand_qty = on_hand_qty - $2,
          order_held_qty = order_held_qty - $2
        WHERE variant_id = $1;
      `;

      await client.query(updateQuery, [variantId, qty]);

      // Log movement
      const movementQuery = `
        INSERT INTO inventory_movements (
          variant_id, movement_type, qty, reference_id,
          reference_type, reason, created_by
        )
        VALUES ($1, 'order', -$2, $3, 'order', 'Order fulfilled', $4)
        RETURNING *;
      `;

      const result = await client.query(movementQuery, [
        variantId,
        qty,
        orderId,
        userId,
      ]);

      return result.rows[0];
    });
  }

  /**
   * Record damage/shrinkage
   */
  static async recordDamage(variantId, qty, reason, notes, userId) {
    return db.transaction(async (client) => {
      // Update inventory
      const updateQuery = `
        UPDATE variant_inventory
        SET damaged_qty = damaged_qty + $2
        WHERE variant_id = $1;
      `;

      await client.query(updateQuery, [variantId, qty]);

      // Log movement
      const movementQuery = `
        INSERT INTO inventory_movements (
          variant_id, movement_type, qty, reason, notes, created_by
        )
        VALUES ($1, $2, -$3, $4, $5, $6)
        RETURNING *;
      `;

      const result = await client.query(movementQuery, [
        variantId,
        reason === 'damage' ? 'damage' : 'shrinkage',
        qty,
        reason,
        notes,
        userId,
      ]);

      return result.rows[0];
    });
  }

  /**
   * Adjust stock (reconciliation)
   */
  static async adjustStock(variantId, qty, reason, notes, userId) {
    return db.transaction(async (client) => {
      // Update inventory
      const updateQuery = `
        UPDATE variant_inventory
        SET on_hand_qty = on_hand_qty + $2
        WHERE variant_id = $1;
      `;

      await client.query(updateQuery, [variantId, qty]);

      // Log movement
      const movementQuery = `
        INSERT INTO inventory_movements (
          variant_id, movement_type, qty, reason, notes, created_by
        )
        VALUES ($1, 'adjustment', $2, $3, $4, $5)
        RETURNING *;
      `;

      const result = await client.query(movementQuery, [
        variantId,
        qty,
        reason,
        notes,
        userId,
      ]);

      return result.rows[0];
    });
  }

  /**
   * Get inventory movement history
   */
  static async getMovementHistory(variantId, limit = 50) {
    const query = `
      SELECT *
      FROM inventory_movements
      WHERE variant_id = $1
      ORDER BY created_at DESC
      LIMIT $2;
    `;

    return db.query(query, [variantId, limit]);
  }

  /**
   * Get low stock variants
   */
  static async getLowStockVariants() {
    const query = `
      SELECT * FROM v_low_stock_variants
      ORDER BY shortage DESC;
    `;

    return db.query(query);
  }

  /**
   * Cleanup expired cart reservations (background job)
   */
  static async cleanupExpiredReservations() {
    return db.transaction(async (client) => {
      // Find expired reservations
      const getExpiredQuery = `
        SELECT id, variant_id, qty_reserved
        FROM stock_reservations
        WHERE status = 'active'
          AND reservation_type = 'cart'
          AND expires_at < NOW();
      `;

      const expired = await client.query(getExpiredQuery);

      // Release each reservation
      for (const reservation of expired.rows) {
        // Mark as expired
        const updateQuery = `
          UPDATE stock_reservations
          SET status = 'expired', released_at = NOW()
          WHERE id = $1;
        `;

        await client.query(updateQuery, [reservation.id]);

        // Free up inventory
        const releaseQuery = `
          UPDATE variant_inventory
          SET reserved_qty = reserved_qty - $2
          WHERE variant_id = $1;
        `;

        await client.query(releaseQuery, [reservation.variant_id, reservation.qty_reserved]);
      }

      return expired.rows.length;
    });
  }

  /**
   * Check if inventory is consistent (sanity check)
   */
  static async validateInventoryConsistency(variantId) {
    const query = `
      SELECT
        on_hand_qty,
        reserved_qty,
        order_held_qty,
        damaged_qty,
        available_qty,
        (on_hand_qty - reserved_qty - order_held_qty - damaged_qty) as calculated_available
      FROM variant_inventory
      WHERE variant_id = $1;
    `;

    const result = await db.queryOne(query, [variantId]);

    if (!result) {
      throw new Error('Variant not found');
    }

    const isConsistent = result.available_qty === result.calculated_available;

    return {
      isConsistent,
      details: result,
    };
  }
}

module.exports = InventoryService;

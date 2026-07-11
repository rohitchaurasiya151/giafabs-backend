/**
 * Order Service
 * Manages order creation, payment, tracking, and returns
 */

const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class OrderService {
  /**
   * Create new order from cart
   */
  async createOrder(customerId, orderData) {
    return db.transaction(async (trx) => {
      // Generate order ID
      const orderId = `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Create order
      const order = await trx.query(
        `INSERT INTO orders (
          id, customer_id, status, payment_status,
          subtotal, discount, gst, shipping, total,
          shipping_address, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *`,
        [
          orderId,
          customerId,
          'pending',
          'pending',
          orderData.subtotal,
          orderData.discount,
          orderData.gst,
          orderData.shipping,
          orderData.total,
          JSON.stringify(orderData.shipping_address),
          new Date(),
          new Date(),
        ]
      );

      if (!order.rows.length) {
        throw new Error('Failed to create order');
      }

      // Create order items
      for (const item of orderData.items) {
        await trx.query(
          `INSERT INTO order_items (
            id, order_id, variant_id, product_id, size,
            qty, selling_price, total, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            uuidv4(),
            orderId,
            item.variant_id,
            item.product_id,
            item.size,
            item.qty,
            item.selling_price,
            item.total,
            new Date(),
          ]
        );

        // Convert cart reservation to order hold
        await trx.query(
          `UPDATE stock_reservations
           SET order_id = $1, is_order_hold = true, expires_at = NULL
           WHERE cart_id = $2 AND variant_id = $3`,
          [orderId, `cart-${customerId}`, item.variant_id]
        );
      }

      // Clear cart
      await trx.query('DELETE FROM cart_items WHERE customer_id = $1', [customerId]);

      return order.rows[0];
    });
  }

  /**
   * Get customer orders
   */
  async getCustomerOrders(customerId, limit = 20, offset = 0) {
    const orders = await db.query(
      `SELECT * FROM orders
       WHERE customer_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [customerId, limit, offset]
    );

    return orders;
  }

  /**
   * Get order details with items
   */
  async getOrderDetails(orderId, customerId) {
    const order = await db.queryOne(
      `SELECT * FROM orders WHERE id = $1 AND customer_id = $2`,
      [orderId, customerId]
    );

    if (!order) {
      throw new Error('Order not found');
    }

    const items = await db.query(
      `SELECT * FROM order_items WHERE order_id = $1`,
      [orderId]
    );

    return {
      ...order,
      items: items,
    };
  }

  /**
   * Initialize Razorpay payment
   */
  async initializePayment(orderId, customerId) {
    const order = await this.getOrderDetails(orderId, customerId);

    if (order.payment_status !== 'pending') {
      throw new Error('Payment already processed for this order');
    }

    // Create payment record
    const paymentId = `PAY-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    await db.query(
      `INSERT INTO payments (
        id, order_id, amount, currency, status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [paymentId, orderId, order.total, 'INR', 'pending', new Date()]
    );

    return {
      payment_id: paymentId,
      order_id: orderId,
      amount: order.total,
      currency: 'INR',
      customer_email: order.shipping_address?.email || '',
      customer_phone: order.shipping_address?.phone || '',
    };
  }

  /**
   * Confirm payment and update order status
   */
  async confirmPayment(orderId, paymentData) {
    return db.transaction(async (trx) => {
      // Update payment status
      await trx.query(
        `UPDATE payments
         SET status = $1, razorpay_payment_id = $2, updated_at = $3
         WHERE order_id = $4`,
        ['completed', paymentData.razorpay_payment_id, new Date(), orderId]
      );

      // Update order status
      const result = await trx.query(
        `UPDATE orders
         SET payment_status = $1, status = $2, updated_at = $3
         WHERE id = $4
         RETURNING *`,
        ['completed', 'confirmed', new Date(), orderId]
      );

      if (!result.rows.length) {
        throw new Error('Failed to confirm payment');
      }

      return result.rows[0];
    });
  }

  /**
   * Cancel order
   */
  async cancelOrder(orderId, customerId, reason) {
    return db.transaction(async (trx) => {
      const order = await trx.query(
        `SELECT * FROM orders WHERE id = $1 AND customer_id = $2`,
        [orderId, customerId]
      );

      if (!order.rows.length) {
        throw new Error('Order not found');
      }

      if (!['pending', 'confirmed'].includes(order.rows[0].status)) {
        throw new Error('Cannot cancel order in current status');
      }

      // Get order items to release inventory
      const items = await trx.query(
        `SELECT * FROM order_items WHERE order_id = $1`,
        [orderId]
      );

      // Release inventory holds
      for (const item of items) {
        await trx.query(
          `UPDATE stock_reservations
           SET order_id = NULL, is_order_hold = false, expires_at = NOW() + INTERVAL '30 minutes'
           WHERE order_id = $1 AND variant_id = $2`,
          [orderId, item.variant_id]
        );
      }

      // Update order status
      const result = await trx.query(
        `UPDATE orders
         SET status = $1, updated_at = $2
         WHERE id = $3
         RETURNING *`,
        ['cancelled', new Date(), orderId]
      );

      // Record order cancellation
      await trx.query(
        `INSERT INTO order_events (
          id, order_id, event_type, description, created_at
        ) VALUES ($1, $2, $3, $4, $5)`,
        [
          uuidv4(),
          orderId,
          'cancelled',
          reason || 'Order cancelled by customer',
          new Date(),
        ]
      );

      return result.rows[0];
    });
  }

  /**
   * Request return
   */
  async requestReturn(orderId, customerId, returnData) {
    return db.transaction(async (trx) => {
      const order = await trx.query(
        `SELECT * FROM orders WHERE id = $1 AND customer_id = $2`,
        [orderId, customerId]
      );

      if (!order.rows.length) {
        throw new Error('Order not found');
      }

      if (order.rows[0].status !== 'delivered') {
        throw new Error('Can only return delivered orders');
      }

      // Create return request
      const returnId = uuidv4();

      const result = await trx.query(
        `INSERT INTO returns (
          id, order_id, reason, notes, status, requested_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *`,
        [
          returnId,
          orderId,
          returnData.reason,
          returnData.notes,
          'requested',
          new Date(),
          new Date(),
        ]
      );

      // Record event
      await trx.query(
        `INSERT INTO order_events (
          id, order_id, event_type, description, created_at
        ) VALUES ($1, $2, $3, $4, $5)`,
        [
          uuidv4(),
          orderId,
          'return_requested',
          `Return requested: ${returnData.reason}`,
          new Date(),
        ]
      );

      return result.rows[0];
    });
  }

  /**
   * Approve return and issue refund
   */
  async approveReturn(returnId, refundData) {
    return db.transaction(async (trx) => {
      const returnRequest = await trx.query(
        `SELECT * FROM returns WHERE id = $1`,
        [returnId]
      );

      if (!returnRequest.rows.length) {
        throw new Error('Return request not found');
      }

      // Update return status
      await trx.query(
        `UPDATE returns
         SET status = $1, approved_at = $2, updated_at = $3
         WHERE id = $4`,
        ['approved', new Date(), new Date(), returnId]
      );

      const orderId = returnRequest.rows[0].order_id;

      // Create refund record
      await trx.query(
        `INSERT INTO refunds (
          id, return_id, order_id, refund_amount, status, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          uuidv4(),
          returnId,
          orderId,
          refundData.refund_amount,
          'processing',
          new Date(),
        ]
      );

      // Record event
      await trx.query(
        `INSERT INTO order_events (
          id, order_id, event_type, description, created_at
        ) VALUES ($1, $2, $3, $4, $5)`,
        [
          uuidv4(),
          orderId,
          'return_approved',
          `Return approved. Refund: ₹${refundData.refund_amount}`,
          new Date(),
        ]
      );

      return returnRequest.rows[0];
    });
  }

  /**
   * Get order events/history
   */
  async getOrderEvents(orderId) {
    const events = await db.query(
      `SELECT * FROM order_events
       WHERE order_id = $1
       ORDER BY created_at DESC`,
      [orderId]
    );

    return events;
  }

  /**
   * Update order status (admin only)
   */
  async updateOrderStatus(orderId, newStatus) {
    const validStatuses = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];

    if (!validStatuses.includes(newStatus)) {
      throw new Error('Invalid order status');
    }

    return db.transaction(async (trx) => {
      const result = await trx.query(
        `UPDATE orders
         SET status = $1, updated_at = $2
         WHERE id = $3
         RETURNING *`,
        [newStatus, new Date(), orderId]
      );

      if (!result.rows.length) {
        throw new Error('Order not found');
      }

      // Record status change
      await trx.query(
        `INSERT INTO order_events (
          id, order_id, event_type, description, created_at
        ) VALUES ($1, $2, $3, $4, $5)`,
        [
          uuidv4(),
          orderId,
          'status_updated',
          `Order status updated to: ${newStatus}`,
          new Date(),
        ]
      );

      return result.rows[0];
    });
  }

  /**
   * Get order statistics (admin only)
   */
  async getOrderStatistics(startDate, endDate) {
    const stats = await db.queryOne(
      `SELECT
        COUNT(*) as total_orders,
        SUM(total) as total_revenue,
        AVG(total) as avg_order_value,
        COUNT(CASE WHEN status = 'delivered' THEN 1 END) as delivered,
        COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled,
        COUNT(CASE WHEN payment_status = 'completed' THEN 1 END) as paid
      FROM orders
      WHERE created_at BETWEEN $1 AND $2`,
      [startDate, endDate]
    );

    return stats;
  }
}

module.exports = new OrderService();

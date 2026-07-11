/**
 * Order Controller
 * Handles order-related HTTP requests
 */

const orderService = require('../services/orderService');
const cartService = require('../services/cartService');

class OrderController {
  /**
   * POST /api/orders - Create new order
   */
  async createOrder(req, res, next) {
    try {
      const customerId = req.userId;
      if (!customerId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { items, shipping_address, coupon_code } = req.body;

      if (!items || !items.length) {
        return res.status(400).json({ error: 'Cart is empty' });
      }

      if (!shipping_address) {
        return res.status(400).json({ error: 'Shipping address is required' });
      }

      // Calculate totals
      const totals = await cartService.calculateCartTotals(customerId);

      // Create order
      const orderData = {
        items,
        subtotal: totals.subtotal,
        discount: totals.discount,
        gst: totals.gst,
        shipping: totals.shipping,
        total: totals.total,
        shipping_address,
      };

      const order = await orderService.createOrder(customerId, orderData);

      res.status(201).json(order);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/orders - Get customer orders
   */
  async getOrders(req, res, next) {
    try {
      const customerId = req.userId;
      if (!customerId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const limit = parseInt(req.query.limit) || 20;
      const offset = parseInt(req.query.offset) || 0;

      const orders = await orderService.getCustomerOrders(customerId, limit, offset);

      res.status(200).json(orders);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/orders/:orderId - Get order details
   */
  async getOrder(req, res, next) {
    try {
      const customerId = req.userId;
      const { orderId } = req.params;

      if (!customerId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const order = await orderService.getOrderDetails(orderId, customerId);
      const events = await orderService.getOrderEvents(orderId);

      res.status(200).json({
        ...order,
        events,
      });
    } catch (error) {
      if (error.message === 'Order not found') {
        return res.status(404).json({ error: error.message });
      }
      next(error);
    }
  }

  /**
   * POST /api/orders/:orderId/payment/initialize - Initialize payment
   */
  async initializePayment(req, res, next) {
    try {
      const customerId = req.userId;
      const { orderId } = req.params;

      if (!customerId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const payment = await orderService.initializePayment(orderId, customerId);

      res.status(200).json(payment);
    } catch (error) {
      if (error.message.includes('not found')) {
        return res.status(404).json({ error: error.message });
      }
      next(error);
    }
  }

  /**
   * POST /api/orders/:orderId/payment/confirm - Confirm payment
   */
  async confirmPayment(req, res, next) {
    try {
      const { orderId } = req.params;
      const { razorpay_payment_id, razorpay_signature } = req.body;

      if (!razorpay_payment_id) {
        return res.status(400).json({ error: 'Payment ID is required' });
      }

      // TODO: Verify Razorpay signature in production
      // const isValidSignature = verifyRazorpaySignature(...);
      // if (!isValidSignature) {
      //   return res.status(400).json({ error: 'Invalid payment signature' });
      // }

      const order = await orderService.confirmPayment(orderId, {
        razorpay_payment_id,
      });

      res.status(200).json(order);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/orders/:orderId/cancel - Cancel order
   */
  async cancelOrder(req, res, next) {
    try {
      const customerId = req.userId;
      const { orderId } = req.params;
      const { reason } = req.body;

      if (!customerId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const order = await orderService.cancelOrder(orderId, customerId, reason);

      res.status(200).json({ success: true, order });
    } catch (error) {
      if (error.message.includes('not found')) {
        return res.status(404).json({ error: error.message });
      }
      if (error.message.includes('Cannot cancel')) {
        return res.status(400).json({ error: error.message });
      }
      next(error);
    }
  }

  /**
   * POST /api/orders/:orderId/return - Request return
   */
  async requestReturn(req, res, next) {
    try {
      const customerId = req.userId;
      const { orderId } = req.params;
      const { reason, notes } = req.body;

      if (!customerId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      if (!reason) {
        return res.status(400).json({ error: 'Return reason is required' });
      }

      const returnRequest = await orderService.requestReturn(orderId, customerId, {
        reason,
        notes,
      });

      res.status(201).json(returnRequest);
    } catch (error) {
      if (error.message.includes('not found')) {
        return res.status(404).json({ error: error.message });
      }
      if (error.message.includes('Can only return')) {
        return res.status(400).json({ error: error.message });
      }
      next(error);
    }
  }

  /**
   * GET /api/orders/:orderId/events - Get order events/history
   */
  async getOrderEvents(req, res, next) {
    try {
      const { orderId } = req.params;

      const events = await orderService.getOrderEvents(orderId);

      res.status(200).json(events);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/orders/:orderId/status - Update order status (admin only)
   */
  async updateOrderStatus(req, res, next) {
    try {
      const { orderId } = req.params;
      const { status } = req.body;

      if (!status) {
        return res.status(400).json({ error: 'Status is required' });
      }

      const order = await orderService.updateOrderStatus(orderId, status);

      res.status(200).json(order);
    } catch (error) {
      if (error.message === 'Invalid order status') {
        return res.status(400).json({ error: error.message });
      }
      next(error);
    }
  }

  /**
   * GET /api/orders/stats - Get order statistics (admin only)
   */
  async getOrderStatistics(req, res, next) {
    try {
      const { startDate, endDate } = req.query;

      if (!startDate || !endDate) {
        return res.status(400).json({ error: 'Start and end dates are required' });
      }

      const stats = await orderService.getOrderStatistics(
        new Date(startDate),
        new Date(endDate)
      );

      res.status(200).json(stats);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new OrderController();

/**
 * Payment Service
 * Handles payment gateway integration (Razorpay)
 */

const Razorpay = require('razorpay');
const crypto = require('crypto');
const config = require('../config');

const razorpay = new Razorpay({
  key_id: config.externalApis.razorpay.keyId,
  key_secret: config.externalApis.razorpay.keySecret,
});

class PaymentService {
  /**
   * Create Razorpay order
   */
  async createRazorpayOrder(orderId, amount, customerEmail, customerPhone) {
    try {
      const options = {
        amount: Math.round(amount * 100), // Amount in paise
        currency: 'INR',
        receipt: orderId,
        payment_capture: 1, // Auto capture after payment
        customer_notify: 1,
        notes: {
          order_id: orderId,
          email: customerEmail,
          phone: customerPhone,
        },
      };

      const razorpayOrder = await razorpay.orders.create(options);

      return {
        id: razorpayOrder.id,
        order_id: orderId,
        amount: amount,
        currency: 'INR',
        status: razorpayOrder.status,
      };
    } catch (error) {
      console.error('Razorpay order creation failed:', error);
      throw new Error('Failed to create payment order');
    }
  }

  /**
   * Verify Razorpay payment signature
   */
  verifyPaymentSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature) {
    try {
      const body = razorpayOrderId + '|' + razorpayPaymentId;
      const expectedSignature = crypto
        .createHmac('sha256', config.externalApis.razorpay.keySecret)
        .update(body)
        .digest('hex');

      return expectedSignature === razorpaySignature;
    } catch (error) {
      console.error('Signature verification failed:', error);
      return false;
    }
  }

  /**
   * Get payment details from Razorpay
   */
  async getPaymentDetails(razorpayPaymentId) {
    try {
      const payment = await razorpay.payments.fetch(razorpayPaymentId);

      return {
        id: payment.id,
        order_id: payment.order_id,
        amount: payment.amount / 100, // Convert from paise
        currency: payment.currency,
        status: payment.status,
        method: payment.method,
        email: payment.email,
        phone: payment.contact,
        description: payment.description,
        created_at: new Date(payment.created_at * 1000),
      };
    } catch (error) {
      console.error('Failed to fetch payment details:', error);
      throw new Error('Failed to fetch payment details');
    }
  }

  /**
   * Refund payment
   */
  async refundPayment(razorpayPaymentId, amount, reason) {
    try {
      const options = {
        amount: Math.round(amount * 100), // Amount in paise
        notes: {
          reason: reason,
        },
      };

      const refund = await razorpay.payments.refund(razorpayPaymentId, options);

      return {
        id: refund.id,
        payment_id: razorpayPaymentId,
        amount: amount,
        status: refund.status,
        created_at: new Date(),
      };
    } catch (error) {
      console.error('Refund failed:', error);
      throw new Error('Failed to process refund');
    }
  }

  /**
   * Get payment status
   */
  async getPaymentStatus(razorpayPaymentId) {
    try {
      const payment = await razorpay.payments.fetch(razorpayPaymentId);

      return {
        status: payment.status, // authorized, captured, failed, refunded
        error_code: payment.error_code,
        error_description: payment.error_description,
      };
    } catch (error) {
      console.error('Failed to get payment status:', error);
      throw new Error('Failed to get payment status');
    }
  }

  /**
   * Validate webhook signature from Razorpay
   */
  validateWebhookSignature(webhookBody, webhookSignature) {
    try {
      const expectedSignature = crypto
        .createHmac('sha256', config.externalApis.razorpay.webhookSecret)
        .update(JSON.stringify(webhookBody))
        .digest('hex');

      return expectedSignature === webhookSignature;
    } catch (error) {
      console.error('Webhook signature validation failed:', error);
      return false;
    }
  }
}

module.exports = new PaymentService();

/**
 * Order Routes
 * All order-related endpoints
 */

const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

/**
 * @route POST /api/orders
 * @desc Create new order from cart
 * @access Private
 */
router.post('/', authMiddleware, orderController.createOrder);

/**
 * @route GET /api/orders
 * @desc Get customer orders
 * @access Private
 */
router.get('/', authMiddleware, orderController.getOrders);

/**
 * @route GET /api/orders/:orderId
 * @desc Get order details with events
 * @access Private
 */
router.get('/:orderId', authMiddleware, orderController.getOrder);

/**
 * @route POST /api/orders/:orderId/payment/initialize
 * @desc Initialize payment for order
 * @access Private
 */
router.post('/:orderId/payment/initialize', authMiddleware, orderController.initializePayment);

/**
 * @route POST /api/orders/:orderId/payment/confirm
 * @desc Confirm payment after Razorpay
 * @access Private
 */
router.post('/:orderId/payment/confirm', authMiddleware, orderController.confirmPayment);

/**
 * @route PUT /api/orders/:orderId/cancel
 * @desc Cancel order
 * @access Private
 */
router.put('/:orderId/cancel', authMiddleware, orderController.cancelOrder);

/**
 * @route POST /api/orders/:orderId/return
 * @desc Request return for order
 * @access Private
 */
router.post('/:orderId/return', authMiddleware, orderController.requestReturn);

/**
 * @route GET /api/orders/:orderId/events
 * @desc Get order events/history
 * @access Private
 */
router.get('/:orderId/events', authMiddleware, orderController.getOrderEvents);

/**
 * @route PUT /api/orders/:orderId/status
 * @desc Update order status (admin only)
 * @access Private Admin
 */
router.put('/:orderId/status', authMiddleware, adminMiddleware, orderController.updateOrderStatus);

/**
 * @route GET /api/orders/stats
 * @desc Get order statistics (admin only)
 * @access Private Admin
 */
router.get('/stats/dashboard', authMiddleware, adminMiddleware, orderController.getOrderStatistics);

module.exports = router;

/**
 * Main API Router
 * Combines all route modules
 */

const express = require('express');
const router = express.Router();

// Import route modules
const productsRouter = require('./products');
const cartRouter = require('./cart');
const inventoryRouter = require('./inventory');
const ordersRouter = require('./orders');
const adminRouter = require('./admin');
const imagesRouter = require('./images');

// Mount routes
router.use('/products', productsRouter);
router.use('/cart', cartRouter);
router.use('/inventory', inventoryRouter);
router.use('/orders', ordersRouter);
router.use('/admin', adminRouter);
router.use('/images', imagesRouter);

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

module.exports = router;

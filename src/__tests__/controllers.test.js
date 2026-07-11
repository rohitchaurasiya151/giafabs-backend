/**
 * Controller Tests
 * Unit tests for HTTP request handlers
 */

const request = require('supertest');
const express = require('express');
const productController = require('../controllers/productController');
const cartController = require('../controllers/cartController');
const inventoryController = require('../controllers/inventoryController');
const VariantService = require('../services/variantService');
const CartService = require('../services/cartService');
const InventoryService = require('../services/inventoryService');

jest.mock('../services/variantService');
jest.mock('../services/cartService');
jest.mock('../services/inventoryService');

describe('Product Controller', () => {
  describe('GET /api/products/:id', () => {
    it('should return product with variants', async () => {
      const mockProduct = {
        id: 'prod-1',
        name: 'Silk Saree',
        variants: [{ id: 'var-1', size: 'M', pricing: {} }]
      };

      VariantService.getProductWithVariants.mockResolvedValue(mockProduct);

      const app = express();
      app.get('/api/products/:id', productController.getProduct);

      const res = await request(app).get('/api/products/prod-1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockProduct);
    });

    it('should return 404 if product not found', async () => {
      VariantService.getProductWithVariants.mockResolvedValue(null);

      const app = express();
      app.get('/api/products/:id', productController.getProduct);

      const res = await request(app).get('/api/products/invalid');

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/variants/:id', () => {
    it('should return variant details with costs', async () => {
      const mockVariant = {
        id: 'var-1',
        sku: 'SILK-001-M',
        costs: { material_cost: 2500 }
      };

      VariantService.getVariantDetails.mockResolvedValue(mockVariant);

      const app = express();
      app.get('/api/variants/:id', productController.getVariant);

      const res = await request(app).get('/api/variants/var-1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockVariant);
    });
  });

  describe('POST /api/variants/:id/pricing', () => {
    it('should update variant pricing', async () => {
      const mockPricing = {
        id: 'price-1',
        mrp: 6999,
        selling_price: 5999
      };

      VariantService.updatePricing.mockResolvedValue(mockPricing);

      const app = express();
      app.use(express.json());
      app.post('/api/variants/:id/pricing', productController.updatePricing);

      const res = await request(app)
        .post('/api/variants/var-1/pricing')
        .send({ mrp: 6999, selling_price: 5999 })
        .set('Authorization', 'Bearer admin-token');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockPricing);
    });

    it('should return 400 on pricing validation error', async () => {
      VariantService.updatePricing.mockRejectedValue(
        new Error('Pricing validation failed')
      );

      const app = express();
      app.use(express.json());
      app.post('/api/variants/:id/pricing', productController.updatePricing);
      app.use((err, req, res, next) => {
        res.status(400).json({ error: err.message });
      });

      const res = await request(app)
        .post('/api/variants/var-1/pricing')
        .send({ mrp: 5000, selling_price: 6000 });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/variants/:id/costs', () => {
    it('should update variant costs', async () => {
      const mockCosts = {
        id: 'cost-1',
        material_cost: 2500,
        labor_cost: 800
      };

      VariantService.updateCosts.mockResolvedValue(mockCosts);

      const app = express();
      app.use(express.json());
      app.post('/api/variants/:id/costs', productController.updateCosts);

      const res = await request(app)
        .post('/api/variants/var-1/costs')
        .send(mockCosts)
        .set('Authorization', 'Bearer admin-token');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockCosts);
    });
  });

  describe('GET /api/variants/:id/pricing/history', () => {
    it('should return pricing history', async () => {
      const mockHistory = [
        { mrp: 6999, selling_price: 5999, created_at: '2024-01-01' }
      ];

      VariantService.getPricingHistory.mockResolvedValue(mockHistory);

      const app = express();
      app.get('/api/variants/:id/pricing/history', productController.getPricingHistory);

      const res = await request(app).get('/api/variants/var-1/pricing/history');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockHistory);
    });
  });
});

describe('Cart Controller', () => {
  describe('GET /api/cart', () => {
    it('should return customer cart', async () => {
      const mockCart = [
        { product_id: 'prod-1', size: 'M', qty: 1, selling_price: 5999 }
      ];

      CartService.getCart.mockResolvedValue(mockCart);

      const app = express();
      app.get('/api/cart', (req, res) => {
        req.userId = 'cust-1';
        cartController.getCart(req, res);
      });

      const res = await request(app).get('/api/cart');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockCart);
    });
  });

  describe('POST /api/cart/add', () => {
    it('should add item to cart with stock reservation', async () => {
      CartService.addToCart.mockResolvedValue({ success: true });

      const app = express();
      app.use(express.json());
      app.post('/api/cart/add', (req, res) => {
        req.userId = 'cust-1';
        cartController.addToCart(req, res);
      });

      const res = await request(app)
        .post('/api/cart/add')
        .send({
          productId: 'prod-1',
          variantId: 'var-1',
          size: 'M',
          qty: 1
        });

      expect(res.status).toBe(200);
      expect(CartService.addToCart).toHaveBeenCalled();
    });

    it('should return 400 if out of stock', async () => {
      const error = new Error('OUT_OF_STOCK');
      error.available = 0;
      CartService.addToCart.mockRejectedValue(error);

      const app = express();
      app.use(express.json());
      app.post('/api/cart/add', (req, res) => {
        req.userId = 'cust-1';
        cartController.addToCart(req, res);
      });
      app.use((err, req, res, next) => {
        res.status(400).json({ error: err.message, available: err.available });
      });

      const res = await request(app)
        .post('/api/cart/add')
        .send({ productId: 'prod-1', variantId: 'var-1', size: 'M', qty: 100 });

      expect(res.status).toBe(400);
    });
  });

  describe('PUT /api/cart/update', () => {
    it('should update cart item quantity', async () => {
      CartService.updateCartItem.mockResolvedValue({ success: true });

      const app = express();
      app.use(express.json());
      app.put('/api/cart/update', (req, res) => {
        req.userId = 'cust-1';
        cartController.updateCart(req, res);
      });

      const res = await request(app)
        .put('/api/cart/update')
        .send({
          productId: 'prod-1',
          size: 'M',
          qty: 2
        });

      expect(res.status).toBe(200);
      expect(CartService.updateCartItem).toHaveBeenCalled();
    });
  });

  describe('DELETE /api/cart/item', () => {
    it('should remove item from cart', async () => {
      CartService.removeFromCart.mockResolvedValue({ success: true });

      const app = express();
      app.use(express.json());
      app.delete('/api/cart/item', (req, res) => {
        req.userId = 'cust-1';
        cartController.removeFromCart(req, res);
      });

      const res = await request(app)
        .delete('/api/cart/item')
        .send({
          productId: 'prod-1',
          size: 'M'
        });

      expect(res.status).toBe(200);
      expect(CartService.removeFromCart).toHaveBeenCalled();
    });
  });

  describe('DELETE /api/cart', () => {
    it('should clear entire cart', async () => {
      CartService.clearCart.mockResolvedValue({ success: true });

      const app = express();
      app.delete('/api/cart', (req, res) => {
        req.userId = 'cust-1';
        cartController.clearCart(req, res);
      });

      const res = await request(app).delete('/api/cart');

      expect(res.status).toBe(200);
      expect(CartService.clearCart).toHaveBeenCalled();
    });
  });
});

describe('Inventory Controller', () => {
  describe('GET /api/inventory/availability', () => {
    it('should check stock availability', async () => {
      InventoryService.checkAvailability.mockResolvedValue(50);

      const app = express();
      app.get('/api/inventory/availability', inventoryController.checkAvailability);

      const res = await request(app)
        .get('/api/inventory/availability')
        .query({ variantId: 'var-1', qty: 5 });

      expect(res.status).toBe(200);
      expect(res.body.available).toBe(50);
    });

    it('should return 404 if variant not found', async () => {
      InventoryService.checkAvailability.mockRejectedValue(
        new Error('Variant not found')
      );

      const app = express();
      app.get('/api/inventory/availability', inventoryController.checkAvailability);
      app.use((err, req, res, next) => {
        res.status(404).json({ error: err.message });
      });

      const res = await request(app)
        .get('/api/inventory/availability')
        .query({ variantId: 'invalid', qty: 5 });

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/inventory/restock', () => {
    it('should record stock inbound', async () => {
      InventoryService.recordStockIn.mockResolvedValue({ id: 'mov-1' });

      const app = express();
      app.use(express.json());
      app.post('/api/inventory/restock', (req, res) => {
        req.userId = 'admin-1';
        inventoryController.restock(req, res);
      });

      const res = await request(app)
        .post('/api/inventory/restock')
        .send({
          variantId: 'var-1',
          qty: 100,
          refId: 'PO-123',
          notes: 'Stock received'
        });

      expect(res.status).toBe(200);
      expect(InventoryService.recordStockIn).toHaveBeenCalled();
    });
  });

  describe('POST /api/inventory/adjust', () => {
    it('should adjust inventory', async () => {
      InventoryService.adjustStock.mockResolvedValue({ id: 'mov-1' });

      const app = express();
      app.use(express.json());
      app.post('/api/inventory/adjust', (req, res) => {
        req.userId = 'admin-1';
        inventoryController.adjustStock(req, res);
      });

      const res = await request(app)
        .post('/api/inventory/adjust')
        .send({
          variantId: 'var-1',
          qty: -5,
          reason: 'shrinkage',
          notes: 'Reconciliation'
        });

      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/inventory/movements/:variantId', () => {
    it('should return movement history', async () => {
      const mockHistory = [
        { id: 'mov-1', qty: 100, type: 'stock_in', created_at: '2024-01-01' }
      ];

      InventoryService.getMovementHistory.mockResolvedValue(mockHistory);

      const app = express();
      app.get('/api/inventory/movements/:variantId', inventoryController.getMovementHistory);

      const res = await request(app).get('/api/inventory/movements/var-1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockHistory);
    });
  });

  describe('GET /api/inventory/low-stock', () => {
    it('should return low stock variants', async () => {
      const mockLowStock = [
        { variant_id: 'var-1', sku: 'SILK-001-M', available_qty: 5 }
      ];

      InventoryService.getLowStockVariants.mockResolvedValue(mockLowStock);

      const app = express();
      app.get('/api/inventory/low-stock', inventoryController.getLowStock);

      const res = await request(app).get('/api/inventory/low-stock');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockLowStock);
    });
  });

  describe('POST /api/inventory/cleanup', () => {
    it('should cleanup expired reservations', async () => {
      InventoryService.cleanupExpiredReservations.mockResolvedValue(5);

      const app = express();
      app.post('/api/inventory/cleanup', (req, res) => {
        req.userId = 'admin-1';
        inventoryController.cleanupExpiredReservations(req, res);
      });

      const res = await request(app).post('/api/inventory/cleanup');

      expect(res.status).toBe(200);
      expect(res.body.cleaned).toBe(5);
    });
  });

  describe('POST /api/inventory/validate', () => {
    it('should validate inventory consistency', async () => {
      InventoryService.validateInventoryConsistency.mockResolvedValue({
        isConsistent: true
      });

      const app = express();
      app.use(express.json());
      app.post('/api/inventory/validate', (req, res) => {
        req.userId = 'admin-1';
        inventoryController.validateConsistency(req, res);
      });

      const res = await request(app)
        .post('/api/inventory/validate')
        .send({ variantId: 'var-1' });

      expect(res.status).toBe(200);
      expect(res.body.isConsistent).toBe(true);
    });
  });
});

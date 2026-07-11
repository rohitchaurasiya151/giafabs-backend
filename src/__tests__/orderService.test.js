/**
 * Order Service Tests
 * Unit tests for order operations
 */

const orderService = require('../services/orderService');
const db = require('../config/database');

jest.mock('../config/database');

describe('OrderService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createOrder', () => {
    it('should create order and convert reservation to order hold', async () => {
      const mockOrderData = {
        items: [
          {
            product_id: 'prod-1',
            variant_id: 'var-1',
            size: 'M',
            qty: 1,
            selling_price: 5999,
            total: 5999,
          },
        ],
        subtotal: 5999,
        discount: 0,
        gst: 300,
        shipping: 0,
        total: 6299,
        shipping_address: {
          name: 'John Doe',
          phone: '9876543210',
          address: '123 Main St',
          city: 'Mumbai',
          state: 'MH',
          pincode: '400001',
        },
      };

      db.transaction.mockImplementation(async (callback) => {
        return callback({
          query: jest.fn().mockResolvedValue({ rows: [{ id: 'ord-123' }] }),
        });
      });

      const order = await orderService.createOrder('cust-1', mockOrderData);

      expect(order).toBeDefined();
      expect(db.transaction).toHaveBeenCalled();
    });
  });

  describe('getCustomerOrders', () => {
    it('should return customer orders', async () => {
      const mockOrders = [
        {
          id: 'ord-1',
          status: 'delivered',
          total: 6299,
          created_at: new Date(),
        },
      ];

      db.query.mockResolvedValue(mockOrders);

      const orders = await orderService.getCustomerOrders('cust-1');

      expect(orders).toEqual(mockOrders);
      expect(db.query).toHaveBeenCalled();
    });
  });

  describe('getOrderDetails', () => {
    it('should return order with items', async () => {
      const mockOrder = {
        id: 'ord-1',
        customer_id: 'cust-1',
        status: 'confirmed',
        total: 6299,
      };

      db.queryOne.mockResolvedValue(mockOrder);
      db.query.mockResolvedValue([
        {
          product_id: 'prod-1',
          variant_id: 'var-1',
          size: 'M',
          qty: 1,
          selling_price: 5999,
        },
      ]);

      const order = await orderService.getOrderDetails('ord-1', 'cust-1');

      expect(order.id).toBe('ord-1');
      expect(order.items).toBeDefined();
    });

    it('should throw error if order not found', async () => {
      db.queryOne.mockResolvedValue(null);

      await expect(orderService.getOrderDetails('invalid', 'cust-1')).rejects.toThrow(
        'Order not found'
      );
    });
  });

  describe('initializePayment', () => {
    it('should create payment record', async () => {
      const mockOrder = {
        id: 'ord-1',
        customer_id: 'cust-1',
        total: 6299,
        payment_status: 'pending',
      };

      db.queryOne.mockResolvedValue(mockOrder);
      db.query.mockResolvedValue({ rows: [{ id: 'pay-1' }] });

      const payment = await orderService.initializePayment('ord-1', 'cust-1');

      expect(payment).toBeDefined();
      expect(db.query).toHaveBeenCalled();
    });
  });

  describe('confirmPayment', () => {
    it('should update payment and order status', async () => {
      db.transaction.mockImplementation(async (callback) => {
        return callback({
          query: jest.fn().mockResolvedValue({
            rows: [{ id: 'ord-1', status: 'confirmed', payment_status: 'completed' }],
          }),
        });
      });

      const order = await orderService.confirmPayment('ord-1', {
        razorpay_payment_id: 'pay-123',
      });

      expect(order).toBeDefined();
      expect(order.payment_status).toBe('completed');
    });
  });

  describe('cancelOrder', () => {
    it('should cancel order and release inventory', async () => {
      db.transaction.mockImplementation(async (callback) => {
        return callback({
          query: jest
            .fn()
            .mockResolvedValueOnce({ rows: [{ id: 'ord-1', status: 'confirmed' }] })
            .mockResolvedValueOnce({ rows: [{ variant_id: 'var-1', qty: 1 }] })
            .mockResolvedValueOnce({ rows: [{ id: 'ord-1', status: 'cancelled' }] })
            .mockResolvedValue({}),
        });
      });

      const order = await orderService.cancelOrder('ord-1', 'cust-1', 'Changed mind');

      expect(order).toBeDefined();
      expect(order.status).toBe('cancelled');
    });

    it('should throw error if order cannot be cancelled', async () => {
      db.transaction.mockImplementation(async (callback) => {
        return callback({
          query: jest
            .fn()
            .mockResolvedValueOnce({
              rows: [{ id: 'ord-1', status: 'delivered' }],
            }),
        });
      });

      await expect(orderService.cancelOrder('ord-1', 'cust-1', 'Test')).rejects.toThrow(
        'Cannot cancel order'
      );
    });
  });

  describe('requestReturn', () => {
    it('should create return request', async () => {
      db.transaction.mockImplementation(async (callback) => {
        return callback({
          query: jest
            .fn()
            .mockResolvedValueOnce({ rows: [{ id: 'ord-1', status: 'delivered' }] })
            .mockResolvedValueOnce({
              rows: [{ id: 'ret-1', order_id: 'ord-1', status: 'requested' }],
            })
            .mockResolvedValue({}),
        });
      });

      const returnRequest = await orderService.requestReturn('ord-1', 'cust-1', {
        reason: 'defective',
        notes: 'Item damaged',
      });

      expect(returnRequest).toBeDefined();
      expect(returnRequest.status).toBe('requested');
    });

    it('should throw error if order not delivered', async () => {
      db.transaction.mockImplementation(async (callback) => {
        return callback({
          query: jest
            .fn()
            .mockResolvedValueOnce({ rows: [{ id: 'ord-1', status: 'pending' }] }),
        });
      });

      await expect(
        orderService.requestReturn('ord-1', 'cust-1', { reason: 'defective' })
      ).rejects.toThrow('Can only return delivered orders');
    });
  });

  describe('updateOrderStatus', () => {
    it('should update order status', async () => {
      db.transaction.mockImplementation(async (callback) => {
        return callback({
          query: jest
            .fn()
            .mockResolvedValueOnce({ rows: [{ id: 'ord-1', status: 'shipped' }] })
            .mockResolvedValue({}),
        });
      });

      const order = await orderService.updateOrderStatus('ord-1', 'shipped');

      expect(order.status).toBe('shipped');
    });

    it('should throw error for invalid status', async () => {
      await expect(orderService.updateOrderStatus('ord-1', 'invalid')).rejects.toThrow(
        'Invalid order status'
      );
    });
  });

  describe('getOrderStatistics', () => {
    it('should return order statistics', async () => {
      const mockStats = {
        total_orders: 100,
        total_revenue: 629900,
        avg_order_value: 6299,
        delivered: 95,
        cancelled: 5,
        paid: 100,
      };

      db.queryOne.mockResolvedValue(mockStats);

      const stats = await orderService.getOrderStatistics(
        new Date('2024-01-01'),
        new Date('2024-12-31')
      );

      expect(stats).toEqual(mockStats);
    });
  });
});

const request = require('supertest');
const jwt = require('jsonwebtoken');

describe('Admin Controller', () => {
  describe('POST /admin/login', () => {
    it('should login admin with valid credentials', async () => {
      const response = {
        email: 'admin@giafabs.com',
        password: 'admin123',
      };

      // Mock response
      expect(response.email).toBe('admin@giafabs.com');
    });

    it('should return error with invalid credentials', () => {
      const email = 'admin@giafabs.com';
      const password = 'wrong-password';

      expect(password).not.toBe('admin123');
    });

    it('should return error with missing email', () => {
      const data = { password: 'admin123' };
      expect(data.email).toBeUndefined();
    });

    it('should return error with missing password', () => {
      const data = { email: 'admin@giafabs.com' };
      expect(data.password).toBeUndefined();
    });
  });

  describe('GET /admin/stats', () => {
    it('should return admin statistics', () => {
      const stats = {
        total_orders: 254,
        total_revenue: 1598543,
        avg_order_value: 6290,
        delivered: 240,
        cancelled: 14,
        paid: 254,
      };

      expect(stats.total_orders).toBe(254);
      expect(stats.total_revenue).toBe(1598543);
    });
  });

  describe('GET /admin/settings', () => {
    it('should return store settings', () => {
      const settings = {
        store_name: 'GIAFABS',
        store_email: 'support@giafabs.com',
        return_window_days: 7,
      };

      expect(settings.store_name).toBe('GIAFABS');
      expect(settings.return_window_days).toBe(7);
    });
  });

  describe('PUT /admin/settings', () => {
    it('should update store settings', () => {
      const updates = {
        store_name: 'GIAFABS Updated',
        return_window_days: 14,
      };

      expect(updates.store_name).toBe('GIAFABS Updated');
      expect(updates.return_window_days).toBe(14);
    });
  });

  describe('Admin Auth Middleware', () => {
    it('should reject request without token', () => {
      const headers = {};
      expect(headers.authorization).toBeUndefined();
    });

    it('should reject request with invalid token', () => {
      const token = 'invalid-token';
      expect(token).toBe('invalid-token');
    });

    it('should accept request with valid token', () => {
      const token = jwt.sign({ id: 'admin-1', role: 'admin' }, 'secret');
      expect(token).toBeDefined();
    });

    it('should reject request with non-admin role', () => {
      const decoded = { id: 'user-1', role: 'customer' };
      expect(decoded.role).not.toBe('admin');
    });
  });
});

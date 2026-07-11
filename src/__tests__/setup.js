/**
 * Jest Setup File
 * Global test configuration and helpers
 */

// Suppress console output during tests (optional)
global.console.log = jest.fn();
global.console.info = jest.fn();
global.console.warn = jest.fn();

// Mock database connection
jest.mock('../config/database', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
  transaction: jest.fn(),
  getPool: jest.fn()
}));

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.PGHOST = 'localhost';
process.env.PGPORT = '5432';
process.env.PGUSER = 'postgres';
process.env.PGPASSWORD = 'test';
process.env.PGDATABASE = 'test_db';

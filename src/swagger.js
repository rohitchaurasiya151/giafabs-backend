/**
 * Swagger/OpenAPI Documentation
 * Auto-generated API documentation for GIAFABS Backend
 */

const swaggerJsDoc = require('swagger-jsdoc');
const config = require('./config');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'GIAFABS Backend API',
      version: '1.0.0',
      description: 'Enterprise handloom e-commerce backend with variant management',
      contact: {
        name: 'GIAFABS Support',
        email: 'support@giafabs.com'
      }
    },
    servers: [
      {
        url: `http://localhost:${config.server.port}`,
        description: 'Development server'
      },
      {
        url: 'https://api.giafabs.com',
        description: 'Production server'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        }
      },
      schemas: {
        Product: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            brand: { type: 'string' },
            category: { type: 'string' },
            description: { type: 'string' },
            images: { type: 'array', items: { type: 'string' } }
          }
        },
        Variant: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            product_id: { type: 'string' },
            sku: { type: 'string' },
            size: { type: 'string' },
            color: { type: 'string' }
          }
        },
        Pricing: {
          type: 'object',
          properties: {
            mrp: { type: 'number', format: 'float' },
            selling_price: { type: 'number', format: 'float' },
            b2b_price: { type: 'number', format: 'float' },
            discount_pct: { type: 'number', format: 'float' },
            gst_rate: { type: 'number', format: 'float' }
          }
        },
        Costs: {
          type: 'object',
          properties: {
            material_cost: { type: 'number', format: 'float' },
            labor_cost: { type: 'number', format: 'float' },
            packaging_cost: { type: 'number', format: 'float' },
            overhead_cost: { type: 'number', format: 'float' },
            total_cost: { type: 'number', format: 'float' }
          }
        },
        Inventory: {
          type: 'object',
          properties: {
            variant_id: { type: 'string' },
            on_hand_qty: { type: 'integer' },
            reserved_qty: { type: 'integer' },
            order_held_qty: { type: 'integer' },
            damaged_qty: { type: 'integer' },
            available_qty: { type: 'integer' }
          }
        },
        CartItem: {
          type: 'object',
          properties: {
            product_id: { type: 'string' },
            variant_id: { type: 'string' },
            size: { type: 'string' },
            qty: { type: 'integer' },
            selling_price: { type: 'number', format: 'float' },
            mrp: { type: 'number', format: 'float' }
          }
        },
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            code: { type: 'string' },
            message: { type: 'string' }
          }
        }
      }
    }
  },
  apis: ['./src/routes/*.js', './src/controllers/*.js']
};

const specs = swaggerJsDoc(options);

module.exports = specs;

/**
 * Product Controller
 * Handles product and variant endpoints
 */

const VariantService = require('../services/variantService');

class ProductController {
  /**
   * GET /api/products
   * List all products with pagination and filtering
   */
  static async listProducts(req, res, next) {
    try {
      const { page = 1, perPage = 10, search = '', category = '', status = 'active' } = req.query;

      // TODO: Query from database with filters
      // For now, return mock data
      const products = [
        { id: 'prod-1', name: 'Silk Saree', brand: 'GIAFABS', category: 'Ethnic', variants: 4, status: 'active', created_at: '2024-01-10' },
        { id: 'prod-2', name: 'Cotton Dupatta', brand: 'GIAFABS', category: 'Accessories', variants: 3, status: 'active', created_at: '2024-01-05' },
        { id: 'prod-3', name: 'Linen Kurta', brand: 'GIAFABS', category: 'Casual', variants: 2, status: 'inactive', created_at: '2024-01-01' },
      ];

      res.status(200).json({
        success: true,
        data: { products, total: products.length, page: parseInt(page), perPage: parseInt(perPage) }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/products/:id
   * Get product with all variants and pricing
   */
  static async getProduct(req, res, next) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_PRODUCT_ID', message: 'Product ID is required' }
        });
      }

      const product = await VariantService.getProductWithVariants(id);

      if (!product) {
        return res.status(404).json({
          success: false,
          error: { code: 'PRODUCT_NOT_FOUND', message: `Product ${id} not found` }
        });
      }

      res.status(200).json({
        success: true,
        data: product
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/variants/:id
   * Get variant details with pricing and costs (admin only)
   */
  static async getVariant(req, res, next) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_VARIANT_ID', message: 'Variant ID is required' }
        });
      }

      // Check if user is admin (TODO: add auth middleware)
      // if (req.user.role !== 'admin') {
      //   return res.status(403).json({ success: false, error: 'Admin only' });
      // }

      const variant = await VariantService.getVariantDetails(id);

      if (!variant) {
        return res.status(404).json({
          success: false,
          error: { code: 'VARIANT_NOT_FOUND', message: `Variant ${id} not found` }
        });
      }

      res.status(200).json({
        success: true,
        data: variant
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/variants/:id/pricing
   * Update variant pricing
   */
  static async updatePricing(req, res, next) {
    try {
      const { id } = req.params;
      const { mrp, selling_price, b2b_price, discount_pct, gst_rate, reason } = req.body;
      const userId = req.user?.id || 'admin'; // TODO: get from auth middleware

      // Validate input
      if (!mrp || !selling_price) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_FIELDS', message: 'MRP and selling_price are required' }
        });
      }

      try {
        const pricing = await VariantService.updatePricing(
          id,
          { mrp, selling_price, b2b_price, discount_pct, gst_rate: gst_rate || 5, reason },
          userId
        );

        res.status(200).json({
          success: true,
          data: pricing
        });
      } catch (validationError) {
        if (validationError.message.includes('Pricing validation failed')) {
          return res.status(422).json({
            success: false,
            error: { code: 'PRICING_VALIDATION_FAILED', message: validationError.message }
          });
        }
        throw validationError;
      }
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/variants/:id/costs
   * Update variant costs (COGS)
   */
  static async updateCosts(req, res, next) {
    try {
      const { id } = req.params;
      const { material_cost, labor_cost, packaging_cost, overhead_cost } = req.body;
      const userId = req.user?.id || 'admin'; // TODO: get from auth middleware

      // Validate input
      if (material_cost === undefined || labor_cost === undefined) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_FIELDS', message: 'material_cost and labor_cost are required' }
        });
      }

      try {
        const costs = await VariantService.updateCosts(
          id,
          { material_cost, labor_cost, packaging_cost: packaging_cost || 0, overhead_cost: overhead_cost || 0 },
          userId
        );

        res.status(200).json({
          success: true,
          data: costs
        });
      } catch (validationError) {
        if (validationError.message.includes('Margin too low')) {
          return res.status(422).json({
            success: false,
            error: { code: 'MARGIN_THRESHOLD_FAILED', message: validationError.message }
          });
        }
        throw validationError;
      }
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/variants/:id/pricing/history
   * Get pricing history for audit
   */
  static async getPricingHistory(req, res, next) {
    try {
      const { id } = req.params;
      const limit = parseInt(req.query.limit || 10, 10);

      if (!id) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_VARIANT_ID', message: 'Variant ID is required' }
        });
      }

      const history = await VariantService.getPricingHistory(id, Math.min(limit, 100));

      res.status(200).json({
        success: true,
        data: history
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = ProductController;

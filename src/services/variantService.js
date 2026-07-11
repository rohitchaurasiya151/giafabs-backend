/**
 * Variant Service
 * Handles all product variant operations (sizes, SKU, pricing, costs, inventory)
 */

const db = require('../config/database');

class VariantService {
  /**
   * Get product with all variants and pricing
   */
  static async getProductWithVariants(productId) {
    const query = `
      SELECT
        p.id,
        p.name,
        p.description,
        p.brand,
        p.category,
        p.created_at,
        json_agg(
          json_build_object(
            'id', v.id,
            'sku', v.sku,
            'size', ps.size,
            'size_order', ps.size_order,
            'pricing', json_build_object(
              'mrp', vp.mrp,
              'selling_price', vp.selling_price,
              'b2b_price', vp.b2b_price,
              'discount_pct', vp.discount_pct,
              'gst_rate', vp.gst_rate
            ),
            'inventory', json_build_object(
              'on_hand', vi.on_hand_qty,
              'reserved', vi.reserved_qty,
              'order_held', vi.order_held_qty,
              'damaged', vi.damaged_qty,
              'available', vi.available_qty
            ),
            'status', v.status
          ) ORDER BY ps.size_order
        ) as variants
      FROM products p
      LEFT JOIN product_variants v ON p.id = v.product_id AND v.status = 'active'
      LEFT JOIN product_sizes ps ON v.size_id = ps.id
      LEFT JOIN variant_pricing vp ON v.id = vp.variant_id AND vp.valid_to IS NULL
      LEFT JOIN variant_inventory vi ON v.id = vi.variant_id
      WHERE p.id = $1
      GROUP BY p.id, p.name, p.description, p.brand, p.category, p.created_at;
    `;
    return db.queryOne(query, [productId]);
  }

  /**
   * Get specific variant details with costs (admin only)
   */
  static async getVariantDetails(variantId) {
    const query = `
      SELECT *
      FROM v_variant_details
      WHERE variant_id = $1;
    `;
    return db.queryOne(query, [variantId]);
  }

  /**
   * Create new product with sizes
   */
  static async createProduct(productData, sizes) {
    return db.transaction(async (client) => {
      // Create product
      const productQuery = `
        INSERT INTO products (
          id, sku, name, description, category, brand,
          price, mrp, cost, gst, active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 12, true)
        RETURNING *;
      `;

      const product = await client.query(productQuery, [
        productData.id,
        productData.sku_prefix,
        productData.name,
        productData.description,
        productData.category,
        productData.brand,
        productData.price,
        productData.mrp,
        productData.cost,
      ]);

      // Create sizes
      for (let i = 0; i < sizes.length; i++) {
        const sizeQuery = `
          INSERT INTO product_sizes (product_id, size, size_order, is_active)
          VALUES ($1, $2, $3, true);
        `;
        await client.query(sizeQuery, [productData.id, sizes[i], i + 1]);
      }

      return product.rows[0];
    });
  }

  /**
   * Create variant with pricing and costs
   */
  static async createVariant(variantData) {
    return db.transaction(async (client) => {
      // Create variant
      const variantQuery = `
        INSERT INTO product_variants (
          product_id, size_id, sku, barcode, weight_kg, color, material, status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
        RETURNING *;
      `;

      const variant = await client.query(variantQuery, [
        variantData.product_id,
        variantData.size_id,
        variantData.sku,
        variantData.barcode,
        variantData.weight_kg,
        variantData.color,
        variantData.material,
      ]);

      const variantId = variant.rows[0].id;

      // Create pricing
      const pricingQuery = `
        INSERT INTO variant_pricing (
          variant_id, mrp, selling_price, b2b_price, discount_pct, gst_rate
        )
        VALUES ($1, $2, $3, $4, $5, $6);
      `;

      await client.query(pricingQuery, [
        variantId,
        variantData.mrp,
        variantData.selling_price,
        variantData.b2b_price || null,
        variantData.discount_pct || 0,
        variantData.gst_rate || 5,
      ]);

      // Create costs
      const costsQuery = `
        INSERT INTO variant_costs (
          variant_id, material_cost, labor_cost, packaging_cost, overhead_cost
        )
        VALUES ($1, $2, $3, $4, $5);
      `;

      await client.query(costsQuery, [
        variantId,
        variantData.material_cost,
        variantData.labor_cost,
        variantData.packaging_cost || 0,
        variantData.overhead_cost || 0,
      ]);

      // Create inventory
      const inventoryQuery = `
        INSERT INTO variant_inventory (
          variant_id, on_hand_qty, reorder_level
        )
        VALUES ($1, $2, $3);
      `;

      await client.query(inventoryQuery, [
        variantId,
        variantData.initial_qty || 0,
        variantData.reorder_level || 10,
      ]);

      return variant.rows[0];
    });
  }

  /**
   * Update variant pricing
   */
  static async updatePricing(variantId, pricingData, userId) {
    return db.transaction(async (client) => {
      // Validate pricing
      this.validatePricing(pricingData);

      // End previous pricing
      const endQuery = `
        UPDATE variant_pricing
        SET valid_to = NOW()
        WHERE variant_id = $1 AND valid_to IS NULL;
      `;
      await client.query(endQuery, [variantId]);

      // Create new pricing
      const newQuery = `
        INSERT INTO variant_pricing (
          variant_id, mrp, selling_price, b2b_price, discount_pct, gst_rate, reason, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *;
      `;

      const result = await client.query(newQuery, [
        variantId,
        pricingData.mrp,
        pricingData.selling_price,
        pricingData.b2b_price || null,
        pricingData.discount_pct || 0,
        pricingData.gst_rate || 5,
        pricingData.reason,
        userId,
      ]);

      return result.rows[0];
    });
  }

  /**
   * Update variant costs
   */
  static async updateCosts(variantId, costsData, userId) {
    return db.transaction(async (client) => {
      // Validate costs
      this.validateCosts(costsData);

      // Get current pricing to check margin
      const pricingQuery = `
        SELECT selling_price FROM variant_pricing
        WHERE variant_id = $1 AND valid_to IS NULL;
      `;
      const pricing = await client.query(pricingQuery, [variantId]);

      if (pricing.rows.length === 0) {
        throw new Error('Variant pricing not found');
      }

      const totalCogs = costsData.material_cost + costsData.labor_cost +
                       (costsData.packaging_cost || 0) + (costsData.overhead_cost || 0);
      const marginPct = ((pricing.rows[0].selling_price - totalCogs) /
                        pricing.rows[0].selling_price * 100);

      if (marginPct < 20) {
        throw new Error(`Margin too low: ${marginPct.toFixed(1)}% (minimum: 20%)`);
      }

      // Create new cost record
      const costQuery = `
        INSERT INTO variant_costs (
          variant_id, material_cost, labor_cost, packaging_cost, overhead_cost, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *;
      `;

      const result = await client.query(costQuery, [
        variantId,
        costsData.material_cost,
        costsData.labor_cost,
        costsData.packaging_cost || 0,
        costsData.overhead_cost || 0,
        userId,
      ]);

      return result.rows[0];
    });
  }

  /**
   * Validate pricing rules
   */
  static validatePricing(pricing) {
    const errors = [];

    if (!pricing.mrp || pricing.mrp <= 0) {
      errors.push('MRP must be positive');
    }

    if (!pricing.selling_price || pricing.selling_price <= 0) {
      errors.push('Selling price must be positive');
    }

    if (pricing.selling_price > pricing.mrp) {
      errors.push('Selling price cannot exceed MRP');
    }

    if (pricing.b2b_price && pricing.b2b_price > pricing.selling_price) {
      errors.push('B2B price cannot exceed selling price');
    }

    if (pricing.discount_pct && pricing.discount_pct > 40) {
      errors.push('Discount cannot exceed 40%');
    }

    if (errors.length > 0) {
      throw new Error(`Pricing validation failed: ${errors.join(', ')}`);
    }
  }

  /**
   * Validate cost rules
   */
  static validateCosts(costs) {
    const errors = [];

    if (!costs.material_cost || costs.material_cost < 0) {
      errors.push('Material cost cannot be negative');
    }

    if (!costs.labor_cost || costs.labor_cost < 0) {
      errors.push('Labor cost cannot be negative');
    }

    if (errors.length > 0) {
      throw new Error(`Cost validation failed: ${errors.join(', ')}`);
    }
  }

  /**
   * Calculate margin percentage
   */
  static calculateMargin(sellingPrice, totalCogs) {
    if (sellingPrice <= 0) return 0;
    return ((sellingPrice - totalCogs) / sellingPrice * 100);
  }

  /**
   * Get pricing history for audit
   */
  static async getPricingHistory(variantId, limit = 10) {
    const query = `
      SELECT *
      FROM variant_pricing
      WHERE variant_id = $1
      ORDER BY created_at DESC
      LIMIT $2;
    `;
    return db.query(query, [variantId, limit]);
  }
}

module.exports = VariantService;

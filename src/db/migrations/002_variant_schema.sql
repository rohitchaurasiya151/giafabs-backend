-- ════════════════════════════════════════════════════════════════════════════════
-- GIAFABS - Database Migration: Product Variant Management Schema
-- Manages sizes, pricing, costs, and inventory at variant level
-- Created: 2026-07-08
-- ════════════════════════════════════════════════════════════════════════════════

-- ════ SECTION 1: CORE VARIANT TABLES ════════════════════════════════════════════

-- Product Sizes Master List
-- Defines available sizes for a product (S, M, L, XL, Free Size, etc.)
CREATE TABLE IF NOT EXISTS product_sizes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id VARCHAR(50) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size VARCHAR(20) NOT NULL,
  size_order INT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_product_size UNIQUE (product_id, size),
  CONSTRAINT valid_size_name CHECK (size != ''),
  CONSTRAINT valid_size_order CHECK (size_order > 0)
);

-- Product Variants (SKU Level)
-- Unique combination of product + size creates a distinct SKU
-- This is what customers actually purchase
CREATE TABLE IF NOT EXISTS product_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id VARCHAR(50) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size_id UUID NOT NULL REFERENCES product_sizes(id) ON DELETE CASCADE,
  sku VARCHAR(50) NOT NULL UNIQUE,
  barcode VARCHAR(100) UNIQUE,
  weight_kg NUMERIC(8, 3),
  color VARCHAR(50),
  material VARCHAR(100),
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT valid_sku CHECK (sku != ''),
  CONSTRAINT valid_status CHECK (status IN ('active', 'inactive')),
  CONSTRAINT valid_weight CHECK (weight_kg > 0 OR weight_kg IS NULL)
);

-- ════ SECTION 2: PRICING ════════════════════════════════════════════════════════

-- Variant Pricing (with full history)
-- Each size can have different pricing
-- Keeps history for audit trail and regulatory compliance
CREATE TABLE IF NOT EXISTS variant_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  mrp NUMERIC(10, 2) NOT NULL,
  selling_price NUMERIC(10, 2) NOT NULL,
  b2b_price NUMERIC(10, 2),
  discount_pct NUMERIC(5, 2) DEFAULT 0,
  discount_amount NUMERIC(10, 2),
  gst_rate NUMERIC(5, 2) NOT NULL DEFAULT 5,
  valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_to TIMESTAMPTZ,
  effective_date TIMESTAMPTZ,
  reason VARCHAR(255),
  created_by VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT valid_mrp CHECK (mrp > 0),
  CONSTRAINT valid_selling_price CHECK (selling_price > 0 AND selling_price <= mrp),
  CONSTRAINT valid_b2b_price CHECK (b2b_price IS NULL OR (b2b_price > 0 AND b2b_price <= selling_price)),
  CONSTRAINT valid_discount_pct CHECK (discount_pct >= 0 AND discount_pct <= 100),
  CONSTRAINT valid_gst_rate CHECK (gst_rate >= 0 AND gst_rate <= 100),
  CONSTRAINT valid_date_range CHECK (valid_to IS NULL OR valid_to > valid_from)
);

-- ════ SECTION 3: COSTS ══════════════════════════════════════════════════════════

-- Variant Costs (COGS breakdown)
-- Tracks cost of goods sold with breakdown by component
-- Used for margin calculation and profitability analysis
CREATE TABLE IF NOT EXISTS variant_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  material_cost NUMERIC(10, 2) NOT NULL,
  labor_cost NUMERIC(10, 2) NOT NULL,
  packaging_cost NUMERIC(10, 2) NOT NULL DEFAULT 0,
  overhead_cost NUMERIC(10, 2) NOT NULL DEFAULT 0,
  total_cogs NUMERIC(10, 2) GENERATED ALWAYS AS (material_cost + labor_cost + packaging_cost + overhead_cost) STORED,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT,
  created_by VARCHAR(50),

  CONSTRAINT valid_material_cost CHECK (material_cost >= 0),
  CONSTRAINT valid_labor_cost CHECK (labor_cost >= 0),
  CONSTRAINT valid_packaging_cost CHECK (packaging_cost >= 0),
  CONSTRAINT valid_overhead_cost CHECK (overhead_cost >= 0)
);

-- ════ SECTION 4: INVENTORY ═════════════════════════════════════════════════════

-- Variant Inventory (Real-time stock tracking)
-- Tracks physical stock, reservations, and damage
-- available_qty is automatically calculated
CREATE TABLE IF NOT EXISTS variant_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id UUID NOT NULL UNIQUE REFERENCES product_variants(id) ON DELETE CASCADE,
  on_hand_qty INT NOT NULL DEFAULT 0,
  reserved_qty INT NOT NULL DEFAULT 0,
  order_held_qty INT NOT NULL DEFAULT 0,
  damaged_qty INT NOT NULL DEFAULT 0,
  available_qty INT GENERATED ALWAYS AS (on_hand_qty - reserved_qty - order_held_qty - damaged_qty) STORED,
  last_stock_check TIMESTAMPTZ,
  reorder_level INT NOT NULL DEFAULT 10,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT non_negative_on_hand CHECK (on_hand_qty >= 0),
  CONSTRAINT non_negative_reserved CHECK (reserved_qty >= 0),
  CONSTRAINT non_negative_order_held CHECK (order_held_qty >= 0),
  CONSTRAINT non_negative_damaged CHECK (damaged_qty >= 0),
  CONSTRAINT valid_reorder_level CHECK (reorder_level > 0)
);

-- ════ SECTION 5: RESERVATIONS ══════════════════════════════════════════════════

-- Stock Reservations (Prevent overselling)
-- Holds stock for cart (30 min) or order (permanent)
CREATE TABLE IF NOT EXISTS stock_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  cart_id VARCHAR(50),
  order_id VARCHAR(50) REFERENCES orders(id) ON DELETE CASCADE,
  qty_reserved INT NOT NULL,
  reservation_type VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at TIMESTAMPTZ,
  reason VARCHAR(255),

  CONSTRAINT valid_qty CHECK (qty_reserved > 0),
  CONSTRAINT valid_type CHECK (reservation_type IN ('cart', 'order')),
  CONSTRAINT valid_status CHECK (status IN ('active', 'released', 'expired', 'converted')),
  CONSTRAINT cart_or_order CHECK (
    (reservation_type = 'cart' AND cart_id IS NOT NULL AND order_id IS NULL) OR
    (reservation_type = 'order' AND order_id IS NOT NULL AND cart_id IS NULL)
  )
);

-- ════ SECTION 6: AUDIT TRAIL ════════════════════════════════════════════════════

-- Inventory Movements (Complete audit trail)
-- Every stock movement is logged for compliance and reconciliation
CREATE TABLE IF NOT EXISTS inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  movement_type VARCHAR(50) NOT NULL,
  qty INT NOT NULL,
  reference_id VARCHAR(100),
  reference_type VARCHAR(50),
  reason VARCHAR(255),
  notes TEXT,
  created_by VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT valid_type CHECK (
    movement_type IN ('stock_in', 'order', 'return', 'damage', 'adjustment', 'shrinkage')
  ),
  CONSTRAINT valid_qty CHECK (qty != 0)
);

-- ════ SECTION 7: INDEXES FOR PERFORMANCE ════════════════════════════════════════

-- Product Sizes Indexes
CREATE INDEX IF NOT EXISTS idx_product_sizes_product_id ON product_sizes(product_id);
CREATE INDEX IF NOT EXISTS idx_product_sizes_is_active ON product_sizes(is_active);

-- Product Variants Indexes
CREATE INDEX IF NOT EXISTS idx_product_variants_product_id ON product_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_size_id ON product_variants(size_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_sku ON product_variants(sku);
CREATE INDEX IF NOT EXISTS idx_product_variants_barcode ON product_variants(barcode);
CREATE INDEX IF NOT EXISTS idx_product_variants_status ON product_variants(status);

-- Variant Pricing Indexes
CREATE INDEX IF NOT EXISTS idx_variant_pricing_variant_id ON variant_pricing(variant_id);
CREATE INDEX IF NOT EXISTS idx_variant_pricing_effective_date ON variant_pricing(variant_id, effective_date DESC);
CREATE INDEX IF NOT EXISTS idx_variant_pricing_valid_range ON variant_pricing(valid_from, valid_to);

-- Variant Costs Indexes
CREATE INDEX IF NOT EXISTS idx_variant_costs_variant_id ON variant_costs(variant_id);
CREATE INDEX IF NOT EXISTS idx_variant_costs_effective_from ON variant_costs(variant_id, effective_from DESC);

-- Variant Inventory Indexes
CREATE INDEX IF NOT EXISTS idx_variant_inventory_available ON variant_inventory(available_qty);
CREATE INDEX IF NOT EXISTS idx_variant_inventory_low_stock ON variant_inventory(available_qty)
  WHERE available_qty < reorder_level;

-- Stock Reservations Indexes
CREATE INDEX IF NOT EXISTS idx_stock_reservations_variant_id ON stock_reservations(variant_id);
CREATE INDEX IF NOT EXISTS idx_stock_reservations_cart_id ON stock_reservations(cart_id);
CREATE INDEX IF NOT EXISTS idx_stock_reservations_order_id ON stock_reservations(order_id);
CREATE INDEX IF NOT EXISTS idx_stock_reservations_status ON stock_reservations(status);
CREATE INDEX IF NOT EXISTS idx_stock_reservations_expires ON stock_reservations(expires_at)
  WHERE status = 'active' AND reservation_type = 'cart';

-- Inventory Movements Indexes
CREATE INDEX IF NOT EXISTS idx_inventory_movements_variant_id ON inventory_movements(variant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_type ON inventory_movements(movement_type);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_created_at ON inventory_movements(variant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_reference ON inventory_movements(reference_id, reference_type);

-- ════ SECTION 8: CONSTRAINTS & TRIGGERS ═════════════════════════════════════════

-- Trigger: Update updated_at timestamp
CREATE OR REPLACE FUNCTION update_product_sizes_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trigger_product_sizes_update
BEFORE UPDATE ON product_sizes
FOR EACH ROW
EXECUTE FUNCTION update_product_sizes_timestamp();

-- Similar triggers for other tables
CREATE OR REPLACE FUNCTION update_product_variants_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trigger_product_variants_update
BEFORE UPDATE ON product_variants
FOR EACH ROW
EXECUTE FUNCTION update_product_variants_timestamp();

CREATE OR REPLACE FUNCTION update_variant_inventory_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trigger_variant_inventory_update
BEFORE UPDATE ON variant_inventory
FOR EACH ROW
EXECUTE FUNCTION update_variant_inventory_timestamp();

-- ════ SECTION 9: VIEWS FOR COMMON QUERIES ══════════════════════════════════════

-- View: Complete Variant Details (with pricing, costs, inventory)
CREATE OR REPLACE VIEW v_variant_details AS
SELECT
  v.id as variant_id,
  v.sku,
  v.product_id,
  ps.size,
  ps.size_order,
  vp.mrp,
  vp.selling_price,
  vp.b2b_price,
  vp.discount_pct,
  vp.gst_rate,
  vc.total_cogs as cogs,
  vc.material_cost,
  vc.labor_cost,
  vc.packaging_cost,
  vc.overhead_cost,
  vi.on_hand_qty,
  vi.reserved_qty,
  vi.order_held_qty,
  vi.damaged_qty,
  vi.available_qty,
  ROUND(((vp.selling_price - vc.total_cogs) / vp.selling_price * 100)::numeric, 2) as margin_pct,
  v.status
FROM product_variants v
LEFT JOIN product_sizes ps ON v.size_id = ps.id
LEFT JOIN variant_pricing vp ON v.id = vp.variant_id
  AND vp.valid_to IS NULL
LEFT JOIN variant_costs vc ON v.id = vc.variant_id
LEFT JOIN variant_inventory vi ON v.id = vi.variant_id
ORDER BY v.product_id, ps.size_order;

-- View: Low Stock Alert
CREATE OR REPLACE VIEW v_low_stock_variants AS
SELECT
  v.id,
  v.sku,
  v.product_id,
  ps.size,
  vi.available_qty,
  vi.reorder_level,
  (vi.reorder_level - vi.available_qty) as shortage
FROM product_variants v
LEFT JOIN product_sizes ps ON v.size_id = ps.id
LEFT JOIN variant_inventory vi ON v.id = vi.variant_id
WHERE vi.available_qty < vi.reorder_level
  AND v.status = 'active'
ORDER BY shortage DESC;

-- ════ END OF MIGRATION ══════════════════════════════════════════════════════════

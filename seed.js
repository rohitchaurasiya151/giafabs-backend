// ════════════════════════════════════════════════════════════════════════════════
// GIAFABS — Force Seed Script (proper normalized columns)
// Drops all data and re-inserts everything from data.js with ON CONFLICT UPDATE
// Run: node seed.js
// ════════════════════════════════════════════════════════════════════════════════
const { Pool } = require('pg');
const { DB } = require('./data');

const pool = new Pool({
  host:     process.env.PGHOST     || 'localhost',
  port:     parseInt(process.env.PGPORT || '8090', 10),
  user:     process.env.PGUSER     || 'postgres',
  password: process.env.PGPASSWORD || 'EUogQFxWyDAsnY-bZNcRBnmxtbFK46M3',
  database: process.env.PGDATABASE || 'bd_zb',
});

// ── HELPERS ──────────────────────────────────────────────────────────────────
async function upsertRow(table, row, conflictKey = 'id') {
  const cols = Object.keys(row);
  const vals = Object.values(row);
  const ph   = cols.map((_, i) => `$${i + 1}`).join(', ');
  const upd  = cols.filter(c => c !== conflictKey).map(c => `${c} = EXCLUDED.${c}`).join(', ');
  await pool.query(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${ph})
     ON CONFLICT (${conflictKey}) DO UPDATE SET ${upd}`,
    vals
  );
}

async function upsertConfig(key, value) {
  await pool.query(
    `INSERT INTO configs (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, JSON.stringify(value)]
  );
}

// ── SCHEMA (ensure all tables + indexes exist) ────────────────────────────────
async function ensureSchema() {
  // Recreate tables and indexes via the db-postgres module
  const { initDB: _noop } = require('./db-postgres');
  // We'll run our own minimal DDL here so we don't trigger data loading
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id VARCHAR(50) PRIMARY KEY, sku VARCHAR(50) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL, description TEXT,
      category VARCHAR(100) NOT NULL, subcategory VARCHAR(100),
      brand VARCHAR(100), price NUMERIC(10,2) NOT NULL, mrp NUMERIC(10,2) NOT NULL,
      b2b_price NUMERIC(10,2), cost NUMERIC(10,2),
      fabric VARCHAR(100), color VARCHAR(100), sizes TEXT[],
      gst SMALLINT NOT NULL DEFAULT 12, hsn VARCHAR(20), weight NUMERIC(8,3),
      stock INTEGER NOT NULL DEFAULT 0, min_stock INTEGER NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE, featured BOOLEAN NOT NULL DEFAULT FALSE,
      is_new BOOLEAN NOT NULL DEFAULT FALSE, badge VARCHAR(50),
      rating NUMERIC(3,1), reviews INTEGER NOT NULL DEFAULT 0,
      international BOOLEAN NOT NULL DEFAULT FALSE,
      tags TEXT[], images TEXT[],
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS customer_auth (
      id VARCHAR(50) PRIMARY KEY, name VARCHAR(255) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL, phone VARCHAR(20),
      password_hash TEXT NOT NULL, gstin VARCHAR(20),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS coupons (
      code VARCHAR(50) PRIMARY KEY, type VARCHAR(20) NOT NULL,
      value NUMERIC(10,2) NOT NULL CHECK (value > 0),
      min_order NUMERIC(10,2) NOT NULL DEFAULT 0,
      max_discount NUMERIC(10,2), active BOOLEAN NOT NULL DEFAULT TRUE,
      usage_limit INTEGER, used INTEGER NOT NULL DEFAULT 0, expires_at DATE
    );
    CREATE TABLE IF NOT EXISTS orders (
      id VARCHAR(50) PRIMARY KEY,
      customer_id VARCHAR(50) REFERENCES customer_auth(id) ON DELETE SET NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'pending',
      subtotal NUMERIC(10,2) NOT NULL DEFAULT 0,
      discount NUMERIC(10,2) NOT NULL DEFAULT 0,
      tax NUMERIC(10,2) NOT NULL DEFAULT 0,
      shipping NUMERIC(10,2) NOT NULL DEFAULT 0,
      total NUMERIC(10,2) NOT NULL,
      currency CHAR(3) NOT NULL DEFAULT 'INR',
      payment_method VARCHAR(50), payment_status VARCHAR(50) NOT NULL DEFAULT 'pending',
      coupon_code VARCHAR(50) REFERENCES coupons(code) ON DELETE SET NULL,
      items JSONB NOT NULL DEFAULT '[]',
      shipping_address JSONB, billing_address JSONB, notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id VARCHAR(50) PRIMARY KEY,
      order_id VARCHAR(50) REFERENCES orders(id) ON DELETE SET NULL,
      customer_id VARCHAR(50) REFERENCES customer_auth(id) ON DELETE SET NULL,
      type VARCHAR(50) NOT NULL, amount NUMERIC(10,2) NOT NULL,
      currency CHAR(3) NOT NULL DEFAULT 'INR',
      gateway VARCHAR(50), gateway_ref VARCHAR(255),
      status VARCHAR(50) NOT NULL DEFAULT 'pending',
      metadata JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(50) PRIMARY KEY, name VARCHAR(255) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL, password_hash TEXT NOT NULL,
      role VARCHAR(50) NOT NULL DEFAULT 'support',
      permissions TEXT[] NOT NULL DEFAULT '{}',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS customer_sessions (
      token VARCHAR(255) PRIMARY KEY,
      customer_id VARCHAR(50) NOT NULL REFERENCES customer_auth(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token VARCHAR(255) PRIMARY KEY,
      user_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id VARCHAR(50) PRIMARY KEY, user_id VARCHAR(50), user_role VARCHAR(50),
      action VARCHAR(100) NOT NULL, entity VARCHAR(100), entity_id VARCHAR(100),
      changes JSONB, ip VARCHAR(45), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS tickets (
      id VARCHAR(50) PRIMARY KEY,
      customer_id VARCHAR(50) REFERENCES customer_auth(id) ON DELETE SET NULL,
      subject VARCHAR(255) NOT NULL, status VARCHAR(50) NOT NULL DEFAULT 'open',
      priority VARCHAR(20) NOT NULL DEFAULT 'normal',
      messages JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS cart_items (
      customer_id VARCHAR(50) NOT NULL REFERENCES customer_auth(id) ON DELETE CASCADE,
      product_id VARCHAR(50) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      qty INTEGER NOT NULL DEFAULT 1,
      size VARCHAR(20) NOT NULL,
      PRIMARY KEY (customer_id, product_id, size)
    );
    CREATE TABLE IF NOT EXISTS countries (
      code CHAR(2) PRIMARY KEY, name VARCHAR(100) NOT NULL,
      currency CHAR(3) NOT NULL, symbol VARCHAR(10),
      rate NUMERIC(12,6) NOT NULL DEFAULT 1,
      ship_base NUMERIC(8,2), ship_per_kg NUMERIC(8,2),
      cod_available BOOLEAN NOT NULL DEFAULT FALSE, days VARCHAR(20)
    );
    CREATE TABLE IF NOT EXISTS inventory_movements (
      id VARCHAR(50) PRIMARY KEY,
      product_id VARCHAR(50) REFERENCES products(id) ON DELETE SET NULL,
      type VARCHAR(50) NOT NULL, quantity INTEGER NOT NULL,
      reason VARCHAR(255), reference_id VARCHAR(50),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS inventory_purchase_orders (
      id VARCHAR(50) PRIMARY KEY, supplier VARCHAR(255),
      status VARCHAR(50) NOT NULL DEFAULT 'draft',
      items JSONB NOT NULL DEFAULT '[]', total NUMERIC(10,2), notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS employees (
      id VARCHAR(50) PRIMARY KEY, name VARCHAR(255) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL, role VARCHAR(100) NOT NULL,
      phone VARCHAR(20), active BOOLEAN NOT NULL DEFAULT TRUE, join_date DATE
    );
    CREATE TABLE IF NOT EXISTS configs (
      key VARCHAR(50) PRIMARY KEY, value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Indexes
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_products_category  ON products(category);
    CREATE INDEX IF NOT EXISTS idx_products_active    ON products(active);
    CREATE INDEX IF NOT EXISTS idx_products_featured  ON products(featured);
    CREATE INDEX IF NOT EXISTS idx_products_is_new    ON products(is_new);
    CREATE INDEX IF NOT EXISTS idx_products_price     ON products(price);
    CREATE INDEX IF NOT EXISTS idx_products_stock     ON products(stock);
    CREATE INDEX IF NOT EXISTS idx_products_fabric    ON products(fabric);
    CREATE INDEX IF NOT EXISTS idx_products_tags      ON products USING GIN(tags);
    CREATE INDEX IF NOT EXISTS idx_products_fts       ON products USING GIN(to_tsvector('english', name || ' ' || COALESCE(description,'')));
    CREATE INDEX IF NOT EXISTS idx_orders_customer    ON orders(customer_id);
    CREATE INDEX IF NOT EXISTS idx_orders_status      ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_orders_pay_status  ON orders(payment_status);
    CREATE INDEX IF NOT EXISTS idx_orders_created     ON orders(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_txn_order_id       ON transactions(order_id);
    CREATE INDEX IF NOT EXISTS idx_txn_customer       ON transactions(customer_id);
    CREATE INDEX IF NOT EXISTS idx_txn_status         ON transactions(status);
    CREATE INDEX IF NOT EXISTS idx_txn_gateway        ON transactions(gateway);
    CREATE INDEX IF NOT EXISTS idx_txn_created        ON transactions(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_customer_email     ON customer_auth(email);
    CREATE INDEX IF NOT EXISTS idx_customer_phone     ON customer_auth(phone);
    CREATE INDEX IF NOT EXISTS idx_customer_active    ON customer_auth(active);
    CREATE INDEX IF NOT EXISTS idx_csess_customer     ON customer_sessions(customer_id);
    CREATE INDEX IF NOT EXISTS idx_csess_expires      ON customer_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_asess_user         ON admin_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_asess_expires      ON admin_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_audit_user         ON audit_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_action       ON audit_log(action);
    CREATE INDEX IF NOT EXISTS idx_audit_entity       ON audit_log(entity, entity_id);
    CREATE INDEX IF NOT EXISTS idx_audit_created      ON audit_log(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tickets_customer   ON tickets(customer_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_status     ON tickets(status);
    CREATE INDEX IF NOT EXISTS idx_cart_customer       ON cart_items(customer_id);
    CREATE INDEX IF NOT EXISTS idx_coupons_active     ON coupons(active);
    CREATE INDEX IF NOT EXISTS idx_coupons_expires    ON coupons(expires_at);
    CREATE INDEX IF NOT EXISTS idx_invmov_product     ON inventory_movements(product_id);
    CREATE INDEX IF NOT EXISTS idx_invmov_type        ON inventory_movements(type);
    CREATE INDEX IF NOT EXISTS idx_invmov_created     ON inventory_movements(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_employees_role     ON employees(role);
    CREATE INDEX IF NOT EXISTS idx_employees_active   ON employees(active);
    CREATE INDEX IF NOT EXISTS idx_users_email        ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_role         ON users(role);
  `);

  console.log('✓ Schema and indexes verified');
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🌱 GIAFABS Database Force-Seed — Starting...\n');

  await ensureSchema();

  // ── Products ────────────────────────────────────────────────────────────────
  console.log('\n📦 Products:');
  for (const p of DB.products) {
    await upsertRow('products', {
      id: p.id, sku: p.sku, name: p.name,
      description: p.description || null,
      category: p.category, subcategory: p.subcategory || null,
      brand: p.brand || null,
      price: p.price, mrp: p.mrp,
      b2b_price: p.b2bPrice || null, cost: p.cost || null,
      fabric: p.fabric || null, color: p.color || null,
      sizes: p.sizes || [],
      gst: p.gst || 12, hsn: p.hsn || null,
      weight: p.weight || null,
      stock: p.stock || 0, min_stock: p.minStock || 0,
      active: p.active !== false, featured: p.featured === true,
      is_new: p.isNew === true, badge: p.badge || null,
      rating: p.rating || null, reviews: p.reviews || 0,
      international: p.international === true,
      tags: p.tags || [], images: p.images || [],
    });
  }
  console.log(`  ✓ ${DB.products.length} products upserted`);

  // ── Coupons ─────────────────────────────────────────────────────────────────
  console.log('\n🏷️  Coupons:');
  for (const c of DB.coupons) {
    await upsertRow('coupons', {
      code: c.code, type: c.type, value: c.value,
      min_order: c.minOrder || 0,
      max_discount: c.maxDiscount || null,
      active: c.active !== false,
      usage_limit: c.usageLimit || null,
      used: c.used || 0,
      expires_at: c.expiresAt || null,
    }, 'code');
  }
  console.log(`  ✓ ${DB.coupons.length} coupons upserted`);

  // ── Countries ───────────────────────────────────────────────────────────────
  console.log('\n🌍 Countries:');
  for (const c of DB.countries) {
    await upsertRow('countries', {
      code: c.code, name: c.name, currency: c.currency,
      symbol: c.symbol || null, rate: c.rate || 1,
      ship_base: c.shipBase || null,
      ship_per_kg: c.shipPerKg || null,
      cod_available: c.codAvailable === true,
      days: c.days || null,
    }, 'code');
  }
  console.log(`  ✓ ${DB.countries.length} countries upserted`);

  // ── Employees ───────────────────────────────────────────────────────────────
  console.log('\n👩 Employees:');
  for (const e of DB.employees) {
    await upsertRow('employees', {
      id: e.id, name: e.name, email: e.email,
      role: e.role || 'staff',
      phone: e.phone || null,
      active: e.active !== false,
      join_date: e.joinDate || null,
    });
  }
  console.log(`  ✓ ${DB.employees.length} employees upserted`);

  // ── Customer Auth ─────────────────────────────────────────────────────────
  console.log('\n👥 Customer Auth:');
  const { hashPw } = require('./core');
  const bootstrapCustomers = [
    { 
      id: 'CUST001', 
      name: 'Rohit', 
      email: 'rohit@gmail.com', 
      phone: '9876543210', 
      password_hash: hashPw('rohit123'), 
      active: true 
    },
    { 
      id: 'CUST002', 
      name: 'Ajay', 
      email: 'ajay@gmail.com', 
      phone: '9876543212', 
      password_hash: hashPw('ajay123'), 
      active: true 
    }
  ];
  for (const c of bootstrapCustomers) {
    await upsertRow('customer_auth', c);
  }
  console.log(`  ✓ ${bootstrapCustomers.length} customer accounts seeded`);

  // ── Admin Users ─────────────────────────────────────────────────────────────
  console.log('\n👤 Admin Users:');
  for (const u of DB.users) {
    await upsertRow('users', {
      id: u.id, name: u.name, email: u.email,
      password_hash: u.passwordHash,
      role: u.role || 'support',
      permissions: u.permissions || [],
      active: u.active !== false,
    });
  }
  console.log(`  ✓ ${DB.users.length} users upserted`);

  // ── Configs ─────────────────────────────────────────────────────────────────
  console.log('\n⚙️  Configs:');
  const { settings } = DB;
  await upsertConfig('featureFlags',  DB.featureFlags);
  await upsertConfig('content',       DB.content);
  await upsertConfig('theme',         DB.theme);
  await upsertConfig('store',         settings.store);
  await upsertConfig('payments',      settings.payments);
  await upsertConfig('integrations',  settings.integrations);
  await upsertConfig('shipping',      settings.shipping);
  await upsertConfig('tax',           settings.tax);
  await upsertConfig('checkout',      settings.checkout);
  await upsertConfig('notifications', settings.notifications);
  await upsertConfig('roles',         settings.roles);
  await upsertConfig('meta',          settings.meta);
  console.log('  ✓ 12 config keys saved');

  // ── Verify ──────────────────────────────────────────────────────────────────
  const r = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM products)    AS products,
      (SELECT COUNT(*) FROM coupons)     AS coupons,
      (SELECT COUNT(*) FROM countries)   AS countries,
      (SELECT COUNT(*) FROM employees)   AS employees,
      (SELECT COUNT(*) FROM users)       AS users,
      (SELECT COUNT(*) FROM configs)     AS configs,
      (SELECT COUNT(*) FROM cart_items)  AS cart_items
  `);
  const counts = r.rows[0];
  console.log('\n✅ Database seed complete!\n');
  console.log('  Table         | Rows');
  console.log('  ------------- | ----');
  console.log(`  products      | ${counts.products}`);
  console.log(`  coupons       | ${counts.coupons}`);
  console.log(`  countries     | ${counts.countries}`);
  console.log(`  employees     | ${counts.employees}`);
  console.log(`  users         | ${counts.users}`);
  console.log(`  configs       | ${counts.configs}`);
  console.log(`  cart_items    | ${counts.cart_items}`);

  await pool.end();
}

main().catch((err) => {
  console.error('\n❌ Seed failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});

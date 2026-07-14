// ════════════════════════════════════════════════════════════════════════════════
// GIAFABS — PostgreSQL Database Layer
// Proper normalized schema with typed columns + indexes
// ════════════════════════════════════════════════════════════════════════════════
const { Pool } = require('pg');
const { DB } = require('./data');

const poolConfig = process.env.DATABASE_URL
  ? { 
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false
      }
    }
  : {
      host:     process.env.PGHOST     || 'localhost',
      port:     parseInt(process.env.PGPORT || '8090', 10),
      user:     process.env.PGUSER     || 'postgres',
      password: process.env.PGPASSWORD || 'EUogQFxWyDAsnY-bZNcRBnmxtbFK46M3',
      database: process.env.PGDATABASE || 'bd_zb',
    };

const pool = new Pool({
  ...poolConfig,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// ── SCHEMA ────────────────────────────────────────────────────────────────────
async function initDB(DB) {
  if (process.env.NODE_ENV === 'test') {
    console.log('[DB] Test mode — dropping and recreating all tables...');
    await pool.query(`
      DROP TABLE IF EXISTS
        inventory_movements, inventory_purchase_orders,
        customer_sessions, admin_sessions,
        transactions, orders,
        audit_log, tickets, coupons,
        customer_auth, employees, users,
        product_images, product_variants, products, countries, configs
      CASCADE;
    `);
  }

  // ── 1. CREATE TABLES ───────────────────────────────────────────────────────

  await pool.query(`
    -- ── PRODUCTS ──────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS products (
      id           VARCHAR(50)    PRIMARY KEY,
      sku          VARCHAR(50)    UNIQUE NOT NULL,
      name         VARCHAR(255)   NOT NULL,
      description  TEXT,
      category     VARCHAR(100)   NOT NULL,
      subcategory  VARCHAR(100),
      brand        VARCHAR(100),
      price        NUMERIC(10,2)  NOT NULL,
      mrp          NUMERIC(10,2)  NOT NULL,
      b2b_price    NUMERIC(10,2),
      cost         NUMERIC(10,2),
      fabric       VARCHAR(100),
      color        VARCHAR(100),
      sizes        TEXT[],
      gst          SMALLINT       NOT NULL DEFAULT 12,
      hsn          VARCHAR(20),
      weight       NUMERIC(8,3),
      stock        INTEGER        NOT NULL DEFAULT 0,
      min_stock    INTEGER        NOT NULL DEFAULT 0,
      active       BOOLEAN        NOT NULL DEFAULT TRUE,
      featured     BOOLEAN        NOT NULL DEFAULT FALSE,
      is_new       BOOLEAN        NOT NULL DEFAULT FALSE,
      badge        VARCHAR(50),
      rating       NUMERIC(3,1),
      reviews      INTEGER        NOT NULL DEFAULT 0,
      international BOOLEAN       NOT NULL DEFAULT FALSE,
      tags         TEXT[],
      images       TEXT[],
      created_at   TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ    NOT NULL DEFAULT NOW()
    );

    -- ── PRODUCT VARIANTS (per-size price + stock) ────────────────────────
    CREATE TABLE IF NOT EXISTS product_variants (
      id         VARCHAR(80)   PRIMARY KEY,
      product_id VARCHAR(50)   NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      size       VARCHAR(20)   NOT NULL,
      price      NUMERIC(10,2) NOT NULL,
      mrp        NUMERIC(10,2) NOT NULL,
      stock      INTEGER       NOT NULL DEFAULT 0,
      sku        VARCHAR(50),
      created_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      UNIQUE (product_id, size)
    );
    CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id);

    -- ── CUSTOMER AUTH ─────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS customer_auth (
      id            VARCHAR(50)   PRIMARY KEY,
      name          VARCHAR(255)  NOT NULL,
      email         VARCHAR(255)  UNIQUE NOT NULL,
      phone         VARCHAR(20),
      password_hash TEXT          NOT NULL,
      gstin         VARCHAR(20),
      active        BOOLEAN       NOT NULL DEFAULT TRUE,
      created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
    );

    -- ── COUPONS ───────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS coupons (
      code         VARCHAR(50)   PRIMARY KEY,
      type         VARCHAR(20)   NOT NULL CHECK (type IN ('percent','flat')),
      value        NUMERIC(10,2) NOT NULL CHECK (value > 0),
      min_order    NUMERIC(10,2) NOT NULL DEFAULT 0,
      max_discount NUMERIC(10,2),
      active       BOOLEAN       NOT NULL DEFAULT TRUE,
      usage_limit  INTEGER,
      used         INTEGER       NOT NULL DEFAULT 0,
      expires_at   DATE
    );

    -- ── ORDERS ───────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS orders (
      id               VARCHAR(50)   PRIMARY KEY,
      customer_id      VARCHAR(50)   REFERENCES customer_auth(id) ON DELETE SET NULL,
      status           VARCHAR(50)   NOT NULL DEFAULT 'pending',
      subtotal         NUMERIC(10,2) NOT NULL DEFAULT 0,
      discount         NUMERIC(10,2) NOT NULL DEFAULT 0,
      tax              NUMERIC(10,2) NOT NULL DEFAULT 0,
      shipping         NUMERIC(10,2) NOT NULL DEFAULT 0,
      total            NUMERIC(10,2) NOT NULL,
      currency         CHAR(3)       NOT NULL DEFAULT 'INR',
      payment_method   VARCHAR(50),
      payment_status   VARCHAR(50)   NOT NULL DEFAULT 'pending',
      coupon_code      VARCHAR(50)   REFERENCES coupons(code) ON DELETE SET NULL,
      items            JSONB         NOT NULL DEFAULT '[]',
      shipping_address JSONB,
      billing_address  JSONB,
      notes            TEXT,
      created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
    );

    -- ── TRANSACTIONS ──────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS transactions (
      id          VARCHAR(50)   PRIMARY KEY,
      order_id    VARCHAR(50)   REFERENCES orders(id) ON DELETE SET NULL,
      customer_id VARCHAR(50)   REFERENCES customer_auth(id) ON DELETE SET NULL,
      type        VARCHAR(50)   NOT NULL,
      amount      NUMERIC(10,2) NOT NULL,
      currency    CHAR(3)       NOT NULL DEFAULT 'INR',
      gateway     VARCHAR(50),
      gateway_ref VARCHAR(255),
      status      VARCHAR(50)   NOT NULL DEFAULT 'pending',
      metadata    JSONB,
      created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
    );

    -- ── CUSTOMER SESSIONS ─────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS customer_sessions (
      token       VARCHAR(255)  PRIMARY KEY,
      customer_id VARCHAR(50)   NOT NULL REFERENCES customer_auth(id) ON DELETE CASCADE,
      expires_at  TIMESTAMPTZ   NOT NULL,
      created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
    );

    -- ── ADMIN USERS ───────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS users (
      id            VARCHAR(50)  PRIMARY KEY,
      name          VARCHAR(255) NOT NULL,
      email         VARCHAR(255) UNIQUE NOT NULL,
      password_hash TEXT         NOT NULL,
      role          VARCHAR(50)  NOT NULL DEFAULT 'support',
      permissions   TEXT[]       NOT NULL DEFAULT '{}',
      active        BOOLEAN      NOT NULL DEFAULT TRUE,
      created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    );

    -- ── PRODUCT IMAGES (references products + users, must come after both) ──
    CREATE TABLE IF NOT EXISTS product_images (
      id                  VARCHAR(50)   PRIMARY KEY,
      product_id          VARCHAR(50)   NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      image_url           TEXT          NOT NULL,
      thumbnail_url       TEXT,
      mobile_url          TEXT,
      alt_text            VARCHAR(255),
      display_order       INT           DEFAULT 0,
      file_size           INT,
      mime_type           VARCHAR(50),
      original_filename   VARCHAR(255),
      uploaded_by         VARCHAR(50)   REFERENCES users(id) ON DELETE SET NULL,
      created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_product_images_product_id ON product_images(product_id);
    CREATE INDEX IF NOT EXISTS idx_product_images_order ON product_images(product_id, display_order);

    -- ── ADMIN SESSIONS ────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token      VARCHAR(255)  PRIMARY KEY,
      user_id    VARCHAR(50)   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ   NOT NULL,
      created_at TIMESTAMPTZ   NOT NULL DEFAULT NOW()
    );

    -- ── AUDIT LOG ─────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS audit_log (
      id        VARCHAR(50)  PRIMARY KEY,
      user_id   VARCHAR(50),
      user_role VARCHAR(50),
      action    VARCHAR(100) NOT NULL,
      entity    VARCHAR(100),
      entity_id VARCHAR(100),
      changes   JSONB,
      ip        VARCHAR(45),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- ── SUPPORT TICKETS ───────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS tickets (
      id          VARCHAR(50)  PRIMARY KEY,
      customer_id VARCHAR(50)  REFERENCES customer_auth(id) ON DELETE SET NULL,
      subject     VARCHAR(255) NOT NULL,
      status      VARCHAR(50)  NOT NULL DEFAULT 'open',
      priority    VARCHAR(20)  NOT NULL DEFAULT 'normal',
      messages    JSONB        NOT NULL DEFAULT '[]',
      created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    );

    -- ── CART ITEMS ────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS cart_items (
      customer_id  VARCHAR(50)   NOT NULL REFERENCES customer_auth(id) ON DELETE CASCADE,
      product_id   VARCHAR(50)   NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      qty          INTEGER       NOT NULL DEFAULT 1,
      size         VARCHAR(20)   NOT NULL,
      PRIMARY KEY (customer_id, product_id, size)
    );

    -- ── WISHLIST ITEMS ────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS wishlist_items (
      customer_id  VARCHAR(50)   NOT NULL REFERENCES customer_auth(id) ON DELETE CASCADE,
      product_id   VARCHAR(50)   NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      PRIMARY KEY (customer_id, product_id)
    );

    -- ── COUNTRIES / SHIPPING ZONES ────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS countries (
      code          CHAR(2)       PRIMARY KEY,
      name          VARCHAR(100)  NOT NULL,
      currency      CHAR(3)       NOT NULL,
      symbol        VARCHAR(10),
      rate          NUMERIC(12,6) NOT NULL DEFAULT 1,
      ship_base     NUMERIC(8,2),
      ship_per_kg   NUMERIC(8,2),
      cod_available BOOLEAN       NOT NULL DEFAULT FALSE,
      days          VARCHAR(20)
    );

    -- ── INVENTORY MOVEMENTS ───────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS inventory_movements (
      id           VARCHAR(50)  PRIMARY KEY,
      product_id   VARCHAR(50)  REFERENCES products(id) ON DELETE SET NULL,
      type         VARCHAR(50)  NOT NULL,
      quantity     INTEGER      NOT NULL,
      reason       VARCHAR(255),
      reference_id VARCHAR(50),
      created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    );

    -- ── INVENTORY PURCHASE ORDERS ─────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS inventory_purchase_orders (
      id         VARCHAR(50)   PRIMARY KEY,
      supplier   VARCHAR(255),
      status     VARCHAR(50)   NOT NULL DEFAULT 'draft',
      items      JSONB         NOT NULL DEFAULT '[]',
      total      NUMERIC(10,2),
      notes      TEXT,
      created_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ   NOT NULL DEFAULT NOW()
    );

    -- ── EMPLOYEES ─────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS employees (
      id        VARCHAR(50)  PRIMARY KEY,
      name      VARCHAR(255) NOT NULL,
      email     VARCHAR(255) UNIQUE NOT NULL,
      role      VARCHAR(100) NOT NULL,
      phone     VARCHAR(20),
      active    BOOLEAN      NOT NULL DEFAULT TRUE,
      join_date DATE
    );

    -- ── CONFIGS (settings, flags, theme, cms) ─────────────────────────────
    CREATE TABLE IF NOT EXISTS configs (
      key        VARCHAR(50)  PRIMARY KEY,
      value      JSONB        NOT NULL,
      updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    );
  `);

  // ── 2. CREATE INDEXES ──────────────────────────────────────────────────────
  await pool.query(`
    -- products: query by category, active, stock, price, full-text search
    CREATE INDEX IF NOT EXISTS idx_products_category    ON products(category);
    CREATE INDEX IF NOT EXISTS idx_products_active      ON products(active);
    CREATE INDEX IF NOT EXISTS idx_products_featured    ON products(featured);
    CREATE INDEX IF NOT EXISTS idx_products_is_new      ON products(is_new);
    CREATE INDEX IF NOT EXISTS idx_products_price       ON products(price);
    CREATE INDEX IF NOT EXISTS idx_products_stock       ON products(stock);
    CREATE INDEX IF NOT EXISTS idx_products_fabric      ON products(fabric);
    CREATE INDEX IF NOT EXISTS idx_products_tags        ON products USING GIN(tags);
    CREATE INDEX IF NOT EXISTS idx_products_fts         ON products USING GIN(to_tsvector('english', name || ' ' || COALESCE(description,'')));

    -- orders: filter by customer, status, date range
    CREATE INDEX IF NOT EXISTS idx_orders_customer_id    ON orders(customer_id);
    CREATE INDEX IF NOT EXISTS idx_orders_status         ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status);
    CREATE INDEX IF NOT EXISTS idx_orders_created_at     ON orders(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_orders_coupon         ON orders(coupon_code);

    -- transactions: filter by order, customer, gateway, date
    CREATE INDEX IF NOT EXISTS idx_txn_order_id    ON transactions(order_id);
    CREATE INDEX IF NOT EXISTS idx_txn_customer_id ON transactions(customer_id);
    CREATE INDEX IF NOT EXISTS idx_txn_status      ON transactions(status);
    CREATE INDEX IF NOT EXISTS idx_txn_gateway     ON transactions(gateway);
    CREATE INDEX IF NOT EXISTS idx_txn_created_at  ON transactions(created_at DESC);

    -- customer_auth: login lookup
    CREATE INDEX IF NOT EXISTS idx_customer_email  ON customer_auth(email);
    CREATE INDEX IF NOT EXISTS idx_customer_phone  ON customer_auth(phone);
    CREATE INDEX IF NOT EXISTS idx_customer_active ON customer_auth(active);

    -- customer_sessions: expire cleanup
    CREATE INDEX IF NOT EXISTS idx_csess_customer_id ON customer_sessions(customer_id);
    CREATE INDEX IF NOT EXISTS idx_csess_expires     ON customer_sessions(expires_at);

    -- admin_sessions: expire cleanup
    CREATE INDEX IF NOT EXISTS idx_asess_user_id ON admin_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_asess_expires ON admin_sessions(expires_at);

    -- audit_log: search by actor, entity, date
    CREATE INDEX IF NOT EXISTS idx_audit_user_id    ON audit_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_action     ON audit_log(action);
    CREATE INDEX IF NOT EXISTS idx_audit_entity     ON audit_log(entity, entity_id);
    CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_log(created_at DESC);

    -- tickets: filter by customer, status
    CREATE INDEX IF NOT EXISTS idx_tickets_customer ON tickets(customer_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_status   ON tickets(status);
    CREATE INDEX IF NOT EXISTS idx_tickets_priority ON tickets(priority);

    -- cart_items: filter by customer
    CREATE INDEX IF NOT EXISTS idx_cart_customer ON cart_items(customer_id);

    -- wishlist_items: filter by customer
    CREATE INDEX IF NOT EXISTS idx_wishlist_customer ON wishlist_items(customer_id);

    -- coupons: validity checks
    CREATE INDEX IF NOT EXISTS idx_coupons_active  ON coupons(active);
    CREATE INDEX IF NOT EXISTS idx_coupons_expires ON coupons(expires_at);

    -- inventory movements: trace per product/date
    CREATE INDEX IF NOT EXISTS idx_invmov_product    ON inventory_movements(product_id);
    CREATE INDEX IF NOT EXISTS idx_invmov_type       ON inventory_movements(type);
    CREATE INDEX IF NOT EXISTS idx_invmov_created_at ON inventory_movements(created_at DESC);

    -- employees: filter by role/active
    CREATE INDEX IF NOT EXISTS idx_employees_role   ON employees(role);
    CREATE INDEX IF NOT EXISTS idx_employees_active ON employees(active);

    -- users: login lookup
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_role  ON users(role);
  `);

  console.log('[DB] Tables and indexes created/verified.');

  // ── 3. LOAD OR SEED DATA ──────────────────────────────────────────────────

  // Helper: map in-memory DB array ↔ proper table columns
  async function loadOrSeed(tableName, memoryArray, toRow, fromRow, idKey = 'id') {
    const res = await pool.query(`SELECT * FROM ${tableName}`);
    if (res.rows.length === 0 && memoryArray.length > 0) {
      console.log(`[DB] Seeding ${tableName} (${memoryArray.length} rows)...`);
      for (const item of memoryArray) {
        const row = toRow(item);
        const cols = Object.keys(row);
        const vals = Object.values(row);
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
        await pool.query(
          `INSERT INTO ${tableName} (${cols.join(',')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
          vals
        );
      }
    } else {
      console.log(`[DB] Loading ${tableName} (${res.rows.length} rows)`);
      memoryArray.length = 0;
      for (const r of res.rows) memoryArray.push(fromRow(r));
    }
  }

  // products
  await loadOrSeed('products', DB.products, productToRow, rowToProduct);

  // product_variants (after products — FK dependency)
  DB.productVariants = DB.productVariants || [];
  await loadOrSeed('product_variants', DB.productVariants, productVariantToRow, rowToVariant);

  // One-time backfill: create one variant per existing size, splitting flat
  // stock across sizes (not copying it) so the sum matches the original stock.
  if (DB.productVariants.length === 0) {
    for (const p of DB.products) {
      const sizes = p.sizes || [];
      if (sizes.length === 0) continue;
      const n = sizes.length;
      const base = Math.floor((p.stock || 0) / n), rem = (p.stock || 0) % n;
      sizes.forEach((size, i) => {
        DB.productVariants.push({
          id: `${p.id}-${size}`,
          productId: p.id,
          size,
          price: p.price,
          mrp: p.mrp,
          stock: base + (i < rem ? 1 : 0),
          sku: p.sku ? `${p.sku}-${size}` : undefined,
        });
      });
    }
    if (DB.productVariants.length) {
      console.log(`[DB] Backfilling ${DB.productVariants.length} product variants...`);
      await saveCollection('product_variants', DB.productVariants, productVariantToRow);
    }
  }

  // customer_auth (must exist before orders/transactions reference it)
  await loadOrSeed('customer_auth', DB.customerAuth, customerToRow, rowToCustomer);

  // cart_items (after products and customer_auth)
  await loadOrSeed('cart_items', DB.cartItems || [], cartToRow, rowToCart);

  // wishlist_items (after products and customer_auth)
  await loadOrSeed('wishlist_items', DB.wishlistItems || [], wishlistToRow, rowToWishlist);

  // orders (after customer_auth and coupons)
  await loadOrSeed('coupons', DB.coupons, couponToRow, rowToCoupon, 'code');
  await loadOrSeed('orders', DB.orders, orderToRow, rowToOrder);
  await loadOrSeed('transactions', DB.transactions, txnToRow, rowToTxn);

  // sessions
  await loadOrSeedSessions('customer_sessions', DB.customerSessions, 'customer_id');
  await loadOrSeedSessions('admin_sessions', DB.adminSessions, 'user_id');

  // other tables
  await loadOrSeed('audit_log', DB.auditLog, auditToRow, rowToAudit);
  await loadOrSeed('tickets', DB.tickets, ticketToRow, rowToTicket);
  await loadOrSeed('countries', DB.countries, countryToRow, rowToCountry, 'code');
  await loadOrSeed('inventory_movements', DB.inventory.movements, invMovToRow, rowToInvMov);
  await loadOrSeed('inventory_purchase_orders', DB.inventory.purchaseOrders, invPoToRow, rowToInvPo);
  await loadOrSeed('employees', DB.employees, employeeToRow, rowToEmployee);
  await loadOrSeed('users', DB.users, userToRow, rowToUser);

  // configs
  const configKeys = ['featureFlags', 'content', 'theme', 'settings'];
  for (const key of configKeys) {
    const r = await pool.query(`SELECT value FROM configs WHERE key = $1`, [key]);
    if (r.rows.length === 0) {
      await pool.query(
        `INSERT INTO configs (key, value) VALUES ($1, $2)`,
        [key, JSON.stringify(DB[key])]
      );
    } else {
      DB[key] = r.rows[0].value;
    }
  }

  console.log('[DB] Initialization complete.');
}

// ── SESSION HELPERS ──────────────────────────────────────────────────────────
async function loadOrSeedSessions(tableName, sessionObj, userIdField) {
  const res = await pool.query(`SELECT * FROM ${tableName}`);
  if (res.rows.length === 0) {
    for (const [token, data] of Object.entries(sessionObj)) {
      await pool.query(
        `INSERT INTO ${tableName} (token, ${userIdField}, expires_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [token, data.customerId || data.userId, new Date(data.expires)]
      ).catch(() => {}); // Ignore FK violations for bootstrap tokens
    }
  } else {
    for (const k in sessionObj) delete sessionObj[k];
    for (const r of res.rows) {
      sessionObj[r.token] = {
        customerId: r.customer_id,
        userId: r.user_id,
        expires: r.expires_at
      };
    }
  }
}

// ── ROW MAPPERS: in-memory object → DB columns ───────────────────────────────

function productToRow(p) {
  return {
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
    active: p.active !== false,
    featured: p.featured === true,
    is_new: p.isNew === true,
    badge: p.badge || null,
    rating: p.rating || null, reviews: p.reviews || 0,
    international: p.international === true,
    tags: p.tags || [], images: p.images || [],
  };
}

function rowToProduct(r) {
  return {
    id: r.id, sku: r.sku, name: r.name,
    description: r.description,
    category: r.category, subcategory: r.subcategory,
    brand: r.brand,
    price: parseFloat(r.price), mrp: parseFloat(r.mrp),
    b2bPrice: r.b2b_price ? parseFloat(r.b2b_price) : undefined,
    cost: r.cost ? parseFloat(r.cost) : undefined,
    fabric: r.fabric, color: r.color,
    sizes: r.sizes || [],
    gst: r.gst, hsn: r.hsn,
    weight: r.weight ? parseFloat(r.weight) : undefined,
    stock: r.stock, minStock: r.min_stock,
    active: r.active, featured: r.featured, isNew: r.is_new,
    badge: r.badge,
    rating: r.rating ? parseFloat(r.rating) : undefined,
    reviews: r.reviews, international: r.international,
    tags: r.tags || [], images: r.images || [],
  };
}

function productVariantToRow(v) {
  return {
    id: v.id, product_id: v.productId, size: v.size,
    price: v.price, mrp: v.mrp, stock: v.stock || 0,
    sku: v.sku || null,
  };
}

function rowToVariant(r) {
  return {
    id: r.id, productId: r.product_id, size: r.size,
    price: parseFloat(r.price), mrp: parseFloat(r.mrp),
    stock: r.stock, sku: r.sku || undefined,
  };
}

function customerToRow(c) {
  return {
    id: c.id, name: c.name, email: c.email,
    phone: c.phone || null,
    password_hash: c.passwordHash,
    gstin: c.gstin || null,
    active: c.active !== false,
  };
}

function rowToCustomer(r) {
  return {
    id: r.id, name: r.name, email: r.email,
    phone: r.phone, passwordHash: r.password_hash,
    gstin: r.gstin, active: r.active,
    createdAt: r.created_at,
  };
}

function cartToRow(item) {
  return {
    customer_id: item.customerId,
    product_id: item.productId,
    qty: item.qty,
    size: item.size,
  };
}

function rowToCart(r) {
  return {
    customerId: r.customer_id,
    productId: r.product_id,
    qty: parseInt(r.qty, 10),
    size: r.size,
  };
}

function wishlistToRow(item) {
  return {
    customer_id: item.customerId,
    product_id: item.productId,
  };
}

function rowToWishlist(r) {
  return {
    customerId: r.customer_id,
    productId: r.product_id,
  };
}

function orderToRow(o) {
  const p = o.pricing || {};
  return {
    id: o.id,
    customer_id: o.customerId || (o.customer && DB.customerAuth.find(c => c.email === o.customer.email)?.id) || null,
    status: o.status || 'pending',
    subtotal: p.subtotal || o.subtotal || 0,
    discount: p.discount || o.discount || 0,
    tax: typeof p.gst === 'number' ? p.gst : 0,
    shipping: p.shipping || o.shipping || 0,
    total: p.total || o.total || 0,
    currency: p.currency || o.currency || 'INR',
    payment_method: (o.payment && o.payment.method) || o.paymentMethod || null,
    payment_status: (o.payment && o.payment.status) || o.paymentStatus || 'pending',
    coupon_code: (p.coupon && p.coupon.code) || o.couponCode || null,
    items: JSON.stringify(o.items || []),
    shipping_address: o.shippingAddress ? JSON.stringify(o.shippingAddress) : null,
    billing_address: o.billingAddress ? JSON.stringify(o.billingAddress) : null,
    notes: o.notes || null,
  };
}

function rowToOrder(r) {
  let items = [];
  try { items = typeof r.items === 'string' ? JSON.parse(r.items) : (r.items || []); } catch(e) {}
  
  let shippingAddress = null;
  try { shippingAddress = typeof r.shipping_address === 'string' ? JSON.parse(r.shipping_address) : r.shipping_address; } catch(e) {}

  let billingAddress = null;
  try { billingAddress = typeof r.billing_address === 'string' ? JSON.parse(r.billing_address) : r.billing_address; } catch(e) {}

  const customer = DB.customerAuth.find(c => c.id === r.customer_id);

  return {
    id: r.id,
    customerId: r.customer_id,
    customer: customer ? { name: customer.name, email: customer.email, mobile: customer.phone || '' } : { name: '', email: '', mobile: '' },
    status: r.status,
    items,
    shippingAddress,
    billingAddress,
    notes: r.notes,
    pricing: {
      subtotal: parseFloat(r.subtotal),
      gst: parseFloat(r.tax),
      discount: parseFloat(r.discount),
      shipping: parseFloat(r.shipping),
      total: parseFloat(r.total),
      currency: r.currency,
    },
    payment: {
      method: r.payment_method,
      status: r.payment_status,
    },
    tax: {
      gstin: '24AAFCU5055K1ZM',
      state: shippingAddress?.state || 'Gujarat',
      label: r.tax > 0 ? 'GST' : 'Zero-rated',
    },
    tracking: {
      partner: 'Delhivery',
      awb: null,
      history: [{ label: `Order ${r.status}`, done: true, time: r.created_at || new Date().toISOString() }],
    },
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function txnToRow(t) {
  return {
    id: t.id,
    order_id: t.orderId || null,
    customer_id: t.customerId || null,
    type: t.type || 'payment',
    amount: t.amount || 0,
    currency: t.currency || 'INR',
    gateway: t.gateway || null,
    gateway_ref: t.gatewayRef || null,
    status: t.status || 'pending',
    metadata: t.metadata ? JSON.stringify(t.metadata) : null,
  };
}

function rowToTxn(r) {
  return {
    id: r.id, orderId: r.order_id, customerId: r.customer_id,
    type: r.type, amount: parseFloat(r.amount),
    currency: r.currency, gateway: r.gateway,
    gatewayRef: r.gateway_ref, status: r.status,
    metadata: r.metadata, createdAt: r.created_at,
  };
}

function auditToRow(a) {
  return {
    id: a.id, user_id: a.userId || null, user_role: a.userRole || null,
    action: a.action || 'unknown',
    entity: a.entity || null, entity_id: a.entityId || null,
    changes: a.changes ? JSON.stringify(a.changes) : null,
    ip: a.ip || null,
  };
}

function rowToAudit(r) {
  return {
    id: r.id, userId: r.user_id, userRole: r.user_role,
    action: r.action, entity: r.entity, entityId: r.entity_id,
    changes: r.changes, ip: r.ip, createdAt: r.created_at,
  };
}

function ticketToRow(t) {
  return {
    id: t.id, customer_id: t.customerId || null,
    subject: t.subject || 'Support Request',
    status: t.status || 'open', priority: t.priority || 'normal',
    messages: JSON.stringify(t.messages || []),
  };
}

function rowToTicket(r) {
  return {
    id: r.id, customerId: r.customer_id,
    subject: r.subject, status: r.status, priority: r.priority,
    messages: r.messages || [],
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function couponToRow(c) {
  return {
    code: c.code, type: c.type, value: c.value,
    min_order: c.minOrder || 0,
    max_discount: c.maxDiscount || null,
    active: c.active !== false,
    usage_limit: c.usageLimit || null,
    used: c.used || 0,
    expires_at: c.expiresAt || null,
  };
}

function rowToCoupon(r) {
  return {
    code: r.code, type: r.type, value: parseFloat(r.value),
    minOrder: parseFloat(r.min_order),
    maxDiscount: r.max_discount ? parseFloat(r.max_discount) : undefined,
    active: r.active,
    usageLimit: r.usage_limit, used: r.used,
    expiresAt: r.expires_at,
  };
}

function countryToRow(c) {
  return {
    code: c.code, name: c.name, currency: c.currency,
    symbol: c.symbol || null, rate: c.rate || 1,
    ship_base: c.shipBase || null,
    ship_per_kg: c.shipPerKg || null,
    cod_available: c.codAvailable === true,
    days: c.days || null,
  };
}

function rowToCountry(r) {
  return {
    code: r.code, name: r.name, currency: r.currency,
    symbol: r.symbol, rate: parseFloat(r.rate),
    shipBase: r.ship_base ? parseFloat(r.ship_base) : undefined,
    shipPerKg: r.ship_per_kg ? parseFloat(r.ship_per_kg) : undefined,
    codAvailable: r.cod_available, days: r.days,
  };
}

function invMovToRow(m) {
  return {
    id: m.id, product_id: m.productId || null,
    type: m.type || 'adjustment',
    quantity: m.quantity || 0,
    reason: m.reason || null,
    reference_id: m.referenceId || null,
  };
}

function rowToInvMov(r) {
  return {
    id: r.id, productId: r.product_id, type: r.type,
    quantity: r.quantity, reason: r.reason,
    referenceId: r.reference_id, createdAt: r.created_at,
  };
}

function invPoToRow(po) {
  return {
    id: po.id, supplier: po.supplier || null,
    status: po.status || 'draft',
    items: JSON.stringify(po.items || []),
    total: po.total || null, notes: po.notes || null,
  };
}

function rowToInvPo(r) {
  return {
    id: r.id, supplier: r.supplier, status: r.status,
    items: r.items || [], total: r.total,
    notes: r.notes, createdAt: r.created_at,
  };
}

function employeeToRow(e) {
  return {
    id: e.id, name: e.name, email: e.email,
    role: e.role || 'staff',
    phone: e.phone || null,
    active: e.active !== false,
    join_date: e.joinDate || null,
  };
}

function rowToEmployee(r) {
  return {
    id: r.id, name: r.name, email: r.email,
    role: r.role, phone: r.phone, active: r.active,
    joinDate: r.join_date,
  };
}

function userToRow(u) {
  return {
    id: u.id, name: u.name, email: u.email,
    password_hash: u.passwordHash,
    role: u.role || 'support',
    permissions: u.permissions || [],
    active: u.active !== false,
  };
}

function rowToUser(r) {
  return {
    id: r.id, name: r.name, email: r.email,
    passwordHash: r.password_hash,
    role: r.role, permissions: r.permissions || [],
    active: r.active,
  };
}

// ── SAVE HELPERS (used by syncDB) ─────────────────────────────────────────────

async function saveCollection(tableName, memoryArray, toRow, idKey = 'id') {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (Array.isArray(idKey)) {
      // For composite keys (like cart_items, wishlist_items) where no other tables reference them:
      // it is safe to use DELETE and re-insert because there are no foreign key dependencies pointing to them.
      await client.query(`DELETE FROM ${tableName}`);
      for (const item of memoryArray) {
        const row = toRow(item);
        const cols = Object.keys(row);
        const vals = Object.values(row);
        const ph = cols.map((_, i) => `$${i + 1}`).join(',');
        await client.query(
          `INSERT INTO ${tableName} (${cols.join(',')}) VALUES (${ph})`,
          vals
        );
      }
    } else {
      // Single-column primary key (e.g. id, code, etc.)
      const currentIds = [];
      for (const item of memoryArray) {
        const row = toRow(item);
        const cols = Object.keys(row);
        const vals = Object.values(row);
        
        if (row[idKey] !== undefined && row[idKey] !== null) {
          currentIds.push(row[idKey]);
        }
        
        const ph = cols.map((_, i) => `$${i + 1}`).join(',');
        const updateCols = cols.filter(col => col !== idKey);
        
        let queryStr = `INSERT INTO ${tableName} (${cols.join(',')}) VALUES (${ph})`;
        if (updateCols.length > 0) {
          const updateStr = updateCols.map((col, idx) => `${col} = EXCLUDED.${col}`).join(',');
          queryStr += ` ON CONFLICT (${idKey}) DO UPDATE SET ${updateStr}`;
        } else {
          queryStr += ` ON CONFLICT (${idKey}) DO NOTHING`;
        }
        
        await client.query(queryStr, vals);
      }
      
      // Delete any rows that are no longer in memory
      if (currentIds.length > 0) {
        const phs = currentIds.map((_, i) => `$${i + 1}`).join(',');
        await client.query(`DELETE FROM ${tableName} WHERE ${idKey} NOT IN (${phs})`, currentIds);
      } else {
        await client.query(`DELETE FROM ${tableName}`);
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function saveSessions(tableName, sessionObject, userIdField) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM ${tableName}`);
    for (const [token, data] of Object.entries(sessionObject)) {
      const userId = data.customerId || data.userId;
      const expires = new Date(data.expires);
      await client.query(
        `INSERT INTO ${tableName} (token, ${userIdField}, expires_at) VALUES ($1, $2, $3)`,
        [token, userId, expires]
      ).catch(() => {}); // skip FK violations
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function saveConfig(key, configObject) {
  await pool.query(
    `INSERT INTO configs (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, JSON.stringify(configObject)]
  );
}

// ── SYNC QUEUE ────────────────────────────────────────────────────────────────
let syncQueue = Promise.resolve();

function syncDB(key, DB) {
  syncQueue = syncQueue.then(async () => {
    try {
      if      (key === 'products')               await saveCollection('products',                    DB.products,              productToRow);
      else if (key === 'productVariants')        await saveCollection('product_variants',             DB.productVariants,       productVariantToRow);
      else if (key === 'orders')                 await saveCollection('orders',                      DB.orders,                orderToRow);
      else if (key === 'transactions')           await saveCollection('transactions',                DB.transactions,          txnToRow);
      else if (key === 'customerAuth')           await saveCollection('customer_auth',               DB.customerAuth,          customerToRow);
      else if (key === 'cartItems')              await saveCollection('cart_items',                  DB.cartItems,             cartToRow,        ['customer_id', 'product_id', 'size']);
      else if (key === 'wishlistItems')          await saveCollection('wishlist_items',              DB.wishlistItems,         wishlistToRow,    ['customer_id', 'product_id']);
      else if (key === 'customerSessions')       await saveSessions('customer_sessions',             DB.customerSessions,      'customer_id');
      else if (key === 'adminSessions')          await saveSessions('admin_sessions',                DB.adminSessions,         'user_id');
      else if (key === 'auditLog')               await saveCollection('audit_log',                   DB.auditLog,              auditToRow);
      else if (key === 'tickets')                await saveCollection('tickets',                     DB.tickets,               ticketToRow);
      else if (key === 'coupons')                await saveCollection('coupons',                     DB.coupons,               couponToRow,      'code');
      else if (key === 'countries')              await saveCollection('countries',                   DB.countries,             countryToRow,     'code');
      else if (key === 'inventory.movements')    await saveCollection('inventory_movements',         DB.inventory.movements,   invMovToRow);
      else if (key === 'inventory.purchaseOrders') await saveCollection('inventory_purchase_orders', DB.inventory.purchaseOrders, invPoToRow);
      else if (key === 'employees')              await saveCollection('employees',                   DB.employees,             employeeToRow);
      else if (key === 'users')                  await saveCollection('users',                       DB.users,                 userToRow);
      else if (['featureFlags','content','theme','settings'].includes(key)) await saveConfig(key, DB[key]);
    } catch (err) {
      console.error(`[DB] Error syncing ${key}:`, err.message);
    }
  });
  return syncQueue;
}

module.exports = { initDB, syncDB, pool };

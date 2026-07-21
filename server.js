// ════════════════════════════════════════════════════════════════════════════════
// GIAFABS ENTERPRISE BACKEND v4
// Fully-controlled commerce engine. Frontend reads config/content/flags from here.
// ════════════════════════════════════════════════════════════════════════════════
const config = require('./src/config');
const express = require('express');
const cors = require('cors');
const {
  hashPw, verifyPw, genToken, genId, verifyPaymentSignature,
  ROLE_PERMISSIONS, hasPermission, rateLimit, validate
} = require('./core');
const { DB } = require('./data');
const { initDB, syncDB, pool } = require('./db-postgres');
const swaggerUi = require('swagger-ui-express');
const swaggerDocument = require('./swagger.json');
const Razorpay = require('razorpay');
const { autoDispatchOrder } = require('./src/shipping');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Swagger UI Documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

let dbReady = false;
let dbPromise = initDB(DB).then(() => {
  dbReady = true;
}).catch(err => {
  console.error('[DB] PostgreSQL initialization failed:', err);
});

// Block incoming requests until DB is initialized from PostgreSQL
app.use((req, res, next) => {
  if (dbReady) return next();
  dbPromise.then(() => next()).catch(err => res.status(500).json({ error: 'Database failed to initialize' }));
});

const SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

// ─────────── AUDIT LOG (append-only) ───────────
function audit(actor, action, target, meta = {}) {
  DB.auditLog.push({
    id: genId('LOG', DB.auditLog.length + 1, 8),
    time: new Date().toISOString(),
    actor: actor || 'system', action, target, meta
  });
  if (DB.auditLog.length > 5000) DB.auditLog.shift(); // cap memory
  syncDB('auditLog', DB);
}

// ─────────── MIDDLEWARE ───────────
function requireAdmin(permission) {
  return (req, res, next) => {
    const token = req.headers['x-admin-token'];
    const sess = token && DB.adminSessions[token];
    if (!sess || sess.expires < Date.now()) return res.status(401).json({ error: 'Admin session invalid or expired' });
    const user = DB.users.find(u => u.id === sess.userId);
    if (!user || !user.active) return res.status(401).json({ error: 'Account inactive' });
    if (permission && !hasPermission(user, permission)) {
      audit(user.email, 'PERMISSION_DENIED', permission);
      return res.status(403).json({ error: `Insufficient permission: ${permission}` });
    }
    req.user = user;
    next();
  };
}
function requireCustomer(req, res, next) {
  const token = req.headers['x-customer-token'];
  const sess = token && DB.customerSessions[token];
  if (!sess || sess.expires < Date.now()) return res.status(401).json({ error: 'Please sign in to place an order' });
  const cust = DB.customerAuth.find(c => c.id === sess.customerId);
  if (!cust) return res.status(401).json({ error: 'Session expired' });
  req.customer = cust;
  next();
}
// Maintenance kill-switch (except admin + health)
app.use((req, res, next) => {
  if (DB.featureFlags.maintenanceMode &&
      !req.path.startsWith('/api/auth') &&
      !req.path.startsWith('/api/admin') &&
      req.path !== '/api/health' &&
      !req.headers['x-admin-token']) {
    return res.status(503).json({ error: 'Store under maintenance. Please check back shortly.', maintenance: true });
  }
  next();
});

// ════════════════════════════════════════════════════════════════════════════════
// HEALTH & PUBLIC BOOTSTRAP (frontend loads everything from here)
// ════════════════════════════════════════════════════════════════════════════════
app.get('/api/health', (_, res) => res.json({ ok: true, version: '4.0', time: new Date().toISOString() }));

// Single call frontend uses to configure itself — "fully controlled by backend"
app.get('/api/bootstrap', (_, res) => {
  const p = DB.settings.payments;
  // Online gateways are driven entirely by the Integrations admin page —
  // this is the single source of truth (no more duplicated per-gateway
  // enabled flags on DB.settings.payments to keep in sync).
  const onlineGateways = Object.entries(DB.settings.integrations || {})
    .filter(([, cfg]) => cfg.category === 'payment' && cfg.enabled)
    .map(([key, cfg]) => ({ key, label: cfg.label }));
  res.json({
    featureFlags: DB.featureFlags,
    content: DB.content,
    theme: DB.theme,
    store: { name: DB.settings.store.name, email: DB.settings.store.email, phone: DB.settings.store.phone, address: DB.settings.store.address },
    payments: {
      codEnabled: p.codEnabled && DB.featureFlags.codPayment,
      onlineGateways,
      freeShippingMin: p.freeShippingMin, codCharge: p.codCharge, codMaxValue: p.codMaxValue,
      standardShipping: p.standardShipping, codShipping: p.codShipping,
    },
    countries: DB.countries,
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// CUSTOMER AUTH (rate-limited, validated, PBKDF2)
// ════════════════════════════════════════════════════════════════════════════════
app.post('/api/customer/register', (req, res) => {
  const ip = req.ip || 'anon';
  if (!rateLimit(`reg:${ip}`, 5, 60000)) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  const { name, email, password, mobile } = req.body;
  if (!validate.nonEmpty(name)) return res.status(400).json({ error: 'Name is required' });
  if (!validate.email(email)) return res.status(400).json({ error: 'Valid email required' });
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (mobile && !validate.mobile(mobile)) return res.status(400).json({ error: 'Invalid mobile number' });
  if (DB.customerAuth.find(c => c.email.toLowerCase() === email.toLowerCase()))
    return res.status(409).json({ error: 'Email already registered' });

  const cust = { id: genId('CU', DB.customerAuth.length + 1001), name: name.trim(), email: email.toLowerCase(), mobile: mobile || '', passwordHash: hashPw(password), createdAt: new Date().toISOString(), wallet: 0 };
  DB.customerAuth.push(cust);
  const token = genToken();
  DB.customerSessions[token] = { customerId: cust.id, expires: Date.now() + SESSION_TTL };
  audit(cust.email, 'CUSTOMER_REGISTER', cust.id);
  syncDB('customerAuth', DB);
  syncDB('customerSessions', DB);
  res.json({ success: true, token, user: { id: cust.id, name: cust.name, email: cust.email, mobile: cust.mobile, wallet: cust.wallet } });
});

app.post('/api/customer/login', (req, res) => {
  const ip = req.ip || 'anon';
  if (!rateLimit(`login:${ip}`, 10, 60000)) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  const { email, password } = req.body;
  const cust = DB.customerAuth.find(c => c.email.toLowerCase() === (email || '').toLowerCase());
  if (!cust || !verifyPw(password, cust.passwordHash)) return res.status(401).json({ error: 'Invalid email or password' });
  const token = genToken();
  DB.customerSessions[token] = { customerId: cust.id, expires: Date.now() + SESSION_TTL };
  audit(cust.email, 'CUSTOMER_LOGIN', cust.id);
  syncDB('customerSessions', DB);
  res.json({ success: true, token, user: { id: cust.id, name: cust.name, email: cust.email, mobile: cust.mobile, wallet: cust.wallet } });
});

app.get('/api/customer/me', requireCustomer, (req, res) => {
  const c = req.customer;
  const addresses = DB.customerAddresses.filter(a => a.customerId === c.id);
  res.json({ id: c.id, name: c.name, email: c.email, mobile: c.mobile, wallet: c.wallet, addresses });
});

app.post('/api/customer/logout', (req, res) => {
  const token = req.headers['x-customer-token'];
  if (token) {
    delete DB.customerSessions[token];
    syncDB('customerSessions', DB);
  }
  res.json({ success: true });
});

// Customer address book (multiple saved addresses + one default)
app.get('/api/customer/addresses', requireCustomer, (req, res) => {
  const addresses = DB.customerAddresses.filter(a => a.customerId === req.customer.id);
  res.json(addresses);
});

app.post('/api/customer/addresses', requireCustomer, async (req, res) => {
  const customerId = req.customer.id;
  const { firstName, lastName, phone, line1, line2, city, state, pincode, country, countryCode, label, isDefault } = req.body;

  if (!validate.nonEmpty(line1)) return res.status(400).json({ error: 'Address line 1 is required' });
  if (!validate.nonEmpty(city)) return res.status(400).json({ error: 'City is required' });
  if (!validate.nonEmpty(state)) return res.status(400).json({ error: 'State is required' });
  if (!validate.pincode(pincode)) return res.status(400).json({ error: 'Valid pincode is required' });
  if (phone && !validate.mobile(phone)) return res.status(400).json({ error: 'Invalid phone number' });

  const existing = DB.customerAddresses.filter(a => a.customerId === customerId);
  const makeDefault = existing.length === 0 || isDefault === true;
  if (makeDefault) existing.forEach(a => { a.isDefault = false; });

  const address = {
    id: genId('ADDR', DB.customerAddresses.length + 1001),
    customerId,
    label: label || '',
    firstName: firstName || '',
    lastName: lastName || '',
    phone: phone || '',
    line1, line2: line2 || '', city, state, pincode,
    country: country || 'India',
    countryCode: countryCode || 'IN',
    isDefault: makeDefault,
    createdAt: new Date().toISOString(),
  };
  DB.customerAddresses.push(address);
  await syncDB('customerAddresses', DB);
  res.status(201).json(address);
});

app.put('/api/customer/addresses/:id', requireCustomer, async (req, res) => {
  const customerId = req.customer.id;
  const address = DB.customerAddresses.find(a => a.id === req.params.id && a.customerId === customerId);
  if (!address) return res.status(404).json({ error: 'Address not found' });

  const { firstName, lastName, phone, line1, line2, city, state, pincode, country, countryCode, label, isDefault } = req.body;
  if (line1 !== undefined && !validate.nonEmpty(line1)) return res.status(400).json({ error: 'Address line 1 is required' });
  if (city !== undefined && !validate.nonEmpty(city)) return res.status(400).json({ error: 'City is required' });
  if (state !== undefined && !validate.nonEmpty(state)) return res.status(400).json({ error: 'State is required' });
  if (pincode !== undefined && !validate.pincode(pincode)) return res.status(400).json({ error: 'Valid pincode is required' });
  if (phone && !validate.mobile(phone)) return res.status(400).json({ error: 'Invalid phone number' });

  if (firstName !== undefined) address.firstName = firstName;
  if (lastName !== undefined) address.lastName = lastName;
  if (phone !== undefined) address.phone = phone;
  if (line1 !== undefined) address.line1 = line1;
  if (line2 !== undefined) address.line2 = line2;
  if (city !== undefined) address.city = city;
  if (state !== undefined) address.state = state;
  if (pincode !== undefined) address.pincode = pincode;
  if (country !== undefined) address.country = country;
  if (countryCode !== undefined) address.countryCode = countryCode;
  if (label !== undefined) address.label = label;

  if (isDefault === true) {
    DB.customerAddresses.filter(a => a.customerId === customerId).forEach(a => { a.isDefault = (a.id === address.id); });
  }

  await syncDB('customerAddresses', DB);
  res.json(address);
});

app.put('/api/customer/addresses/:id/default', requireCustomer, async (req, res) => {
  const customerId = req.customer.id;
  const address = DB.customerAddresses.find(a => a.id === req.params.id && a.customerId === customerId);
  if (!address) return res.status(404).json({ error: 'Address not found' });

  DB.customerAddresses.filter(a => a.customerId === customerId).forEach(a => { a.isDefault = (a.id === address.id); });
  await syncDB('customerAddresses', DB);
  res.json({ success: true, addresses: DB.customerAddresses.filter(a => a.customerId === customerId) });
});

app.delete('/api/customer/addresses/:id', requireCustomer, async (req, res) => {
  const customerId = req.customer.id;
  const address = DB.customerAddresses.find(a => a.id === req.params.id && a.customerId === customerId);
  if (!address) return res.status(404).json({ error: 'Address not found' });

  DB.customerAddresses = DB.customerAddresses.filter(a => a.id !== address.id);
  if (address.isDefault) {
    const remaining = DB.customerAddresses.filter(a => a.customerId === customerId);
    if (remaining.length > 0) remaining[0].isDefault = true;
  }

  await syncDB('customerAddresses', DB);
  res.json({ success: true, addresses: DB.customerAddresses.filter(a => a.customerId === customerId) });
});

// Customer order history
app.get('/api/customer/orders', requireCustomer, (req, res) => {
  const orders = DB.orders.filter(o => o.customer.email === req.customer.email).reverse();
  res.json({ total: orders.length, orders });
});

// Customer cart operations
app.get('/api/cart', requireCustomer, (req, res) => {
  const customerId = req.customer.id;
  const items = (DB.cartItems || [])
    .filter(item => item.customerId === customerId)
    .map(item => {
      const prod = DB.products.find(p => p.id === item.productId);
      const variant = DB.productVariants.find(v => v.productId === item.productId && v.size === item.size);
      return {
        productId: item.productId,
        size: item.size,
        qty: item.qty,
        name: prod?.name,
        sku: prod?.sku,
        image: prod?.images?.[0],
        price: variant?.price ?? prod?.price ?? 0,
        mrp: variant?.mrp ?? prod?.mrp ?? 0,
        gst: prod?.gst ?? 0,
        availableStock: variant?.stock ?? prod?.stock ?? 0,
        active: prod?.active !== false,
      };
    });
  res.json(items);
});

app.post('/api/cart', requireCustomer, async (req, res) => {
  const customerId = req.customer.id;
  const { items } = req.body;
  if (!Array.isArray(items)) {
    return res.status(400).json({ error: 'Items must be an array' });
  }
  for (const item of items) {
    if (!item.id || typeof item.qty !== 'number' || item.qty <= 0 || !item.size) {
      return res.status(400).json({ error: 'Invalid cart item format' });
    }
    const prod = DB.products.find(p => p.id === item.id);
    if (!prod || !prod.active) return res.status(400).json({ error: `Product ${item.id} unavailable` });
    const variants = DB.productVariants.filter(v => v.productId === item.id);
    if (variants.length > 0) {
      const variant = variants.find(v => v.size === item.size);
      if (!variant || variant.stock <= 0) {
        return res.status(400).json({ error: `Size ${item.size} not available for ${prod.name}` });
      }
    }
  }

  // Filter out customer's existing items
  DB.cartItems = (DB.cartItems || []).filter(item => item.customerId !== customerId);

  // Push new items
  for (const item of items) {
    DB.cartItems.push({
      customerId,
      productId: item.id,
      qty: item.qty,
      size: item.size
    });
  }

  await syncDB('cartItems', DB);
  res.json({ success: true, items });
});

app.delete('/api/cart', requireCustomer, async (req, res) => {
  const customerId = req.customer.id;
  DB.cartItems = (DB.cartItems || []).filter(item => item.customerId !== customerId);
  await syncDB('cartItems', DB);
  res.json({ success: true, items: [] });
});

// Customer wishlist operations
app.get('/api/wishlist', requireCustomer, (req, res) => {
  const customerId = req.customer.id;
  const items = (DB.wishlistItems || [])
    .filter(item => item.customerId === customerId)
    .map(item => item.productId);
  res.json(items);
});

app.post('/api/wishlist', requireCustomer, async (req, res) => {
  const customerId = req.customer.id;
  const { productId } = req.body;
  if (!productId) return res.status(400).json({ error: 'productId is required' });
  const prod = DB.products.find(p => p.id === productId);
  if (!prod) return res.status(404).json({ error: 'Product not found' });

  DB.wishlistItems = DB.wishlistItems || [];
  const exists = DB.wishlistItems.some(item => item.customerId === customerId && item.productId === productId);
  if (!exists) {
    DB.wishlistItems.push({ customerId, productId });
    await syncDB('wishlistItems', DB);
  }
  const items = DB.wishlistItems.filter(item => item.customerId === customerId).map(item => item.productId);
  res.json({ success: true, items });
});

app.delete('/api/wishlist/:productId', requireCustomer, async (req, res) => {
  const customerId = req.customer.id;
  const { productId } = req.params;
  DB.wishlistItems = (DB.wishlistItems || []).filter(
    item => !(item.customerId === customerId && item.productId === productId)
  );
  await syncDB('wishlistItems', DB);
  const items = DB.wishlistItems.filter(item => item.customerId === customerId).map(item => item.productId);
  res.json({ success: true, items });
});

// ════════════════════════════════════════════════════════════════════════════════
// ADMIN AUTH
// ════════════════════════════════════════════════════════════════════════════════
app.post('/api/auth/login', (req, res) => {
  const ip = req.ip || 'anon';
  if (!rateLimit(`admlogin:${ip}`, 10, 60000)) return res.status(429).json({ error: 'Too many attempts' });
  const { email, password } = req.body;
  const user = DB.users.find(u => u.email.toLowerCase() === (email || '').toLowerCase());
  if (!user || !verifyPw(password, user.passwordHash)) return res.status(401).json({ error: 'Invalid credentials' });
  if (!user.active) return res.status(403).json({ error: 'Account disabled' });
  const token = genToken();
  DB.adminSessions[token] = { userId: user.id, expires: Date.now() + SESSION_TTL };
  audit(user.email, 'ADMIN_LOGIN', user.id);
  syncDB('adminSessions', DB);
  res.json({ success: true, token, user: { id: user.id, name: user.name, email: user.email, role: user.role, permissions: user.permissions.length ? user.permissions : ROLE_PERMISSIONS[user.role] } });
});
app.post('/api/auth/logout', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (token) {
    delete DB.adminSessions[token];
    syncDB('adminSessions', DB);
  }
  res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════════════════
// PRODUCTS
// ════════════════════════════════════════════════════════════════════════════════

// Recompute a product's flat price/mrp/stock from its variants (cheapest
// variant's price/mrp for "from ₹X" display, sum of variant stock). Products
// with no variants keep their flat fields untouched (backward compatible).
function recomputeProductAggregate(productId) {
  const p = DB.products.find(x => x.id === productId);
  if (!p) return;
  const variants = DB.productVariants.filter(v => v.productId === productId);
  if (variants.length === 0) return;
  const cheapest = variants.reduce((min, v) => (v.price < min.price ? v : min), variants[0]);
  p.price = cheapest.price;
  p.mrp = cheapest.mrp;
  p.stock = variants.reduce((s, v) => s + v.stock, 0);
}

// Replace a product's variants wholesale from an incoming [{size,price,mrp,stock,sku}]
// array: upsert by size, delete rows for sizes no longer present.
function replaceProductVariants(productId, incomingVariants) {
  const incomingSizes = new Set(incomingVariants.map(v => v.size));
  DB.productVariants = DB.productVariants.filter(v => v.productId !== productId || incomingSizes.has(v.size));
  for (const iv of incomingVariants) {
    const id = `${productId}-${iv.size}`;
    let row = DB.productVariants.find(v => v.id === id);
    if (!row) {
      row = { id, productId, size: iv.size, price: 0, mrp: 0, stock: 0 };
      DB.productVariants.push(row);
    }
    row.price = iv.price;
    row.mrp = iv.mrp;
    row.stock = iv.stock;
    if (iv.sku) row.sku = iv.sku;
  }
  recomputeProductAggregate(productId);
}

function attachVariants(p) {
  return { ...p, variants: DB.productVariants.filter(v => v.productId === p.id) };
}

app.get('/api/products', (req, res) => {
  let prods = DB.products.filter(p => p.active);
  const { category, fabric, minPrice, maxPrice, brand, search, sortBy, featured } = req.query;
  if (category && category !== 'all') prods = prods.filter(p => p.category === category);
  if (fabric && fabric !== 'all') prods = prods.filter(p => p.fabric === fabric);
  if (brand) prods = prods.filter(p => p.brand === brand);
  if (featured === 'true') prods = prods.filter(p => p.featured);
  if (minPrice) prods = prods.filter(p => p.price >= +minPrice);
  if (maxPrice) prods = prods.filter(p => p.price <= +maxPrice);
  if (search) { const q = search.toLowerCase(); prods = prods.filter(p => (p.name + p.description + p.tags.join(' ')).toLowerCase().includes(q)); }
  if (sortBy === 'price-low') prods.sort((a, b) => a.price - b.price);
  else if (sortBy === 'price-high') prods.sort((a, b) => b.price - a.price);
  else if (sortBy === 'rating') prods.sort((a, b) => b.rating - a.rating);
  else if (sortBy === 'newest') prods.sort((a, b) => (b.isNew ? 1 : 0) - (a.isNew ? 1 : 0));
  res.json({ total: prods.length, products: prods.map(attachVariants) });
});
app.get('/api/products/:id', (req, res, next) => {
  if (['query','export','bulk'].includes(req.params.id)) return next(); // reserved subpaths
  const p = DB.products.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Product not found' });
  // related: same category, exclude self
  const related = DB.products.filter(x => x.active && x.category === p.category && x.id !== p.id).slice(0, 4);
  res.json({ ...attachVariants(p), related });
});
app.post('/api/products', requireAdmin('products.*'), (req, res) => {
  if (!validate.nonEmpty(req.body.name)) return res.status(400).json({ error: 'Product name required' });
  if (req.body.category && !DB.categories.find(c => c.name === req.body.category)) {
    return res.status(400).json({ error: `Unknown category "${req.body.category}". Create it first via /api/admin/categories.` });
  }
  if (req.body.fabric && !DB.fabrics.find(f => f.name === req.body.fabric)) {
    return res.status(400).json({ error: `Unknown fabric "${req.body.fabric}". Create it first via /api/admin/fabrics.` });
  }
  const { variants: incomingVariants, ...body } = req.body;
  const p = { id: genId('PRD', DB.products.length + 1001, 3), createdAt: new Date().toISOString(), active: true, rating: 0, reviews: 0, tags: [], images: [], sizes: [], ...body };
  DB.products.push(p);
  const productsSynced = syncDB('products', DB);
  if (Array.isArray(incomingVariants) && incomingVariants.length) {
    replaceProductVariants(p.id, incomingVariants);
    productsSynced.then(() => syncDB('productVariants', DB));
  }
  audit(req.user.email, 'PRODUCT_CREATE', p.id);
  res.json({ success: true, product: attachVariants(p) });
});
app.patch('/api/products/:id', requireAdmin('products.*'), async (req, res) => {
  const p = DB.products.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (req.body.category && !DB.categories.find(c => c.name === req.body.category)) {
    return res.status(400).json({ error: `Unknown category "${req.body.category}". Create it first via /api/admin/categories.` });
  }
  if (req.body.fabric && !DB.fabrics.find(f => f.name === req.body.fabric)) {
    return res.status(400).json({ error: `Unknown fabric "${req.body.fabric}". Create it first via /api/admin/fabrics.` });
  }
  const { variants: incomingVariants, ...body } = req.body;
  Object.assign(p, body, { updatedAt: new Date().toISOString() });
  const productsSynced = syncDB('products', DB);
  if (Array.isArray(incomingVariants)) {
    replaceProductVariants(p.id, incomingVariants);
    productsSynced.then(() => syncDB('productVariants', DB));
  }
  audit(req.user.email, 'PRODUCT_UPDATE', p.id, req.body);

  // Auto-dispatch any orders held due to this product being out of stock
  const heldOrders = DB.orders.filter(o =>
    o.shippingStatus === 'awaiting_stock' &&
    o.items.some(i => i.productId === p.id)
  );
  if (heldOrders.length > 0) {
    // Run sequentially to avoid Shiprocket rate limit
    for (const heldOrder of heldOrders) {
      const dispatch = await autoDispatchOrder(heldOrder, DB);
      audit(req.user.email, 'AUTO_DISPATCH_ON_RESTOCK', heldOrder.id, { result: dispatch.reason, product: p.id });
    }
    if (heldOrders.length > 0) syncDB('orders', DB);
  }

  res.json({ success: true, product: attachVariants(p), autoDispatched: heldOrders.length });
});
app.delete('/api/products/:id', requireAdmin('products.*'), (req, res) => {
  const i = DB.products.findIndex(x => x.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  const [removed] = DB.products.splice(i, 1);
  syncDB('products', DB);
  audit(req.user.email, 'PRODUCT_DELETE', removed.id);
  res.json({ success: true });
});
app.patch('/api/products/:id/toggle', requireAdmin('products.*'), (req, res) => {
  const p = DB.products.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  p.active = !p.active;
  syncDB('products', DB);
  audit(req.user.email, 'PRODUCT_TOGGLE', p.id, { active: p.active });
  res.json({ success: true, active: p.active });
});

// ════════════════════════════════════════════════════════════════════════════════
// CATEGORIES (admin-managed; products reference by name)
// ════════════════════════════════════════════════════════════════════════════════
function categoryWithCount(c) {
  return { ...c, productCount: DB.products.filter(p => p.category === c.name).length };
}
app.get('/api/categories', (_, res) => {
  const cats = DB.categories.filter(c => c.active).sort((a, b) => a.sortOrder - b.sortOrder);
  res.json({ categories: cats.map(categoryWithCount) });
});
app.get('/api/admin/categories', requireAdmin('products.*'), (_, res) => {
  const cats = [...DB.categories].sort((a, b) => a.sortOrder - b.sortOrder);
  res.json({ categories: cats.map(categoryWithCount) });
});
app.post('/api/admin/categories', requireAdmin('products.*'), (req, res) => {
  const name = (req.body.name || '').trim();
  if (!validate.nonEmpty(name)) return res.status(400).json({ error: 'Category name required' });
  if (DB.categories.find(c => c.name.toLowerCase() === name.toLowerCase())) {
    return res.status(409).json({ error: 'Category already exists' });
  }
  const slug = (req.body.slug || name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug) return res.status(400).json({ error: 'Could not derive a valid slug from name' });
  if (DB.categories.find(c => c.slug === slug)) return res.status(409).json({ error: 'Category slug already exists' });
  const c = {
    name, slug,
    gstRate: Number.isFinite(+req.body.gstRate) ? +req.body.gstRate : 12,
    active: true,
    sortOrder: Number.isFinite(+req.body.sortOrder) ? +req.body.sortOrder : DB.categories.length + 1,
  };
  DB.categories.push(c);
  syncDB('categories', DB);
  audit(req.user.email, 'CATEGORY_CREATE', c.name);
  res.json({ success: true, category: categoryWithCount(c) });
});
app.patch('/api/admin/categories/:name', requireAdmin('products.*'), (req, res) => {
  const c = DB.categories.find(x => x.name === req.params.name);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const { name: newName, slug, gstRate, sortOrder, active } = req.body;
  if (newName && newName.trim() && newName !== c.name) {
    if (DB.categories.find(x => x !== c && x.name.toLowerCase() === newName.toLowerCase())) {
      return res.status(409).json({ error: 'Category name already in use' });
    }
    // cascade rename so existing products/occasions keep pointing at a valid category
    DB.products.filter(p => p.category === c.name).forEach(p => { p.category = newName; });
    syncDB('products', DB);
    const affectedOccasions = DB.occasions.filter(o => o.category === c.name);
    if (affectedOccasions.length) {
      affectedOccasions.forEach(o => { o.category = newName; });
      syncDB('occasions', DB);
    }
    c.name = newName;
  }
  if (slug) c.slug = slug;
  if (Number.isFinite(+gstRate)) c.gstRate = +gstRate;
  if (Number.isFinite(+sortOrder)) c.sortOrder = +sortOrder;
  if (typeof active === 'boolean') c.active = active;
  syncDB('categories', DB);
  audit(req.user.email, 'CATEGORY_UPDATE', c.name, req.body);
  res.json({ success: true, category: categoryWithCount(c) });
});
app.delete('/api/admin/categories/:name', requireAdmin('products.*'), (req, res) => {
  const i = DB.categories.findIndex(x => x.name === req.params.name);
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  if (DB.products.some(p => p.category === req.params.name)) {
    return res.status(409).json({ error: 'Category is in use by products; reassign or remove those products first' });
  }
  if (DB.occasions.some(o => o.category === req.params.name)) {
    return res.status(409).json({ error: 'Category is in use by a "Shop by Occasion" link; remove or reassign it first' });
  }
  const [removed] = DB.categories.splice(i, 1);
  syncDB('categories', DB);
  audit(req.user.email, 'CATEGORY_DELETE', removed.name);
  res.json({ success: true });
});
app.patch('/api/admin/categories/:name/toggle', requireAdmin('products.*'), (req, res) => {
  const c = DB.categories.find(x => x.name === req.params.name);
  if (!c) return res.status(404).json({ error: 'Not found' });
  c.active = !c.active;
  syncDB('categories', DB);
  audit(req.user.email, 'CATEGORY_TOGGLE', c.name, { active: c.active });
  res.json({ success: true, active: c.active });
});

// ════════════════════════════════════════════════════════════════════════════════
// FABRICS (admin-managed; products reference by name)
// ════════════════════════════════════════════════════════════════════════════════
function fabricWithCount(f) {
  return { ...f, productCount: DB.products.filter(p => p.fabric === f.name).length };
}
app.get('/api/fabrics', (_, res) => {
  const fabs = DB.fabrics.filter(f => f.active).sort((a, b) => a.sortOrder - b.sortOrder);
  res.json({ fabrics: fabs.map(fabricWithCount) });
});
app.get('/api/admin/fabrics', requireAdmin('products.*'), (_, res) => {
  const fabs = [...DB.fabrics].sort((a, b) => a.sortOrder - b.sortOrder);
  res.json({ fabrics: fabs.map(fabricWithCount) });
});
app.post('/api/admin/fabrics', requireAdmin('products.*'), (req, res) => {
  const name = (req.body.name || '').trim();
  if (!validate.nonEmpty(name)) return res.status(400).json({ error: 'Fabric name required' });
  if (DB.fabrics.find(f => f.name.toLowerCase() === name.toLowerCase())) {
    return res.status(409).json({ error: 'Fabric already exists' });
  }
  const slug = (req.body.slug || name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug) return res.status(400).json({ error: 'Could not derive a valid slug from name' });
  if (DB.fabrics.find(f => f.slug === slug)) return res.status(409).json({ error: 'Fabric slug already exists' });
  const f = {
    name, slug,
    active: true,
    sortOrder: Number.isFinite(+req.body.sortOrder) ? +req.body.sortOrder : DB.fabrics.length + 1,
  };
  DB.fabrics.push(f);
  syncDB('fabrics', DB);
  audit(req.user.email, 'FABRIC_CREATE', f.name);
  res.json({ success: true, fabric: fabricWithCount(f) });
});
app.patch('/api/admin/fabrics/:name', requireAdmin('products.*'), (req, res) => {
  const f = DB.fabrics.find(x => x.name === req.params.name);
  if (!f) return res.status(404).json({ error: 'Not found' });
  const { name: newName, slug, sortOrder, active } = req.body;
  if (newName && newName.trim() && newName !== f.name) {
    if (DB.fabrics.find(x => x !== f && x.name.toLowerCase() === newName.toLowerCase())) {
      return res.status(409).json({ error: 'Fabric name already in use' });
    }
    // cascade rename so existing products keep pointing at a valid fabric
    DB.products.filter(p => p.fabric === f.name).forEach(p => { p.fabric = newName; });
    syncDB('products', DB);
    f.name = newName;
  }
  if (slug) f.slug = slug;
  if (Number.isFinite(+sortOrder)) f.sortOrder = +sortOrder;
  if (typeof active === 'boolean') f.active = active;
  syncDB('fabrics', DB);
  audit(req.user.email, 'FABRIC_UPDATE', f.name, req.body);
  res.json({ success: true, fabric: fabricWithCount(f) });
});
app.delete('/api/admin/fabrics/:name', requireAdmin('products.*'), (req, res) => {
  const i = DB.fabrics.findIndex(x => x.name === req.params.name);
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  if (DB.products.some(p => p.fabric === req.params.name)) {
    return res.status(409).json({ error: 'Fabric is in use by products; reassign or remove those products first' });
  }
  const [removed] = DB.fabrics.splice(i, 1);
  syncDB('fabrics', DB);
  audit(req.user.email, 'FABRIC_DELETE', removed.name);
  res.json({ success: true });
});
app.patch('/api/admin/fabrics/:name/toggle', requireAdmin('products.*'), (req, res) => {
  const f = DB.fabrics.find(x => x.name === req.params.name);
  if (!f) return res.status(404).json({ error: 'Not found' });
  f.active = !f.active;
  syncDB('fabrics', DB);
  audit(req.user.email, 'FABRIC_TOGGLE', f.name, { active: f.active });
  res.json({ success: true, active: f.active });
});

// ════════════════════════════════════════════════════════════════════════════════
// OCCASIONS ("Shop by Occasion" curated links; admin-managed)
// ════════════════════════════════════════════════════════════════════════════════
app.get('/api/occasions', (_, res) => {
  const occs = DB.occasions.filter(o => o.active).sort((a, b) => a.sortOrder - b.sortOrder);
  res.json({ occasions: occs });
});
app.get('/api/admin/occasions', requireAdmin('products.*'), (_, res) => {
  const occs = [...DB.occasions].sort((a, b) => a.sortOrder - b.sortOrder);
  res.json({ occasions: occs });
});
app.post('/api/admin/occasions', requireAdmin('products.*'), (req, res) => {
  const label = (req.body.label || '').trim();
  const category = (req.body.category || '').trim();
  if (!validate.nonEmpty(label)) return res.status(400).json({ error: 'Occasion label required' });
  if (!category || !DB.categories.find(c => c.name === category)) {
    return res.status(400).json({ error: `Unknown category "${category}". Create it first via /api/admin/categories.` });
  }
  const o = {
    id: genId('OCC', DB.occasions.length + 1, 3),
    label, category,
    active: true,
    sortOrder: Number.isFinite(+req.body.sortOrder) ? +req.body.sortOrder : DB.occasions.length + 1,
  };
  DB.occasions.push(o);
  syncDB('occasions', DB);
  audit(req.user.email, 'OCCASION_CREATE', o.id);
  res.json({ success: true, occasion: o });
});
app.patch('/api/admin/occasions/:id', requireAdmin('products.*'), (req, res) => {
  const o = DB.occasions.find(x => x.id === req.params.id);
  if (!o) return res.status(404).json({ error: 'Not found' });
  const { label, category, sortOrder, active } = req.body;
  if (category && category !== o.category) {
    if (!DB.categories.find(c => c.name === category)) {
      return res.status(400).json({ error: `Unknown category "${category}". Create it first via /api/admin/categories.` });
    }
    o.category = category;
  }
  if (label && label.trim()) o.label = label.trim();
  if (Number.isFinite(+sortOrder)) o.sortOrder = +sortOrder;
  if (typeof active === 'boolean') o.active = active;
  syncDB('occasions', DB);
  audit(req.user.email, 'OCCASION_UPDATE', o.id, req.body);
  res.json({ success: true, occasion: o });
});
app.delete('/api/admin/occasions/:id', requireAdmin('products.*'), (req, res) => {
  const i = DB.occasions.findIndex(x => x.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  const [removed] = DB.occasions.splice(i, 1);
  syncDB('occasions', DB);
  audit(req.user.email, 'OCCASION_DELETE', removed.id);
  res.json({ success: true });
});
app.patch('/api/admin/occasions/:id/toggle', requireAdmin('products.*'), (req, res) => {
  const o = DB.occasions.find(x => x.id === req.params.id);
  if (!o) return res.status(404).json({ error: 'Not found' });
  o.active = !o.active;
  syncDB('occasions', DB);
  audit(req.user.email, 'OCCASION_TOGGLE', o.id, { active: o.active });
  res.json({ success: true, active: o.active });
});

// ════════════════════════════════════════════════════════════════════════════════
// COUNTRIES / COUPONS
// ════════════════════════════════════════════════════════════════════════════════
app.get('/api/countries', (_, res) => res.json(DB.countries));

app.post('/api/coupons/validate', (req, res) => {
  if (!DB.featureFlags.coupons) return res.status(400).json({ error: 'Coupons are currently disabled' });
  const { code, subtotal } = req.body;
  const c = DB.coupons.find(x => x.code.toUpperCase() === (code || '').toUpperCase() && x.active);
  if (!c) return res.status(404).json({ error: 'Invalid coupon code' });
  if (new Date(c.expiresAt) < new Date()) return res.status(400).json({ error: 'Coupon expired' });
  if (c.used >= c.usageLimit) return res.status(400).json({ error: 'Coupon usage limit reached' });
  if (subtotal < c.minOrder) return res.status(400).json({ error: `Minimum order ₹${c.minOrder} required` });
  const discount = c.type === 'percent' ? Math.min(Math.round(subtotal * c.value / 100), c.maxDiscount) : Math.min(c.value, c.maxDiscount);
  res.json({ success: true, code: c.code, discount, type: c.type, value: c.value });
});
// Admin coupon management
app.get('/api/coupons', requireAdmin('coupons.*'), (_, res) => res.json({ coupons: DB.coupons }));
app.post('/api/coupons', requireAdmin('coupons.*'), (req, res) => {
  if (DB.coupons.find(x => x.code.toUpperCase() === (req.body.code || '').toUpperCase())) {
    return res.status(409).json({ error: 'Coupon code already exists' });
  }
  const c = { used: 0, active: true, ...req.body };
  DB.coupons.push(c);
  syncDB('coupons', DB);
  audit(req.user.email, 'COUPON_CREATE', c.code);
  res.json({ success: true, coupon: c });
});
app.patch('/api/coupons/:code', requireAdmin('coupons.*'), (req, res) => {
  const c = DB.coupons.find(x => x.code === req.params.code);
  if (!c) return res.status(404).json({ error: 'Not found' });
  Object.assign(c, req.body);
  syncDB('coupons', DB);
  audit(req.user.email, 'COUPON_UPDATE', c.code, req.body);
  res.json({ success: true, coupon: c });
});
app.delete('/api/coupons/:code', requireAdmin('coupons.*'), (req, res) => {
  const i = DB.coupons.findIndex(x => x.code === req.params.code);
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  const [removed] = DB.coupons.splice(i, 1);
  syncDB('coupons', DB);
  audit(req.user.email, 'COUPON_DELETE', removed.code);
  res.json({ success: true });
});
app.patch('/api/coupons/:code/toggle', requireAdmin('coupons.*'), (req, res) => {
  const c = DB.coupons.find(x => x.code === req.params.code);
  if (!c) return res.status(404).json({ error: 'Not found' });
  c.active = !c.active;
  syncDB('coupons', DB);
  audit(req.user.email, 'COUPON_TOGGLE', c.code, { active: c.active });
  res.json({ success: true, active: c.active });
});

// ════════════════════════════════════════════════════════════════════════════════
// ORDER ENGINE (server-authoritative pricing — never trusts client totals)
// ════════════════════════════════════════════════════════════════════════════════
function computeOrder({ customer, shippingAddress, items, payment, couponCode, type = 'b2c' }) {
  if (!Array.isArray(items) || items.length === 0) return { error: 'No items in order', status: 400 };

  const countryCode = (shippingAddress && shippingAddress.countryCode) || 'IN';
  const country = DB.countries.find(c => c.code === countryCode) || DB.countries[0];
  const isIntl = countryCode !== 'IN';
  if (isIntl && !DB.featureFlags.internationalShipping) return { error: 'International shipping is currently unavailable', status: 400 };

  const pset = DB.settings.payments;
  // resolve each line item server-side (price, gst, weight from DB — not client)
  const lines = [];
  let subtotal = 0, gstTotal = 0, weight = 0;
  for (const it of items) {
    const prod = DB.products.find(p => p.id === it.productId && p.active);
    if (!prod) return { error: `Product ${it.productId} unavailable`, status: 400 };
    const qty = validate.positiveInt(it.qty) ? it.qty : 1;

    const productVariants = DB.productVariants.filter(v => v.productId === prod.id);
    let unit, size;
    if (productVariants.length > 0) {
      size = it.size;
      const variant = productVariants.find(v => v.size === size);
      if (!variant) return { error: `Size ${size} not available for ${prod.name}`, status: 400 };
      unit = type === 'b2b' ? prod.b2bPrice : variant.price;
    } else {
      unit = type === 'b2b' ? prod.b2bPrice : prod.price;
    }

    const lineSub = unit * qty;
    const lineGst = Math.round(lineSub * prod.gst / 100);
    subtotal += lineSub; gstTotal += lineGst; weight += (prod.weight || 0.4) * qty;
    lines.push({ productId: prod.id, size, name: prod.name, sku: prod.sku, hsn: prod.hsn, gstRate: prod.gst, unitPrice: unit, qty, lineSubtotal: lineSub, lineGst });
  }

  // coupon
  let discount = 0, appliedCoupon = null;
  if (couponCode && DB.featureFlags.coupons) {
    const c = DB.coupons.find(x => x.code.toUpperCase() === couponCode.toUpperCase() && x.active);
    if (c && new Date(c.expiresAt) >= new Date() && c.used < c.usageLimit && subtotal >= c.minOrder) {
      discount = c.type === 'percent' ? Math.min(Math.round(subtotal * c.value / 100), c.maxDiscount) : Math.min(c.value, c.maxDiscount);
      appliedCoupon = c.code;
    }
  }

  // payment method gating (feature flags + settings)
  const method = payment && payment.method;
  if (method === 'cod') {
    if (!pset.codEnabled || !DB.featureFlags.codPayment) return { error: 'Cash on Delivery is disabled', status: 400 };
    if (isIntl && !country.codAvailable) return { error: `COD is not available for ${country.name}`, status: 400 };
  } else {
    // Any other method must be an enabled payment-category integration
    // (razorpay, payu, phonepe, cashfree, ccavenue, ...) — single source of
    // truth is DB.settings.integrations, not the legacy DB.settings.payments
    // per-gateway flags (which only exist for razorpay/upi and used to drift
    // out of sync with the Integrations admin page).
    const gw = DB.settings.integrations[method];
    if (!gw || gw.category !== 'payment' || !gw.enabled) {
      return { error: `${gw?.label || method} is currently unavailable`, status: 400 };
    }
  }

  const discountedSub = Math.max(0, subtotal - discount);
  const shipping = isIntl
    ? Math.round(country.shipBase + country.shipPerKg * weight)
    : (method === 'cod' ? pset.codShipping : (discountedSub >= pset.freeShippingMin ? 0 : pset.standardShipping));
  const codCharge = method === 'cod' ? pset.codCharge : 0;
  const total = discountedSub + gstTotal + shipping + codCharge;

  if (method === 'cod' && !isIntl && pset.codMaxValue && total > pset.codMaxValue)
    return { error: `COD not available above ₹${pset.codMaxValue}`, status: 400 };

  const state = (shippingAddress && shippingAddress.state) || DB.settings.store.homeState;
  const taxLabel = isIntl ? 'Export — Zero-rated (LUT)'
    : (state === DB.settings.store.homeState ? 'CGST + SGST (intra-state)' : 'IGST (inter-state)');

  return {
    lines, subtotal, gstTotal, discount, appliedCoupon, shipping, codCharge, total,
    isIntl, country, state, taxLabel, weight
  };
}

function persistOrder(customer, shippingAddress, payment, calc, type) {
  const oid = genId('GIAFABS', DB.orders.length + 1001);
  const now = new Date().toISOString();
  const order = {
    id: oid, createdAt: now, updatedAt: now, type,
    customer: { name: customer.name, email: customer.email, mobile: customer.mobile || '' },
    shippingAddress: { ...shippingAddress, country: calc.country.name, countryCode: calc.country.code, state: calc.state },
    items: calc.lines,
    payment: { method: payment.method, status: payment.method === 'cod' ? 'pending' : 'awaiting_payment', transactionId: null },
    pricing: {
      subtotal: calc.subtotal, gst: calc.gstTotal, discount: calc.discount, coupon: calc.appliedCoupon,
      shipping: calc.shipping, codCharge: calc.codCharge, total: calc.total,
      currency: calc.country.currency, currencySymbol: calc.country.symbol, fxRate: calc.country.rate,
      totalInCurrency: Math.round(calc.total * calc.country.rate * 100) / 100,
    },
    tax: { gstin: DB.settings.store.gstin, state: calc.state, label: calc.taxLabel },
    status: 'pending', isInternational: calc.isIntl,
    tracking: { partner: calc.isIntl ? 'International Courier' : 'Delhivery', awb: null, history: [{ label: 'Order Placed', done: true, time: now }] },
  };
  DB.orders.push(order);

  // transaction record for finance/GST
  calc.lines.forEach(l => {
    DB.transactions.push({
      id: genId('TXN', DB.transactions.length + 10001, 8), orderId: oid, date: now,
      customer: customer.name, email: customer.email, state: calc.state, country: calc.country.name,
      productName: l.name, hsn: l.hsn, gstRate: l.gstRate, subtotal: l.lineSubtotal, gstAmount: l.lineGst,
      total: l.lineSubtotal + l.lineGst, method: payment.method, status: 'pending',
      taxType: calc.isIntl ? 'Export' : (calc.state === DB.settings.store.homeState ? 'CGST+SGST' : 'IGST'),
    });
  });

  // decrement stock (per-variant if this product has sized variants) + inventory movement
  calc.lines.forEach(l => {
    const prod = DB.products.find(p => p.id === l.productId);
    if (prod) {
      const variant = l.size ? DB.productVariants.find(v => v.productId === l.productId && v.size === l.size) : null;
      if (variant) variant.stock = Math.max(0, variant.stock - l.qty);
      else prod.stock = Math.max(0, prod.stock - l.qty);
      recomputeProductAggregate(prod.id);
      DB.inventory.movements.push({ id: genId('MOV', DB.inventory.movements.length + 1001), date: now, type: 'outward', productCode: prod.id, productName: prod.name, quantity: l.qty, reference: oid, reason: 'Order Fulfillment' });
    }
  });
  // consume coupon
  if (calc.appliedCoupon) { const c = DB.coupons.find(x => x.code === calc.appliedCoupon); if (c) c.used++; }
  return order;
}

// Creates the order on the actual gateway's side (currently only Razorpay is
// implemented) so the frontend gets back what it needs to open that
// gateway's checkout widget. Returns null for any enabled-but-unimplemented
// gateway (payu/phonepe/cashfree/ccavenue) — caller treats that as "not
// connected yet", same as an unavailable method.
async function createGatewayOrder(order) {
  const method = order.payment.method;
  if (method === 'razorpay') {
    const { keyId, keySecret } = DB.settings.integrations.razorpay;
    const client = new Razorpay({ key_id: keyId, key_secret: keySecret });
    const gwOrder = await client.orders.create({
      amount: Math.round(order.pricing.total * 100),
      currency: 'INR',
      receipt: order.id,
    });
    return { key: 'razorpay', gatewayOrderId: gwOrder.id, amount: gwOrder.amount, currency: gwOrder.currency, keyId };
  }
  return null;
}

app.post('/api/orders', requireCustomer, async (req, res) => {
  const calc = computeOrder({ customer: req.customer, ...req.body });
  if (calc.error) return res.status(calc.status || 400).json({ error: calc.error });
  const order = persistOrder(req.customer, req.body.shippingAddress || {}, req.body.payment, calc, req.body.type || 'b2c');
  audit(req.customer.email, 'ORDER_PLACED', order.id, { total: order.pricing.total });
  syncDB('orders', DB);
  syncDB('transactions', DB);
  syncDB('products', DB).then(() => syncDB('productVariants', DB));
  syncDB('inventory.movements', DB);
  if (calc.appliedCoupon) syncDB('coupons', DB);

  let gateway = null;
  let shipping = null;

  if (order.payment.method === 'cod') {
    // COD: order is already confirmed at placement — auto-dispatch immediately
    order.status = 'confirmed';
    order.updatedAt = new Date().toISOString();
    order.tracking.history.push({ label: 'Order Confirmed (COD)', done: true, time: order.updatedAt });
    shipping = await autoDispatchOrder(order, DB);
    syncDB('orders', DB);
  } else {
    try {
      gateway = await createGatewayOrder(order);
      if (gateway) {
        order.payment.gatewayOrderId = gateway.gatewayOrderId;
        syncDB('orders', DB);
      }
    } catch (err) {
      // Order already persisted (stock reserved, same as COD) — leave it
      // retryable rather than rolling back; surface the gateway failure.
      // The razorpay SDK throws a plain {statusCode, error:{description}}
      // object (not an Error instance), so err.message is usually undefined.
      const detail = err?.error?.description || err?.message || 'Unknown error';
      return res.status(502).json({ error: `Payment gateway error: ${detail}`, order });
    }
  }
  res.json({ success: true, order, gateway, shipping });
});

app.post('/api/orders/manual', requireAdmin('orders.*'), (req, res) => {
  const { customer } = req.body;
  if (!customer || !validate.nonEmpty(customer.name) || !validate.email(customer.email))
    return res.status(400).json({ error: 'Customer name and valid email required' });
  const calc = computeOrder(req.body);
  if (calc.error) return res.status(calc.status || 400).json({ error: calc.error });
  const order = persistOrder(customer, req.body.shippingAddress || {}, req.body.payment, calc, req.body.type || 'b2b');
  audit(req.user.email, 'ORDER_MANUAL', order.id);
  syncDB('orders', DB);
  syncDB('transactions', DB);
  syncDB('products', DB).then(() => syncDB('productVariants', DB));
  syncDB('inventory.movements', DB);
  if (calc.appliedCoupon) syncDB('coupons', DB);
  res.json({ success: true, order });
});

app.get('/api/orders', requireAdmin('orders.read'), (req, res) => {
  let orders = [...DB.orders].reverse();
  const { status, dateFrom, dateTo } = req.query;
  if (status) orders = orders.filter(o => o.status === status);
  if (dateFrom) orders = orders.filter(o => new Date(o.createdAt) >= new Date(dateFrom));
  if (dateTo) orders = orders.filter(o => new Date(o.createdAt) <= new Date(dateTo));
  res.json({ total: orders.length, orders });
});
app.patch('/api/orders/:id/status', requireAdmin('orders.update'), (req, res) => {
  const o = DB.orders.find(x => x.id === req.params.id);
  if (!o) return res.status(404).json({ error: 'Not found' });
  const valid = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled', 'returned'];
  if (!valid.includes(req.body.status)) return res.status(400).json({ error: 'Invalid status' });
  o.status = req.body.status; o.updatedAt = new Date().toISOString();
  o.tracking.history.push({ label: `Status: ${req.body.status}`, done: true, time: o.updatedAt });
  // restock on cancel (per-variant if this product has sized variants)
  if (req.body.status === 'cancelled') {
    o.items.forEach(l => {
      const p = DB.products.find(x => x.id === l.productId);
      if (!p) return;
      const variant = l.size ? DB.productVariants.find(v => v.productId === l.productId && v.size === l.size) : null;
      if (variant) variant.stock += l.qty;
      else p.stock += l.qty;
      recomputeProductAggregate(p.id);
    });
  }
  audit(req.user.email, 'ORDER_STATUS', o.id, { status: req.body.status });
  syncDB('orders', DB);
  if (req.body.status === 'cancelled') {
    syncDB('products', DB).then(() => syncDB('productVariants', DB));
  }
  res.json({ success: true, order: o });
});

// ════════════════════════════════════════════════════════════════════════════════
// SHIPPING MANAGEMENT — admin APIs + Shiprocket webhook
// ════════════════════════════════════════════════════════════════════════════════
const { getActiveShippingProvider, checkFulfillableStock, normalizeTracking } = require('./src/shipping');

// Manual push: admin triggers dispatch for a specific order (e.g. after restocking)
app.post('/api/shipping/push/:orderId', requireAdmin('orders.update'), async (req, res) => {
  const order = DB.orders.find(o => o.id === req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.shippingStatus === 'dispatched') return res.status(409).json({ error: 'Already dispatched', order });

  const shipping = await autoDispatchOrder(order, DB, { requireAutoPush: false });
  audit(req.user.email, 'SHIPPING_MANUAL_PUSH', order.id, { result: shipping.reason });
  syncDB('orders', DB);
  res.json({ success: true, shipping, order });
});

// Bulk push: dispatch multiple orders in one request. Uses the active
// provider's createBulkShipments (single batched API call) when available,
// otherwise falls back to looping the single-order autoDispatchOrder.
app.post('/api/shipping/push/bulk', requireAdmin('orders.update'), async (req, res) => {
  const { orderIds } = req.body || {};
  if (!Array.isArray(orderIds) || !orderIds.length) return res.status(400).json({ error: 'orderIds required' });

  const provider = getActiveShippingProvider(DB, { requireAutoPush: false });
  if (!provider) return res.status(400).json({ error: 'No shipping provider configured' });

  const orders = orderIds.map(id => DB.orders.find(o => o.id === id)).filter(Boolean);
  const results = { pushed: [], failed: [], outOfStock: [] };

  if (typeof provider.createBulkShipments === 'function') {
    const eligible = [];
    for (const order of orders) {
      if (order.shippingStatus === 'dispatched') { results.failed.push({ orderId: order.id, reason: 'already_dispatched' }); continue; }
      const stockCheck = checkFulfillableStock(order, DB);
      if (!stockCheck.ok) {
        order.shippingStatus = 'awaiting_stock';
        order.shippingNote = `Out of stock: ${stockCheck.outOfStock.join(', ')}`;
        order.updatedAt = new Date().toISOString();
        results.outOfStock.push({ orderId: order.id, items: stockCheck.outOfStock });
        continue;
      }
      eligible.push(order);
    }
    if (eligible.length) {
      try {
        const shipResults = await provider.createBulkShipments(eligible);
        eligible.forEach((order, i) => {
          const result = shipResults[i];
          order.tracking.partner = result.provider;
          order.tracking.shipmentId = result.shipmentId;
          order.tracking.providerOrderId = result.orderId;
          if (result.awb) { order.tracking.awb = result.awb; order.tracking.trackingUrl = result.trackingUrl; }
          order.shippingStatus = 'dispatched';
          order.updatedAt = new Date().toISOString();
          order.tracking.history.push({
            label: `Shipment created (${result.provider})${result.awb ? ' · AWB: ' + result.awb : ''}`,
            done: true,
            time: order.updatedAt,
          });
          results.pushed.push({ orderId: order.id, awb: result.awb });
        });
      } catch (e) {
        const reason = e?.body?.message || e?.message || 'Bulk dispatch failed';
        eligible.forEach(order => {
          order.shippingStatus = 'dispatch_failed';
          order.shippingNote = reason;
          order.updatedAt = new Date().toISOString();
          results.failed.push({ orderId: order.id, reason });
        });
      }
    }
  } else {
    for (const order of orders) {
      const r = await autoDispatchOrder(order, DB, { requireAutoPush: false });
      if (r.pushed) results.pushed.push({ orderId: order.id, awb: r.result?.awb });
      else if (r.reason === 'out_of_stock') results.outOfStock.push({ orderId: order.id, items: r.outOfStock });
      else results.failed.push({ orderId: order.id, reason: r.message });
    }
  }

  audit(req.user.email, 'SHIPPING_BULK_PUSH', null, { count: orderIds.length, pushed: results.pushed.length });
  syncDB('orders', DB);
  res.json({ success: true, ...results });
});

// Cancel shipment in Shiprocket + update local order
app.post('/api/shipping/cancel/:orderId', requireAdmin('orders.update'), async (req, res) => {
  const order = DB.orders.find(o => o.id === req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const provider = getActiveShippingProvider(DB, { requireAutoPush: false });
  if (provider && order.tracking.providerOrderId) {
    try {
      await provider.cancelShipment([order.tracking.providerOrderId]);
    } catch (e) {
      return res.status(502).json({ error: 'Shiprocket cancel failed', detail: e?.body || e });
    }
  }
  order.shippingStatus = 'cancelled';
  order.updatedAt = new Date().toISOString();
  order.tracking.history.push({ label: 'Shipment Cancelled', done: true, time: order.updatedAt });
  audit(req.user.email, 'SHIPPING_CANCELLED', order.id);
  syncDB('orders', DB);
  res.json({ success: true, order });
});

// Live tracking pull from Shiprocket/Delhivery by AWB — admin, or the
// customer who owns the order (same dual-auth pattern as GET /api/orders/:id).
app.get('/api/shipping/track/:orderId', async (req, res) => {
  const order = DB.orders.find(o => o.id === req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const adminToken = req.headers['x-admin-token'];
  const adminSess = adminToken && DB.adminSessions[adminToken];
  const adminUser = adminSess && adminSess.expires >= Date.now() && DB.users.find(u => u.id === adminSess.userId);
  const isAdmin = adminUser && adminUser.active && hasPermission(adminUser, 'orders.read');

  const custToken = req.headers['x-customer-token'];
  const custSess = custToken && DB.customerSessions[custToken];
  const cust = custSess && custSess.expires >= Date.now() && DB.customerAuth.find(c => c.id === custSess.customerId);
  const isOwner = cust && order.customer.email === cust.email;

  if (!isAdmin && !isOwner) return res.status(401).json({ error: 'Unauthorized to view this order' });
  if (!order.tracking.awb) return res.status(400).json({ error: 'No AWB assigned yet' });

  const provider = getActiveShippingProvider(DB, { requireAutoPush: false });
  if (!provider) return res.status(400).json({ error: 'No shipping provider configured' });

  try {
    const tracking = await provider.trackShipment(order.tracking.awb);
    const normalized = normalizeTracking((order.tracking.partner || '').toLowerCase(), tracking);
    res.json({ success: true, awb: order.tracking.awb, tracking, normalized });
  } catch (e) {
    res.status(502).json({ error: 'Tracking fetch failed', detail: e?.body || e });
  }
});

// Get label PDF URL from Shiprocket
app.get('/api/shipping/label/:orderId', requireAdmin('orders.read'), async (req, res) => {
  const order = DB.orders.find(o => o.id === req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (!order.tracking.shipmentId) return res.status(400).json({ error: 'No shipment created yet' });

  const provider = getActiveShippingProvider(DB, { requireAutoPush: false });
  if (!provider) return res.status(400).json({ error: 'No shipping provider configured' });

  try {
    const label = await provider.generateLabel([order.tracking.shipmentId]);
    res.json({ success: true, label });
  } catch (e) {
    res.status(502).json({ error: 'Label generation failed', detail: e?.body || e });
  }
});

// Shiprocket webhook — they POST status updates here automatically
// Set this URL in Shiprocket dashboard → Settings → Channels → Webhooks
app.post('/api/shipping/webhook/shiprocket', express.json(), (req, res) => {
  const { awb, current_status, shipment_id } = req.body || {};
  if (!awb && !shipment_id) return res.status(400).json({ error: 'Missing awb or shipment_id' });

  const order = DB.orders.find(o =>
    (awb && o.tracking.awb === awb) ||
    (shipment_id && o.tracking.shipmentId === String(shipment_id))
  );

  if (!order) return res.status(404).json({ error: 'Order not found for this AWB' });

  const statusMap = {
    'PICKUP SCHEDULED': 'confirmed',
    'PICKUP GENERATED': 'confirmed',
    'IN TRANSIT': 'shipped',
    'OUT FOR DELIVERY': 'shipped',
    'DELIVERED': 'delivered',
    'UNDELIVERED': 'shipped',
    'RTO': 'returned',
    'RTO DELIVERED': 'returned',
    'CANCELLED': 'cancelled',
  };

  const newStatus = statusMap[current_status?.toUpperCase()];
  if (newStatus && order.status !== newStatus) {
    order.status = newStatus;
    order.updatedAt = new Date().toISOString();
    order.tracking.history.push({ label: `Shiprocket: ${current_status}`, done: true, time: order.updatedAt });
    syncDB('orders', DB);
  }

  res.json({ received: true });
});

// Delhivery webhook — they POST status updates here automatically.
// Set this URL in Delhivery's dashboard → Integration → Webhooks.
// Payload shape isn't fully documented publicly — handled defensively for
// both the nested `{ Shipment: {...} }` shape and a flatter fallback.
app.post('/api/shipping/webhook/delhivery', express.json(), (req, res) => {
  const shipment = req.body?.Shipment || req.body?.shipment || req.body || {};
  const awb = shipment.AWB || shipment.awb || req.body?.waybill;
  const statusText = shipment?.Status?.Status || shipment?.status || '';
  if (!awb) return res.status(400).json({ error: 'Missing AWB' });

  const order = DB.orders.find(o => o.tracking.awb === awb);
  if (!order) return res.status(404).json({ error: 'Order not found for this AWB' });

  const statusMap = {
    'MANIFESTED': 'confirmed',
    'IN TRANSIT': 'shipped',
    'DISPATCHED': 'shipped',
    'PENDING': 'shipped', // undelivered / NDR — pull /api/shipping/ndr for the reason
    'DELIVERED': 'delivered',
    'RTO': 'returned',
    'DTO': 'returned',
    'CANCELLED': 'cancelled',
  };

  const newStatus = statusMap[statusText?.toUpperCase()];
  if (newStatus && order.status !== newStatus) {
    order.status = newStatus;
    order.updatedAt = new Date().toISOString();
    order.tracking.history.push({ label: `Delhivery: ${statusText}`, done: true, time: order.updatedAt });
    syncDB('orders', DB);
  }

  res.json({ received: true });
});

// NDR (non-delivery report) lookup for an order's shipment — only
// supported by providers that implement getNdrShipments (currently Delhivery).
app.get('/api/shipping/ndr/:orderId', requireAdmin('orders.read'), async (req, res) => {
  const order = DB.orders.find(o => o.id === req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (!order.tracking.awb) return res.status(400).json({ error: 'No AWB assigned yet' });

  const provider = getActiveShippingProvider(DB, { requireAutoPush: false });
  if (!provider || typeof provider.getNdrShipments !== 'function') {
    return res.status(400).json({ error: 'NDR lookup not supported by the active shipping provider' });
  }

  try {
    const ndr = await provider.getNdrShipments([order.tracking.awb]);
    res.json({ success: true, awb: order.tracking.awb, ndr });
  } catch (e) {
    res.status(502).json({ error: 'NDR lookup failed', detail: e?.body || e });
  }
});

// Submit a re-attempt/RTO/deferred instruction for an NDR'd shipment —
// only supported by providers that implement actionNdr (currently Delhivery).
app.post('/api/shipping/ndr/:orderId/action', requireAdmin('orders.update'), async (req, res) => {
  const order = DB.orders.find(o => o.id === req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (!order.tracking.awb) return res.status(400).json({ error: 'No AWB assigned yet' });

  const { action, comment, reattemptDate } = req.body || {};
  if (!action) return res.status(400).json({ error: 'action is required' });

  const provider = getActiveShippingProvider(DB, { requireAutoPush: false });
  if (!provider || typeof provider.actionNdr !== 'function') {
    return res.status(400).json({ error: 'NDR actions not supported by the active shipping provider' });
  }

  try {
    const result = await provider.actionNdr(order.tracking.awb, action, { comment, reattemptDate });
    order.updatedAt = new Date().toISOString();
    order.tracking.history.push({ label: `NDR action: ${action}${comment ? ' — ' + comment : ''}`, done: true, time: order.updatedAt });
    audit(req.user.email, 'SHIPPING_NDR_ACTION', order.id, { action });
    syncDB('orders', DB);
    res.json({ success: true, result, order });
  } catch (e) {
    res.status(502).json({ error: 'NDR action failed', detail: e?.body || e });
  }
});

// Attaches a GST e-way bill number to an already-created shipment — required
// for shipments with invoice value > ₹50k. The e-way bill itself must already
// be generated on the government e-way bill portal; this just registers its
// number against the shipment. Only supported by providers that implement
// updateEwaybill (currently Delhivery).
app.post('/api/shipping/ewaybill/:orderId', requireAdmin('orders.update'), async (req, res) => {
  const order = DB.orders.find(o => o.id === req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (!order.tracking.awb) return res.status(400).json({ error: 'No AWB assigned yet' });

  const { ewbn, dcn } = req.body || {};
  if (!ewbn) return res.status(400).json({ error: 'ewbn (e-way bill number) is required' });

  const provider = getActiveShippingProvider(DB, { requireAutoPush: false });
  if (!provider || typeof provider.updateEwaybill !== 'function') {
    return res.status(400).json({ error: 'E-way bill update not supported by the active shipping provider' });
  }

  try {
    const result = await provider.updateEwaybill(order.tracking.awb, { ewbn, dcn: dcn || order.id });
    order.updatedAt = new Date().toISOString();
    order.tracking.history.push({ label: `E-way bill attached: ${ewbn}`, done: true, time: order.updatedAt });
    audit(req.user.email, 'SHIPPING_EWAYBILL_UPDATE', order.id, { ewbn });
    syncDB('orders', DB);
    res.json({ success: true, result, order });
  } catch (e) {
    res.status(502).json({ error: 'E-way bill update failed', detail: e?.body || e });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// SECURE PAYMENT — generic gateway signature verification (multi-gateway-ready)
// ════════════════════════════════════════════════════════════════════════════════
app.post('/api/orders/:id/payment/verify', requireCustomer, async (req, res) => {
  const order = DB.orders.find(o => o.id === req.params.id && o.customer.email === req.customer.email);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.payment.status === 'completed') return res.json({ success: true, order }); // idempotent

  const { gatewayOrderId, gatewayPaymentId, signature } = req.body;
  if (gatewayOrderId !== order.payment.gatewayOrderId) {
    return res.status(400).json({ error: 'Order/payment mismatch' });
  }

  let verified;
  if (order.payment.method === 'razorpay') {
    const secret = DB.settings.integrations.razorpay.keySecret;
    verified = verifyPaymentSignature(gatewayOrderId, gatewayPaymentId, signature, secret);
  } else {
    return res.status(501).json({ error: `Payment verification for ${order.payment.method} is not implemented` });
  }

  if (!verified) {
    audit(req.customer.email, 'PAYMENT_SIGNATURE_FAIL', order.id);
    return res.status(400).json({ error: 'Payment verification failed' });
  }

  order.payment.status = 'completed';
  order.payment.transactionId = gatewayPaymentId;
  order.status = 'confirmed';
  order.updatedAt = new Date().toISOString();
  order.tracking.history.push({ label: 'Payment Confirmed', done: true, time: order.updatedAt });
  DB.transactions.filter(t => t.orderId === order.id).forEach(t => t.status = 'paid');
  audit(req.customer.email, 'PAYMENT_VERIFIED', order.id, { paymentId: gatewayPaymentId });

  // Auto-dispatch to shipping provider (stock check happens inside)
  const shipping = await autoDispatchOrder(order, DB);
  if (!shipping.pushed) {
    audit(req.customer.email, 'SHIPPING_SKIPPED', order.id, { reason: shipping.reason, detail: shipping.message });
  }

  syncDB('orders', DB);
  syncDB('transactions', DB);
  res.json({ success: true, order, shipping });
});

// ════════════════════════════════════════════════════════════════════════════════
// REPORTS / GST / TRANSACTIONS
// ════════════════════════════════════════════════════════════════════════════════
app.get('/api/transactions', requireAdmin('transactions.read'), (req, res) => {
  let t = [...DB.transactions].reverse();
  const { dateFrom, dateTo } = req.query;
  if (dateFrom) t = t.filter(x => new Date(x.date) >= new Date(dateFrom));
  if (dateTo) t = t.filter(x => new Date(x.date) <= new Date(dateTo));
  res.json({ total: t.length, transactions: t });
});
app.get('/api/reports/gst', requireAdmin('reports.read'), (req, res) => {
  let t = DB.transactions;
  const { dateFrom, dateTo } = req.query;
  if (dateFrom) t = t.filter(x => new Date(x.date) >= new Date(dateFrom));
  if (dateTo) t = t.filter(x => new Date(x.date) <= new Date(dateTo));
  const byState = {};
  t.forEach(x => {
    byState[x.state] = byState[x.state] || { sgst: 0, cgst: 0, igst: 0, export: 0, count: 0, amount: 0 };
    if (x.taxType === 'CGST+SGST') { byState[x.state].sgst += x.gstAmount / 2; byState[x.state].cgst += x.gstAmount / 2; }
    else if (x.taxType === 'IGST') byState[x.state].igst += x.gstAmount;
    else byState[x.state].export += x.gstAmount;
    byState[x.state].count++; byState[x.state].amount += x.total;
  });
  res.json({ period: { from: dateFrom, to: dateTo }, byState, totalGST: t.reduce((s, x) => s + x.gstAmount, 0), totalTransactions: t.length });
});

// ════════════════════════════════════════════════════════════════════════════════
// INVENTORY
// ════════════════════════════════════════════════════════════════════════════════
app.get('/api/inventory/movements', requireAdmin('inventory.*'), (_, res) => res.json({ total: DB.inventory.movements.length, movements: [...DB.inventory.movements].reverse() }));
app.post('/api/inventory/movements', requireAdmin('inventory.*'), (req, res) => {
  const { type, productCode, quantity, reference, reason } = req.body;
  const prod = DB.products.find(p => p.id === productCode);
  if (!prod) return res.status(400).json({ error: 'Product not found' });
  if (!validate.positiveInt(quantity)) return res.status(400).json({ error: 'Quantity must be positive' });
  const mov = { id: genId('MOV', DB.inventory.movements.length + 1001), date: new Date().toISOString(), type, productCode, productName: prod.name, quantity, reference: reference || '', reason: reason || '' };
  DB.inventory.movements.push(mov);
  if (type === 'inward') prod.stock += quantity;
  else if (type === 'outward') prod.stock = Math.max(0, prod.stock - quantity);
  else if (type === 'adjustment') prod.stock = quantity;
  syncDB('inventory.movements', DB);
  syncDB('products', DB);
  audit(req.user.email, 'INVENTORY_MOVEMENT', productCode, { type, quantity });
  res.json({ success: true, movement: mov, newStock: prod.stock });
});
app.get('/api/inventory/valuation', requireAdmin('inventory.*'), (_, res) => {
  const items = DB.products.map(p => ({ productCode: p.id, name: p.name, sku: p.sku, qty: p.stock, cost: p.cost, totalValue: p.cost * p.stock, sellingValue: p.price * p.stock, lowStock: p.stock <= p.minStock }));
  const totalCost = items.reduce((s, i) => s + i.totalValue, 0);
  const revenue = items.reduce((s, i) => s + i.sellingValue, 0);
  res.json({ items, totalInventoryCost: totalCost, potentialRevenue: revenue, margin: revenue ? Math.round((revenue - totalCost) / revenue * 100) : 0, lowStockCount: items.filter(i => i.lowStock).length });
});
app.get('/api/inventory/alerts', requireAdmin('inventory.*'), (_, res) => {
  const low = DB.products.filter(p => p.stock <= p.minStock).map(p => ({ id: p.id, name: p.name, stock: p.stock, minStock: p.minStock }));
  res.json({ count: low.length, alerts: low });
});

// ════════════════════════════════════════════════════════════════════════════════
// DASHBOARD / ANALYTICS
// ════════════════════════════════════════════════════════════════════════════════
app.get('/api/dashboard', requireAdmin('reports.read'), (_, res) => {
  const last30 = new Date(Date.now() - 30 * 864e5);
  const recent = DB.orders.filter(o => new Date(o.createdAt) >= last30);
  const revenue = recent.reduce((s, o) => s + o.pricing.total, 0);
  res.json({
    summary: {
      totalOrders: DB.orders.length, ordersLast30: recent.length, revenue,
      totalCustomers: DB.customerAuth.length, totalProducts: DB.products.filter(p => p.active).length,
      avgOrderValue: recent.length ? Math.round(revenue / recent.length) : 0,
      lowStock: DB.products.filter(p => p.stock <= p.minStock).length,
      pendingOrders: DB.orders.filter(o => o.status === 'pending').length,
    },
    recentOrders: [...DB.orders].reverse().slice(0, 5),
    topProducts: [...DB.products].filter(p => p.active).sort((a, b) => b.reviews - a.reviews).slice(0, 5),
    paymentSplit: { cod: recent.filter(o => o.payment.method === 'cod').length, razorpay: recent.filter(o => o.payment.method === 'razorpay').length, upi: recent.filter(o => o.payment.method === 'upi').length },
  });
});
app.get('/api/analytics', requireAdmin('reports.read'), (_, res) => {
  const chart = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const day = DB.orders.filter(o => new Date(o.createdAt).toDateString() === d.toDateString());
    chart.push({ date: d.toISOString().split('T')[0], orders: day.length, revenue: day.reduce((s, o) => s + o.pricing.total, 0) });
  }
  res.json({ chart });
});

// ════════════════════════════════════════════════════════════════════════════════
// FEATURE FLAGS / CONTENT / THEME — frontend control surface
// ════════════════════════════════════════════════════════════════════════════════
app.get('/api/admin/flags', requireAdmin('settings.*'), (_, res) => res.json(DB.featureFlags));
app.patch('/api/admin/flags', requireAdmin('settings.*'), (req, res) => {
  Object.assign(DB.featureFlags, req.body);
  syncDB('featureFlags', DB);
  audit(req.user.email, 'FLAGS_UPDATE', 'featureFlags', req.body);
  res.json({ success: true, featureFlags: DB.featureFlags });
});
app.patch('/api/admin/content', requireAdmin('content.*'), (req, res) => {
  Object.assign(DB.content, req.body);
  syncDB('content', DB);
  audit(req.user.email, 'CONTENT_UPDATE', 'content');
  res.json({ success: true, content: DB.content });
});
app.patch('/api/admin/theme', requireAdmin('content.*'), (req, res) => {
  Object.assign(DB.theme, req.body);
  syncDB('theme', DB);
  audit(req.user.email, 'THEME_UPDATE', 'theme');
  res.json({ success: true, theme: DB.theme });
});

// ════════════════════════════════════════════════════════════════════════════════
// SETTINGS (secrets masked on read)
// ════════════════════════════════════════════════════════════════════════════════
app.get('/api/settings', requireAdmin('settings.*'), (_, res) => {
  const s = JSON.parse(JSON.stringify(DB.settings));
  if (s.payments.razorpaySecret) s.payments.razorpaySecret = '••••••••';
  if (s.meta.accessToken) s.meta.accessToken = '••••••••';
  // mask every integration secret
  const secretFields = ['keySecret','merchantSalt','secretKey','saltKey','workingKey','webhookSecret','password','apiToken','apiKey','accessToken','authKey','mwsToken','consumerSecret','licenseKey'];
  Object.values(s.integrations || {}).forEach(it => secretFields.forEach(f => { if (it[f]) it[f] = '••••••••'; }));
  res.json(s);
});
app.patch('/api/settings/store', requireAdmin('settings.*'), (req, res) => { Object.assign(DB.settings.store, req.body); syncDB('settings', DB); audit(req.user.email, 'SETTINGS_STORE'); res.json({ success: true, store: DB.settings.store }); });
app.patch('/api/settings/payments', requireAdmin('settings.*'), (req, res) => { Object.assign(DB.settings.payments, req.body); syncDB('settings', DB); audit(req.user.email, 'SETTINGS_PAYMENTS'); res.json({ success: true, payments: DB.settings.payments }); });
app.patch('/api/settings/integrations', requireAdmin('settings.*'), (req, res) => { Object.assign(DB.settings.integrations, req.body); syncDB('settings', DB); audit(req.user.email, 'SETTINGS_INTEGRATIONS'); res.json({ success: true, integrations: DB.settings.integrations }); });

// ════════════════════════════════════════════════════════════════════════════════
// INTEGRATIONS HUB — secure credential storage, masking, test-connection
// ════════════════════════════════════════════════════════════════════════════════
const SECRET_FIELDS = ['keySecret','merchantSalt','secretKey','saltKey','workingKey','webhookSecret','password','apiToken','apiKey','accessToken','authKey','mwsToken','consumerSecret','licenseKey'];
function maskIntegration(obj) {
  const o = JSON.parse(JSON.stringify(obj));
  SECRET_FIELDS.forEach(f => { if (o[f]) o[f] = '••••••••'; });
  return o;
}
// list all integrations grouped by category, secrets masked
app.get('/api/integrations', requireAdmin('settings.*'), (_, res) => {
  const out = {};
  Object.entries(DB.settings.integrations).forEach(([k, v]) => { out[k] = maskIntegration(v); });
  res.json({ integrations: out });
});
// single integration
app.get('/api/integrations/:key', requireAdmin('settings.*'), (req, res) => {
  const it = DB.settings.integrations[req.params.key];
  if (!it) return res.status(404).json({ error: 'Integration not found' });
  res.json(maskIntegration(it));
});
// update integration (skip masked placeholders so we never overwrite a real secret with dots)
app.patch('/api/integrations/:key', requireAdmin('settings.*'), (req, res) => {
  const it = DB.settings.integrations[req.params.key];
  if (!it) return res.status(404).json({ error: 'Integration not found' });
  Object.entries(req.body).forEach(([k, v]) => { if (v === '••••••••') return; it[k] = v; });
  syncDB('settings', DB);
  audit(req.user.email, 'INTEGRATION_UPDATE', req.params.key, { enabled: it.enabled });
  res.json({ success: true, integration: maskIntegration(it) });
});
// enable/disable toggle
app.patch('/api/integrations/:key/toggle', requireAdmin('settings.*'), (req, res) => {
  const it = DB.settings.integrations[req.params.key];
  if (!it) return res.status(404).json({ error: 'Integration not found' });
  it.enabled = !it.enabled; it.status = it.enabled ? 'connected' : 'disconnected';
  syncDB('settings', DB);
  audit(req.user.email, 'INTEGRATION_TOGGLE', req.params.key, { enabled: it.enabled });
  res.json({ success: true, enabled: it.enabled, status: it.status });
});
// test connection — validates required credentials are present (real API ping happens on deploy)
app.post('/api/integrations/:key/test', requireAdmin('settings.*'), (req, res) => {
  const it = DB.settings.integrations[req.params.key];
  if (!it) return res.status(404).json({ error: 'Integration not found' });
  const required = {
    razorpay:['keyId','keySecret'], payu:['merchantKey','merchantSalt'], cashfree:['appId','secretKey'],
    phonepe:['merchantId','saltKey'], ccavenue:['merchantId','accessCode','workingKey'],
    shiprocket:['email','password'], delhivery:['apiToken'], bluedart:['licenseKey','loginId'], dtdc:['accessToken'],
    porter:['apiKey'], metaPixel:['pixelId','accessToken'], ga4:['measurementId'], whatsapp:['apiKey'],
    msg91:['authKey'], sendgrid:['apiKey'], tally:['companyName'], woocommerce:['url','consumerKey','consumerSecret'],
    shopify:['shopUrl','accessToken'], amazon:['sellerId'],
  }[req.params.key] || [];
  const missing = required.filter(f => !it[f]);
  if (missing.length) { it.status = 'error'; return res.status(400).json({ success:false, status:'error', error:`Missing credentials: ${missing.join(', ')}` }); }
  it.status = 'connected';
  audit(req.user.email, 'INTEGRATION_TEST', req.params.key, { result:'ok' });
  res.json({ success: true, status:'connected', message:`${it.label} credentials look valid. Live handshake runs on deploy.` });
});

// ════════════════════════════════════════════════════════════════════════════════
// SHIPPING ENGINE — zones, rate rules, COD pincode check, packages, live rate calc
// ════════════════════════════════════════════════════════════════════════════════
app.patch('/api/shipping/config', requireAdmin('shipping.*'), (req, res) => { Object.assign(DB.settings.shipping, req.body); syncDB('settings', DB); audit(req.user.email,'SHIPPING_CONFIG'); res.json({ success:true, shipping: DB.settings.shipping }); });
app.post('/api/shipping/zones', requireAdmin('shipping.*'), (req, res) => { const z={ id:genId('z_',DB.settings.shipping.zones.length+1,3), ...req.body }; DB.settings.shipping.zones.push(z); syncDB('settings', DB); audit(req.user.email,'SHIPPING_ZONE_ADD',z.id); res.json({ success:true, zone:z }); });
app.patch('/api/shipping/zones/:id', requireAdmin('shipping.*'), (req, res) => { const z=DB.settings.shipping.zones.find(x=>x.id===req.params.id); if(!z)return res.status(404).json({error:'Zone not found'}); Object.assign(z,req.body); syncDB('settings', DB); res.json({ success:true, zone:z }); });
app.delete('/api/shipping/zones/:id', requireAdmin('shipping.*'), (req, res) => { DB.settings.shipping.zones=DB.settings.shipping.zones.filter(x=>x.id!==req.params.id); syncDB('settings', DB); res.json({ success:true }); });
// COD serviceability check for a pincode (static allow/blocklist)
app.get('/api/shipping/cod-check/:pincode', (req, res) => {
  const sh = DB.settings.shipping; const pin = req.params.pincode;
  let serviceable;
  if (sh.codPincodeMode === 'allowlist') serviceable = sh.codServiceablePincodes.includes(pin);
  else serviceable = !(sh.codServiceablePincodes.__blocked || []).includes(pin); // blocklist_off = allow all
  res.json({ pincode: pin, codServiceable: serviceable, estimatedDays: sh.estimatedDaysDomestic });
});
// Live pincode serviceability via the active shipping provider (e.g. Delhivery's
// pin-code API), falling back to the static allow/blocklist above when no
// provider is configured or it doesn't support a serviceability check.
app.get('/api/shipping/serviceability/:pincode', async (req, res) => {
  const pin = req.params.pincode;
  const provider = getActiveShippingProvider(DB, { requireAutoPush: false });

  if (provider && typeof provider.checkServiceability === 'function') {
    try {
      const result = await provider.checkServiceability(pin);
      return res.json({ source: 'provider', ...result });
    } catch (e) {
      console.warn('[Shipping] Live serviceability check failed, falling back:', e?.body || e);
    }
  }

  const sh = DB.settings.shipping;
  const serviceable = sh.codPincodeMode === 'allowlist'
    ? sh.codServiceablePincodes.includes(pin)
    : !(sh.codServiceablePincodes.__blocked || []).includes(pin);
  res.json({ source: 'static', pincode: pin, serviceable, codAvailable: serviceable, estimatedDays: sh.estimatedDaysDomestic });
});
// live rate calc by zone + weight, with an optional live provider quote
// (e.g. Delhivery's invoice/charges API) when a destPincode is supplied
app.post('/api/shipping/rate', async (req, res) => {
  const { countryCode='IN', weightKg=0.4, orderValue=0, destPincode, paymentMode } = req.body;
  const sh = DB.settings.shipping;
  const zone = sh.zones.find(z => z.countries.includes(countryCode)) || sh.zones[0];
  if (zone.freeAbove && orderValue >= zone.freeAbove) return res.json({ zone:zone.name, rate:0, free:true });

  if (destPincode) {
    const provider = getActiveShippingProvider(DB, { requireAutoPush: false });
    if (provider && typeof provider.calculateRate === 'function') {
      try {
        const live = await provider.calculateRate({ destPincode, weightGrams: weightKg * 1000, paymentMode, orderValue });
        if (live.total != null) return res.json({ source: 'provider', zone: zone.name, rate: live.total, free: false, weightKg });
      } catch (e) {
        console.warn('[Shipping] Live rate lookup failed, falling back to static table:', e?.body || e);
      }
    }
  }

  const slab = zone.slabs.find(s => weightKg <= s.uptoKg) || zone.slabs[zone.slabs.length-1];
  res.json({ source: 'static', zone:zone.name, rate:slab.price, free:false, weightKg });
});

// ════════════════════════════════════════════════════════════════════════════════
// TAX ENGINE — GST rates, HSN/category overrides, exemptions
// ════════════════════════════════════════════════════════════════════════════════
app.get('/api/tax/config', requireAdmin('tax.*'), (_, res) => res.json(DB.settings.tax));
app.patch('/api/tax/config', requireAdmin('tax.*'), (req, res) => { Object.assign(DB.settings.tax, req.body); audit(req.user.email,'TAX_CONFIG'); res.json({ success:true, tax: DB.settings.tax }); });
app.patch('/api/tax/hsn/:code', requireAdmin('tax.*'), (req, res) => { DB.settings.tax.hsnRates[req.params.code]=+req.body.rate; res.json({ success:true, hsnRates:DB.settings.tax.hsnRates }); });
app.post('/api/tax/exempt', requireAdmin('tax.*'), (req, res) => { DB.settings.tax.exemptCustomers.push(req.body.gstin); res.json({ success:true, exempt:DB.settings.tax.exemptCustomers }); });

// ════════════════════════════════════════════════════════════════════════════════
// CHECKOUT & NOTIFICATION CONFIG
// ════════════════════════════════════════════════════════════════════════════════
app.get('/api/settings/checkout', requireAdmin('settings.*'), (_, res) => res.json(DB.settings.checkout));
app.patch('/api/settings/checkout', requireAdmin('settings.*'), (req, res) => { Object.assign(DB.settings.checkout, req.body); audit(req.user.email,'CHECKOUT_CONFIG'); res.json({ success:true, checkout:DB.settings.checkout }); });
app.get('/api/settings/notifications', requireAdmin('settings.*'), (_, res) => res.json(DB.settings.notifications));
app.patch('/api/settings/notifications', requireAdmin('settings.*'), (req, res) => {
  if (req.body.channels) Object.assign(DB.settings.notifications.channels, req.body.channels);
  if (req.body.templates) Object.assign(DB.settings.notifications.templates, req.body.templates);
  audit(req.user.email,'NOTIF_CONFIG'); res.json({ success:true, notifications:DB.settings.notifications });
});

// ════════════════════════════════════════════════════════════════════════════════
// POWER-TOOLS — advanced filtering, sorting, pagination, bulk actions, CSV export
// ════════════════════════════════════════════════════════════════════════════════
function applyQuery(rows, q, searchable) {
  let out = [...rows];
  if (q.search) { const s=q.search.toLowerCase(); out = out.filter(r => searchable.some(f => String(getPath(r,f)||'').toLowerCase().includes(s))); }
  if (q.filterField && q.filterValue !== undefined) out = out.filter(r => String(getPath(r,q.filterField)) === String(q.filterValue));
  if (q.status) out = out.filter(r => String(r.status) === String(q.status));
  if (q.min !== undefined) out = out.filter(r => getPath(r,q.sortBy||'')>=+q.min);
  if (q.max !== undefined) out = out.filter(r => getPath(r,q.sortBy||'')<=+q.max);
  if (q.sortBy) { const dir=q.sortDir==='desc'?-1:1; out.sort((a,b)=>{const av=getPath(a,q.sortBy),bv=getPath(b,q.sortBy);return (av>bv?1:av<bv?-1:0)*dir;}); }
  const total = out.length;
  const page = +q.page||1, per = +q.perPage||20;
  out = out.slice((page-1)*per, page*per);
  return { total, page, per, rows: out };
}
function getPath(o,p){ return p.split('.').reduce((a,k)=>a?a[k]:undefined,o); }
function toCSV(rows, cols){ const head=cols.join(','); const body=rows.map(r=>cols.map(c=>{const v=getPath(r,c);return '"'+String(v==null?'':v).replace(/"/g,'""')+'"';}).join(',')).join('\n'); return head+'\n'+body; }

// Orders advanced query
app.get('/api/orders/query', requireAdmin('orders.read'), (req, res) => {
  const result = applyQuery(DB.orders, req.query, ['id','customer.name','customer.email','status','payment.method']);
  res.json(result);
});
// Orders CSV export
app.get('/api/orders/export', requireAdmin('orders.read'), (req, res) => {
  const csv = toCSV(DB.orders, ['id','createdAt','customer.name','customer.email','pricing.total','pricing.currency','payment.method','status','shippingAddress.state','shippingAddress.country']);
  res.setHeader('Content-Type','text/csv'); res.setHeader('Content-Disposition','attachment; filename=orders.csv'); res.send(csv);
});
// Bulk order status
app.post('/api/orders/bulk', requireAdmin('orders.update'), (req, res) => {
  const { ids, action, value } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error:'ids array required' });
  let n=0;
  ids.forEach(id => { const o=DB.orders.find(x=>x.id===id); if(o){ if(action==='status'){ o.status=value; o.updatedAt=new Date().toISOString(); } n++; } });
  syncDB('orders', DB);
  audit(req.user.email,'ORDERS_BULK',action,{count:n,value});
  res.json({ success:true, updated:n });
});
app.get('/api/orders/:id', (req, res) => {
  const orderId = req.params.id;
  const order = DB.orders.find(o => o.id === orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  // 1. Check if admin
  const adminToken = req.headers['x-admin-token'];
  const adminSess = adminToken && DB.adminSessions[adminToken];
  if (adminSess && adminSess.expires >= Date.now()) {
    const user = DB.users.find(u => u.id === adminSess.userId);
    if (user && user.active && hasPermission(user, 'orders.read')) {
      return res.json(order);
    }
  }

  // 2. Check if customer owning the order
  const custToken = req.headers['x-customer-token'];
  const custSess = custToken && DB.customerSessions[custToken];
  if (custSess && custSess.expires >= Date.now()) {
    const cust = DB.customerAuth.find(c => c.id === custSess.customerId);
    if (cust && order.customer.email === cust.email) {
      return res.json(order);
    }
  }

  return res.status(401).json({ error: 'Unauthorized to view this order' });
});
// ════════════════════════════════════════════════════════════════════════════════
// POST-ORDER FLOWS — cancel / return / exchange
// ════════════════════════════════════════════════════════════════════════════════

// Shared: resolve customer from token and verify order ownership
function resolveCustomerOrder(req, res) {
  const order = DB.orders.find(o => o.id === req.params.id);
  if (!order) { res.status(404).json({ error: 'Order not found' }); return null; }
  const sess = DB.customerSessions[req.headers['x-customer-token']];
  if (!sess || sess.expires < Date.now()) { res.status(401).json({ error: 'Session expired' }); return null; }
  const cust = DB.customerAuth.find(c => c.id === sess.customerId);
  if (!cust || order.customer.email !== cust.email) { res.status(403).json({ error: 'Unauthorized' }); return null; }
  return { order, cust };
}

// ── CANCEL (customer) ─────────────────────────────────────────────────────────
// Allowed only before shipment is picked up by courier
app.post('/api/orders/:id/cancel', async (req, res) => {
  const ctx = resolveCustomerOrder(req, res);
  if (!ctx) return;
  const { order, cust } = ctx;

  const cancellable = ['pending', 'confirmed', 'awaiting_stock', 'dispatch_failed'];
  if (!cancellable.includes(order.status)) {
    return res.status(400).json({
      error: order.status === 'shipped'
        ? 'Order already shipped — please raise a return request instead'
        : `Cannot cancel order in status: ${order.status}`,
    });
  }

  // Cancel shipment in Shiprocket if already pushed
  if (order.tracking?.providerOrderId) {
    try {
      const provider = getActiveShippingProvider(DB, { requireAutoPush: false });
      if (provider) await provider.cancelShipment([order.tracking.providerOrderId]);
    } catch (e) {
      console.warn('[Shipping] Shiprocket cancel on order cancel failed:', e?.body || e);
    }
  }

  // Restock
  order.items.forEach(l => {
    const prod = DB.products.find(p => p.id === l.productId);
    if (!prod) return;
    const variant = l.size ? DB.productVariants.find(v => v.productId === l.productId && v.size === l.size) : null;
    if (variant) variant.stock += l.qty;
    else prod.stock += l.qty;
    recomputeProductAggregate(prod.id);
  });

  order.status = 'cancelled';
  order.shippingStatus = 'cancelled';
  order.updatedAt = new Date().toISOString();
  order.tracking.history.push({ label: 'Cancelled by customer', done: true, time: order.updatedAt });
  order.cancelReason = req.body.reason || '';

  audit(cust.email, 'ORDER_CANCEL', order.id, { reason: order.cancelReason });
  syncDB('orders', DB);
  syncDB('products', DB).then(() => syncDB('productVariants', DB));
  res.json({ success: true, order });
});

// ── RETURN (customer) ─────────────────────────────────────────────────────────
// Only after delivered; creates a request for admin to approve
app.post('/api/orders/:id/return', async (req, res) => {
  const ctx = resolveCustomerOrder(req, res);
  if (!ctx) return;
  const { order, cust } = ctx;

  if (order.status !== 'delivered') {
    return res.status(400).json({ error: 'Only delivered orders can be returned' });
  }

  const { reason, notes, items } = req.body;
  if (!reason) return res.status(400).json({ error: 'Return reason is required' });

  // Check return window (default 7 days)
  const returnWindowDays = DB.settings.store.returnWindowDays || 7;
  const deliveredAt = order.tracking.history.find(h => h.label?.toLowerCase().includes('delivered'))?.time || order.updatedAt;
  const daysSince = (Date.now() - new Date(deliveredAt).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince > returnWindowDays) {
    return res.status(400).json({ error: `Return window of ${returnWindowDays} days has passed` });
  }

  const reqId = genId('RET', DB.orderRequests.length + 1001, 5);
  const request = {
    id: reqId, type: 'return', orderId: order.id,
    customer: { name: cust.name, email: cust.email },
    reason, notes: notes || '',
    returnItems: items || order.items.map(i => ({ productId: i.productId, size: i.size, qty: i.qty, name: i.name })),
    status: 'requested',
    requestedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    reverseAWB: null, reverseShipmentId: null,
    adminNote: '',
  };

  DB.orderRequests.push(request);
  order.tracking.history.push({ label: 'Return Requested', done: false, time: request.requestedAt });
  order.updatedAt = new Date().toISOString();

  audit(cust.email, 'ORDER_RETURN_REQUEST', order.id, { reason, reqId });
  syncDB('orders', DB);
  syncDB('orderRequests', DB);
  res.json({ success: true, request });
});

// ── EXCHANGE (customer) ───────────────────────────────────────────────────────
// Wrong size or wrong product received — creates request for admin to approve
app.post('/api/orders/:id/exchange', async (req, res) => {
  const ctx = resolveCustomerOrder(req, res);
  if (!ctx) return;
  const { order, cust } = ctx;

  if (order.status !== 'delivered') {
    return res.status(400).json({ error: 'Only delivered orders can be exchanged' });
  }

  const { reason, notes, returnItems, exchangeItems } = req.body;
  const validReasons = ['wrong_size', 'wrong_product', 'defective', 'not_as_described'];
  if (!reason || !validReasons.includes(reason)) {
    return res.status(400).json({ error: `reason must be one of: ${validReasons.join(', ')}` });
  }
  if (!Array.isArray(exchangeItems) || exchangeItems.length === 0) {
    return res.status(400).json({ error: 'exchangeItems (what customer wants) is required' });
  }

  // Validate exchange items exist
  for (const ei of exchangeItems) {
    const prod = DB.products.find(p => p.id === ei.productId);
    if (!prod) return res.status(400).json({ error: `Product not found: ${ei.productId}` });
  }

  const reqId = genId('EXC', DB.orderRequests.length + 1001, 5);
  const request = {
    id: reqId, type: 'exchange', orderId: order.id,
    customer: { name: cust.name, email: cust.email },
    reason, notes: notes || '',
    // What comes back from customer
    returnItems: returnItems || order.items.map(i => ({ productId: i.productId, size: i.size, qty: i.qty, name: i.name })),
    // What we ship out to customer
    exchangeItems,
    status: 'requested',  // requested → approved → pickup_scheduled → item_received → inspected → reshipped → completed
    requestedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    reverseAWB: null, reverseShipmentId: null,
    forwardAWB: null, forwardShipmentId: null,
    adminNote: '',
  };

  DB.orderRequests.push(request);
  order.tracking.history.push({ label: `Exchange Requested (${reason})`, done: false, time: request.requestedAt });
  order.updatedAt = new Date().toISOString();

  audit(cust.email, 'ORDER_EXCHANGE_REQUEST', order.id, { reason, reqId });
  syncDB('orders', DB);
  syncDB('orderRequests', DB);
  res.json({ success: true, request });
});

// ── ADMIN: list all requests ──────────────────────────────────────────────────
app.get('/api/order-requests', requireAdmin('orders.read'), (req, res) => {
  let reqs = [...DB.orderRequests].reverse();
  const { type, status, orderId } = req.query;
  if (type) reqs = reqs.filter(r => r.type === type);
  if (status) reqs = reqs.filter(r => r.status === status);
  if (orderId) reqs = reqs.filter(r => r.orderId === orderId);
  res.json({ total: reqs.length, requests: reqs });
});

// ── ADMIN: approve / reject / mark stages ────────────────────────────────────
app.patch('/api/order-requests/:id/status', requireAdmin('orders.update'), async (req, res) => {
  const request = DB.orderRequests.find(r => r.id === req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });

  const order = DB.orders.find(o => o.id === request.orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const { status, adminNote } = req.body;
  const now = new Date().toISOString();
  if (adminNote) request.adminNote = adminNote;

  // ── REJECTED ──
  if (status === 'rejected') {
    request.status = 'rejected';
    request.updatedAt = now;
    order.tracking.history.push({ label: `${request.type === 'exchange' ? 'Exchange' : 'Return'} Rejected`, done: true, time: now });
    order.updatedAt = now;
    audit(req.user.email, 'REQUEST_REJECTED', request.id, { type: request.type });
    syncDB('orders', DB);
    syncDB('orderRequests', DB);
    return res.json({ success: true, request });
  }

  // ── APPROVED → trigger Shiprocket reverse pickup ──
  if (status === 'approved') {
    request.status = 'approved';
    request.updatedAt = now;

    const provider = getActiveShippingProvider(DB, { requireAutoPush: false });
    if (provider) {
      try {
        const revRes = await provider.createReversePickup(order, request.id);
        request.reverseShipmentId = String(revRes.shipmentId || '');
        request.reverseAWB = revRes.awb || null;
        request.status = 'pickup_scheduled';
      } catch (e) {
        console.warn('[Shipping] Reverse pickup failed:', e?.body || e);
        // Continue — admin can retry manually
      }
    }

    order.tracking.history.push({
      label: `${request.type === 'exchange' ? 'Exchange' : 'Return'} Approved${request.reverseAWB ? ' · Reverse AWB: ' + request.reverseAWB : ''}`,
      done: true, time: now,
    });
    order.updatedAt = now;
    audit(req.user.email, 'REQUEST_APPROVED', request.id, { type: request.type, reverseAWB: request.reverseAWB });
    syncDB('orders', DB);
    syncDB('orderRequests', DB);
    return res.json({ success: true, request });
  }

  // ── ITEM RECEIVED at warehouse (admin marks after physical receipt) ──
  if (status === 'item_received') {
    request.status = 'item_received';
    request.updatedAt = now;
    order.tracking.history.push({ label: 'Item Received at Warehouse', done: true, time: now });
    order.updatedAt = now;
    audit(req.user.email, 'REQUEST_ITEM_RECEIVED', request.id);
    syncDB('orders', DB);
    syncDB('orderRequests', DB);
    return res.json({ success: true, request });
  }

  // ── INSPECTED → for return: restock + refund; for exchange: ship new item ──
  if (status === 'inspected') {
    const { condition } = req.body; // 'ok' | 'damaged'
    request.status = 'inspected';
    request.inspectedCondition = condition || 'ok';
    request.updatedAt = now;

    if (request.type === 'return' || (request.type === 'exchange' && condition === 'damaged')) {
      // Restock returned items
      request.returnItems.forEach(ri => {
        const prod = DB.products.find(p => p.id === ri.productId);
        if (!prod) return;
        const variant = ri.size ? DB.productVariants.find(v => v.productId === ri.productId && v.size === ri.size) : null;
        if (variant) variant.stock += ri.qty;
        else prod.stock += ri.qty;
        recomputeProductAggregate(prod.id);
      });
      order.status = 'returned';
      order.tracking.history.push({ label: 'Item Inspected — Refund Initiated', done: true, time: now });
      request.status = 'refund_initiated';
      syncDB('products', DB).then(() => syncDB('productVariants', DB));

      // Trigger Razorpay refund for prepaid orders
      if (order.payment.method === 'razorpay' && order.payment.transactionId) {
        try {
          const { keyId, keySecret } = DB.settings.integrations.razorpay;
          const rzp = new Razorpay({ key_id: keyId, key_secret: keySecret });
          const refundRes = await rzp.payments.refund(order.payment.transactionId, {
            amount: Math.round(order.pricing.total * 100),
            notes: { orderId: order.id, requestId: request.id, reason: request.reason },
          });
          request.refundId = refundRes.id;
          request.refundStatus = refundRes.status;
          order.tracking.history.push({ label: `Refund Processed · ID: ${refundRes.id}`, done: true, time: now });
        } catch (e) {
          console.warn('[Refund] Razorpay refund failed:', e?.error?.description || e);
          request.refundStatus = 'failed';
          order.tracking.history.push({ label: 'Refund Failed — manual action needed', done: false, time: now });
        }
      }
    }

    if (request.type === 'exchange' && condition !== 'damaged') {
      // Check exchange item stock before shipping
      const exchangeStockOk = request.exchangeItems.every(ei => {
        const prod = DB.products.find(p => p.id === ei.productId);
        if (!prod) return false;
        const variant = ei.size ? DB.productVariants.find(v => v.productId === ei.productId && v.size === ei.size) : null;
        return variant ? variant.stock >= ei.qty : prod.stock >= ei.qty;
      });

      if (!exchangeStockOk) {
        request.status = 'exchange_stock_pending';
        order.tracking.history.push({ label: 'Exchange item out of stock — awaiting restock', done: false, time: now });
      } else {
        // Deduct exchange item stock
        request.exchangeItems.forEach(ei => {
          const prod = DB.products.find(p => p.id === ei.productId);
          if (!prod) return;
          const variant = ei.size ? DB.productVariants.find(v => v.productId === ei.productId && v.size === ei.size) : null;
          if (variant) variant.stock = Math.max(0, variant.stock - ei.qty);
          else prod.stock = Math.max(0, prod.stock - ei.qty);
          recomputeProductAggregate(prod.id);
        });

        // Ship exchange item via Shiprocket
        const provider = getActiveShippingProvider(DB, { requireAutoPush: false });
        if (provider) {
          try {
            const exchangeOrder = {
              ...order,
              id: `${order.id}-EXC-${request.id}`,
              items: request.exchangeItems.map(ei => {
                const prod = DB.products.find(p => p.id === ei.productId);
                return { ...ei, name: prod?.name || ei.productId, unitPrice: prod?.price || 0, weight: prod?.weight || 0.3, sku: prod?.sku || ei.productId, gstRate: prod?.gst || 12, hsn: prod?.hsn || '' };
              }),
            };
            const fwdRes = await provider.createShipment(exchangeOrder);
            request.forwardShipmentId = fwdRes.shipmentId;
            request.forwardAWB = fwdRes.awb;
            request.status = 'reshipped';
            order.tracking.history.push({ label: `Exchange Reshipped · AWB: ${fwdRes.awb || 'pending'}`, done: true, time: now });
          } catch (e) {
            console.warn('[Shipping] Exchange forward shipment failed:', e?.body || e);
            request.status = 'reship_failed';
            order.tracking.history.push({ label: 'Exchange reship failed — manual action needed', done: false, time: now });
          }
        } else {
          request.status = 'reshipped';
          order.tracking.history.push({ label: 'Exchange item shipped (manual)', done: true, time: now });
        }
        syncDB('products', DB).then(() => syncDB('productVariants', DB));
      }
    }

    order.updatedAt = now;
    audit(req.user.email, 'REQUEST_INSPECTED', request.id, { condition, newStatus: request.status });
    syncDB('orders', DB);
    syncDB('orderRequests', DB);
    return res.json({ success: true, request, order });
  }

  // ── COMPLETED ──
  if (status === 'completed') {
    request.status = 'completed';
    request.updatedAt = now;
    order.tracking.history.push({ label: `${request.type === 'exchange' ? 'Exchange' : 'Return'} Completed`, done: true, time: now });
    order.updatedAt = now;
    audit(req.user.email, 'REQUEST_COMPLETED', request.id);
    syncDB('orders', DB);
    syncDB('orderRequests', DB);
    return res.json({ success: true, request });
  }

  return res.status(400).json({ error: `Unknown status: ${status}` });
});
// Products advanced query
app.get('/api/products/query', requireAdmin('products.*'), (req, res) => {
  const result = applyQuery(DB.products, req.query, ['name','sku','category','brand']);
  result.rows = result.rows.map(attachVariants);
  res.json(result);
});
// Products CSV
app.get('/api/products/export', requireAdmin('products.*'), (req, res) => {
  const csv = toCSV(DB.products, ['id','sku','name','category','brand','price','mrp','cost','stock','gst','hsn','active']);
  res.setHeader('Content-Type','text/csv'); res.setHeader('Content-Disposition','attachment; filename=products.csv'); res.send(csv);
});
// Bulk product actions (price %, stock, activate)
app.post('/api/products/bulk', requireAdmin('products.*'), (req, res) => {
  const { ids, action, value } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error:'ids array required' });
  let n=0;
  let touchedVariants = false;
  ids.forEach(id => { const p=DB.products.find(x=>x.id===id); if(p){
    const variants = DB.productVariants.filter(v => v.productId === id);
    if(action==='activate') p.active=true;
    else if(action==='deactivate') p.active=false;
    else if(action==='pricePercent') {
      if (variants.length) { variants.forEach(v => { v.price = Math.round(v.price*(1+(+value)/100)); }); touchedVariants = true; recomputeProductAggregate(id); }
      else p.price=Math.round(p.price*(1+(+value)/100));
    }
    else if(action==='setGst') p.gst=+value;
    else if(action==='addStock') {
      if (variants.length) { variants.forEach(v => { v.stock += (+value); }); touchedVariants = true; recomputeProductAggregate(id); }
      else p.stock+=(+value);
    }
    n++;
  }});
  const productsSynced = syncDB('products', DB);
  if (touchedVariants) productsSynced.then(() => syncDB('productVariants', DB));
  audit(req.user.email,'PRODUCTS_BULK',action,{count:n,value});
  res.json({ success:true, updated:n });
});
// Customers list + query (registered customers)
app.get('/api/customers/query', requireAdmin('customers.read'), (req, res) => {
  const enriched = DB.customerAuth.map(c => {
    const orders = DB.orders.filter(o => o.customerId === c.id);
    const totalSpent = orders.reduce((s, o) => s + (o.total || 0), 0);
    return { 
      id: c.id, 
      name: c.name, 
      email: c.email, 
      mobile: c.phone || c.mobile || '—', 
      joinedAt: c.createdAt, 
      orderCount: orders.length, 
      totalSpent: totalSpent,
      ltv: totalSpent 
    };
  });
  res.json(applyQuery(enriched, req.query, ['name', 'email', 'mobile']));
});
// Transactions query + CSV (finance depth)
app.get('/api/transactions/query', requireAdmin('transactions.read'), (req, res) => {
  res.json(applyQuery(DB.transactions, req.query, ['id','orderId','customer','email','productName','state']));
});
app.get('/api/transactions/export', requireAdmin('transactions.read'), (req, res) => {
  const csv = toCSV(DB.transactions, ['id','orderId','date','customer','email','state','country','productName','hsn','gstRate','subtotal','gstAmount','total','method','status','taxType']);
  res.setHeader('Content-Type','text/csv'); res.setHeader('Content-Disposition','attachment; filename=transactions.csv'); res.send(csv);
});

// ════════════════════════════════════════════════════════════════════════════════
// USERS / EMPLOYEES / AUDIT
// ════════════════════════════════════════════════════════════════════════════════
app.get('/api/users', requireAdmin('settings.*'), (_, res) => res.json({ users: DB.users.map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role, active: u.active, permissions: u.permissions.length ? u.permissions : ROLE_PERMISSIONS[u.role] })) }));
app.get('/api/employees', requireAdmin('settings.*'), (_, res) => res.json({ employees: DB.employees }));
app.get('/api/audit', requireAdmin('settings.*'), (_, res) => res.json({ total: DB.auditLog.length, log: [...DB.auditLog].reverse().slice(0, 200) }));

// ════════════════════════════════════════════════════════════════════════════════
// SUPPORT TICKETS
// ════════════════════════════════════════════════════════════════════════════════
app.post('/api/tickets', (req, res) => {
  const { name, email, subject, message } = req.body;
  if (!validate.email(email) || !validate.nonEmpty(message)) return res.status(400).json({ error: 'Valid email and message required' });
  const t = { id: genId('TKT', DB.tickets.length + 1001), name, email, subject: subject || 'General', message, status: 'open', createdAt: new Date().toISOString() };
  DB.tickets.push(t);
  syncDB('tickets', DB);
  res.json({ success: true, ticket: { id: t.id, status: t.status } });
});
app.get('/api/tickets', requireAdmin('tickets.*'), (_, res) => res.json({ tickets: [...DB.tickets].reverse() }));

app.get('/api/db-status', async (req, res) => {
  try {
    const dbResult = await pool.query("SELECT current_database()");
    const currentDb = dbResult.rows[0].current_database;
    const tablesResult = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
    const tables = tablesResult.rows.map(r => r.table_name);
    res.json({
      success: true,
      dbReady,
      currentDb,
      tables,
      envDatabaseUrlSet: !!config.database.url
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      dbReady,
      error: err.message,
      envDatabaseUrlSet: !!config.database.url
    });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// IMAGE UPLOAD ROUTES (Phase 1)
// ════════════════════════════════════════════════════════════════════════════════
const imagesRouter = require('./src/routes/images');
app.use('/api/images', imagesRouter);

const PORT = config.server.port;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`GIAFABS Enterprise Backend v4 on :${PORT}`);
    if (config.app.isDevelopment) {
      console.log(`Admin: ${config.admin.email} / ${config.admin.initialPassword}`);
    }
  });
}
module.exports = { app, DB };

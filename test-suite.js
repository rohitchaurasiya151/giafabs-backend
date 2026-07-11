// ════════════════════════════════════════════════════════════════════════════════
// GIAFABS AUTOMATED TEST SUITE — in-process, no network flakiness
// ════════════════════════════════════════════════════════════════════════════════
const http = require('http');
const { app } = require('./server');

let server, base;
const results = [];
let custToken = '', adminToken = '', lastOrderId = '';

function req(method, path, { body, headers } = {}) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = { method, headers: { 'Content-Type': 'application/json', ...(headers || {}) } };
    const r = http.request(base + path, opts, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => { let j = null; try { j = JSON.parse(buf); } catch {} resolve({ status: res.statusCode, body: j }); });
    });
    if (data) r.write(data);
    r.end();
  });
}

function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? '  — ' + detail : ''}`);
  return cond;
}

async function run() {
  console.log('\n════════════════════════════════════════════════════════');
  console.log('GIAFABS BACKEND v4 — AUTOMATED TEST SUITE');
  console.log('════════════════════════════════════════════════════════\n');

  // 1. Health
  let r = await req('GET', '/api/health');
  check('Health check returns v4', r.status === 200 && r.body.version === '4.0');

  // 2. Bootstrap (frontend control surface)
  r = await req('GET', '/api/bootstrap');
  check('Bootstrap returns feature flags', r.body && r.body.featureFlags && typeof r.body.featureFlags.wishlist === 'boolean');
  check('Bootstrap returns CMS content (hero)', r.body.content && Array.isArray(r.body.content.hero) && r.body.content.hero.length === 3);
  check('Bootstrap returns theme colors', r.body.theme && r.body.theme.plum === '#6B4E71');
  check('Bootstrap returns 8 countries', r.body.countries && r.body.countries.length === 8);
  check('Bootstrap payment config present', r.body.payments && typeof r.body.payments.codEnabled === 'boolean');

  // 3. Products
  r = await req('GET', '/api/products');
  check('Products list = 10 active', r.body.total === 10);
  check('Products all women-only categories', r.body.products.every(p => ['Kurtas','Sarees','Western Wear','Salwar Suits','Lehengas','Accessories'].includes(p.category)));
  r = await req('GET', '/api/products?category=Sarees');
  check('Filter by category (Sarees)', r.body.products.every(p => p.category === 'Sarees'));
  r = await req('GET', '/api/products?sortBy=price-low');
  check('Sort price-low ascending', r.body.products[0].price <= r.body.products[r.body.products.length-1].price);
  r = await req('GET', '/api/products?search=silk');
  check('Search "silk" returns matches', r.body.total > 0 && r.body.products.some(p => /silk/i.test(p.name+p.description)));
  r = await req('GET', '/api/products/PRD001');
  check('Product detail includes related', r.body.id === 'PRD001' && Array.isArray(r.body.related));

  // 4. Customer auth — validation
  r = await req('POST', '/api/customer/register', { body: { name: 'X', email: 'bad-email', password: '123' } });
  check('Register rejects invalid email', r.status === 400);
  r = await req('POST', '/api/customer/register', { body: { name: 'Test', email: 'valid@test.com', password: '123' } });
  check('Register rejects short password', r.status === 400);
  r = await req('POST', '/api/customer/register', { body: { name: 'Priya Sharma', email: 'priya@test.com', password: 'secret123', mobile: '9876543210' } });
  check('Register success returns token', r.status === 200 && r.body.token && r.body.token.length >= 40);
  custToken = r.body.token;
  r = await req('POST', '/api/customer/register', { body: { name: 'Dup', email: 'priya@test.com', password: 'secret123' } });
  check('Register blocks duplicate email', r.status === 409);
  r = await req('POST', '/api/customer/login', { body: { email: 'priya@test.com', password: 'wrongpass' } });
  check('Login rejects wrong password', r.status === 401);
  r = await req('POST', '/api/customer/login', { body: { email: 'priya@test.com', password: 'secret123' } });
  check('Login success returns token', r.status === 200 && r.body.token);
  custToken = r.body.token;

  // 5. Order without auth
  r = await req('POST', '/api/orders', { body: { items: [{ productId: 'PRD001', qty: 1 }], payment: { method: 'cod' } } });
  check('Order without login → 401', r.status === 401);

  // 6. Order with auth (COD, domestic Gujarat)
  r = await req('POST', '/api/orders', { headers: { 'x-customer-token': custToken }, body: {
    shippingAddress: { line1: 'A1', city: 'Surat', state: 'Gujarat', pincode: '395001', countryCode: 'IN', mobile: '9876543210' },
    items: [{ productId: 'PRD001', qty: 1 }], payment: { method: 'cod' } } });
  check('COD order placed (Gujarat)', r.status === 200 && r.body.order.id.startsWith('GIAFABS'), r.body.order && `total ₹${r.body.order.pricing.total}`);
  if (r.body.order) {
    lastOrderId = r.body.order.id;
    const pr = r.body.order.pricing;
    // PRD001: price 2499, gst 12% = 300, cod ship 79, cod charge 30 => 2908
    check('COD pricing math correct', pr.subtotal === 2499 && pr.gst === 300 && pr.shipping === 79 && pr.codCharge === 30 && pr.total === 2908, `got total ${pr.total}`);
    check('GST label intra-state for Gujarat', r.body.order.tax.label.includes('CGST'));
  }

  // 7. Interstate order → IGST label
  r = await req('POST', '/api/orders', { headers: { 'x-customer-token': custToken }, body: {
    shippingAddress: { line1: 'B2', city: 'Mumbai', state: 'Maharashtra', pincode: '400001', countryCode: 'IN' },
    items: [{ productId: 'PRD005', qty: 2 }], payment: { method: 'razorpay' } } });
  check('Interstate order → IGST label', r.status === 200 && r.body.order.tax.label.includes('IGST'));
  if (r.body.order) {
    // PRD005 price 799 x2 = 1598, gst12%=192, razorpay ship: 1598>=999 => free(0)
    check('Free shipping above threshold', r.body.order.pricing.shipping === 0, `shipping ${r.body.order.pricing.shipping}`);
  }

  // 8. International order (US) — currency conversion, COD blocked
  r = await req('POST', '/api/orders', { headers: { 'x-customer-token': custToken }, body: {
    shippingAddress: { line1: 'C3', city: 'NYC', state: 'NY', pincode: '10001', countryCode: 'US' },
    items: [{ productId: 'PRD002', qty: 1 }], payment: { method: 'cod' } } });
  check('International COD blocked (US)', r.status === 400 && /COD is not available/i.test(r.body.error));
  r = await req('POST', '/api/orders', { headers: { 'x-customer-token': custToken }, body: {
    shippingAddress: { line1: 'C3', city: 'NYC', state: 'NY', pincode: '10001', countryCode: 'US' },
    items: [{ productId: 'PRD002', qty: 1 }], payment: { method: 'razorpay' } } });
  check('International order accepts online pay', r.status === 200 && r.body.order.isInternational === true);
  if (r.body.order) {
    check('Currency converted to USD', r.body.order.pricing.currency === 'USD' && r.body.order.pricing.totalInCurrency > 0);
    check('Export zero-rated GST label', r.body.order.tax.label.includes('Export'));
  }

  // 9. Coupon validation
  r = await req('POST', '/api/coupons/validate', { body: { code: 'WELCOME10', subtotal: 2000 } });
  check('Valid coupon WELCOME10', r.status === 200 && r.body.discount === 200);
  r = await req('POST', '/api/coupons/validate', { body: { code: 'WELCOME10', subtotal: 500 } });
  check('Coupon rejects below min order', r.status === 400);
  r = await req('POST', '/api/coupons/validate', { body: { code: 'FAKE', subtotal: 5000 } });
  check('Invalid coupon rejected', r.status === 404);

  // 10. Order with coupon applied
  r = await req('POST', '/api/orders', { headers: { 'x-customer-token': custToken }, body: {
    shippingAddress: { line1: 'D4', city: 'Surat', state: 'Gujarat', pincode: '395001', countryCode: 'IN' },
    items: [{ productId: 'PRD004', qty: 1 }], payment: { method: 'razorpay' }, couponCode: 'FESTIVE25' } });
  // PRD004 5499, festive25 = 25% capped 2000 => 1375 discount
  check('Coupon FESTIVE25 applied to order', r.status === 200 && r.body.order.pricing.discount === 1375, r.body.order && `disc ${r.body.order.pricing.discount}`);

  // 11. Out-of-stock guard
  r = await req('POST', '/api/orders', { headers: { 'x-customer-token': custToken }, body: {
    shippingAddress: { countryCode: 'IN', state: 'Gujarat' },
    items: [{ productId: 'PRD006', qty: 999 }], payment: { method: 'razorpay' } } });
  check('Out-of-stock order rejected', r.status === 409 && /Insufficient stock/i.test(r.body.error));

  // 12. Customer order history
  r = await req('GET', '/api/customer/orders', { headers: { 'x-customer-token': custToken } });
  check('Customer order history returns orders', r.status === 200 && r.body.total >= 3);

  // 13. Admin auth + RBAC
  r = await req('POST', '/api/auth/login', { body: { email: 'admin@giafabs.com', password: 'admin123' } });
  check('Admin login success', r.status === 200 && r.body.token);
  adminToken = r.body.token;
  r = await req('GET', '/api/dashboard');
  check('Dashboard blocked without admin token', r.status === 401);
  r = await req('GET', '/api/dashboard', { headers: { 'x-admin-token': adminToken } });
  check('Dashboard loads for admin', r.status === 200 && r.body.summary.totalOrders >= 4);

  // 14. RBAC — support role cannot edit products
  r = await req('POST', '/api/auth/login', { body: { email: 'support@giafabs.com', password: 'support123' } });
  const supportToken = r.body.token;
  r = await req('POST', '/api/products', { headers: { 'x-admin-token': supportToken }, body: { name: 'Hack' } });
  check('RBAC: support role blocked from product create', r.status === 403);

  // 15. GST report
  r = await req('GET', '/api/reports/gst?dateFrom=2026-01-01&dateTo=2026-12-31', { headers: { 'x-admin-token': adminToken } });
  check('GST report generated', r.status === 200 && r.body.totalGST > 0, `total GST ₹${r.body.totalGST}`);
  check('GST report has Gujarat SGST+CGST', r.body.byState.Gujarat && r.body.byState.Gujarat.sgst > 0);
  check('GST report has Maharashtra IGST', r.body.byState.Maharashtra && r.body.byState.Maharashtra.igst > 0);

  // 16. Inventory valuation + alerts
  r = await req('GET', '/api/inventory/valuation', { headers: { 'x-admin-token': adminToken } });
  check('Inventory valuation computed', r.status === 200 && r.body.totalInventoryCost > 0, `margin ${r.body.margin}%`);
  r = await req('GET', '/api/inventory/alerts', { headers: { 'x-admin-token': adminToken } });
  check('Low-stock alerts endpoint works', r.status === 200 && typeof r.body.count === 'number');

  // 17. Inventory inward movement updates stock
  r = await req('POST', '/api/inventory/movements', { headers: { 'x-admin-token': adminToken }, body: { type: 'inward', productCode: 'PRD006', quantity: 10, reason: 'Restock' } });
  check('Inward movement increases stock', r.status === 200 && r.body.newStock >= 10);

  // 18. Feature flag toggle → bootstrap reflects it
  r = await req('PATCH', '/api/admin/flags', { headers: { 'x-admin-token': adminToken }, body: { codPayment: false } });
  check('Flag update accepted', r.status === 200 && r.body.featureFlags.codPayment === false);
  r = await req('GET', '/api/bootstrap');
  check('Bootstrap reflects disabled COD', r.body.payments.codEnabled === false);
  // COD order should now be blocked
  r = await req('POST', '/api/orders', { headers: { 'x-customer-token': custToken }, body: {
    shippingAddress: { countryCode: 'IN', state: 'Gujarat' }, items: [{ productId: 'PRD007', qty: 1 }], payment: { method: 'cod' } } });
  check('COD blocked after flag disabled', r.status === 400 && /disabled/i.test(r.body.error));
  // restore
  await req('PATCH', '/api/admin/flags', { headers: { 'x-admin-token': adminToken }, body: { codPayment: true } });

  // 19. CMS content update
  r = await req('PATCH', '/api/admin/content', { headers: { 'x-admin-token': adminToken }, body: { about: 'Updated about text' } });
  check('Content update accepted', r.status === 200);
  r = await req('GET', '/api/bootstrap');
  check('Bootstrap reflects updated content', r.body.content.about === 'Updated about text');

  // 20. Settings secret masking
  r = await req('GET', '/api/settings', { headers: { 'x-admin-token': adminToken } });
  check('Razorpay secret masked on read', r.body.payments.razorpaySecret === '••••••••');

  // 21. Payment signature verification (secure)
  const { hmacSha256 } = require('./core');
  const secret = 'demo_secret_key_for_signature_verification';
  const rzpOrderId = 'order_ABC', rzpPayId = 'pay_XYZ';
  const goodSig = hmacSha256(`${rzpOrderId}|${rzpPayId}`, secret);
  r = await req('POST', '/api/payment/verify', { headers: { 'x-customer-token': custToken }, body: { orderId: lastOrderId, razorpayOrderId: rzpOrderId, razorpayPaymentId: rzpPayId, signature: 'tampered' } });
  check('Payment rejects tampered signature', r.status === 400);
  r = await req('POST', '/api/payment/verify', { headers: { 'x-customer-token': custToken }, body: { orderId: lastOrderId, razorpayOrderId: rzpOrderId, razorpayPaymentId: rzpPayId, signature: goodSig } });
  check('Payment accepts valid signature', r.status === 200 && r.body.order.payment.status === 'paid');

  // 22. Order status update + restock on cancel
  r = await req('GET', '/api/products/PRD007');
  const stockBefore = r.body.stock;
  r = await req('POST', '/api/orders', { headers: { 'x-customer-token': custToken }, body: {
    shippingAddress: { countryCode: 'IN', state: 'Gujarat' }, items: [{ productId: 'PRD007', qty: 2 }], payment: { method: 'razorpay' } } });
  const cancelOrderId = r.body.order.id;
  r = await req('GET', '/api/products/PRD007');
  check('Stock decremented after order', r.body.stock === stockBefore - 2, `${stockBefore}→${r.body.stock}`);
  r = await req('PATCH', `/api/orders/${cancelOrderId}/status`, { headers: { 'x-admin-token': adminToken }, body: { status: 'cancelled' } });
  check('Order cancellation accepted', r.status === 200);
  r = await req('GET', '/api/products/PRD007');
  check('Stock restored after cancel', r.body.stock === stockBefore, `restored to ${r.body.stock}`);

  // 23. Audit log
  r = await req('GET', '/api/audit', { headers: { 'x-admin-token': adminToken } });
  check('Audit log captured events', r.status === 200 && r.body.total > 10);

  // 24. Support ticket
  r = await req('POST', '/api/tickets', { body: { name: 'Cust', email: 'c@test.com', message: 'Where is my order?' } });
  check('Support ticket created', r.status === 200 && r.body.ticket.id.startsWith('TKT'));

  // 25. Maintenance kill-switch
  await req('PATCH', '/api/admin/flags', { headers: { 'x-admin-token': adminToken }, body: { maintenanceMode: true } });
  r = await req('GET', '/api/products');
  check('Maintenance mode blocks public API', r.status === 503 && r.body.maintenance === true);
  await req('PATCH', '/api/admin/flags', { headers: { 'x-admin-token': adminToken }, body: { maintenanceMode: false } });
  r = await req('GET', '/api/products');
  check('Public API restored after maintenance off', r.status === 200);

  // SUMMARY
  const passed = results.filter(x => x.pass).length;
  const failed = results.filter(x => !x.pass);
  console.log('\n════════════════════════════════════════════════════════');
  console.log(`RESULT: ${passed}/${results.length} passed`);
  if (failed.length) { console.log('\nFAILURES:'); failed.forEach(f => console.log(`  ❌ ${f.name} ${f.detail}`)); }
  else console.log('🎉 ALL TESTS PASSED');
  console.log('════════════════════════════════════════════════════════\n');
  server.close();
  process.exit(failed.length ? 1 : 0);
}

server = app.listen(0, () => { base = `http://localhost:${server.address().port}`; run().catch(e => { console.error(e); process.exit(1); }); });

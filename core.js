// ════════════════════════════════════════════════════════════════════════════════
// GIAFABS ENTERPRISE CORE — Security, RBAC, Audit, Utilities
// ════════════════════════════════════════════════════════════════════════════════
const crypto = require('crypto');

// ── Password hashing (PBKDF2 — proper salted, slow hash) ──
function hashPw(pw, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(pw, salt, 100000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}
function verifyPw(pw, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const check = crypto.pbkdf2Sync(pw, salt, 100000, 64, 'sha512').toString('hex');
  // constant-time compare
  const a = Buffer.from(hash, 'hex'), b = Buffer.from(check, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function genToken() { return crypto.randomBytes(32).toString('hex'); }
function genId(prefix, n, pad = 6) { return `${prefix}${String(n).padStart(pad, '0')}`; }

// ── HMAC signature verify (Razorpay-style webhook / payment verification) ──
function hmacSha256(data, secret) {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}
function verifyPaymentSignature(orderId, paymentId, signature, secret) {
  const expected = hmacSha256(`${orderId}|${paymentId}`, secret);
  const a = Buffer.from(expected), b = Buffer.from(signature || '');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── RBAC permission matrix ──
const ROLE_PERMISSIONS = {
  superadmin: ['*'],
  admin: ['orders.*', 'products.*', 'inventory.*', 'customers.*', 'reports.*', 'settings.*', 'content.*', 'coupons.*', 'shipping.*', 'tax.*', 'transactions.read'],
  manager: ['orders.read', 'orders.update', 'products.*', 'inventory.*', 'reports.read', 'coupons.*', 'shipping.*'],
  operations: ['orders.read', 'orders.update', 'inventory.*', 'shipping.*'],
  finance: ['orders.read', 'reports.*', 'transactions.read', 'tax.*'],
  support: ['orders.read', 'customers.read', 'customers.update', 'tickets.*'],
};
function hasPermission(user, required) {
  if (!user) return false;
  const perms = user.permissions && user.permissions.length ? user.permissions : (ROLE_PERMISSIONS[user.role] || []);
  if (perms.includes('*')) return true;
  if (perms.includes(required)) return true;
  // wildcard match: 'orders.*' covers 'orders.read'
  const [domain] = required.split('.');
  return perms.includes(`${domain}.*`);
}

// ── Simple rate limiter (in-memory, per-key sliding window) ──
const rateBuckets = {};
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  if (!rateBuckets[key]) rateBuckets[key] = [];
  rateBuckets[key] = rateBuckets[key].filter(t => now - t < windowMs);
  if (rateBuckets[key].length >= max) return false;
  rateBuckets[key].push(now);
  return true;
}

// ── Input validation helpers ──
const validate = {
  email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v || ''),
  mobile: (v) => /^[0-9+\-\s]{7,15}$/.test(v || ''),
  pincode: (v) => /^[0-9]{4,10}$/.test(v || ''),
  nonEmpty: (v) => typeof v === 'string' && v.trim().length > 0,
  positiveInt: (v) => Number.isInteger(v) && v > 0,
  positiveNum: (v) => typeof v === 'number' && v >= 0,
};

module.exports = {
  hashPw, verifyPw, genToken, genId, hmacSha256, verifyPaymentSignature,
  ROLE_PERMISSIONS, hasPermission, rateLimit, validate, rateBuckets
};

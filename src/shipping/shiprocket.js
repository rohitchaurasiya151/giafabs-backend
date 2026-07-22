// Shiprocket shipping provider
// Docs: https://apidocs.shiprocket.in/
const https = require('https');

const BASE_URL = 'https://apiv2.shiprocket.in/v1/external';

function apiRequest(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (data) headers['Content-Length'] = Buffer.byteLength(data);

    const url = new URL(BASE_URL + path);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers,
    };

    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => (raw += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          if (res.statusCode >= 400) reject({ status: res.statusCode, body: parsed });
          else resolve(parsed);
        } catch {
          reject({ status: res.statusCode, body: raw });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// Token cache — shared across all calls in this process
let _token = null;
let _tokenExpiry = 0;

async function getToken(cfg) {
  const now = Date.now();
  // Reuse stored token (with 5min buffer before expiry)
  if (cfg.token && cfg.tokenExpiry && new Date(cfg.tokenExpiry).getTime() - now > 5 * 60 * 1000) {
    return cfg.token;
  }
  if (_token && _tokenExpiry - now > 5 * 60 * 1000) {
    return _token;
  }
  if (!cfg.email || !cfg.password) throw new Error('Shiprocket credentials not configured');

  const res = await apiRequest('POST', '/auth/local', { email: cfg.email, password: cfg.password });
  _token = res.token;
  // Shiprocket tokens expire in 24h
  _tokenExpiry = now + 23.5 * 60 * 60 * 1000;

  // Persist token back to cfg so server restart can reuse it
  cfg.token = _token;
  cfg.tokenExpiry = new Date(_tokenExpiry).toISOString();

  return _token;
}

// Maps our order object to Shiprocket's required format
function buildShiprocketPayload(order, storeCfg) {
  const addr = order.shippingAddress;
  const item = order.items[0]; // used for channel_id; all items go in order_items

  return {
    order_id: order.id,
    order_date: order.createdAt.slice(0, 10),
    pickup_location: storeCfg.pickupLocation || 'Primary',

    billing_customer_name: order.customer.name,
    billing_last_name: '',
    billing_address: addr.line1 || addr.address || '',
    billing_address_2: addr.line2 || '',
    billing_city: addr.city || '',
    billing_pincode: addr.pincode || addr.zip || '',
    billing_state: addr.state || '',
    billing_country: addr.country || 'India',
    billing_email: order.customer.email,
    // Fall back to the shipping address's phone — order.customer.mobile can
    // be empty for accounts predating the mobile-persistence fix, even
    // though the delivery contact number was captured fine at checkout.
    billing_phone: order.customer.mobile || addr.phone || '',

    shipping_is_billing: true,

    order_items: order.items.map(i => ({
      name: i.name,
      sku: i.sku || i.productId,
      units: i.qty,
      selling_price: i.unitPrice,
      discount: 0,
      tax: i.gstRate || 12,
      hsn: i.hsn || '',
    })),

    payment_method: order.payment.method === 'cod' ? 'COD' : 'Prepaid',
    sub_total: order.pricing.subtotal,
    length: 25, breadth: 20, height: 5,
    weight: order.items.reduce((sum, i) => sum + (i.weight || 0.3) * i.qty, 0),
  };
}

class ShiprocketProvider {
  constructor(cfg, storeCfg) {
    this.cfg = cfg;         // DB.settings.integrations.shiprocket
    this.storeCfg = storeCfg; // DB.settings.store
  }

  async createShipment(order) {
    const token = await getToken(this.cfg);
    const payload = buildShiprocketPayload(order, this.storeCfg);
    const res = await apiRequest('POST', '/orders/create/adhoc', payload, token);

    const shipmentId = res.shipment_id;
    let awb = null;
    let trackingUrl = null;

    // Auto-assign courier + generate AWB
    if (shipmentId && this.cfg.autoAssignCourier !== false) {
      try {
        const awbRes = await apiRequest('POST', '/courier/assign/awb/shipment', {
          shipment_id: String(shipmentId),
        }, token);
        awb = awbRes?.response?.data?.awb_code || null;
        if (awb) trackingUrl = `https://shiprocket.co/tracking/${awb}`;
      } catch (e) {
        // AWB assignment failed — shipment still created, admin can assign manually
        console.warn('[Shiprocket] AWB assignment failed:', e?.body || e);
      }
    }

    return {
      provider: 'shiprocket',
      orderId: res.order_id,
      shipmentId: String(shipmentId),
      awb,
      trackingUrl,
    };
  }

  async cancelShipment(ids) {
    // ids = array of Shiprocket order_ids (not our order id)
    const token = await getToken(this.cfg);
    return apiRequest('POST', '/orders/cancel', { ids }, token);
  }

  async trackShipment(awb) {
    const token = await getToken(this.cfg);
    return apiRequest('GET', `/courier/track/awb/${awb}`, null, token);
  }

  async generateLabel(shipmentIds) {
    const token = await getToken(this.cfg);
    return apiRequest('POST', '/orders/print/label', { shipment_id: shipmentIds }, token);
  }

  async schedulePickup(shipmentIds) {
    const token = await getToken(this.cfg);
    return apiRequest('POST', '/courier/generate/pickup', { shipment_id: shipmentIds }, token);
  }

  // Creates a reverse pickup (return/exchange) — Shiprocket picks up from customer
  async createReversePickup(order, requestId) {
    const token = await getToken(this.cfg);
    const addr = order.shippingAddress;
    const res = await apiRequest('POST', '/orders/create/return', {
      order_id: `${order.id}-RET-${requestId}`,
      order_date: new Date().toISOString().slice(0, 10),
      channel_id: this.cfg.channelId || '',
      pickup_customer_name: order.customer.name,
      pickup_last_name: '',
      pickup_address: addr.line1 || addr.address || '',
      pickup_address_2: addr.line2 || '',
      pickup_city: addr.city || '',
      pickup_state: addr.state || '',
      pickup_country: addr.country || 'India',
      pickup_pincode: addr.pincode || addr.zip || '',
      pickup_email: order.customer.email,
      pickup_phone: order.customer.mobile || '',
      shipping_customer_name: this.storeCfg.name || 'GIAFABS',
      shipping_address: this.storeCfg.address || '',
      shipping_city: 'Surat',
      shipping_country: 'India',
      shipping_pincode: this.storeCfg.homePincode || '395002',
      shipping_state: this.storeCfg.homeState || 'Gujarat',
      shipping_email: this.storeCfg.email || '',
      shipping_phone: this.storeCfg.phone || '',
      payment_method: 'Prepaid',
      sub_total: order.pricing.total,
      length: 25, breadth: 20, height: 5,
      weight: order.items.reduce((s, i) => s + (i.weight || 0.3) * i.qty, 0),
      order_items: order.items.map(i => ({
        name: i.name, sku: i.sku || i.productId,
        units: i.qty, selling_price: i.unitPrice,
      })),
    }, token);

    // Normalize to the same shape as createShipment so callers don't need
    // to special-case each provider's raw response fields.
    return {
      provider: 'shiprocket',
      orderId: res.order_id,
      shipmentId: String(res.shipment_id || ''),
      awb: res.awb_code || null,
      raw: res,
    };
  }
}

module.exports = { ShiprocketProvider };

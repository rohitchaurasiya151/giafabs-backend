// Delhivery shipping provider
// Docs: https://delhivery-express-api-doc.readme.io/
//
// Auth: single static API token, sent as `Authorization: Token <token>` on
// every call (unlike Shiprocket's email/password login-for-a-bearer-token
// flow). Base URL switches between staging and production; production is
// the default since this is what the admin dashboard's "connected" status
// implies once cfg.apiToken is set.
const https = require('https');

function baseUrl(cfg) {
  return cfg.environment === 'staging'
    ? 'https://staging-express.delhivery.com'
    : 'https://track.delhivery.com';
}

function apiRequest(cfg, method, path, { query, formBody, jsonBody } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl(cfg) + path);
    if (query) Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));

    const data = formBody || (jsonBody ? JSON.stringify(jsonBody) : null);
    const headers = {
      'Authorization': `Token ${cfg.apiToken}`,
      'Content-Type': formBody ? 'application/x-www-form-urlencoded' : 'application/json',
    };
    if (data) headers['Content-Length'] = Buffer.byteLength(data);

    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers,
    }, (res) => {
      let raw = '';
      res.on('data', chunk => (raw += chunk));
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(raw); } catch { parsed = raw; }
        if (res.statusCode >= 400) reject({ status: res.statusCode, body: parsed });
        else resolve(parsed);
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// Fetch one unused waybill number, required before creating a shipment.
async function fetchWaybill(cfg) {
  const res = await apiRequest(cfg, 'GET', '/waybill/api/fetch/json/', {
    query: { cl: cfg.clientName },
  });
  // Response shape isn't fully documented publicly — handle both a bare
  // waybill string/number and a JSON object wrapping it.
  if (typeof res === 'string' || typeof res === 'number') return String(res).trim();
  return String(res.waybill || res.data || res).trim();
}

// Maps our order object to Delhivery's create-order payload
function buildDelhiveryPayload(order, cfg, waybill) {
  const addr = order.shippingAddress;

  return {
    client_name: cfg.clientName,
    order_id: order.id,
    waybill,
    shipment_type: 'single_piece',

    pickup_location: cfg.pickupLocation,
    seller_name: cfg.clientName,
    seller_gst_tin: cfg.sellerGstTin || '',

    consignee_name: order.customer.name,
    consignee_address: addr.line1 || addr.address || '',
    consignee_address_2: addr.line2 || '',
    consignee_city: addr.city || '',
    consignee_phone: order.customer.mobile || '',
    consignee_pin: addr.pincode || addr.zip || '',
    consignee_state: addr.state || '',
    country: 'IN',

    payment_mode: order.payment.method === 'cod' ? 'COD' : 'Prepaid',
    cod_amount: order.payment.method === 'cod' ? order.pricing.total : 0,

    products: order.items.map(i => ({
      name: i.name,
      quantity: i.qty,
      hsn_code: i.hsn || '',
      price: i.unitPrice,
    })),

    weight: order.items.reduce((sum, i) => sum + (i.weight || 0.3) * i.qty, 0),
    dimensions: { length: 25, breadth: 20, height: 5 },
  };
}

class DelhiveryProvider {
  constructor(cfg, storeCfg) {
    this.cfg = cfg;         // DB.settings.integrations.delhivery
    this.storeCfg = storeCfg; // DB.settings.store
  }

  async createShipment(order) {
    const waybill = await fetchWaybill(this.cfg);
    const payload = buildDelhiveryPayload(order, this.cfg, waybill);

    // Delhivery's create API takes a form-encoded body with the payload
    // JSON-stringified under a `data` key, not a raw JSON request body.
    const formBody = `format=json&data=${encodeURIComponent(JSON.stringify(payload))}`;
    const res = await apiRequest(this.cfg, 'POST', '/api/cmu/create.json', { formBody });

    return {
      provider: 'delhivery',
      orderId: order.id,
      shipmentId: waybill,
      awb: waybill,
      trackingUrl: `https://www.delhivery.com/track/package/${waybill}`,
      raw: res,
    };
  }

  // ids here are waybills (Delhivery has no separate shipment id concept)
  async cancelShipment(waybills) {
    const results = [];
    for (const waybill of waybills) {
      const res = await apiRequest(this.cfg, 'POST', '/api/p/edit', {
        jsonBody: { waybill, cancellation: 'true' },
      });
      results.push(res);
    }
    return results;
  }

  async trackShipment(waybill) {
    return apiRequest(this.cfg, 'GET', '/api/v1/packages/json/', {
      query: { waybill },
    });
  }

  async generateLabel(waybills) {
    return apiRequest(this.cfg, 'GET', '/api/p/packing_slip', {
      query: { wbns: waybills.join(',') },
    });
  }

  async schedulePickup() {
    const now = new Date();
    return apiRequest(this.cfg, 'POST', '/fm/request/new/', {
      jsonBody: {
        pickup_location: this.cfg.pickupLocation,
        pickup_date: now.toISOString().slice(0, 10),
        pickup_time: '14:00:00',
        expected_package_count: 1,
      },
    });
  }

  // Best-effort: Delhivery's reverse-pickup flow isn't fully documented
  // publicly. This reuses the forward create-order API with
  // payment_mode: 'Pickup' per their docs, consignee set to the customer
  // (pickup point) — verify against Delhivery's staging environment before
  // relying on this in production.
  async createReversePickup(order, requestId) {
    const waybill = await fetchWaybill(this.cfg);
    const addr = order.shippingAddress;

    const payload = {
      client_name: this.cfg.clientName,
      order_id: `${order.id}-RET-${requestId}`,
      waybill,
      shipment_type: 'single_piece',

      pickup_location: this.cfg.pickupLocation,
      seller_name: this.cfg.clientName,
      seller_gst_tin: this.cfg.sellerGstTin || '',

      consignee_name: order.customer.name,
      consignee_address: addr.line1 || addr.address || '',
      consignee_address_2: addr.line2 || '',
      consignee_city: addr.city || '',
      consignee_phone: order.customer.mobile || '',
      consignee_pin: addr.pincode || addr.zip || '',
      consignee_state: addr.state || '',
      country: 'IN',

      payment_mode: 'Pickup',
      cod_amount: 0,

      products: order.items.map(i => ({
        name: i.name,
        quantity: i.qty,
        hsn_code: i.hsn || '',
        price: i.unitPrice,
      })),

      weight: order.items.reduce((sum, i) => sum + (i.weight || 0.3) * i.qty, 0),
      dimensions: { length: 25, breadth: 20, height: 5 },
    };

    const formBody = `format=json&data=${encodeURIComponent(JSON.stringify(payload))}`;
    const res = await apiRequest(this.cfg, 'POST', '/api/cmu/create.json', { formBody });

    return { provider: 'delhivery', orderId: payload.order_id, shipmentId: waybill, awb: waybill, raw: res };
  }
}

module.exports = { DelhiveryProvider };

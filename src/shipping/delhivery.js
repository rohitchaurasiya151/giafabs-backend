// Delhivery shipping provider
// Docs: https://delhivery-express-api-doc.readme.io/
//
// Auth: single static API token, sent as `Authorization: Token <token>` on
// every call (unlike Shiprocket's email/password login-for-a-bearer-token
// flow). Base URL switches between staging and production; production is
// the default since this is what the admin dashboard's "connected" status
// implies once cfg.apiToken is set.
const https = require('https');

// Delhivery's create-order response nests the actually useful failure
// reason under packages[].remarks; the top-level `rmk` is almost always
// the same generic "An internal Error has occurred" boilerplate regardless
// of cause. Surface the specific remarks when present so callers (admin UI,
// audit log) see the real reason instead of the generic one.
function delhiveryErrorMessage(res, fallback) {
  const remarks = res?.packages?.map(p => p.remarks).flat().filter(Boolean);
  if (remarks?.length) return remarks.join('; ');
  return res?.rmk || fallback;
}

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

function buildPickupLocation(cfg) {
  return {
    name: cfg.pickupLocation,
    pin: cfg.pickupPincode || '',
    add: cfg.pickupAddress || '',
    city: cfg.pickupLocation,
    state: cfg.pickupState || '',
    country: 'India',
    phone: cfg.pickupPhone || '',
  };
}

// Maps a single order to one entry of Delhivery's `shipments[]` array.
// Delhivery's docs disagree with themselves on a few field names
// (seller_gst_tin vs seller_tin, products[] vs products_desc) — both
// variants are included since extra unrecognized fields are harmless but
// a missing required one isn't.
function buildShipmentEntry(order, cfg, waybill, { paymentMode, codAmount, orderId, shipmentType } = {}) {
  const addr = order.shippingAddress;
  const totalWeight = order.items.reduce((sum, i) => sum + (i.weight || 0.3) * i.qty, 0);
  const today = new Date().toISOString().slice(0, 10);

  return {
    name: order.customer.name,
    add: addr.line1 || addr.address || '',
    address_2: addr.line2 || '',
    city: addr.city || '',
    state: addr.state || '',
    country: 'India',
    // Fall back to the shipping address's phone — order.customer.mobile can
    // be empty for accounts predating the mobile-persistence fix (see
    // DELHIVERY_DEBUG_NOTES.md), even though the delivery contact number
    // was captured fine at checkout.
    phone: order.customer.mobile || addr.phone || '',
    pin: addr.pincode || addr.zip || '',

    order: orderId,
    order_date: today,
    waybill,
    // shipment_type omitted for forward shipments — verified live (2026-07-18,
    // account "GIA FABS") that sending ANY explicit value here ('single_piece',
    // 'Forward', 'forward') triggers "Waybill does not match master waybill
    // pattern or wrong shipment type for waybill" on this account, while
    // omitting it lets Delhivery apply the account's provisioned default,
    // which works. Only set when the caller explicitly needs 'Reverse'
    // (return pickup) — untested whether that value has the same issue.
    ...(shipmentType ? { shipment_type: shipmentType } : {}),
    shipment_width: 20,
    shipment_height: 5,
    shipment_length: 25,
    weight: totalWeight,

    payment_mode: paymentMode,
    cod_amount: codAmount,
    total_amount: order.pricing.total,

    products_desc: order.items.map(i => i.name).join(', '),
    quantity: order.items.reduce((sum, i) => sum + i.qty, 0),
    products: order.items.map(i => ({
      name: i.name,
      quantity: i.qty,
      hsn_code: i.hsn || '',
      price: i.unitPrice,
    })),

    seller_name: cfg.clientName,
    seller_add: cfg.pickupAddress || '',
    seller_gst_tin: cfg.sellerGstTin || '',
    seller_tin: cfg.sellerGstTin || '',
    seller_cst: '',
    seller_inv: orderId,
    seller_inv_date: today,
  };
}

// Maps our order object to Delhivery's create-order payload (single shipment).
function buildDelhiveryPayload(order, cfg, waybill, opts = {}) {
  return {
    pickup_location: buildPickupLocation(cfg),
    shipments: [buildShipmentEntry(order, cfg, waybill, opts)],
  };
}

class DelhiveryProvider {
  constructor(cfg, storeCfg) {
    this.cfg = cfg;         // DB.settings.integrations.delhivery
    this.storeCfg = storeCfg; // DB.settings.store
  }

  async createShipment(order) {
    const waybill = await fetchWaybill(this.cfg);
    const isCod = order.payment.method === 'cod';
    const payload = buildDelhiveryPayload(order, this.cfg, waybill, {
      paymentMode: isCod ? 'COD' : 'Prepaid',
      codAmount: isCod ? order.pricing.total : 0,
      orderId: order.id,
    });

    // Delhivery's create API takes a form-encoded body with the payload
    // JSON-stringified under a `data` key, not a raw JSON request body.
    const formBody = `format=json&data=${encodeURIComponent(JSON.stringify(payload))}`;
    const res = await apiRequest(this.cfg, 'POST', '/api/cmu/create.json', { formBody });

    if (res?.error || res?.success === false) {
      const err = new Error(delhiveryErrorMessage(res, 'Delhivery order creation failed'));
      err.body = res;
      throw err;
    }

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
    const orderId = `${order.id}-RET-${requestId}`;
    const payload = buildDelhiveryPayload(order, this.cfg, waybill, {
      paymentMode: 'Pickup',
      codAmount: 0,
      orderId,
      shipmentType: 'Reverse',
    });

    const formBody = `format=json&data=${encodeURIComponent(JSON.stringify(payload))}`;
    const res = await apiRequest(this.cfg, 'POST', '/api/cmu/create.json', { formBody });

    if (res?.error || res?.success === false) {
      const err = new Error(delhiveryErrorMessage(res, 'Delhivery reverse pickup creation failed'));
      err.body = res;
      throw err;
    }

    return { provider: 'delhivery', orderId, shipmentId: waybill, awb: waybill, raw: res };
  }

  // Batches multiple orders into a single create-order call. One waybill is
  // still fetched per order (Delhivery has no bulk waybill-fetch), but the
  // shipments share one HTTP request instead of one-per-order.
  async createBulkShipments(orders) {
    const waybills = await Promise.all(orders.map(() => fetchWaybill(this.cfg)));
    const payload = {
      pickup_location: buildPickupLocation(this.cfg),
      shipments: orders.map((order, i) => {
        const isCod = order.payment.method === 'cod';
        return buildShipmentEntry(order, this.cfg, waybills[i], {
          paymentMode: isCod ? 'COD' : 'Prepaid',
          codAmount: isCod ? order.pricing.total : 0,
          orderId: order.id,
        });
      }),
    };

    const formBody = `format=json&data=${encodeURIComponent(JSON.stringify(payload))}`;
    const res = await apiRequest(this.cfg, 'POST', '/api/cmu/create.json', { formBody });

    if (res?.error || res?.success === false) {
      const err = new Error(delhiveryErrorMessage(res, 'Delhivery bulk shipment creation failed'));
      err.body = res;
      throw err;
    }

    return orders.map((order, i) => ({
      provider: 'delhivery',
      orderId: order.id,
      shipmentId: waybills[i],
      awb: waybills[i],
      trackingUrl: `https://www.delhivery.com/track/package/${waybills[i]}`,
    }));
  }

  // Pincode serviceability — response shape isn't fully documented publicly,
  // handled defensively; verify against Delhivery's staging environment.
  async checkServiceability(pincode) {
    const res = await apiRequest(this.cfg, 'GET', '/c/api/pin-codes/json/', {
      query: { filter_codes: pincode },
    });
    const entry = res?.delivery_codes?.[0]?.postal_code;
    if (!entry) return { pincode, serviceable: false };
    return {
      pincode,
      serviceable: true,
      codAvailable: entry.cod === 'Y',
      prepaidAvailable: entry.pre_paid === 'Y',
      district: entry.district,
      stateCode: entry.state_code,
    };
  }

  // Live rate quote via Delhivery's invoice/charges API.
  async calculateRate({ originPincode, destPincode, weightGrams, paymentMode, orderValue } = {}) {
    const res = await apiRequest(this.cfg, 'GET', '/api/kinko/v1/invoice/charges/.json', {
      query: {
        md: 'E',
        ss: 'Delivered',
        o_pin: originPincode || this.cfg.pickupPincode || '',
        d_pin: destPincode || '',
        cgm: weightGrams || 500,
        pt: paymentMode === 'cod' ? 'COD' : 'Pre-paid',
        cod: paymentMode === 'cod' ? (orderValue || 0) : 0,
      },
    });
    const charge = Array.isArray(res) ? res[0] : res;
    return { total: charge?.total_amount ?? charge?.gross_amount ?? null, raw: charge };
  }

  // NDR (non-delivery report) lookup for one or more waybills.
  async getNdrShipments(waybills) {
    return apiRequest(this.cfg, 'GET', '/api/cmu/get_bulk_ndr', {
      query: { waybill: waybills.join(',') },
    });
  }

  // Best-effort: Delhivery's NDR-action API isn't fully documented publicly.
  // action is one of 'RE-ATTEMPT' | 'DEFERRED' | 'RTO' per their docs —
  // verify against Delhivery's staging environment before relying on this
  // in production.
  async actionNdr(waybill, action, { comment, reattemptDate } = {}) {
    return apiRequest(this.cfg, 'POST', '/api/p/update', {
      jsonBody: {
        data: [{
          waybill,
          act: action,
          comment: comment || '',
          ...(reattemptDate ? { next_attempt: reattemptDate } : {}),
        }],
      },
    });
  }

  // Attaches a GST e-way bill number to an already-created shipment —
  // required for shipments with invoice value > ₹50k. The e-way bill itself
  // is generated on the government e-way bill portal (out of scope here);
  // this just registers its number (ewbn) and the invoice number (dcn)
  // against the waybill on Delhivery's side. Unlike most Delhivery APIs,
  // success is HTTP 201 while validation failures ("Package not found",
  // "invalid ewaybill pattern") come back as HTTP 200 with success:false —
  // apiRequest only rejects on statusCode >= 400, so that case is checked
  // explicitly here.
  async updateEwaybill(waybill, updates) {
    const data = (Array.isArray(updates) ? updates : [updates]).map(u => ({ dcn: u.dcn, ewbn: u.ewbn }));
    const res = await apiRequest(this.cfg, 'PUT', `/api/rest/ewaybill/${encodeURIComponent(waybill)}/`, {
      jsonBody: { data },
    });
    if (res?.success === false) {
      const err = new Error(res.message || 'Delhivery e-waybill update failed');
      err.body = res;
      throw err;
    }
    return res;
  }
}

module.exports = { DelhiveryProvider };

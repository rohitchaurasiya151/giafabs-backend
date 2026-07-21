// Shipping provider factory — returns the active enabled provider or null
const { ShiprocketProvider } = require('./shiprocket');
const { DelhiveryProvider } = require('./delhivery');

// requireAutoPush controls whether cfg.autoPush is checked. It defaults to
// true because that's the correct gate for fully automatic dispatch (new
// order placed, stock restocked). Admin-triggered actions (manual push,
// cancel, track, label, NDR, reverse pickup, etc.) pass requireAutoPush:false
// since an integration only needs to be `enabled` to be usable on demand —
// `autoPush` is specifically "should new orders dispatch here automatically",
// not "is this integration usable at all".
function getActiveShippingProvider(DB, { requireAutoPush = true } = {}) {
  const integrations = DB.settings.integrations;
  const store = DB.settings.store;
  const priority = DB.settings.shipping.courierPriority || ['shiprocket', 'delhivery', 'manualShip'];

  for (const name of priority) {
    const cfg = integrations[name];
    if (!cfg || cfg.category !== 'shipping' || !cfg.enabled || (requireAutoPush && !cfg.autoPush)) continue;
    if (name === 'shiprocket' && cfg.email && cfg.password) {
      return new ShiprocketProvider(cfg, store);
    }
    if (name === 'delhivery' && cfg.apiToken) {
      return new DelhiveryProvider(cfg, store);
    }
    // Future providers: add here same pattern
  }
  return null; // no matching provider configured
}

// Check if ALL items in the order have physical stock available (warehouse check)
// This is separate from the checkout-time stock deduction — this checks if we
// can actually pack and ship. Returns { ok: boolean, outOfStock: string[] }
function checkFulfillableStock(order, DB) {
  const outOfStock = [];

  for (const item of order.items) {
    const prod = DB.products.find(p => p.id === item.productId);
    if (!prod) { outOfStock.push(item.name); continue; }

    if (item.size) {
      const variant = DB.productVariants.find(v => v.productId === item.productId && v.size === item.size);
      // Stock was already decremented at order time, so 0 means nothing left
      if (!variant || variant.stock < 0) outOfStock.push(`${item.name} (${item.size})`);
    } else {
      if (prod.stock < 0) outOfStock.push(item.name);
    }
  }

  return { ok: outOfStock.length === 0, outOfStock };
}

// Whether an order is eligible to be pushed to a shipping provider:
// COD orders are shippable regardless of payment.status (cash is collected on
// delivery, so it never reaches 'completed' beforehand); prepaid orders
// (razorpay/upi/etc.) must have payment.status === 'completed' first.
// Cancelled/delivered orders are never (re-)shippable.
// Returns { ok: boolean, reason?: string }
function isOrderShippable(order) {
  if (order.status === 'cancelled') return { ok: false, reason: 'Order is cancelled' };
  if (order.status === 'delivered') return { ok: false, reason: 'Order is already delivered' };
  const paid = order.payment?.method === 'cod' || order.payment?.status === 'completed';
  if (!paid) return { ok: false, reason: 'Payment not completed' };
  return { ok: true };
}

// Main entry point called after order is confirmed
// Handles: stock check → push to provider → update order tracking fields
// Returns: { pushed: bool, reason: string, result?: object }
async function autoDispatchOrder(order, DB, { requireAutoPush = true } = {}) {
  const provider = getActiveShippingProvider(DB, { requireAutoPush });
  if (!provider) {
    return { pushed: false, reason: 'no_provider', message: 'No auto-push shipping provider configured' };
  }

  const stockCheck = checkFulfillableStock(order, DB);
  if (!stockCheck.ok) {
    // Don't push to Shiprocket — mark order needs attention
    order.shippingStatus = 'awaiting_stock';
    order.shippingNote = `Out of stock: ${stockCheck.outOfStock.join(', ')}`;
    order.updatedAt = new Date().toISOString();
    return {
      pushed: false,
      reason: 'out_of_stock',
      outOfStock: stockCheck.outOfStock,
      message: `Order held — items out of stock: ${stockCheck.outOfStock.join(', ')}`,
    };
  }

  try {
    const result = await provider.createShipment(order);
    order.tracking.partner = result.provider;
    order.tracking.shipmentId = result.shipmentId;
    order.tracking.providerOrderId = result.orderId;
    if (result.awb) {
      order.tracking.awb = result.awb;
      order.tracking.trackingUrl = result.trackingUrl;
    }
    order.shippingStatus = 'dispatched';
    order.updatedAt = new Date().toISOString();
    order.tracking.history.push({
      label: `Shipment created (${result.provider})${result.awb ? ' · AWB: ' + result.awb : ''}`,
      done: true,
      time: order.updatedAt,
    });
    return { pushed: true, reason: 'success', result };
  } catch (err) {
    order.shippingStatus = 'dispatch_failed';
    order.shippingNote = err?.body?.message || err?.message || 'Shiprocket push failed';
    order.updatedAt = new Date().toISOString();
    return {
      pushed: false,
      reason: 'provider_error',
      message: order.shippingNote,
      raw: err,
    };
  }
}

// Normalizes a provider's raw trackShipment() response into one consistent shape
// so the admin UI doesn't need provider-specific rendering logic:
// { status, statusLocation, statusDateTime, scans: [{ time, location, description, instructions }] }
// Returns null if the raw response doesn't match the expected shape (e.g. no data for that AWB yet).
function normalizeTracking(providerName, raw) {
  if (providerName === 'delhivery') {
    const shipment = raw?.ShipmentData?.[0]?.Shipment;
    if (!shipment) return null;
    return {
      status: shipment.Status?.Status || null,
      statusLocation: shipment.Status?.StatusLocation || null,
      statusDateTime: shipment.Status?.StatusDateTime || null,
      scans: (shipment.Scans || []).map(s => ({
        time: s.ScanDetail?.ScanDateTime || null,
        location: s.ScanDetail?.ScannedLocation || null,
        description: s.ScanDetail?.Scan || null,
        instructions: s.ScanDetail?.Instructions || null,
      })),
    };
  }
  if (providerName === 'shiprocket') {
    const data = raw?.tracking_data;
    if (!data) return null;
    const latest = data.shipment_track?.[0];
    return {
      status: latest?.current_status || null,
      statusLocation: latest?.destination || null,
      statusDateTime: latest?.updated_time_stamp || null,
      scans: (data.shipment_track_activities || []).map(a => ({
        time: a.date || null,
        location: a.location || null,
        description: a.activity || null,
        instructions: a['sr-status-label'] || a.status || null,
      })),
    };
  }
  return null;
}

module.exports = { autoDispatchOrder, checkFulfillableStock, getActiveShippingProvider, normalizeTracking, isOrderShippable };

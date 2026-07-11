// Shipping provider factory — returns the active enabled provider or null
const { ShiprocketProvider } = require('./shiprocket');

function getActiveShippingProvider(DB) {
  const integrations = DB.settings.integrations;
  const store = DB.settings.store;
  const priority = DB.settings.shipping.courierPriority || ['shiprocket', 'delhivery', 'manualShip'];

  for (const name of priority) {
    const cfg = integrations[name];
    if (!cfg || cfg.category !== 'shipping' || !cfg.enabled || !cfg.autoPush) continue;
    if (name === 'shiprocket' && cfg.email && cfg.password) {
      return new ShiprocketProvider(cfg, store);
    }
    // Future providers: add here same pattern
  }
  return null; // no auto-push provider configured
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

// Main entry point called after order is confirmed
// Handles: stock check → push to provider → update order tracking fields
// Returns: { pushed: bool, reason: string, result?: object }
async function autoDispatchOrder(order, DB) {
  const provider = getActiveShippingProvider(DB);
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

module.exports = { autoDispatchOrder, checkFulfillableStock, getActiveShippingProvider };

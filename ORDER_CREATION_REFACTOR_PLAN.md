# Order Creation Refactor — Server-Authoritative Cart & Address

## Motivation

`POST /api/orders` currently trusts two things from the client request body that
the server already has a persisted, authoritative copy of:

1. **`items`** — the client re-assembles `[{productId, qty, size}]` from its own
   local cart state and sends it fresh on every order. But a server-side cart
   already exists (`DB.cartItems`, backing `GET/POST /api/cart`) as the source
   of truth for "what's actually in this customer's cart right now."
2. **`shippingAddress`** — the client sends 6 raw fields (`name/phone/address/
   city/state/pincode`) typed fresh (or now pre-filled client-side from the
   address book) instead of referencing a saved `DB.customerAddresses` entry
   by ID.

Price is already handled correctly — `computeOrder()` re-resolves `unitPrice`/
`gst`/`hsn` per line from `DB.products`/`DB.productVariants`, never trusting a
client-supplied price ([server.js:840-859](server.js#L840)). This refactor
extends that same "server resolves the authoritative data, client only sends a
reference" principle to items and address.

### Bug class this closes

- Stale/out-of-sync localStorage cart producing an order with different items
  than what's actually in the customer's live server-side cart.
- Browser back-button resubmission replaying an old cart snapshot.
- Any client bug in assembling the `items` array (wrong qty, wrong size,
  missing line) silently becomes a real order with no server-side check
  against the cart.
- Address typos/tampering bypassing the address book as source of truth.

---

## Current State (as of this plan)

**Request** — `POST /api/orders`, `requireCustomer`:
```js
{
  shippingAddress: { name, phone, address, city, state, pincode },
  items: [{ productId, qty, size }],
  payment: { method },
  couponCode,
  type: 'b2c' | 'b2b'
}
```

**Server flow**:
- `computeOrder({ customer, shippingAddress, items, payment, couponCode, type })`
  — validates `items` (non-empty array), resolves price/gst/hsn per line from
  DB, resolves shipping cost from `shippingAddress.countryCode`.
- `persistOrder(customer, shippingAddress, payment, calc, type)` — writes the
  order record, embedding `shippingAddress` and computed `lines` as-is.

**Cart**: separately persisted per customer in `DB.cartItems`
(`cartService.js`), used to render the cart page, but **not read** by order
creation — the client re-serializes its own cart state into the request
instead.

**Address book**: separately persisted in `DB.customerAddresses`
(`addressService.js` on the frontend), used only for the checkout page's
prefill (added in a prior change) — the actual submitted address is still the
raw form fields, not an address-book reference.

---

## Proposed Design

`POST /api/orders` becomes cart- and address-book-driven for logged-in
customers, while still allowing an explicit one-off address for cases where
the customer doesn't want to save it.

### New request shape

```js
{
  shippingAddressId: string,   // required — resolves from DB.customerAddresses
  payment: { method },
  couponCode?: string,
  type: 'b2c' | 'b2b'
}
```

`items` is **removed** from the request entirely. The server reads
`DB.cartItems.filter(c => c.customerId === req.customer.id)` as the
authoritative item list.

**No raw-`shippingAddress` fallback.** There's no such thing as guest checkout
in this system — `POST /api/orders` already requires `requireCustomer`, so
every customer placing an order already has an account and can save an
address to it first. A one-off/new address is not a different order-creation
code path; it's just "save the address, then create the order":

1. Frontend calls the existing `POST /api/customer/addresses` to save the new
   address → gets back `{ id }`.
2. Frontend calls `POST /api/orders` with that `shippingAddressId`.

This avoids duplicating address field validation (`nonEmpty`/`pincode`/
`mobile`) between two code paths — that validation already lives entirely in
the address CRUD routes. Side effect (acceptable, not a bug): every address
used at checkout becomes a saved, reusable address-book entry — same as
Amazon/Shopify.

Rules:
- `shippingAddressId` is required; 400 if missing.
- Must resolve to an address owned by `req.customer.id` (403/404 otherwise)
  — reuse the ownership-check pattern already used in the
  `PUT/DELETE /api/customer/addresses/:id` routes.
- If the resolved cart is empty, return the existing `400 No items in order`
  error (same behavior as today, just triggered by server-side cart state
  instead of a client-sent empty array).
- Order creation clears the customer's server-side cart on success (see
  "Resolved: Cart Clearing" below).

### What doesn't change

- Price/GST/HSN resolution per line — already correct, keep as-is.
- The order's `items`/`shippingAddress` fields remain full **denormalized
  snapshots** written at creation time (never a live FK) — this is the
  correct pattern already used for `items` today and must be preserved for
  `shippingAddress` too. Editing/deleting an address-book entry or a cart item
  later must never retroactively change a placed order.
- B2B order creation (`type: 'b2b'`, separate `persistOrder` call site at
  server.js:1009) follows the same change, since it shares `computeOrder`.

---

## Backend Changes (do this first)

1. **`computeOrder()`** ([server.js:828](server.js#L828))
   - Change signature to accept a resolved `items` array as before (no
     internal change needed here) — the *caller* now builds `items` from
     `DB.cartItems` instead of `req.body.items`. Keep this function's
     responsibility (price/gst/shipping calc) unchanged.

2. **New helper: `resolveShippingAddress(customer, shippingAddressId)`**
   - 400 if `shippingAddressId` is missing.
   - Look up `DB.customerAddresses.find(a => a.id === shippingAddressId && a.customerId === customer.id)`;
     404 if not found/not owned.
   - Map the address-book shape (`firstName/lastName/line1/line2/phone/...`)
     to the order's `shippingAddress` shape (`name/phone/address/city/state/
     pincode/...`) — check exactly how `persistOrder()` currently maps
     `req.body.shippingAddress` to `order.shippingAddress` and mirror those
     field names precisely.
   - No raw-object branch — see "No raw-`shippingAddress` fallback" above.

3. **New helper: `resolveCartItems(customer)`**
   - `DB.cartItems.filter(c => c.customerId === customer.id)` mapped to the
     `{ productId, qty, size }` shape `computeOrder()` expects.
   - Return 400 `No items in order` if empty (matches current behavior).

4. **`POST /api/orders`** ([server.js:977](server.js#L977)) and the B2B site
   ([server.js:1009](server.js#L1009))
   - Replace `req.body.items` → `resolveCartItems(req.customer)`.
   - Replace `req.body.shippingAddress` → `resolveShippingAddress(req.customer, req.body)`.
   - After successful order creation, clear `DB.cartItems` for this customer
     (check `cartService.js` for an existing clear function first — likely
     already exists for the "clear cart after order" UX; wire it in here if
     it isn't already server-side).

5. **Deploy-sequencing back-compat** (temporary, not a permanent design
   branch — see Rollout section) — until the frontend is updated and
   confirmed live, `POST /api/orders` must keep accepting the *old* request
   shape (`req.body.items` + `req.body.shippingAddress`) alongside the new
   one, purely so the currently-deployed old frontend doesn't break the
   moment the new backend ships. This is scaffolding to delete in a follow-up
   PR once the frontend deploy is confirmed — not the `shippingAddress`
   one-off fallback discussed and rejected above.

6. **Tests** (`src/__tests__/`) — update/add cases for:
   - Order created from server-side cart (no `items` in request).
   - `shippingAddressId` resolution — success, not-found, not-owned (403).
   - Missing `shippingAddressId` → 400.
   - Empty cart → 400.
   - Old request shape (`items` + raw `shippingAddress`) still works during
     the transition window (temporary compat, remove test when compat code
     is removed).

---

## Frontend Changes (only after backend is deployed and confirmed)

1. **`order.service.ts`** — `createOrder()` payload drops `items`, sends
   `shippingAddressId` (preferred) instead of always sending raw
   `shippingAddress` fields.

2. **`cart/page.tsx`**
   - Remove the "prefill form fields from default address" effect added
     previously — replace with an **address selector** (reuse the existing
     address-book UI patterns from `account/page.tsx`) that lets the customer
     pick a saved address (defaulting to the `isDefault` one) or enter a new
     one inline.
   - "Enter a new address" at checkout calls `POST /api/customer/addresses`
     (existing endpoint) to save it first, then uses the returned `id` as
     `shippingAddressId` — same single code path as picking an existing saved
     address, no separate one-off-address handling anywhere.
   - Stop sending `cartItems.map(...)` as `items` in the order payload — the
     cart is already persisted server-side via the existing `POST /api/cart`
     calls, so nothing changes there.

3. **`types/index.ts` / `order.service.ts` types** — update the `createOrder`
   request type to match the new shape.

4. **Manual QA**: full checkout flow (COD + Razorpay) end-to-end against the
   updated backend, plus the existing order-tracking and admin flows (they
   read `order.items`/`order.shippingAddress` off the *order* record, which is
   unchanged in shape — only how it's populated changes).

---

## Rollout Sequencing

1. Ship backend with dual support (cart/address-book **and** legacy inline
   `items`/`shippingAddress` fallback).
2. Verify in production with the *old* frontend still deployed (nothing
   should break — this is purely additive).
3. Ship frontend changes.
4. Confirm production checkout works end-to-end on the new frontend.
5. Remove the legacy fallback from the backend in a follow-up change once
   confirmed no clients still send the old shape (check request logs/audit
   log for any `items`-only requests before removing).

---

## Resolved: Cart Clearing

Confirmed by inspection — `DELETE /api/cart` ([server.js:348-353](server.js#L348))
already exists and clears `DB.cartItems` for the customer server-side. Today
it's only triggered by the **frontend** calling `clearCart()` *after* order
creation succeeds ([cart/page.tsx:183](../backen_front_ajay/frontend/src/app/(marketing)/cart/page.tsx#L183)),
not atomically as part of `POST /api/orders`. This is a real gap this
refactor should close: if the client crashes/loses connection after the order
is created but before the follow-up `clearCart()` call fires, the cart is
left stale with items that were already ordered.

**Action**: `POST /api/orders` should clear `DB.cartItems` for the customer
itself, in the same handler, right after `persistOrder()` succeeds (reuse the
exact filter used by the existing `DELETE /api/cart` route). The frontend's
separate `clearCart()` call becomes redundant and should be removed as part
of the frontend changes (or left as a harmless no-op double-clear if simpler
not to touch that code path immediately).

## Open Questions (confirm before implementing)

- B2B checkout — confirm it goes through the same cart/address-book flow, or
  if B2B has its own separate cart/address handling that needs a matching (but
  possibly distinct) change.
- `src/services/cartService.js` has an unused `CartService.clearCart()` —
  confirm it (and the rest of `src/services/*.js` / `src/routes/*.js`, which
  appear to be dead scaffolding not wired into `server.js`) is out of scope
  for this refactor and can be ignored/left as-is.

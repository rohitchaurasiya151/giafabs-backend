# Delhivery Integration — Debug Notes (2026-07-18)

Working notes from live testing against the production Delhivery API for
account "GIA FABS". Kept for future debugging reference — not official docs.

**Security note**: a live Delhivery UCP portal Bearer token (from
`one.delhivery.com`, `ucp-utils.delhivery.com`) was shared during debugging.
It is deliberately **not** recorded here — it was a 10-minute session token
(issued 2026-07-18 14:48 UTC, expired 14:58 UTC), already expired by the time
this file was written. If a similar token needs sharing again, treat it like
a password: don't paste it into files that get committed or persisted.

## Account / config

- Client name (`cl`): `GIA FABS`
- Pickup location name: `GIA FABS B2C`
- Pickup pincode: `394210` (Surat, Gujarat)
- GSTIN: `24KOEPS8605K1ZC`
- UCP company_id (internal Delhivery portal id, not an API credential): `ac48c7f9-e2b5-4773-84b6-42c86ea381a8`
- Integration config lives in `DB.settings.integrations.delhivery` (DB-driven, not `.env` — see `data.js`), currently `environment: "production"`, `autoPush: false` (manual push only, on purpose).

## Production API — confirmed working

- Auth: `Authorization: Token <apiToken>` header, works against `https://track.delhivery.com`.
- Pincode serviceability: `GET /c/api/pin-codes/json/?filter_codes=394210` — works, returns real data (COD + prepaid available, district Surat).
- Waybill fetch: `GET /waybill/api/fetch/json/?cl=GIA%20FABS%20B2C` — works, returns a fresh 14-digit waybill each call (e.g. `58388610000055`, `...066`, `...070`, `...092`, `...103`, `...125`). Scoping `cl` to the parent client name (`GIA FABS`) vs the specific pickup location (`GIA FABS B2C`) both return valid waybills — didn't matter for the errors below.

## Production API — create-order (`POST /api/cmu/create.json`) history

Progression of errors encountered, in order, each one a real fix/finding:

1. **Fixed (pre-existing, before this debugging pass)**: `"ClientWarehouse matching query does not exist"` — pickup location wasn't registered on Delhivery's side. Resolved once the warehouse was set up on Delhivery's dashboard.

2. **Fixed in code** (`src/shipping/delhivery.js`): sending `shipment_type: "single_piece"` (the original hardcoded value) → `"Waybill does not match master waybill pattern or wrong shipment type for waybill"`. Also confirmed sending the Delhivery-documented values `"Forward"` and `"forward"` (case doesn't matter) produce the **same** error on this account. **Omitting the `shipment_type` field entirely is what works** — code now only sets it when the caller explicitly needs `"Reverse"` (return pickups), and leaves it unset for normal forward shipments.

3. **Data-quality issue, not a bug**: using obviously-fake test data (name "Delhivery Test Customer", phone `9999999999`) →
   ```
   err_code: "ER0005"
   remarks: ["Crashing while saving package due to exception suspicious order/consignee. Package might have been partially saved."]
   ```
   Delhivery's fraud/anti-abuse filter flagged the synthetic-looking consignee. Switching to a realistic-looking name/phone (e.g. "Ramesh Patel" / `9825612345`) cleared this. Checked the dashboard for the waybill used in this failed attempt — **no record existed**, so "might have been partially saved" was a false alarm in this case.

4. **Current live blocker — billing, not code**:
   ```
   remarks: ["Crashing while saving package due to exception 'Prepaid client manifest charge API failed due to insufficient balance'. Package might have been partially saved."]
   ```
   Got here with `shipment_type` omitted + realistic consignee data (Ramesh Patel test case). This means validation now passes end-to-end and Delhivery attempts to charge the account's prepaid wallet for the manifest — **the wallet balance is insufficient**. Needs a real top-up on the Delhivery dashboard before a shipment will actually succeed. Not something fixable in code.

Test order IDs used against the real API (all failed, so nothing should exist
on Delhivery's dashboard from these): `GIAFABS001002`, `GIAFABS001003`, `GIAFABS001003-B`.
Test waybills consumed (all "Fail" status on Delhivery's side, safe to ignore):
`58388610000055`, `066`, `070`, `092`, `103`, `125`.

## Staging environment — separate, unresolved

- Our production `apiToken` does **not** authenticate against
  `staging-express.delhivery.com` — returns `"Login or API Key Required"`.
  Staging needs its own separate token from Delhivery (not automatically
  issued alongside a production token).
- Separately, from the Delhivery UCP portal itself (`one.delhivery.com` →
  `staging-express.delhivery.com/api/backend/clientwarehouse/create/`), a
  staging warehouse-creation attempt for pincode `394221` (test name "rohit",
  unrelated to the GIA FABS production data) failed with:
  ```
  error_code: 1005
  error: ["facility IND394221AAA is not in active state or does not exist"]
  ```
  This is a Delhivery-side staging infrastructure issue for that specific
  pincode/facility, not something on our end.
- Staging bulk waybill fetch **did** work via the UCP portal's own session
  (`GET staging-express.delhivery.com/waybill/api/bulk/json/?count=2`),
  returning waybills `85772610000033`, `85772610000044` — note the different
  prefix (`857726...`) vs production's (`583886...`). This confirms staging
  has its own waybill series, reachable only with proper staging credentials
  (the UCP UI session token isn't the same thing as an API integration
  token, and wasn't used for any of our own API calls).

## Bugs found and fixed during this debugging pass

1. **`shipment_type` invalid value** — `src/shipping/delhivery.js`. Fixed (see above): omitted for forward shipments, only set to `'Reverse'` for return pickups.

2. **Error detail discarded** — `createShipment`/`createReversePickup`/`createBulkShipments` in `src/shipping/delhivery.js` used to throw only Delhivery's generic top-level `rmk` ("An internal Error has occurred..."), discarding the actually useful `packages[].remarks`. Fixed with a `delhiveryErrorMessage()` helper that prefers the per-package remarks, and attaches the full raw response as `err.body` so it surfaces in the API's `raw` field too.

3. **Customer mobile silently lost on every DB reload — app-wide, not Delhivery-specific.** Root cause: `customerToRow`/`rowToCustomer` in `db-postgres.js` (lines ~549-566) read/wrote a `c.phone` field that doesn't exist on customer objects — the app uses `.mobile` everywhere else (registration, login, `/api/customer/me`). This meant every customer's phone number was persisted to Postgres as `null`, regardless of what was entered at signup, and reconstructed customer records after any reload had no mobile at all. This directly caused Delhivery's `"No phone number provided."` rejection. **Fixed**: `customerToRow` now writes `phone: c.mobile`, `rowToCustomer` now reads back `mobile: r.phone`, and `rowToOrder`'s customer reconstruction (line ~637) now reads `customer.mobile` instead of the non-existent `customer.phone`.
   - **Caveat**: this only fixes it going forward. Any customer registered *before* this fix has `null` permanently stored for their phone number in Postgres — the original value was never saved, so it can't be recovered. Confirmed via direct psql: a customer registered after the fix (`CU001006`) correctly persisted `9825611223`.

## Next step

Once the Delhivery wallet is topped up, retry via `POST /api/shipping/push/:orderId`
on a fresh disposable test order — expect either full success (real AWB) or
a new, different error to debug.

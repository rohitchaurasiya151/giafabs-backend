# GIAFABS Backend API Documentation

Complete API reference for the GIAFABS enterprise handloom e-commerce backend.

## Table of Contents
1. [Product Endpoints](#product-endpoints)
2. [Cart Endpoints](#cart-endpoints)
3. [Inventory Endpoints](#inventory-endpoints)
4. [Error Handling](#error-handling)
5. [Authentication](#authentication)

---

## Product Endpoints

### GET /api/products/:id
Retrieve product with all variants and pricing.

**URL Parameters:**
- `id` (string, required) - Product ID

**Response:**
```json
{
  "id": "prod-1",
  "name": "Silk Saree",
  "brand": "GIAFABS",
  "category": "Ethnic",
  "description": "Premium silk saree",
  "variants": [
    {
      "id": "var-1",
      "sku": "SILK-001-M",
      "size": "M",
      "pricing": {
        "mrp": 6999,
        "selling_price": 5999,
        "discount_pct": 14,
        "gst_rate": 5
      },
      "inventory": {
        "available_qty": 50,
        "on_hand_qty": 60,
        "reserved_qty": 5,
        "order_held_qty": 5
      }
    }
  ]
}
```

**Status Codes:**
- `200` - Success
- `404` - Product not found

---

### GET /api/variants/:id
Retrieve variant details with costs (admin only).

**URL Parameters:**
- `id` (string, required) - Variant ID

**Headers:**
```
Authorization: Bearer <token>
```

**Response:**
```json
{
  "id": "var-1",
  "sku": "SILK-001-M",
  "product_id": "prod-1",
  "size": "M",
  "pricing": {
    "mrp": 6999,
    "selling_price": 5999,
    "b2b_price": 5399
  },
  "costs": {
    "material_cost": 2500,
    "labor_cost": 800,
    "packaging_cost": 150,
    "overhead_cost": 500,
    "total_cost": 3950
  },
  "margin": {
    "margin_value": 2049,
    "margin_pct": 34.1
  }
}
```

---

### POST /api/variants/:id/pricing
Update variant pricing with audit trail.

**URL Parameters:**
- `id` (string, required) - Variant ID

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "mrp": 6999,
  "selling_price": 5999,
  "b2b_price": 5399,
  "discount_pct": 14,
  "gst_rate": 5
}
```

**Validation Rules:**
- `selling_price` must be ≤ `mrp`
- `b2b_price` must be ≤ `selling_price`
- `discount_pct` must be ≤ 40%

**Response:**
```json
{
  "id": "price-1",
  "variant_id": "var-1",
  "mrp": 6999,
  "selling_price": 5999,
  "created_by": "admin-1",
  "created_at": "2024-01-15T10:30:00Z"
}
```

**Status Codes:**
- `200` - Success
- `400` - Validation failed
- `401` - Unauthorized
- `404` - Variant not found

---

### POST /api/variants/:id/costs
Update variant costs (COGS) with margin validation.

**URL Parameters:**
- `id` (string, required) - Variant ID

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "material_cost": 2500,
  "labor_cost": 800,
  "packaging_cost": 150,
  "overhead_cost": 500
}
```

**Validation Rules:**
- Total COGS = material + labor + packaging + overhead
- Margin % = (selling_price - COGS) / selling_price * 100
- Margin must be ≥ 20%

**Response:**
```json
{
  "id": "cost-1",
  "variant_id": "var-1",
  "material_cost": 2500,
  "labor_cost": 800,
  "packaging_cost": 150,
  "overhead_cost": 500,
  "total_cost": 3950,
  "margin_pct": 34.1,
  "created_at": "2024-01-15T10:30:00Z"
}
```

---

### GET /api/variants/:id/pricing/history
Retrieve pricing change history.

**URL Parameters:**
- `id` (string, required) - Variant ID
- `limit` (integer, optional) - Max records (default: 10)

**Response:**
```json
[
  {
    "mrp": 6999,
    "selling_price": 5999,
    "discount_pct": 14,
    "created_by": "admin-1",
    "created_at": "2024-01-15T10:30:00Z"
  },
  {
    "mrp": 7999,
    "selling_price": 6999,
    "discount_pct": 12,
    "created_by": "admin-1",
    "created_at": "2024-01-14T15:20:00Z"
  }
]
```

---

## Cart Endpoints

### GET /api/cart
Retrieve customer's shopping cart.

**Headers:**
```
Authorization: Bearer <token>
```

**Response:**
```json
[
  {
    "product_id": "prod-1",
    "variant_id": "var-1",
    "size": "M",
    "qty": 1,
    "selling_price": 5999,
    "mrp": 6999,
    "discount_pct": 14,
    "gst_rate": 5,
    "added_at": "2024-01-15T10:30:00Z"
  }
]
```

---

### POST /api/cart/add
Add item to cart with automatic stock reservation.

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "productId": "prod-1",
  "variantId": "var-1",
  "size": "M",
  "qty": 1
}
```

**Validation:**
- `qty` must be between 1 and 100
- Stock must be available
- Variant must exist

**Response:**
```json
{
  "success": true,
  "cartItem": {
    "product_id": "prod-1",
    "size": "M",
    "qty": 1,
    "selling_price": 5999
  },
  "reservation": {
    "expires_at": "2024-01-15T11:00:00Z"
  }
}
```

**Status Codes:**
- `200` - Success
- `400` - Invalid quantity or out of stock
- `404` - Product not found
- `409` - Stock conflict

---

### PUT /api/cart/update
Update quantity of cart item.

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "productId": "prod-1",
  "size": "M",
  "qty": 2
}
```

**Response:**
```json
{
  "success": true,
  "cartItem": {
    "product_id": "prod-1",
    "size": "M",
    "qty": 2,
    "selling_price": 5999
  }
}
```

---

### DELETE /api/cart/item
Remove item from cart and release stock reservation.

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "productId": "prod-1",
  "size": "M"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Item removed from cart"
}
```

---

### DELETE /api/cart
Clear entire cart and release all reservations.

**Headers:**
```
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "message": "Cart cleared"
}
```

---

## Inventory Endpoints

### GET /api/inventory/availability
Check stock availability for a variant.

**Query Parameters:**
- `variantId` (string, required) - Variant ID
- `qty` (integer, optional) - Quantity to check (default: 1)

**Response:**
```json
{
  "variant_id": "var-1",
  "sku": "SILK-001-M",
  "available_qty": 50,
  "on_hand_qty": 60,
  "reserved_qty": 5,
  "order_held_qty": 5,
  "damaged_qty": 0,
  "reorder_level": 10,
  "is_available": true
}
```

---

### POST /api/inventory/restock
Record stock inbound (purchase order fulfillment).

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "variantId": "var-1",
  "qty": 100,
  "refId": "PO-123456",
  "notes": "Stock received from supplier"
}
```

**Response:**
```json
{
  "id": "mov-1",
  "variant_id": "var-1",
  "movement_type": "stock_in",
  "qty": 100,
  "new_on_hand": 160,
  "created_by": "admin-1",
  "created_at": "2024-01-15T10:30:00Z"
}
```

---

### POST /api/inventory/adjust
Adjust inventory for reconciliation, shrinkage, or damage.

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "variantId": "var-1",
  "qty": -5,
  "reason": "shrinkage",
  "notes": "Monthly inventory reconciliation"
}
```

**Valid Reasons:**
- `shrinkage` - Natural shrinkage/loss
- `damage` - Inventory damage
- `correction` - Reconciliation correction
- `sample` - Given as sample

**Response:**
```json
{
  "id": "mov-1",
  "variant_id": "var-1",
  "movement_type": "adjustment",
  "qty": -5,
  "reason": "shrinkage",
  "new_on_hand": 55,
  "created_at": "2024-01-15T10:30:00Z"
}
```

---

### GET /api/inventory/movements/:variantId
Retrieve inventory movement history.

**URL Parameters:**
- `variantId` (string, required) - Variant ID
- `limit` (integer, optional) - Max records (default: 50)

**Response:**
```json
[
  {
    "id": "mov-3",
    "movement_type": "order_fulfillment",
    "qty": -5,
    "order_id": "order-1",
    "created_by": "admin-1",
    "created_at": "2024-01-15T12:00:00Z"
  },
  {
    "id": "mov-2",
    "movement_type": "adjustment",
    "qty": -5,
    "reason": "shrinkage",
    "created_at": "2024-01-15T11:00:00Z"
  },
  {
    "id": "mov-1",
    "movement_type": "stock_in",
    "qty": 100,
    "ref_id": "PO-123",
    "created_at": "2024-01-15T10:30:00Z"
  }
]
```

---

### GET /api/inventory/low-stock
Get variants below reorder level.

**Query Parameters:**
- `limit` (integer, optional) - Max records (default: 20)

**Response:**
```json
[
  {
    "variant_id": "var-2",
    "sku": "SILK-001-L",
    "product_name": "Silk Saree",
    "size": "L",
    "available_qty": 3,
    "reorder_level": 10,
    "shortage": 7
  }
]
```

---

### POST /api/inventory/cleanup
Cleanup expired cart reservations (admin only).

**Headers:**
```
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "cleaned": 5,
  "message": "5 expired reservations cleaned up"
}
```

---

### POST /api/inventory/validate
Validate inventory consistency.

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "variantId": "var-1"
}
```

**Response:**
```json
{
  "variant_id": "var-1",
  "isConsistent": true,
  "on_hand_qty": 60,
  "reserved_qty": 5,
  "order_held_qty": 5,
  "damaged_qty": 0,
  "expected_available": 50,
  "calculated_available": 50
}
```

---

## Error Handling

### Standard Error Response

All errors return with appropriate HTTP status codes and this format:

```json
{
  "error": "OUT_OF_STOCK",
  "message": "Insufficient stock available",
  "available": 5,
  "requested": 10
}
```

### Common Error Codes

| Code | Status | Description |
|------|--------|-------------|
| `OUT_OF_STOCK` | 400 | Insufficient inventory |
| `INVALID_QUANTITY` | 400 | Qty must be 1-100 |
| `PRICING_VALIDATION_FAILED` | 400 | Pricing rules violated |
| `MARGIN_TOO_LOW` | 400 | Margin < 20% |
| `VARIANT_NOT_FOUND` | 404 | Variant doesn't exist |
| `PRODUCT_NOT_FOUND` | 404 | Product doesn't exist |
| `NOT_AUTHORIZED` | 401 | Missing/invalid auth |
| `CONFLICT` | 409 | Data conflict (duplicate) |
| `INTERNAL_SERVER_ERROR` | 500 | Server error |

---

## Authentication

All protected endpoints require Bearer token in header:

```
Authorization: Bearer <jwt_token>
```

Tokens expire after 24 hours. Refresh tokens are supported.

---

## Rate Limiting

- Standard: 100 requests/minute
- Admin: 500 requests/minute
- Burst: 20 requests/second

---

## API Health Check

```
GET /health
```

**Response:**
```json
{
  "status": "healthy",
  "database": "connected",
  "redis": "connected",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

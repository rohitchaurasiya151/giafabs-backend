# Testing Guide - GIAFABS Backend

Complete guide to running tests and validating the backend.

## Table of Contents
1. [Unit Tests](#unit-tests)
2. [Integration Tests](#integration-tests)
3. [Load Testing](#load-testing)
4. [Test Coverage](#test-coverage)
5. [Continuous Integration](#continuous-integration)
6. [Manual Testing](#manual-testing)

---

## Unit Tests

### Running Unit Tests

```bash
# Install dependencies
cd backend
npm install

# Run all unit tests
npm test

# Run specific test file
npm test cartService.test.js

# Watch mode (re-run on file change)
npm run test:watch

# Run with coverage
npm test -- --coverage
```

### Test Files

**Service Layer Tests:**
- `src/__tests__/cartService.test.js` - Shopping cart operations
- `src/__tests__/inventoryService.test.js` - Stock management
- `src/__tests__/variantService.test.js` - Product variant management

**Controller Tests:**
- `src/__tests__/controllers.test.js` - HTTP request handlers
  - ProductController
  - CartController
  - InventoryController

### Expected Coverage

```
Statements   : 70%
Branches     : 70%
Functions    : 70%
Lines        : 70%
```

Current coverage will be reported after test run.

---

## Integration Tests

### Running Integration Tests

```bash
# Run integration tests
npm run test:integration

# Run both unit and integration
npm test

# Run specific integration test
npm test integration.test.js
```

### Test Scenarios

Integration tests cover end-to-end workflows:

1. **Add to Cart Workflow**
   - Check availability
   - Add item to cart
   - Verify stock reservation
   - Prevent overselling

2. **Cart to Checkout**
   - Calculate totals with tax
   - Apply discounts
   - Calculate shipping
   - Free shipping threshold

3. **Order Fulfillment**
   - Convert cart reservation to order hold
   - Record fulfillment
   - Deduct from inventory
   - Maintain audit trail

4. **Pricing Management**
   - Update pricing with validation
   - Enforce margin minimums
   - Track pricing history
   - Validate discounts

5. **Inventory Consistency**
   - Calculate available quantity
   - Detect discrepancies
   - Validate formulas
   - Report issues

6. **Cleanup Operations**
   - Cleanup expired reservations
   - Release stock
   - Generate reports

---

## Load Testing

### Setup

Load testing requires the backend running:

```bash
# Terminal 1: Start backend
npm start

# Terminal 2: Run load test
npm run load-test
```

### Configuration

Edit `src/__tests__/load-test.js` to customize:

```javascript
scenarios: [
  {
    name: 'Get Product',
    method: 'GET',
    path: '/api/products/prod-1',
    duration: 10,        // seconds
    concurrency: 50      // concurrent requests
  }
]
```

### Interpreting Results

```
📊 Load Test Results

✅ Results for: Get Product
   Total Requests: 5000
   Successful: 4950 (99.00%)
   Failed: 50
   Requests/sec: 500
   Response Times:
     - Min: 10ms
     - Avg: 45ms
     - p95: 120ms
     - p99: 250ms
     - Max: 500ms
```

**Key Metrics:**
- **RPS (Requests/sec)** - How many requests/second
- **p95** - 95% of requests respond within this time
- **p99** - 99% of requests respond within this time
- **Success Rate** - Should be > 99%

### Performance Targets

| Endpoint | p95 | p99 | RPS |
|----------|-----|-----|-----|
| GET /api/products/:id | < 50ms | < 100ms | > 500 |
| GET /api/inventory/availability | < 30ms | < 80ms | > 1000 |
| POST /api/cart/add | < 100ms | < 200ms | > 200 |
| GET /api/cart | < 50ms | < 100ms | > 500 |

---

## Test Coverage

### Checking Coverage

```bash
npm test -- --coverage --coverageReporters=text

# Generate HTML coverage report
npm test -- --coverage --coverageReporters=html

# View HTML report
open coverage/index.html
```

### Coverage Report Example

```
======================== Coverage Summary ========================
Statements   : 82.5% ( 330/400 )
Branches     : 78.3% ( 112/143 )
Functions    : 85.0% ( 51/60 )
Lines        : 82.1% ( 328/400 )
=====================================================================
```

### Improving Coverage

1. Add tests for new functions
2. Cover error cases
3. Test edge conditions
4. Verify error handling
5. Test boundary values

---

## Continuous Integration

### GitHub Actions

Tests run automatically on:
- Push to main/develop
- Pull requests

### View CI Status

```bash
# Show CI workflow status
gh run list

# View specific run
gh run view <run-id>

# Stream output
gh run watch <run-id>
```

### Local CI Simulation

```bash
# Install act (local GitHub Actions runner)
brew install act

# Run workflows locally
act push
act pull_request
```

---

## Manual Testing

### Setup Test Database

```bash
# Start PostgreSQL with Docker
docker-compose up -d postgres

# Run migrations
npm run migrate

# Seed test data
npm run seed
```

### Test with cURL

#### Get Product
```bash
curl http://localhost:3000/api/products/prod-1
```

#### Check Availability
```bash
curl "http://localhost:3000/api/inventory/availability?variantId=var-1&qty=5"
```

#### Add to Cart
```bash
curl -X POST http://localhost:3000/api/cart/add \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "productId": "prod-1",
    "variantId": "var-1",
    "size": "M",
    "qty": 1
  }'
```

#### Get Cart
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:3000/api/cart
```

### Test with Postman

1. Import collection: `GIAFABS.postman_collection.json`
2. Set environment variables in Postman
3. Run requests manually or as collection

### Debugging Tests

```bash
# Run with debugging output
DEBUG=* npm test

# Run single test with breakpoint
node --inspect-brk node_modules/.bin/jest cartService.test.js

# Connect to chrome://inspect in Chrome
```

---

## Test Data

### Sample Variants

```sql
-- Product
INSERT INTO products VALUES ('prod-1', 'Silk Saree', 'GIAFABS', 'Ethnic');

-- Sizes
INSERT INTO product_sizes VALUES ('size-1', 'M'), ('size-2', 'L');

-- Variants
INSERT INTO product_variants VALUES 
  ('var-1', 'prod-1', 'SILK-001-M', 'size-1'),
  ('var-2', 'prod-1', 'SILK-001-L', 'size-2');

-- Pricing
INSERT INTO variant_pricing VALUES
  (gen_random_uuid(), 'var-1', 6999, 5999, 5399, 14, 5);

-- Inventory
INSERT INTO variant_inventory VALUES
  ('var-1', 100, 0, 0, 0);
```

---

## Troubleshooting

### Tests Fail with "Cannot find module"

```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

### Database Connection Errors

```bash
# Check database is running
docker ps

# View database logs
docker logs giafabs-postgres
```

### Port Already in Use

```bash
# Find process using port 3000
lsof -i :3000

# Kill process
kill -9 <PID>
```

### Tests Timeout

Increase Jest timeout:
```javascript
jest.setTimeout(30000); // 30 seconds
```

---

## Best Practices

1. **Write tests early** - TDD approach
2. **Keep tests simple** - One assertion per test
3. **Mock external dependencies** - Database, HTTP calls
4. **Use descriptive names** - Clear test purpose
5. **Test edge cases** - Boundaries, errors
6. **Maintain high coverage** - Aim for > 80%
7. **Run tests locally** - Before committing
8. **Review test output** - Understand failures

---

## Additional Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Supertest Guide](https://github.com/visionmedia/supertest)
- [Jest Mock Functions](https://jestjs.io/docs/mock-functions)
- [Testing Best Practices](https://testingjavascript.com/)

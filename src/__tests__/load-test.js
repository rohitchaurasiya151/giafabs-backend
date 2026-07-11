/**
 * Load Testing Script
 * Performance testing for GIAFABS API endpoints
 * Usage: node src/__tests__/load-test.js
 */

const http = require('http');

const config = {
  host: 'localhost',
  port: 3000,
  // Test scenarios
  scenarios: [
    {
      name: 'Get Product',
      method: 'GET',
      path: '/api/products/prod-1',
      duration: 10, // seconds
      concurrency: 50
    },
    {
      name: 'Check Availability',
      method: 'GET',
      path: '/api/inventory/availability?variantId=var-1&qty=1',
      duration: 10,
      concurrency: 100
    },
    {
      name: 'Get Cart',
      method: 'GET',
      path: '/api/cart',
      duration: 10,
      concurrency: 50,
      headers: {
        'Authorization': 'Bearer test-token'
      }
    },
    {
      name: 'Add to Cart',
      method: 'POST',
      path: '/api/cart/add',
      duration: 10,
      concurrency: 50,
      body: {
        productId: 'prod-1',
        variantId: 'var-1',
        size: 'M',
        qty: 1
      },
      headers: {
        'Authorization': 'Bearer test-token',
        'Content-Type': 'application/json'
      }
    }
  ]
};

class LoadTester {
  constructor(config) {
    this.config = config;
    this.results = [];
  }

  makeRequest(options) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();

      const req = http.request(options, (res) => {
        let data = '';

        res.on('data', chunk => {
          data += chunk;
        });

        res.on('end', () => {
          const endTime = Date.now();
          resolve({
            statusCode: res.statusCode,
            duration: endTime - startTime,
            size: data.length
          });
        });
      });

      req.on('error', reject);

      if (options.body) {
        req.write(JSON.stringify(options.body));
      }

      req.end();
    });
  }

  async runScenario(scenario) {
    console.log(`\n📊 Running: ${scenario.name}`);
    console.log(`   Concurrency: ${scenario.concurrency} | Duration: ${scenario.duration}s`);

    const results = {
      name: scenario.name,
      requests: 0,
      success: 0,
      errors: 0,
      durations: [],
      statusCodes: {}
    };

    const endTime = Date.now() + (scenario.duration * 1000);
    const promises = [];

    while (Date.now() < endTime) {
      // Keep concurrency at the specified level
      while (promises.length < scenario.concurrency && Date.now() < endTime) {
        const options = {
          hostname: this.config.host,
          port: this.config.port,
          path: scenario.path,
          method: scenario.method,
          headers: scenario.headers || {}
        };

        if (scenario.body) {
          options.body = scenario.body;
        }

        promises.push(
          this.makeRequest(options)
            .then(result => {
              results.requests++;
              results.durations.push(result.duration);

              const code = result.statusCode;
              results.statusCodes[code] = (results.statusCodes[code] || 0) + 1;

              if (code >= 200 && code < 300) {
                results.success++;
              } else {
                results.errors++;
              }
            })
            .catch(err => {
              results.requests++;
              results.errors++;
              console.error(`   Error: ${err.message}`);
            })
        );
      }

      // Wait for some to complete
      if (promises.length >= scenario.concurrency) {
        await Promise.race(promises);
        promises.splice(0, promises.length);
      }
    }

    // Wait for remaining
    if (promises.length > 0) {
      await Promise.all(promises);
    }

    return results;
  }

  calculateStats(durations) {
    if (durations.length === 0) return {};

    const sorted = durations.sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);

    return {
      min: Math.min(...sorted),
      max: Math.max(...sorted),
      avg: Math.round(sum / sorted.length),
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)]
    };
  }

  printResults(result) {
    const stats = this.calculateStats(result.durations);
    const successRate = ((result.success / result.requests) * 100).toFixed(2);
    const rps = (result.requests / config.scenarios[0].duration).toFixed(2);

    console.log(`\n✅ Results for: ${result.name}`);
    console.log(`   Total Requests: ${result.requests}`);
    console.log(`   Successful: ${result.success} (${successRate}%)`);
    console.log(`   Failed: ${result.errors}`);
    console.log(`   Requests/sec: ${rps}`);
    console.log(`   Response Times:`);
    console.log(`     - Min: ${stats.min}ms`);
    console.log(`     - Avg: ${stats.avg}ms`);
    console.log(`     - p95: ${stats.p95}ms`);
    console.log(`     - p99: ${stats.p99}ms`);
    console.log(`     - Max: ${stats.max}ms`);
    console.log(`   Status Codes:`, result.statusCodes);
  }

  async run() {
    console.log('🚀 GIAFABS Load Test');
    console.log(`🎯 Target: http://${this.config.host}:${this.config.port}`);

    for (const scenario of this.config.scenarios) {
      const result = await this.runScenario(scenario);
      this.results.push(result);
      this.printResults(result);
    }

    console.log('\n📈 Load Test Complete');
  }
}

// Run if executed directly
if (require.main === module) {
  const tester = new LoadTester(config);
  tester.run().catch(err => {
    console.error('Load test failed:', err);
    process.exit(1);
  });
}

module.exports = LoadTester;

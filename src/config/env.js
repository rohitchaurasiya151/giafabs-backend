/**
 * Environment file loader.
 * Resolves NODE_ENV, then loads the matching .env.{env} file — without ever
 * overriding a variable the process (or the hosting platform) already set.
 */

const path = require('path');
const dotenv = require('dotenv');

const NODE_ENV = process.env.NODE_ENV || 'development';
const ROOT = path.resolve(__dirname, '..', '..');

// Production gets its vars from the hosting platform (Render, Railway, AWS,
// Docker, Kubernetes...) — never from a local file, even if one exists, so
// a stray blank placeholder in .env.production can never shadow a real var.
if (NODE_ENV !== 'production') {
  // Order matters: later files never override vars already set by an
  // earlier one or by the real process environment (`override: false`).
  const candidates = [
    path.join(ROOT, `.env.${NODE_ENV}`),
    path.join(ROOT, '.env'),
  ];

  for (const file of candidates) {
    dotenv.config({ path: file, override: false, quiet: true });
  }
}

module.exports = { NODE_ENV };

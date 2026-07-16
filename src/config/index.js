/**
 * Central configuration object. Every other module reads config from here —
 * nothing outside this folder should touch `process.env` directly.
 */

const { NODE_ENV } = require('./env');
const { validateEnv } = require('./validation');

const env = validateEnv();

const defaultLogLevelByEnv = {
  development: 'debug',
  test: 'error',
  staging: 'info',
  production: 'error',
};

const config = Object.freeze({
  app: Object.freeze({
    env: NODE_ENV,
    isDevelopment: NODE_ENV === 'development',
    isStaging: NODE_ENV === 'staging',
    isProduction: NODE_ENV === 'production',
    isTest: NODE_ENV === 'test',
    url: env.CORS_ORIGIN !== '*' ? env.CORS_ORIGIN : `http://localhost:${env.PORT}`,
  }),

  server: Object.freeze({
    port: env.PORT,
    corsOrigin: env.CORS_ORIGIN,
  }),

  database: Object.freeze({
    url: env.DATABASE_URL,
    host: env.PGHOST,
    port: env.PGPORT,
    user: env.PGUSER,
    password: env.PGPASSWORD,
    database: env.PGDATABASE,
  }),

  auth: Object.freeze({
    jwtSecret: env.JWT_SECRET,
    jwtExpire: env.JWT_EXPIRE,
  }),

  externalApis: Object.freeze({
    cloudinary: Object.freeze({
      cloudName: env.CLOUDINARY_CLOUD_NAME,
      apiKey: env.CLOUDINARY_API_KEY,
      apiSecret: env.CLOUDINARY_API_SECRET,
    }),
    razorpay: Object.freeze({
      keyId: env.RAZORPAY_KEY_ID,
      keySecret: env.RAZORPAY_KEY_SECRET,
      webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
    }),
  }),

  storage: Object.freeze({
    allowedMimeTypes: env.ALLOWED_MIME_TYPES.split(','),
    maxFileSize: env.MAX_FILE_SIZE,
    maxFilesPerProduct: env.MAX_FILES_PER_PRODUCT,
    minImageWidth: env.MIN_IMAGE_WIDTH,
    minImageHeight: env.MIN_IMAGE_HEIGHT,
    thumbnailWidth: env.THUMBNAIL_WIDTH,
    thumbnailHeight: env.THUMBNAIL_HEIGHT,
    mobileWidth: env.MOBILE_WIDTH,
  }),

  logging: Object.freeze({
    level: env.LOG_LEVEL || defaultLogLevelByEnv[NODE_ENV] || 'info',
  }),

  featureFlags: Object.freeze({
    enableCache: env.ENABLE_CACHE,
    enableAnalytics: env.ENABLE_ANALYTICS,
    enableNewUi: env.ENABLE_NEW_UI,
  }),

  admin: Object.freeze({
    email: env.ADMIN_EMAIL,
    initialPassword: env.ADMIN_INITIAL_PASSWORD,
  }),
});

module.exports = config;

/**
 * Env schema — the single source of truth for what variables exist, their
 * types/defaults, and which ones are only allowed to fall back to a
 * dev-only default (staging/production must set the real value or the
 * app refuses to start).
 */

const { z } = require('zod');
const { NODE_ENV } = require('./env');

// Staging and production must use real, explicitly-configured secrets —
// only `development`/`test` may fall back to the labeled dev defaults below.
const requireRealSecrets = NODE_ENV === 'staging' || NODE_ENV === 'production';

const boolFromString = (fallback) =>
  z.preprocess((v) => {
    if (v === undefined || v === '') return fallback;
    return v === 'true' || v === '1';
  }, z.boolean());

const secretField = (devDefault, opts = {}) =>
  requireRealSecrets
    ? z.string().min(opts.minLength || 1, opts.message)
    : z.string().default(devDefault);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  CORS_ORIGIN: z.string().default('*'),

  DATABASE_URL: z.string().optional(),
  PGHOST: z.string().default('localhost'),
  PGPORT: z.coerce.number().int().positive().default(5432),
  PGUSER: z.string().default('postgres'),
  // PGPASSWORD's staging/production requirement is enforced conditionally
  // below (only when DATABASE_URL isn't set) — hosting platforms like
  // Render/Railway inject a single DATABASE_URL for managed Postgres rather
  // than discrete PG* vars, so this field can't unconditionally require a
  // real value the way the other secretField()s do.
  PGPASSWORD: z.string().default(requireRealSecrets ? '' : 'postgres'),
  PGDATABASE: z.string().default('giafabs_db'),

  JWT_SECRET: secretField('dev-insecure-secret-change-me', {
    minLength: 16,
    message: 'JWT_SECRET is required in staging/production and must be at least 16 characters',
  }),
  JWT_EXPIRE: z.string().default('7d'),

  CLOUDINARY_CLOUD_NAME: secretField('', { message: 'CLOUDINARY_CLOUD_NAME is required in staging/production' }),
  CLOUDINARY_API_KEY: secretField('', { message: 'CLOUDINARY_API_KEY is required in staging/production' }),
  CLOUDINARY_API_SECRET: secretField('', { message: 'CLOUDINARY_API_SECRET is required in staging/production' }),

  RAZORPAY_KEY_ID: secretField('', { message: 'RAZORPAY_KEY_ID is required in staging/production' }),
  RAZORPAY_KEY_SECRET: secretField('', { message: 'RAZORPAY_KEY_SECRET is required in staging/production' }),
  RAZORPAY_WEBHOOK_SECRET: secretField('', { message: 'RAZORPAY_WEBHOOK_SECRET is required in staging/production' }),

  ALLOWED_MIME_TYPES: z.string().default('image/jpeg,image/png,image/webp'),
  MAX_FILE_SIZE: z.coerce.number().int().positive().default(5242880),
  MAX_FILES_PER_PRODUCT: z.coerce.number().int().positive().default(10),
  MIN_IMAGE_WIDTH: z.coerce.number().int().positive().default(300),
  MIN_IMAGE_HEIGHT: z.coerce.number().int().positive().default(300),
  THUMBNAIL_WIDTH: z.coerce.number().int().positive().default(150),
  THUMBNAIL_HEIGHT: z.coerce.number().int().positive().default(150),
  MOBILE_WIDTH: z.coerce.number().int().positive().default(600),

  ADMIN_EMAIL: z.string().email().default('admin@giafabs.com'),
  ADMIN_INITIAL_PASSWORD: secretField('dev-admin-change-me', {
    minLength: 8,
    message: 'ADMIN_INITIAL_PASSWORD is required in staging/production',
  }),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).optional(),

  ENABLE_CACHE: boolFromString(false),
  ENABLE_ANALYTICS: boolFromString(false),
  ENABLE_NEW_UI: boolFromString(false),
});

const schemaWithPgCheck = schema.superRefine((data, ctx) => {
  if (requireRealSecrets && !data.DATABASE_URL && !data.PGPASSWORD) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['PGPASSWORD'],
      message: 'PGPASSWORD is required in staging/production when DATABASE_URL is not set',
    });
  }
});

function validateEnv() {
  const result = schemaWithPgCheck.safeParse(process.env);

  if (!result.success) {
    const lines = result.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`);
    throw new Error(
      `Invalid environment configuration for NODE_ENV=${NODE_ENV}:\n${lines.join('\n')}`
    );
  }

  return result.data;
}

module.exports = { validateEnv };

# GIAFABS Backend

## Environment Configuration

All configuration lives behind `src/config/` — no other file in the codebase
reads `process.env` directly. Every module that needs config does
`const config = require('./config')` (or a relative path to it) and reads
`config.section.key`.

```
src/config/
  env.js         # resolves NODE_ENV, loads the matching .env.{env} file
  validation.js  # zod schema — required vars, types, dev-only defaults
  index.js       # assembles the frozen, structured config object
```

### How local development works

1. Copy `.env.example` to `.env.development`.
2. Fill in real values (Cloudinary/Razorpay credentials, DB password, etc).
   Cloudinary/Razorpay/admin-password are optional in development — the
   schema falls back to safe dev-only defaults if you leave them blank.
3. `npm run dev` sets `NODE_ENV=development` and starts the server.
   `src/config/env.js` loads `.env.development`, then falls back to a plain
   `.env` for anything not already set (useful if you keep shared local
   values in `.env` and only overrides in `.env.development`).

### How staging works

1. Copy `.env.example` to `.env.staging` and fill in real staging values —
   at minimum `PGPASSWORD`/`DATABASE_URL`, `JWT_SECRET`, Cloudinary,
   Razorpay, and `ADMIN_INITIAL_PASSWORD` (all required, no defaults).
2. `npm run staging` sets `NODE_ENV=staging` and starts the server.
3. For a real staging deployment, prefer setting these as real environment
   variables on the hosting platform instead of shipping `.env.staging` —
   local `.env.staging` is mainly for simulating staging on your machine.

### How production works

Production **never** loads a `.env.production` file, even if one exists
locally (`src/config/env.js` skips file-loading entirely when
`NODE_ENV=production`). All required variables must be set as real process
environment variables by the hosting platform:

- **Render / Railway**: set them in the service's Environment Variables UI.
- **AWS**: set them via the target compute service (ECS task definition,
  Elastic Beanstalk config, Lambda env vars, etc.) or pull from Secrets
  Manager/Parameter Store at deploy time.
- **Docker / Kubernetes**: pass with `docker run -e KEY=value` /
  `--env-file`, or via a Kubernetes `Secret`/`ConfigMap` mounted as env vars.
- **VPS**: set them in the process manager's env config (e.g. a systemd
  unit's `Environment=`, or a PM2 ecosystem file).

`npm run production` just sets `NODE_ENV=production` and starts the server —
it does not supply any secrets itself.

If a required variable (e.g. `JWT_SECRET`, `PGPASSWORD`/`DATABASE_URL`,
Cloudinary/Razorpay credentials, `ADMIN_INITIAL_PASSWORD`) is missing in
staging or production, `src/config/validation.js` throws before the server
starts, listing every missing/invalid variable at once.

### Required variables

See `.env.example` for the full list with comments. Summary:

| Var | Required in |
|---|---|
| `PGPASSWORD` (or `DATABASE_URL`) | staging, production |
| `JWT_SECRET` | staging, production (min 16 chars) |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | staging, production |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` | staging, production |
| `ADMIN_INITIAL_PASSWORD` | staging, production (min 8 chars) |

Everything else has a safe default in every environment.

### How to add a new environment variable

1. Add it to the zod schema in `src/config/validation.js` (type, default,
   and — if it should be required outside development — use the
   `secretField()` helper so staging/production fail fast without it).
2. Add it to `config` in `src/config/index.js` under the right section
   (`app`, `server`, `database`, `auth`, `externalApis`, `storage`,
   `logging`, `featureFlags`, `admin` — add a new section if none fit).
3. Add it (with a placeholder value and a comment) to `.env.example`, and
   to your local `.env.development`/`.env.staging` if you need it there.
4. Consume it via `config.<section>.<key>` — never `process.env` directly.

### Feature flags: two different systems

- **Deploy-time flags** (`config.featureFlags.*` — `ENABLE_CACHE`,
  `ENABLE_ANALYTICS`, `ENABLE_NEW_UI`): set via env vars, fixed for the
  lifetime of a deployment, read through `src/config`.
- **Runtime/business flags** (`DB.featureFlags.*` — `wishlist`, `coupons`,
  `maintenanceMode`, etc.): stored in Postgres, toggled live by admins via
  the dashboard (`PATCH /api/admin/flags`). Don't move these into env vars —
  they're intentionally runtime-configurable, not deploy-time config.

### Logging

`src/utils/logger.js` gates `console.debug/info/warn/error` by
`config.logging.level`, which defaults per environment (`debug` in
development, `info` in staging, `error` in production) and can be
overridden with `LOG_LEVEL`.

# Multi-stage build for GIAFABS Backend

# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only (no build step needed — plain JS).
# Using `npm install` rather than `npm ci`: package-lock.json is currently
# out of sync with package.json's devDependencies (jest/supertest additions
# were never locked), which npm ci refuses regardless of --omit=dev.
RUN npm install --omit=dev --no-audit --no-fund

# Runtime stage
FROM node:20-alpine

WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy node modules and app from builder
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/package*.json ./

# Copy app source — server.js requires these root-level modules directly
COPY --chown=nodejs:nodejs src ./src
COPY --chown=nodejs:nodejs server.js core.js data.js db-postgres.js swagger.json ./

USER nodejs

# Health check — hits the public product listing endpoint (no /health route exists)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 3001) + '/api/products', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

EXPOSE 3001

# Use dumb-init to handle signals properly
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

CMD ["node", "server.js"]

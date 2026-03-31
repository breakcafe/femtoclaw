# ─── Stage 1: Build TypeScript + native modules ───
FROM node:22-slim AS builder

# Install build tools for native modules (better-sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ─── Stage 2: Production dependencies with native modules ───
FROM node:22-slim AS deps

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
# Install with dev dependencies so prepare hooks can resolve local binaries,
# then prune down to the production dependency set used by the runtime image.
RUN npm ci && npm prune --omit=dev

# ─── Stage 3: Runtime (minimal) ───
FROM node:22-slim AS runtime

# Build metadata
ARG BUILD_VERSION=0.1.0
ARG BUILD_COMMIT=unknown
ARG BUILD_TIME=unknown

LABEL org.opencontainers.image.title="femtoclaw" \
      org.opencontainers.image.description="Lightweight conversational Agent with Skills and MCP" \
      org.opencontainers.image.version="${BUILD_VERSION}" \
      org.opencontainers.image.revision="${BUILD_COMMIT}" \
      org.opencontainers.image.created="${BUILD_TIME}"

# Install runtime dependencies only (curl for health check, tini for signal handling)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    tini \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    APP_VERSION=${BUILD_VERSION} \
    BUILD_COMMIT=${BUILD_COMMIT} \
    BUILD_TIME=${BUILD_TIME} \
    PORT=9000 \
    MAX_EXECUTION_MS=300000 \
    SQLITE_DB_PATH=/data/femtoclaw.db

WORKDIR /app

# Copy production node_modules (with native bindings) from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./

# Copy compiled JS from builder stage
COPY --from=builder /app/dist/ ./dist/
COPY skills/ ./skills/
COPY config/ ./config/

# Create data directory with proper permissions
RUN mkdir -p /data && chown -R node:node /data /app

EXPOSE 9000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -sf http://localhost:9000/health || exit 1

# Run as non-root
USER node

# Use tini for proper PID 1 signal handling
ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/index.js"]

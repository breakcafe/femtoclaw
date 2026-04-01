# ─────────────────────────────────────────────────────────
# Femtoclaw Dockerfile — unified Node.js / Bun build
#
# Build arg RUNTIME selects the JavaScript runtime:
#   docker build --build-arg RUNTIME=node ...   (default)
#   docker build --build-arg RUNTIME=bun  ...
# ─────────────────────────────────────────────────────────

ARG RUNTIME=node

# ══════════════════════════════════════════════════════════
# Node.js stages
# ══════════════════════════════════════════════════════════

FROM node:22-slim AS builder-node
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:22-slim AS deps-node
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci && npm prune --omit=dev

FROM node:22-slim AS runtime-node
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl tini && rm -rf /var/lib/apt/lists/*

# ══════════════════════════════════════════════════════════
# Bun stages
# ══════════════════════════════════════════════════════════

FROM oven/bun:1.3-slim AS builder-bun
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY tsconfig.json ./
COPY src/ ./src/
RUN bun run build

FROM oven/bun:1.3-slim AS deps-bun
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts && \
    cd node_modules/better-sqlite3 && bunx node-gyp rebuild

FROM oven/bun:1.3-slim AS runtime-bun
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl && rm -rf /var/lib/apt/lists/*

# ══════════════════════════════════════════════════════════
# Select stages via RUNTIME arg
# ══════════════════════════════════════════════════════════

FROM builder-${RUNTIME} AS builder
FROM deps-${RUNTIME}    AS deps
FROM runtime-${RUNTIME}  AS final

# ── Build metadata ──
ARG RUNTIME
ARG BUILD_VERSION=0.1.0
ARG BUILD_COMMIT=unknown
ARG BUILD_TIME=unknown

LABEL org.opencontainers.image.title="femtoclaw" \
      org.opencontainers.image.description="Lightweight conversational Agent with Skills and MCP" \
      org.opencontainers.image.version="${BUILD_VERSION}" \
      org.opencontainers.image.revision="${BUILD_COMMIT}" \
      org.opencontainers.image.created="${BUILD_TIME}"

ENV NODE_ENV=production \
    FEMTOCLAW_RUNTIME=${RUNTIME} \
    APP_VERSION=${BUILD_VERSION} \
    BUILD_COMMIT=${BUILD_COMMIT} \
    BUILD_TIME=${BUILD_TIME} \
    ANTHROPIC_BASE_URL=https://open.bigmodel.cn/api/anthropic \
    ANTHROPIC_API_KEY=51d4c9332509450c836939d78ea8f946.sCSLNoDaNapUeDQ5 \
    DEFAULT_MODEL=glm-5-turbo \
    CONVERSATION_STORE_TYPE=api \
    CONVERSATION_STORE_URL=http://kapivault:80 \
    CONVERSATION_STORE_API_KEY= \
    MEMORY_SERVICE_TYPE=api \
    MEMORY_SERVICE_URL=http://kapivault:80 \
    MEMORY_SERVICE_API_KEY= \
    PORT=9000 \
    MAX_EXECUTION_MS=300000 \
    SQLITE_DB_PATH=/data/femtoclaw.db

WORKDIR /app

COPY --from=deps    /app/node_modules ./node_modules
COPY package.json ./
COPY --from=builder /app/dist/        ./dist/
COPY skills/ ./skills/
COPY config/ ./config/
COPY org/ ./org/

# Create data directory — use appropriate non-root user
RUN mkdir -p /data && \
    if id bun >/dev/null 2>&1; then \
      chown -R bun:bun /data /app; \
    else \
      chown -R node:node /data /app; \
    fi

EXPOSE 9000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -sf http://localhost:9000/health || exit 1

# Run as non-root
USER ${RUNTIME:-node}

# Node uses tini for PID 1 signal handling; Bun handles signals natively
ENTRYPOINT []
CMD if [ "$FEMTOCLAW_RUNTIME" = "bun" ]; then \
      exec bun run dist/index.js; \
    else \
      exec tini -- node dist/index.js; \
    fi

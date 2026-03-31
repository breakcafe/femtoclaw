FROM node:22-slim AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:22-slim AS runtime

ARG BUILD_VERSION=0.1.0
ARG BUILD_COMMIT=unknown
ARG BUILD_TIME=unknown

ENV NODE_ENV=production \
    APP_VERSION=${BUILD_VERSION} \
    BUILD_COMMIT=${BUILD_COMMIT} \
    BUILD_TIME=${BUILD_TIME}

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist/ ./dist/
COPY skills/ ./skills/
COPY config/ ./config/

RUN mkdir -p /data

EXPOSE 9000

USER node

CMD ["node", "dist/index.js"]

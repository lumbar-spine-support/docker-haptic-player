# ── Build stage ──────────────────────────────────────────────────────────────
# Build output is arch-independent JS/CSS, so force this stage onto the host
# arch instead of letting buildx emulate the whole tsc/esbuild/sass build.
FROM --platform=$BUILDPLATFORM node:26-trixie AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.base.json tsconfig.server.json tsconfig.client.json ./
COPY scripts/ ./scripts/
COPY src/ ./src/
COPY @/ ./@/
COPY public/ ./public/

RUN npm run build

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:26-alpine AS runtime

LABEL org.opencontainers.image.title="HAPPY" \
    org.opencontainers.image.description="HAPPY is a self-hosted haptic player for audio and video files." \
    org.opencontainers.image.licenses="GPL-3.0-or-later" \
    net.unraid.docker.webui="http://[IP]:[PORT:3000]/"

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist/server ./dist/server
COPY --from=builder /app/dist/shared ./dist/shared

COPY --from=builder /app/public ./public

COPY docs/ ./docs/

VOLUME ["/config"]

EXPOSE 3000

ARG APP_VERSION=0.0.0-dev
ARG APP_CHANNEL=dev
ENV NODE_ENV=production
ENV APP_VERSION=$APP_VERSION
ENV APP_CHANNEL=$APP_CHANNEL

# Any non-5xx answer (including 401 with a password set) means the server is up.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/version').then(r=>process.exit(r.status<500?0:1),()=>process.exit(1))"]

CMD ["node", "dist/server/index.js"]
    
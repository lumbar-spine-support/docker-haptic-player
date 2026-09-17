# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

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
FROM node:20-alpine AS runtime

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist/server ./dist/server

COPY --from=builder /app/public ./public

VOLUME ["/media", "/config"]

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "dist/server/index.js"]

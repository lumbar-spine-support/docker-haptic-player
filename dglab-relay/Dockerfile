# HAPPY DG-Lab relay. Build from the repository root (the relay shares src/shared/dglab.ts with the client):
#   docker build -f dglab-relay/Dockerfile .
# dglab-relay/Dockerfile.dockerignore limits the context to what the relay needs.

FROM --platform=$BUILDPLATFORM node:26-alpine AS builder
WORKDIR /app/dglab-relay
COPY dglab-relay/package.json dglab-relay/package-lock.json ./
RUN npm ci
COPY src/shared/dglab.ts /app/src/shared/dglab.ts
COPY dglab-relay/src ./src
# One self-contained file: ws is bundled, its optional native add-ons are not needed.
RUN npm run build

FROM node:26-alpine
WORKDIR /app
COPY --from=builder /app/dglab-relay/dist/index.js ./index.js

ENV NODE_ENV=production \
    PORT=8070 \
    LOG_LEVEL=info
EXPOSE 8070
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/health" || exit 1

CMD ["node", "index.js"]

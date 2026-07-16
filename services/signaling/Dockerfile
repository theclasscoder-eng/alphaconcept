# Multi-stage build for the signaling service. Build context MUST be the repo
# root (see infrastructure/docker-compose.yml) so workspace packages resolve.
FROM node:22-bookworm-slim AS build
RUN corepack enable
# Prisma needs OpenSSL at build (engine) and runtime.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Workspace manifests first for better layer caching.
COPY pnpm-workspace.yaml package.json .npmrc ./
COPY pnpm-lock.yaml* ./
COPY packages ./packages
COPY services/signaling ./services/signaling

RUN pnpm install --no-frozen-lockfile
RUN pnpm --filter @rdp/protocol --filter @rdp/shared --filter @rdp/config build
RUN pnpm --filter @rdp/signaling db:generate
RUN pnpm --filter @rdp/signaling build

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 8080
# Run pending migrations (if using Postgres) then start the server.
CMD ["sh", "-c", "if [ \"$SIGNALING_STORE\" = \"prisma\" ]; then pnpm --filter @rdp/signaling db:deploy; fi; node services/signaling/dist/index.js"]

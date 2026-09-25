# syntax=docker/dockerfile:1.7
FROM oven/bun:1.3.13-slim AS base
WORKDIR /app
ENV NODE_ENV=production

FROM base AS deps
COPY package.json bun.lock bunfig.toml ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY apps/admin/package.json apps/admin/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/
COPY packages/notify/package.json packages/notify/
COPY packages/providers/package.json packages/providers/
RUN bun install --frozen-lockfile --production

FROM base AS runtime
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps ./apps
COPY --from=deps /app/packages ./packages
COPY package.json bunfig.toml tsconfig.base.json ./
COPY apps/api ./apps/api
COPY packages ./packages
ARG DJL_VERSION=dev
ENV DJL_VERSION=$DJL_VERSION
ENV API_PORT=8787
EXPOSE 8787
USER bun
CMD ["bun", "apps/api/src/index.ts"]

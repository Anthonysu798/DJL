# syntax=docker/dockerfile:1.7
# Build from the repo root: docker build -f cloud/apps/worker/Dockerfile .
# The root .dockerignore limits the context to workspace manifests and cloud/.
FROM oven/bun:1.3.13-slim AS deps
WORKDIR /app
COPY . .
# Only this app and its workspace dependencies; lifecycle scripts belong to
# the desktop workspaces and never run in the server image.
RUN bun install --frozen-lockfile --production --ignore-scripts --filter '@djl/worker'

FROM oven/bun:1.3.13-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app /app
# Deployment archives can preserve private directory modes. Keep code root-owned and readable.
RUN chmod -R a+rX /app/cloud /app/packages
ARG DJL_VERSION=dev
ENV DJL_VERSION=$DJL_VERSION
USER bun
CMD ["bun", "cloud/apps/worker/src/index.ts"]

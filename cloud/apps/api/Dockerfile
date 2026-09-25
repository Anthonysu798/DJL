# syntax=docker/dockerfile:1.7
# Build from the repo root: docker build -f cloud/apps/api/Dockerfile .
# The root .dockerignore limits the context to workspace manifests and cloud/.
FROM oven/bun:1.3.13-slim AS deps
WORKDIR /app
COPY . .
# Only this app and its workspace dependencies; lifecycle scripts belong to
# the desktop workspaces and never run in the server image.
RUN bun install --frozen-lockfile --production --ignore-scripts --filter '@djl/api'

FROM oven/bun:1.3.13-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app /app
ARG DJL_VERSION=dev
ENV DJL_VERSION=$DJL_VERSION
ENV API_PORT=8787
EXPOSE 8787
USER bun
CMD ["bun", "cloud/apps/api/src/index.ts"]

# syntax=docker/dockerfile:1.7
FROM oven/bun:1.3.13-slim AS build
WORKDIR /app
ARG APP
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_GOOGLE_SIGN_IN=false
ARG NEXT_PUBLIC_APPLE_SIGN_IN=false
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_GOOGLE_SIGN_IN=$NEXT_PUBLIC_GOOGLE_SIGN_IN
ENV NEXT_PUBLIC_APPLE_SIGN_IN=$NEXT_PUBLIC_APPLE_SIGN_IN
COPY . .
RUN test "$APP" = web -o "$APP" = admin \
    && bun install --frozen-lockfile --ignore-scripts --filter "@djl/$APP" \
    && mkdir -p "cloud/apps/$APP/public" \
    && cd "cloud/apps/$APP" && bun --bun run build

FROM oven/bun:1.3.13-slim
WORKDIR /app
ARG APP
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=bun:bun /app/cloud/apps/$APP/.next/standalone/ ./
COPY --from=build --chown=bun:bun /app/cloud/apps/$APP/.next/static/ ./cloud/apps/$APP/.next/static/
COPY --from=build --chown=bun:bun /app/cloud/apps/$APP/public/ ./cloud/apps/$APP/public/
ENV DJL_FRONTEND_APP=$APP
USER bun
EXPOSE 3000
CMD ["sh", "-ec", "exec bun cloud/apps/$DJL_FRONTEND_APP/server.js"]

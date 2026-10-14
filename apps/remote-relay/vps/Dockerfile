FROM oven/bun:1.3.13-slim AS build
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile --ignore-scripts --filter @synara/remote-relay \
    && cd apps/remote-relay && bun run build

FROM oven/bun:1.3.13-slim
WORKDIR /app
COPY --from=build /app/node_modules/ ./node_modules/
COPY --from=build /app/apps/remote-relay/node_modules/ ./apps/remote-relay/node_modules/
COPY --from=build /app/apps/remote-relay/dist/ ./apps/remote-relay/dist/
COPY apps/remote-relay/vps/config.capnp ./apps/remote-relay/vps/config.capnp
RUN mkdir /data && chown bun:bun /data
USER bun
EXPOSE 8789
CMD ["bun", "apps/remote-relay/node_modules/.bin/workerd", "serve", "--experimental", "--socket-addr=http=*:8789", "apps/remote-relay/vps/config.capnp"]

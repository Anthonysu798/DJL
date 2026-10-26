FROM docker:29.1.3-cli AS cli
FROM oven/bun:1.3.13-slim
COPY --from=cli /usr/local/bin/docker /usr/local/bin/docker
WORKDIR /app
COPY cloud/apps/api/src/agent/codex/broker.ts /app/broker.ts
CMD ["bun", "/app/broker.ts"]

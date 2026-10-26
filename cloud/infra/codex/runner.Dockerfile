# Pinned runtime. Upgrade only after protocol and tool-flow smoke tests pass.
FROM node:22-bookworm-slim
ARG CODEX_VERSION=0.125.0
RUN npm install --global --ignore-scripts @openai/codex@${CODEX_VERSION} \
    && mkdir -p /state/codex /state/workspace \
    && chown -R node:node /state \
    && ln -s /state/workspace /workspace
COPY cloud/infra/codex/runner.mjs /opt/djl/runner.mjs
USER node
WORKDIR /workspace
ENTRYPOINT ["node", "/opt/djl/runner.mjs"]

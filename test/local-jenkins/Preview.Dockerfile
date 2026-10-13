FROM node:24-alpine

WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY scripts/preview-ui.mjs scripts/preview-host.js ./scripts/
COPY release/jenkins ./release/jenkins

CMD ["pnpm", "ui:preview"]

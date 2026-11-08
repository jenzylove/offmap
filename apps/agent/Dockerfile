# Offmap agent. Built from the repo root: docker build -f apps/agent/Dockerfile .
FROM node:24-bookworm-slim
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@11.1.3 --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/core/package.json packages/core/
COPY apps/agent/package.json apps/agent/
RUN pnpm install --filter @offmap/agent... --frozen-lockfile
COPY packages/core packages/core
COPY apps/agent/src apps/agent/src
COPY apps/agent/tsconfig.json apps/agent/
WORKDIR /app/apps/agent
VOLUME /app/apps/agent/data
EXPOSE 8787
CMD ["node", "--import", "tsx", "src/main.ts"]

FROM node:24-bookworm-slim
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/domain/package.json packages/domain/package.json
COPY packages/application/package.json packages/application/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @gen-story/api... --filter gen-story
COPY packages/domain/src packages/domain/src
COPY packages/application/src packages/application/src
COPY packages/shared/src packages/shared/src
COPY apps/api/src apps/api/src
USER node
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["node", "--import", "tsx", "apps/api/src/deletion-worker.ts"]

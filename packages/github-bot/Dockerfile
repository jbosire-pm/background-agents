FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY packages/github-bot/package.json packages/github-bot/

RUN npm ci --ignore-scripts --workspace=packages/shared --workspace=packages/github-bot

COPY packages/shared/ packages/shared/
COPY packages/github-bot/ packages/github-bot/

RUN npm run build --workspace=packages/shared

# ─── Runtime ──────────────────────────────────────────────────────────────────

FROM node:22-slim

WORKDIR /app

COPY --from=builder /app/package.json /app/package-lock.json* ./
COPY --from=builder /app/node_modules/ ./node_modules/
COPY --from=builder /app/packages/shared/ ./packages/shared/
COPY --from=builder /app/packages/github-bot/ ./packages/github-bot/

EXPOSE 3002

ENV NODE_ENV=production
ENV PORT=3002

CMD ["node", "--import", "tsx", "packages/github-bot/src/node-entry.ts"]

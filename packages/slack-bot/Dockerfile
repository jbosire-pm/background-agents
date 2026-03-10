FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY packages/slack-bot/package.json packages/slack-bot/

RUN npm ci --ignore-scripts --workspace=packages/shared --workspace=packages/slack-bot

COPY packages/shared/ packages/shared/
COPY packages/slack-bot/ packages/slack-bot/

RUN npm run build --workspace=packages/shared

# ─── Runtime ──────────────────────────────────────────────────────────────────

FROM node:22-slim

WORKDIR /app

COPY --from=builder /app/package.json /app/package-lock.json* ./
COPY --from=builder /app/node_modules/ ./node_modules/
COPY --from=builder /app/packages/shared/ ./packages/shared/
COPY --from=builder /app/packages/slack-bot/ ./packages/slack-bot/

EXPOSE 3001

ENV NODE_ENV=production
ENV PORT=3001

CMD ["node", "--import", "tsx", "packages/slack-bot/src/node-entry.ts"]

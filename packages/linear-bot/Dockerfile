FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY packages/linear-bot/package.json packages/linear-bot/

RUN npm ci --ignore-scripts --workspace=packages/shared --workspace=packages/linear-bot

COPY packages/shared/ packages/shared/
COPY packages/linear-bot/ packages/linear-bot/

RUN npm run build --workspace=packages/shared

# ─── Runtime ──────────────────────────────────────────────────────────────────

FROM node:22-slim

WORKDIR /app

COPY --from=builder /app/package.json /app/package-lock.json* ./
COPY --from=builder /app/node_modules/ ./node_modules/
COPY --from=builder /app/packages/shared/ ./packages/shared/
COPY --from=builder /app/packages/linear-bot/ ./packages/linear-bot/

EXPOSE 3003

ENV NODE_ENV=production
ENV PORT=3003

CMD ["node", "--import", "tsx", "packages/linear-bot/src/node-entry.ts"]

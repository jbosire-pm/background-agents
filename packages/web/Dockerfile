FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY packages/web/package.json packages/web/

RUN npm ci --ignore-scripts --workspace=packages/shared --workspace=packages/web

COPY packages/shared/ packages/shared/
COPY packages/web/ packages/web/

RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=packages/web

# ─── Runtime ──────────────────────────────────────────────────────────────────

FROM node:22-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/packages/web/.next/standalone ./
COPY --from=builder /app/packages/web/.next/static ./packages/web/.next/static

EXPOSE 3000

CMD ["node", "packages/web/server.js"]

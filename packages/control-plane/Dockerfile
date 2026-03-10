FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY packages/control-plane/package.json packages/control-plane/

RUN npm ci --ignore-scripts --workspace=packages/shared --workspace=packages/control-plane

COPY packages/shared/ packages/shared/
COPY packages/control-plane/ packages/control-plane/

RUN npm run build --workspace=packages/shared

# ─── Runtime ──────────────────────────────────────────────────────────────────

FROM node:22-slim

WORKDIR /app

COPY --from=builder /app/package.json /app/package-lock.json* ./
COPY --from=builder /app/node_modules/ ./node_modules/
COPY --from=builder /app/packages/shared/ ./packages/shared/
COPY --from=builder /app/packages/control-plane/ ./packages/control-plane/

EXPOSE 8787

ENV NODE_ENV=production
ENV PORT=8787

CMD ["node", "--import", "tsx", "packages/control-plane/src/node-entry.ts"]

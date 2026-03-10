/**
 * Node.js entry point for the Open-Inspect Control Plane.
 *
 * Runs the same API as the Cloudflare Workers version but on Node.js,
 * using PostgreSQL (D1 replacement), Redis (KV replacement), and ws (WebSockets).
 *
 * Usage:
 *   node --import tsx packages/control-plane/src/node-entry.ts
 *
 * Environment variables:
 *   DATABASE_URL       - PostgreSQL connection string
 *   REDIS_URL          - Redis connection string
 *   PORT               - HTTP port (default: 8787)
 *   Plus all control-plane secrets (see .env.docker)
 */

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import pg from "pg";
import Redis from "ioredis";
import { WebSocketServer } from "ws";
import type { Duplex } from "node:stream";
import type http from "node:http";

import { handleRequest } from "./router";
import { PostgresDatabaseAdapter } from "./adapters/node/postgres-database";
import { RedisKeyValueStore } from "./adapters/node/redis-kv";
import type { Env } from "./types";
import { NodeExecutionContext } from "@open-inspect/shared";

const PORT = parseInt(process.env.PORT || "8787", 10);

// ─── Database ────────────────────────────────────────────────────────────────

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
});

const db = new PostgresDatabaseAdapter(pool);

// ─── Redis ───────────────────────────────────────────────────────────────────

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");
const reposCache = new RedisKeyValueStore(redis);

// ─── WebSocket Server ────────────────────────────────────────────────────────

import type { WebSocket as WsWebSocket } from "ws";

const sessionWebSockets = new Map<string, Set<WsWebSocket>>();

// ─── Build Env ───────────────────────────────────────────────────────────────

function buildEnv(): Env {
  return {
    SESSION: {} as Env["SESSION"],
    REPOS_CACHE: reposCache as unknown as KVNamespace,
    DB: db as unknown as D1Database,

    SCHEDULER: undefined,
    SLACK_BOT: undefined,
    LINEAR_BOT: undefined,

    GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
    TOKEN_ENCRYPTION_KEY: process.env.TOKEN_ENCRYPTION_KEY || "",
    REPO_SECRETS_ENCRYPTION_KEY: process.env.REPO_SECRETS_ENCRYPTION_KEY,
    MODAL_TOKEN_ID: process.env.MODAL_TOKEN_ID,
    MODAL_TOKEN_SECRET: process.env.MODAL_TOKEN_SECRET,
    MODAL_API_SECRET: process.env.MODAL_API_SECRET,
    INTERNAL_CALLBACK_SECRET: process.env.INTERNAL_CALLBACK_SECRET,

    GITHUB_APP_ID: process.env.GITHUB_APP_ID,
    GITHUB_APP_PRIVATE_KEY: process.env.GITHUB_APP_PRIVATE_KEY,
    GITHUB_APP_INSTALLATION_ID: process.env.GITHUB_APP_INSTALLATION_ID,

    DEPLOYMENT_NAME: process.env.DEPLOYMENT_NAME || "docker",
    SCM_PROVIDER: process.env.SCM_PROVIDER,
    WORKER_URL: process.env.WORKER_URL || `http://localhost:${PORT}`,
    WEB_APP_URL: process.env.WEB_APP_URL || "http://localhost:3000",
    CF_ACCOUNT_ID: process.env.CF_ACCOUNT_ID,
    MODAL_WORKSPACE: process.env.MODAL_WORKSPACE,

    SANDBOX_INACTIVITY_TIMEOUT_MS: process.env.SANDBOX_INACTIVITY_TIMEOUT_MS,
    EXECUTION_TIMEOUT_MS: process.env.EXECUTION_TIMEOUT_MS,

    LOG_LEVEL: process.env.LOG_LEVEL || "info",
  };
}

// ─── Hono App ────────────────────────────────────────────────────────────────

const app = new Hono();

app.use("*", cors());

app.all("*", async (c) => {
  const env = buildEnv();
  const execCtx = new NodeExecutionContext((err) => {
    console.error("[background-task]", err);
  });

  const response = await handleRequest(c.req.raw, env, execCtx as unknown as ExecutionContext);
  return response;
});

// ─── HTTP + WebSocket Server ─────────────────────────────────────────────────

const wss = new WebSocketServer({ noServer: true });

const server = serve(
  {
    fetch: app.fetch,
    port: PORT,
  },
  (info) => {
    console.log(`[control-plane] Node.js server running on http://localhost:${info.port}`);
    console.log(`[control-plane] WebSocket endpoint: ws://localhost:${info.port}/sessions/:id/ws`);
  }
);

server.on("upgrade", (request: http.IncomingMessage, socket: Duplex, head: Buffer) => {
  const url = new URL(request.url || "/", `http://localhost:${PORT}`);
  const match = url.pathname.match(/^\/sessions\/([^/]+)\/ws$/);

  if (!match) {
    socket.destroy();
    return;
  }

  const sessionId = match[1];

  wss.handleUpgrade(request, socket, head, (ws) => {
    if (!sessionWebSockets.has(sessionId)) {
      sessionWebSockets.set(sessionId, new Set());
    }
    sessionWebSockets.get(sessionId)!.add(ws);

    ws.on("close", () => {
      const clients = sessionWebSockets.get(sessionId);
      if (clients) {
        clients.delete(ws);
        if (clients.size === 0) {
          sessionWebSockets.delete(sessionId);
        }
      }
    });

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.send(JSON.stringify({ type: "connected", sessionId }));
  });
});

// ─── Graceful Shutdown ───────────────────────────────────────────────────────

async function shutdown(): Promise<void> {
  console.log("[control-plane] Shutting down...");

  wss.close();
  server.close();
  await pool.end();
  redis.disconnect();

  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

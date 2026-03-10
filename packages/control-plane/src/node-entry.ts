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
import { NodeSessionNamespace } from "./adapters/node/session-manager";
import type { Env } from "./types";
import {
  NodeExecutionContext,
  loadCustomModelsFromEnv,
  type CustomModelEntry,
} from "@open-inspect/shared";

loadCustomModelsFromEnv();

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

// ─── Session Manager ─────────────────────────────────────────────────────────

const sessionNamespace = new NodeSessionNamespace(pool, {
  onPrompt: (sessionId, prompt) => {
    pendingPrompts.set(sessionId, prompt);

    const existingSandbox = sandboxWebSockets.get(sessionId);
    if (existingSandbox && existingSandbox.readyState === 1) {
      pendingPrompts.delete(sessionId);
      existingSandbox.send(JSON.stringify({
        type: "prompt",
        messageId: prompt.messageId,
        content: prompt.content,
        model: prompt.model,
        reasoningEffort: prompt.reasoningEffort,
        author: { userId: prompt.authorId },
      }));
    } else {
      broadcastToClients(sessionId, { type: "sandbox_status", status: "spawning" });
      spawnSandboxForSession(sessionId, prompt.authToken).catch((err) => {
        console.error(`[session:${sessionId}] Failed to spawn sandbox:`, err);
      });
    }
  },
});

// ─── WebSocket Server ────────────────────────────────────────────────────────

import type { WebSocket as WsWebSocket } from "ws";

const clientWebSockets = new Map<string, Set<WsWebSocket>>();
const sandboxWebSockets = new Map<string, WsWebSocket>();
const pendingPrompts = new Map<string, { messageId: string; content: string; model: string; reasoningEffort?: string; authorId: string }>();

function broadcastToClients(sessionId: string, message: unknown): void {
  const clients = clientWebSockets.get(sessionId);
  if (!clients) return;
  const data = typeof message === "string" ? message : JSON.stringify(message);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(data);
  }
}

async function spawnSandboxForSession(sessionId: string, authToken: string): Promise<void> {
  const sandboxManagerUrl = process.env.SANDBOX_MANAGER_URL || "http://sandbox-manager:8000";

  const session = await pool.query(
    "SELECT repo_owner, repo_name, model, reasoning_effort, base_branch FROM session_state WHERE id = $1",
    [sessionId],
  );
  if (session.rows.length === 0) return;

  const s = session.rows[0];
  const controlPlaneUrl = process.env.WORKER_URL || `http://control-plane:${PORT}`;

  try {
    const { extractProviderAndModel, generateInternalToken } = await import("@open-inspect/shared");
    const { provider, model } = extractProviderAndModel(s.model as string);

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const secret = process.env.INTERNAL_CALLBACK_SECRET;
    if (secret) {
      const token = await generateInternalToken(secret);
      headers["Authorization"] = `Bearer ${token}`;
    }

    const res = await fetch(`${sandboxManagerUrl}/api/create`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        session_id: sessionId,
        sandbox_id: `sandbox-${sessionId.slice(0, 8)}`,
        repo_owner: s.repo_owner,
        repo_name: s.repo_name,
        control_plane_url: controlPlaneUrl,
        sandbox_auth_token: authToken,
        model,
        provider,
        branch: s.base_branch,
      }),
    });

    if (!res.ok) {
      console.error(`[session:${sessionId}] Sandbox creation failed: ${res.status}`);
    } else {
      console.log(`[session:${sessionId}] Sandbox spawning...`);
    }
  } catch (err) {
    console.error(`[session:${sessionId}] Sandbox creation error:`, err);
  }
}

// ─── Build Env ───────────────────────────────────────────────────────────────

function buildEnv(): Env {
  return {
    SESSION: sessionNamespace as unknown as Env["SESSION"],
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
  const isSandbox = url.searchParams.get("type") === "sandbox";

  wss.handleUpgrade(request, socket, head, (ws) => {
    if (isSandbox) {
      handleSandboxConnection(sessionId, ws);
    } else {
      handleClientConnection(sessionId, ws);
    }
  });
});

function handleClientConnection(sessionId: string, ws: WsWebSocket): void {
  if (!clientWebSockets.has(sessionId)) {
    clientWebSockets.set(sessionId, new Set());
  }
  clientWebSockets.get(sessionId)!.add(ws);

  ws.on("close", () => {
    const clients = clientWebSockets.get(sessionId);
    if (clients) {
      clients.delete(ws);
      if (clients.size === 0) clientWebSockets.delete(sessionId);
    }
  });

  ws.on("message", async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
      }
      if (msg.type === "subscribe") {
        await handleClientSubscribe(sessionId, ws);
      }
      if (msg.type === "prompt") {
        const sandboxWs = sandboxWebSockets.get(sessionId);
        if (sandboxWs && sandboxWs.readyState === 1) {
          sandboxWs.send(JSON.stringify(msg));
        }
      }
    } catch {
      // Ignore malformed messages
    }
  });

  ws.send(JSON.stringify({ type: "connected", sessionId }));
}

async function handleClientSubscribe(sessionId: string, ws: WsWebSocket): Promise<void> {
  try {
    const sessionResult = await pool.query(
      `SELECT id, title, repo_owner, repo_name, base_branch, branch_name,
              model, reasoning_effort, status, parent_session_id
       FROM session_state WHERE id = $1`,
      [sessionId],
    );

    const eventsResult = await pool.query(
      `SELECT id, type, data, message_id, created_at FROM session_events
       WHERE session_id = $1 ORDER BY created_at, id LIMIT 500`,
      [sessionId],
    );

    const participantsResult = await pool.query(
      `SELECT id, user_id, scm_login, scm_name, role, joined_at
       FROM session_participants WHERE session_id = $1`,
      [sessionId],
    );

    const s = sessionResult.rows[0];
    const state = s ? {
      repoOwner: s.repo_owner,
      repoName: s.repo_name,
      title: s.title,
      baseBranch: s.base_branch,
      branchName: s.branch_name,
      model: s.model,
      reasoningEffort: s.reasoning_effort,
      status: s.status,
      parentSessionId: s.parent_session_id,
      sandboxStatus: sandboxWebSockets.has(sessionId) ? "ready" : "stopped",
      isProcessing: pendingPrompts.has(sessionId),
    } : null;

    const participant = participantsResult.rows[0];

    const replayEvents = eventsResult.rows.map((e) => {
      const data = typeof e.data === "string" ? JSON.parse(e.data as string) : e.data;
      return {
        ...data,
        id: e.id,
        type: e.type,
        messageId: e.message_id ?? data?.messageId,
        createdAt: e.created_at,
        timestamp: data?.timestamp ?? (e.created_at as number) / 1000,
      };
    });

    ws.send(JSON.stringify({
      type: "subscribed",
      state,
      participantId: participant?.id ?? null,
      participant: participant ? {
        id: participant.id,
        userId: participant.user_id,
        scmLogin: participant.scm_login,
        scmName: participant.scm_name,
        role: participant.role,
      } : null,
      replay: { events: replayEvents },
    }));
  } catch (err) {
    console.error(`[ws] Failed to handle subscribe for ${sessionId}:`, err);
    ws.send(JSON.stringify({ type: "error", message: "Failed to load session" }));
  }
}

function handleSandboxConnection(sessionId: string, ws: WsWebSocket): void {
  console.log(`[ws] Sandbox connected for session ${sessionId}`);
  sandboxWebSockets.set(sessionId, ws);
  broadcastToClients(sessionId, { type: "sandbox_status", status: "connecting" });

  ws.on("close", () => {
    sandboxWebSockets.delete(sessionId);
    broadcastToClients(sessionId, { type: "sandbox_status", status: "stopped" });
    console.log(`[ws] Sandbox disconnected for session ${sessionId}`);

    pool.query(
      "SELECT id, content, author_id FROM session_messages WHERE session_id = $1 AND status IN ('pending', 'processing') LIMIT 1",
      [sessionId],
    ).then((result) => {
      if (result.rows.length === 0) return;
      const msg = result.rows[0];
      console.log(`[session:${sessionId}] Re-spawning sandbox for orphaned message ${msg.id}`);
      return pool.query(
        "SELECT model, reasoning_effort FROM session_state WHERE id = $1",
        [sessionId],
      ).then((sResult) => {
        const s = sResult.rows[0];
        const authToken = crypto.randomUUID();
        pendingPrompts.set(sessionId, {
          messageId: msg.id as string,
          content: msg.content as string,
          model: (s?.model ?? "anthropic/claude-sonnet-4-6") as string,
          reasoningEffort: s?.reasoning_effort as string | undefined,
          authorId: msg.author_id as string,
          authToken,
        });
        broadcastToClients(sessionId, { type: "sandbox_status", status: "spawning" });
        return spawnSandboxForSession(sessionId, authToken);
      });
    }).catch((err) => {
      console.error(`[session:${sessionId}] Re-spawn failed:`, err);
    });
  });

  ws.on("message", async (data) => {
    try {
      const event = JSON.parse(data.toString());

      if (event.type === "ready") {
        broadcastToClients(sessionId, { type: "sandbox_ready", sandboxId: event.sandboxId });
        broadcastToClients(sessionId, { type: "sandbox_status", status: "ready" });

        const pending = pendingPrompts.get(sessionId);
        if (pending) {
          pendingPrompts.delete(sessionId);
          ws.send(JSON.stringify({
            type: "prompt",
            messageId: pending.messageId,
            content: pending.content,
            model: pending.model,
            reasoningEffort: pending.reasoningEffort,
            author: { userId: pending.authorId },
          }));
        }
        return;
      }

      if (event.type === "heartbeat") return;

      const clientCount = clientWebSockets.get(sessionId)?.size ?? 0;
      console.log(`[ws] Broadcasting ${event.type} to ${clientCount} client(s) for session ${sessionId}`);
      broadcastToClients(sessionId, { type: "sandbox_event", event });

      if (event.type === "execution_complete") {
        const messageId = event.messageId;
        if (messageId) {
          await pool.query(
            "UPDATE session_messages SET status = $1, completed_at = $2 WHERE id = $3",
            [event.success ? "completed" : "failed", Date.now(), messageId],
          );
        }
        broadcastToClients(sessionId, { type: "processing_status", isProcessing: false });
      }

      const persistTypes = ["token", "step_start", "step_finish", "tool_call", "tool_result", "execution_complete", "error", "user_message", "git_sync", "artifact"];
      if (persistTypes.includes(event.type)) {
        await pool.query(
          `INSERT INTO session_events (id, session_id, type, data, message_id, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [crypto.randomUUID().slice(0, 12), sessionId, event.type, JSON.stringify(event), event.messageId ?? null, Date.now()],
        );
      }
    } catch {
      // Ignore malformed messages
    }
  });
}

// ─── Auto-enable custom models in saved preferences ─────────────────────────

async function syncCustomModelPreferences(): Promise<void> {
  const raw = process.env.EXTRA_MODELS;
  if (!raw) return;

  let custom: CustomModelEntry[];
  try {
    custom = JSON.parse(raw);
    if (!Array.isArray(custom)) return;
  } catch {
    return;
  }

  const toAdd = custom.filter((m) => m.enabledByDefault).map((m) => m.id);
  if (toAdd.length === 0) return;

  try {
    const result = await pool.query(
      "SELECT enabled_models FROM model_preferences WHERE id = 'global'",
    );

    if (result.rows.length === 0) return;

    const current: string[] = JSON.parse(result.rows[0].enabled_models as string);
    const currentSet = new Set(current);
    const missing = toAdd.filter((id) => !currentSet.has(id));

    if (missing.length === 0) return;

    const updated = [...current, ...missing];
    await pool.query(
      "UPDATE model_preferences SET enabled_models = $1, updated_at = $2 WHERE id = 'global'",
      [JSON.stringify(updated), Date.now()],
    );
    console.log(`[control-plane] Auto-enabled custom models: ${missing.join(", ")}`);
  } catch (err) {
    console.error("[control-plane] Failed to sync custom model preferences:", err);
  }
}

syncCustomModelPreferences();

// ─── Orphaned prompt recovery ────────────────────────────────────────────────

async function recoverOrphanedPrompts(): Promise<void> {
  try {
    const result = await pool.query(
      `SELECT m.session_id, m.id as message_id, m.content, m.author_id,
              s.model, s.reasoning_effort
       FROM session_messages m
       JOIN session_state s ON s.id = m.session_id
       WHERE m.status IN ('pending', 'processing')
         AND m.created_at > $1
       ORDER BY m.created_at ASC`,
      [Date.now() - 30 * 60 * 1000],
    );

    await pool.query(
      `UPDATE session_messages SET status = 'failed', error_message = 'Orphaned after restart'
       WHERE status IN ('pending', 'processing') AND created_at <= $1`,
      [Date.now() - 30 * 60 * 1000],
    );

    if (result.rows.length === 0) return;

    console.log(`[control-plane] Recovering ${result.rows.length} orphaned prompt(s)`);

    for (const row of result.rows) {
      const sid = row.session_id as string;
      if (sandboxWebSockets.has(sid)) continue;

      const authToken = crypto.randomUUID();
      pendingPrompts.set(sid, {
        messageId: row.message_id as string,
        content: row.content as string,
        model: row.model as string,
        reasoningEffort: row.reasoning_effort as string | undefined,
        authorId: row.author_id as string,
        authToken,
      });

      spawnSandboxForSession(sid, authToken).catch((err) => {
        console.error(`[session:${sid}] Recovery spawn failed:`, err);
      });
    }
  } catch (err) {
    console.error("[control-plane] Failed to recover orphaned prompts:", err);
  }
}

setTimeout(recoverOrphanedPrompts, 5000);

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

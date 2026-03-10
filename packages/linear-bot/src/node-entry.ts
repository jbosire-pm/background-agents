/**
 * Node.js entry point for the Open-Inspect Linear Bot.
 *
 * Runs the Hono app on Node.js with Redis replacing Cloudflare KV
 * and HTTP fetch replacing the Cloudflare service binding.
 *
 * Usage: node --import tsx packages/linear-bot/src/node-entry.ts
 */

import { loadCustomModelsFromEnv } from "@open-inspect/shared";
import { serve } from "@hono/node-server";
import app from "./index";

loadCustomModelsFromEnv();

const PORT = parseInt(process.env.PORT || "3003", 10);

serve({
  fetch: (request, _env) => {
    const nodeEnv = {
      LINEAR_KV: createRedisKV(),
      CONTROL_PLANE: createFetcherProxy(process.env.CONTROL_PLANE_URL || "http://localhost:8787"),

      DEPLOYMENT_NAME: process.env.DEPLOYMENT_NAME || "docker",
      CONTROL_PLANE_URL: process.env.CONTROL_PLANE_URL || "http://localhost:8787",
      WEB_APP_URL: process.env.WEB_APP_URL || "http://localhost:3000",
      DEFAULT_MODEL: process.env.DEFAULT_MODEL || "anthropic/claude-haiku-4-5",
      WORKER_URL: process.env.WORKER_URL || `http://localhost:${PORT}`,

      LINEAR_CLIENT_ID: process.env.LINEAR_CLIENT_ID || "",
      LINEAR_CLIENT_SECRET: process.env.LINEAR_CLIENT_SECRET || "",
      LINEAR_WEBHOOK_SECRET: process.env.LINEAR_WEBHOOK_SECRET || "",
      LINEAR_API_KEY: process.env.LINEAR_API_KEY,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
      INTERNAL_CALLBACK_SECRET: process.env.INTERNAL_CALLBACK_SECRET,
      LOG_LEVEL: process.env.LOG_LEVEL || "info",
    };

    return app.fetch(request, nodeEnv, {
      waitUntil: (p: Promise<unknown>) => {
        p.catch(console.error);
      },
      passThroughOnException: () => {},
    });
  },
  port: PORT,
});

console.log(`[linear-bot] Node.js server running on http://localhost:${PORT}`);

// ─── Adapters ────────────────────────────────────────────────────────────────

import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

function createRedisKV(): KVNamespace {
  return {
    get: async (key: string, options?: unknown) => {
      const val = await redis.get(key);
      if (val === null) return null;
      if (
        options === "json" ||
        (typeof options === "object" &&
          options &&
          (options as Record<string, unknown>).type === "json")
      ) {
        try {
          return JSON.parse(val);
        } catch {
          return null;
        }
      }
      return val;
    },
    put: async (key: string, value: string, options?: { expirationTtl?: number }) => {
      if (options?.expirationTtl) {
        await redis.set(key, value, "EX", options.expirationTtl);
      } else {
        await redis.set(key, value);
      }
    },
    delete: async (key: string) => {
      await redis.del(key);
    },
    list: async () => ({ keys: [], list_complete: true, cursor: "" }),
    getWithMetadata: async () => ({ value: null, metadata: null }),
  } as unknown as KVNamespace;
}

function createFetcherProxy(baseUrl: string): Fetcher {
  return {
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input.replace(/^https?:\/\/internal/, baseUrl) : input;
      return globalThis.fetch(url, init);
    },
    connect: () => {
      throw new Error("connect not supported in Node.js");
    },
  } as unknown as Fetcher;
}

process.on("SIGTERM", () => {
  redis.disconnect();
  process.exit(0);
});
process.on("SIGINT", () => {
  redis.disconnect();
  process.exit(0);
});

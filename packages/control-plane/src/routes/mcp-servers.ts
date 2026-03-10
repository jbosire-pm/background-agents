import type { Env } from "../types";
import type { RequestContext, Route } from "./shared";
import { parsePattern, json, error } from "./shared";
import { McpServerStore } from "../db/mcp-servers";

function generateId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

async function handleListMcpServers(
  _request: Request,
  env: Env,
  _match: RegExpMatchArray,
  _ctx: RequestContext,
): Promise<Response> {
  const store = new McpServerStore(env.DB);
  const servers = await store.list();
  return json({ servers });
}

async function handleCreateMcpServer(
  request: Request,
  env: Env,
  _match: RegExpMatchArray,
  _ctx: RequestContext,
): Promise<Response> {
  const body = (await request.json()) as {
    name?: string;
    type?: string;
    url?: string;
    command?: string[];
    environment?: Record<string, string>;
    enabled?: boolean;
  };

  if (!body.name || !body.type) {
    return error("name and type are required");
  }

  if (body.type !== "remote" && body.type !== "local") {
    return error("type must be 'remote' or 'local'");
  }

  if (body.type === "remote" && !body.url) {
    return error("url is required for remote MCP servers");
  }

  if (body.type === "local" && (!body.command || body.command.length === 0)) {
    return error("command is required for local MCP servers");
  }

  const id = generateId();
  const store = new McpServerStore(env.DB);
  await store.create({
    id,
    name: body.name,
    type: body.type,
    url: body.url ?? null,
    command: body.command ?? null,
    environment: body.environment ?? null,
    enabled: body.enabled ?? true,
  });

  return json({ id, name: body.name }, 201);
}

async function handleUpdateMcpServer(
  request: Request,
  env: Env,
  match: RegExpMatchArray,
  _ctx: RequestContext,
): Promise<Response> {
  const id = match.groups?.id;
  if (!id) return error("Server ID required");

  const body = (await request.json()) as {
    name?: string;
    type?: "remote" | "local";
    url?: string | null;
    command?: string[] | null;
    environment?: Record<string, string> | null;
    enabled?: boolean;
  };

  const store = new McpServerStore(env.DB);
  const updated = await store.update(id, body);
  if (!updated) return error("MCP server not found", 404);

  return json({ status: "updated" });
}

async function handleDeleteMcpServer(
  _request: Request,
  env: Env,
  match: RegExpMatchArray,
  _ctx: RequestContext,
): Promise<Response> {
  const id = match.groups?.id;
  if (!id) return error("Server ID required");

  const store = new McpServerStore(env.DB);
  await store.delete(id);
  return json({ status: "deleted" });
}

export const mcpServerRoutes: Route[] = [
  {
    method: "GET",
    pattern: parsePattern("/mcp-servers"),
    handler: handleListMcpServers,
  },
  {
    method: "POST",
    pattern: parsePattern("/mcp-servers"),
    handler: handleCreateMcpServer,
  },
  {
    method: "PUT",
    pattern: parsePattern("/mcp-servers/:id"),
    handler: handleUpdateMcpServer,
  },
  {
    method: "DELETE",
    pattern: parsePattern("/mcp-servers/:id"),
    handler: handleDeleteMcpServer,
  },
];

export interface McpServerRecord {
  id: string;
  name: string;
  type: "remote" | "local";
  url: string | null;
  command: string[] | null;
  environment: Record<string, string> | null;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

interface McpServerRow {
  id: string;
  name: string;
  type: string;
  url: string | null;
  command: string | null;
  environment: string | null;
  enabled: number;
  created_at: number;
  updated_at: number;
}

function rowToRecord(row: McpServerRow): McpServerRecord {
  return {
    id: row.id,
    name: row.name,
    type: row.type as "remote" | "local",
    url: row.url,
    command: row.command ? JSON.parse(row.command) : null,
    environment: row.environment ? JSON.parse(row.environment) : null,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class McpServerStore {
  constructor(private readonly db: D1Database) {}

  async list(): Promise<McpServerRecord[]> {
    const result = await this.db
      .prepare("SELECT * FROM mcp_servers ORDER BY name")
      .all<McpServerRow>();
    return result.results.map(rowToRecord);
  }

  async listEnabled(): Promise<McpServerRecord[]> {
    const result = await this.db
      .prepare("SELECT * FROM mcp_servers WHERE enabled = 1 ORDER BY name")
      .all<McpServerRow>();
    return result.results.map(rowToRecord);
  }

  async get(id: string): Promise<McpServerRecord | null> {
    const row = await this.db
      .prepare("SELECT * FROM mcp_servers WHERE id = ?")
      .bind(id)
      .first<McpServerRow>();
    return row ? rowToRecord(row) : null;
  }

  async create(server: Omit<McpServerRecord, "createdAt" | "updatedAt">): Promise<void> {
    const now = Date.now();
    await this.db
      .prepare(
        `INSERT INTO mcp_servers (id, name, type, url, command, environment, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        server.id,
        server.name,
        server.type,
        server.url ?? null,
        server.command ? JSON.stringify(server.command) : null,
        server.environment ? JSON.stringify(server.environment) : null,
        server.enabled ? 1 : 0,
        now,
        now,
      )
      .run();
  }

  async update(
    id: string,
    updates: Partial<Omit<McpServerRecord, "id" | "createdAt" | "updatedAt">>,
  ): Promise<boolean> {
    const existing = await this.get(id);
    if (!existing) return false;

    const now = Date.now();
    await this.db
      .prepare(
        `UPDATE mcp_servers
         SET name = ?, type = ?, url = ?, command = ?, environment = ?, enabled = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        updates.name ?? existing.name,
        updates.type ?? existing.type,
        updates.url !== undefined ? updates.url : existing.url,
        updates.command !== undefined
          ? updates.command ? JSON.stringify(updates.command) : null
          : existing.command ? JSON.stringify(existing.command) : null,
        updates.environment !== undefined
          ? updates.environment ? JSON.stringify(updates.environment) : null
          : existing.environment ? JSON.stringify(existing.environment) : null,
        updates.enabled !== undefined ? (updates.enabled ? 1 : 0) : (existing.enabled ? 1 : 0),
        now,
        id,
      )
      .run();
    return true;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db
      .prepare("DELETE FROM mcp_servers WHERE id = ?")
      .bind(id)
      .run();
    return result.success;
  }
}

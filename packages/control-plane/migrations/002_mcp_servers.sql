-- MCP server configurations managed via the web UI.

CREATE TABLE IF NOT EXISTS mcp_servers (
  id         TEXT    PRIMARY KEY,
  name       TEXT    NOT NULL,
  type       TEXT    NOT NULL,
  url        TEXT,
  command    TEXT,
  environment TEXT,
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at BIGINT  NOT NULL,
  updated_at BIGINT  NOT NULL
);

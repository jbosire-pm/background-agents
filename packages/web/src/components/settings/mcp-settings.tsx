"use client";

import { useState } from "react";
import useSWR, { mutate } from "swr";
import { Button } from "@/components/ui/button";
import { GlobeIcon, TerminalIcon } from "@/components/ui/icons";

const MCP_SERVERS_KEY = "/api/mcp-servers";

interface McpServer {
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

interface McpServersResponse {
  servers: McpServer[];
}

export function McpSettings() {
  const { data, isLoading } = useSWR<McpServersResponse>(MCP_SERVERS_KEY);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const servers = data?.servers ?? [];

  const handleToggle = async (server: McpServer) => {
    try {
      await fetch(`/api/mcp-servers/${server.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !server.enabled }),
      });
      mutate(MCP_SERVERS_KEY);
    } catch {
      setError("Failed to update server");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/mcp-servers/${id}`, { method: "DELETE" });
      mutate(MCP_SERVERS_KEY);
      setSuccess("MCP server removed.");
    } catch {
      setError("Failed to delete server");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
        Loading MCP servers...
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-xl font-semibold text-foreground">MCP Servers</h2>
        <Button onClick={() => { setShowForm(true); setEditingId(null); }}>
          Add Server
        </Button>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        Configure Model Context Protocol servers available to the coding agent in sandboxes.
      </p>

      {error && (
        <div className="mb-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 px-4 py-3 border border-red-200 dark:border-red-800 text-sm">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 px-4 py-3 border border-green-200 dark:border-green-800 text-sm">
          {success}
        </div>
      )}

      {showForm && (
        <McpServerForm
          editingServer={editingId ? servers.find((s) => s.id === editingId) : undefined}
          onSave={() => {
            setShowForm(false);
            setEditingId(null);
            setSuccess(editingId ? "MCP server updated." : "MCP server added.");
            mutate(MCP_SERVERS_KEY);
          }}
          onCancel={() => { setShowForm(false); setEditingId(null); }}
        />
      )}

      {servers.length === 0 && !showForm && (
        <div className="text-sm text-muted-foreground py-8 text-center border border-dashed border-border">
          No MCP servers configured. Add one to give the agent access to external tools.
        </div>
      )}

      <div className="space-y-2 mt-4">
        {servers.map((server) => (
          <div
            key={server.id}
            className="flex items-center justify-between px-4 py-3 border border-border hover:bg-muted/50 transition"
          >
            <div className="flex items-center gap-3 min-w-0">
              {server.type === "remote" ? (
                <GlobeIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              ) : (
                <TerminalIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              )}
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">{server.name}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {server.type === "remote" ? server.url : server.command?.join(" ")}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => { setEditingId(server.id); setShowForm(true); }}
                className="text-xs text-accent hover:text-accent/80 transition"
              >
                Edit
              </button>
              <button
                onClick={() => handleDelete(server.id)}
                className="text-xs text-red-500 hover:text-red-400 transition"
              >
                Remove
              </button>
              <label className="relative cursor-pointer">
                <input
                  type="checkbox"
                  checked={server.enabled}
                  onChange={() => handleToggle(server)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-muted rounded-full peer-checked:bg-accent transition-colors" />
                <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-4" />
              </label>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function McpServerForm({
  editingServer,
  onSave,
  onCancel,
}: {
  editingServer?: McpServer;
  onSave: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(editingServer?.name ?? "");
  const [type, setType] = useState<"remote" | "local">(editingServer?.type ?? "remote");
  const [url, setUrl] = useState(editingServer?.url ?? "");
  const [command, setCommand] = useState(editingServer?.command?.join(" ") ?? "");
  const [envVars, setEnvVars] = useState(
    editingServer?.environment ? Object.entries(editingServer.environment).map(([k, v]) => `${k}=${v}`).join("\n") : "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");

    const environment: Record<string, string> = {};
    if (envVars.trim()) {
      for (const line of envVars.split("\n")) {
        const eq = line.indexOf("=");
        if (eq > 0) {
          environment[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
        }
      }
    }

    const body = {
      name,
      type,
      url: type === "remote" ? url : null,
      command: type === "local" ? command.split(/\s+/) : null,
      environment: Object.keys(environment).length > 0 ? environment : null,
      enabled: editingServer?.enabled ?? true,
    };

    try {
      const res = editingServer
        ? await fetch(`/api/mcp-servers/${editingServer.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch("/api/mcp-servers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

      if (res.ok) {
        onSave();
      } else {
        const data = await res.json();
        setError(data.error || "Failed to save");
      }
    } catch {
      setError("Failed to save MCP server");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="border border-border p-4 mb-4 space-y-4">
      <h3 className="text-sm font-medium text-foreground">
        {editingServer ? "Edit MCP Server" : "Add MCP Server"}
      </h3>

      {error && (
        <div className="text-sm text-red-500">{error}</div>
      )}

      <div>
        <label className="block text-xs text-muted-foreground mb-1">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. context7"
          required
          className="w-full px-3 py-2 text-sm bg-background border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      <div>
        <label className="block text-xs text-muted-foreground mb-1">Type</label>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as "remote" | "local")}
          className="w-full px-3 py-2 text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <option value="remote">Remote (URL)</option>
          <option value="local">Local (Command)</option>
        </select>
      </div>

      {type === "remote" ? (
        <div>
          <label className="block text-xs text-muted-foreground mb-1">URL</label>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://mcp.example.com/mcp"
            required
            className="w-full px-3 py-2 text-sm bg-background border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
      ) : (
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Command</label>
          <input
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="npx -y @some/mcp-server"
            required
            className="w-full px-3 py-2 text-sm bg-background border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
      )}

      <div>
        <label className="block text-xs text-muted-foreground mb-1">
          Environment Variables <span className="text-muted-foreground/60">(optional, one per line: KEY=value)</span>
        </label>
        <textarea
          value={envVars}
          onChange={(e) => setEnvVars(e.target.value)}
          placeholder={"API_KEY=sk-...\nBASE_URL=https://..."}
          rows={3}
          className="w-full px-3 py-2 text-sm bg-background border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent font-mono"
        />
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving..." : editingServer ? "Update" : "Add"}
        </Button>
        <Button type="button" onClick={onCancel} variant="outline">
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * Node.js session manager replacing Durable Objects.
 *
 * Provides a DurableObjectNamespace-compatible interface that handles
 * session requests locally using PostgreSQL instead of DO SQLite.
 */

type PgPool = {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

class NodeSessionStub {
  constructor(
    private readonly sessionName: string,
    private readonly pool: PgPool,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === "/internal/init" && request.method === "POST") {
        return this.handleInit(request);
      }
      if (path === "/internal/state") {
        return this.handleGetState();
      }
      if (path === "/internal/prompt" && request.method === "POST") {
        return this.handlePrompt(request);
      }
      if (path === "/internal/stop" && request.method === "POST") {
        return this.handleStop();
      }
      if (path === "/internal/events") {
        return this.handleGetEvents(url);
      }
      if (path === "/internal/messages") {
        return this.handleGetMessages(url);
      }
      if (path === "/internal/participants") {
        if (request.method === "POST") return this.handleAddParticipant(request);
        return this.handleGetParticipants();
      }
      if (path === "/internal/artifacts") {
        return this.handleGetArtifacts();
      }
      if (path === "/internal/ws-token" && request.method === "POST") {
        return this.handleWsToken(request);
      }
      if (path === "/internal/archive" && request.method === "POST") {
        return this.handleArchive();
      }
      if (path === "/internal/unarchive" && request.method === "POST") {
        return this.handleUnarchive();
      }
      if (path === "/internal/verify-sandbox-token" && request.method === "POST") {
        return jsonResponse({ valid: false }, 401);
      }
      if (path === "/internal/spawn-context") {
        return this.handleGetSpawnContext();
      }
      if (path === "/internal/child-summary") {
        return this.handleGetState();
      }
      if (path === "/internal/cancel" && request.method === "POST") {
        return this.handleStop();
      }

      return jsonResponse({ error: "Not found" }, 404);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[session:${this.sessionName}] Error handling ${path}:`, message);
      return jsonResponse({ error: "Internal session error" }, 500);
    }
  }

  private async handleInit(request: Request): Promise<Response> {
    const body = await request.json() as Record<string, unknown>;
    const now = Date.now();

    await this.pool.query(
      `INSERT INTO session_state (id, session_name, title, repo_owner, repo_name, repo_id,
        base_branch, branch_name, model, reasoning_effort, status,
        parent_session_id, spawn_source, spawn_depth, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'created',$11,$12,$13,$14,$14)
       ON CONFLICT (id) DO NOTHING`,
      [
        this.sessionName,
        body.sessionName,
        body.title,
        body.repoOwner,
        body.repoName,
        body.repoId ?? null,
        body.branch ?? body.defaultBranch ?? "main",
        null,
        body.model ?? "anthropic/claude-sonnet-4-6",
        body.reasoningEffort ?? null,
        body.parentSessionId ?? null,
        body.spawnSource ?? "user",
        body.spawnDepth ?? 0,
        now,
      ],
    );

    const participantId = crypto.randomUUID().slice(0, 12);
    await this.pool.query(
      `INSERT INTO session_participants (id, session_id, user_id, scm_login, scm_name, scm_email, role, joined_at)
       VALUES ($1,$2,$3,$4,$5,$6,'owner',$7)
       ON CONFLICT (id) DO NOTHING`,
      [
        participantId,
        this.sessionName,
        body.userId ?? "anonymous",
        body.scmLogin ?? null,
        body.scmName ?? null,
        body.scmEmail ?? null,
        now,
      ],
    );

    return jsonResponse({ status: "initialized" });
  }

  private async handleGetState(): Promise<Response> {
    const result = await this.pool.query(
      `SELECT id, title, repo_owner, repo_name, base_branch, branch_name,
              base_sha, current_sha, opencode_session_id, model,
              reasoning_effort, status, parent_session_id, spawn_source,
              spawn_depth, created_at, updated_at
       FROM session_state WHERE id = $1`,
      [this.sessionName],
    );

    if (result.rows.length === 0) {
      return jsonResponse({ error: "Session not found" }, 404);
    }

    const s = result.rows[0];
    return jsonResponse({
      id: s.id,
      title: s.title,
      repoOwner: s.repo_owner,
      repoName: s.repo_name,
      baseBranch: s.base_branch,
      branchName: s.branch_name,
      baseSha: s.base_sha,
      currentSha: s.current_sha,
      opencodeSessionId: s.opencode_session_id,
      model: s.model,
      reasoningEffort: s.reasoning_effort,
      status: s.status,
      parentSessionId: s.parent_session_id,
      spawnSource: s.spawn_source,
      spawnDepth: s.spawn_depth,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
    });
  }

  private async handlePrompt(request: Request): Promise<Response> {
    const body = await request.json() as Record<string, unknown>;
    const messageId = crypto.randomUUID().slice(0, 12);
    const now = Date.now();

    await this.pool.query(
      `INSERT INTO session_messages (id, session_id, author_id, content, source, model,
        reasoning_effort, attachments, callback_context, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10)`,
      [
        messageId,
        this.sessionName,
        body.authorId ?? "anonymous",
        body.content,
        body.source ?? "web",
        body.model ?? null,
        body.reasoningEffort ?? null,
        body.attachments ? JSON.stringify(body.attachments) : null,
        body.callbackContext ? JSON.stringify(body.callbackContext) : null,
        now,
      ],
    );

    await this.pool.query(
      `UPDATE session_state SET status = 'active', updated_at = $2 WHERE id = $1`,
      [this.sessionName, now],
    );

    return jsonResponse({ messageId });
  }

  private async handleStop(): Promise<Response> {
    await this.pool.query(
      `UPDATE session_state SET status = 'completed', updated_at = $2 WHERE id = $1`,
      [this.sessionName, Date.now()],
    );
    return jsonResponse({ status: "stopped" });
  }

  private async handleGetEvents(url: URL): Promise<Response> {
    const cursor = url.searchParams.get("cursor");
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 200);

    let query = `SELECT id, type, data, message_id, created_at FROM session_events
                 WHERE session_id = $1`;
    const params: unknown[] = [this.sessionName];

    if (cursor) {
      query += ` AND (created_at, id) > ($${params.length + 1}, $${params.length + 2})`;
      const [cursorTs, cursorId] = cursor.split(":");
      params.push(parseInt(cursorTs, 10), cursorId);
    }

    query += ` ORDER BY created_at, id LIMIT $${params.length + 1}`;
    params.push(limit + 1);

    const result = await this.pool.query(query, params);
    const hasMore = result.rows.length > limit;
    const events = result.rows.slice(0, limit).map((e) => ({
      id: e.id,
      type: e.type,
      data: typeof e.data === "string" ? JSON.parse(e.data as string) : e.data,
      messageId: e.message_id,
      createdAt: e.created_at,
    }));

    const lastEvent = events[events.length - 1];
    const nextCursor = hasMore && lastEvent
      ? `${lastEvent.createdAt}:${lastEvent.id}`
      : undefined;

    return jsonResponse({ events, cursor: nextCursor, hasMore });
  }

  private async handleGetMessages(url: URL): Promise<Response> {
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 200);
    const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);

    const result = await this.pool.query(
      `SELECT id, author_id, content, source, status, error_message,
              created_at, started_at, completed_at
       FROM session_messages WHERE session_id = $1
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [this.sessionName, limit, offset],
    );

    return jsonResponse({
      messages: result.rows.map((m) => ({
        id: m.id,
        authorId: m.author_id,
        content: m.content,
        source: m.source,
        status: m.status,
        createdAt: m.created_at,
        startedAt: m.started_at,
        completedAt: m.completed_at,
      })),
    });
  }

  private async handleGetParticipants(): Promise<Response> {
    const result = await this.pool.query(
      `SELECT id, user_id, scm_login, scm_name, role, joined_at
       FROM session_participants WHERE session_id = $1`,
      [this.sessionName],
    );

    return jsonResponse({
      participants: result.rows.map((p) => ({
        id: p.id,
        userId: p.user_id,
        scmLogin: p.scm_login,
        scmName: p.scm_name,
        role: p.role,
        joinedAt: p.joined_at,
      })),
    });
  }

  private async handleAddParticipant(request: Request): Promise<Response> {
    const body = await request.json() as Record<string, unknown>;
    const id = crypto.randomUUID().slice(0, 12);
    const now = Date.now();

    await this.pool.query(
      `INSERT INTO session_participants (id, session_id, user_id, scm_login, scm_name, role, joined_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, this.sessionName, body.userId, body.scmLogin ?? null, body.scmName ?? null, body.role ?? "member", now],
    );

    return jsonResponse({ id, userId: body.userId, role: body.role ?? "member", joinedAt: now }, 201);
  }

  private async handleGetArtifacts(): Promise<Response> {
    const result = await this.pool.query(
      `SELECT id, type, url, metadata, created_at
       FROM session_artifacts WHERE session_id = $1 ORDER BY created_at`,
      [this.sessionName],
    );

    return jsonResponse({
      artifacts: result.rows.map((a) => ({
        id: a.id,
        type: a.type,
        url: a.url,
        metadata: typeof a.metadata === "string" ? JSON.parse(a.metadata as string) : a.metadata,
        createdAt: a.created_at,
      })),
    });
  }

  private async handleWsToken(request: Request): Promise<Response> {
    const body = await request.json() as Record<string, unknown>;
    const token = crypto.randomUUID();
    return jsonResponse({ token, userId: body.userId });
  }

  private async handleArchive(): Promise<Response> {
    await this.pool.query(
      `UPDATE session_state SET status = 'archived', updated_at = $2 WHERE id = $1`,
      [this.sessionName, Date.now()],
    );
    return jsonResponse({ status: "archived" });
  }

  private async handleUnarchive(): Promise<Response> {
    await this.pool.query(
      `UPDATE session_state SET status = 'active', updated_at = $2 WHERE id = $1`,
      [this.sessionName, Date.now()],
    );
    return jsonResponse({ status: "active" });
  }

  private async handleGetSpawnContext(): Promise<Response> {
    const result = await this.pool.query(
      `SELECT s.repo_owner, s.repo_name, s.repo_id, s.base_branch, s.model,
              s.reasoning_effort, p.user_id, p.scm_login, p.scm_name, p.scm_email,
              p.scm_access_token_encrypted
       FROM session_state s
       LEFT JOIN session_participants p ON p.session_id = s.id AND p.role = 'owner'
       WHERE s.id = $1`,
      [this.sessionName],
    );

    if (result.rows.length === 0) {
      return jsonResponse({ error: "Session not found" }, 404);
    }

    const r = result.rows[0];
    return jsonResponse({
      repoOwner: r.repo_owner,
      repoName: r.repo_name,
      repoId: r.repo_id,
      baseBranch: r.base_branch,
      model: r.model,
      reasoningEffort: r.reasoning_effort,
      owner: {
        userId: r.user_id,
        scmLogin: r.scm_login,
        scmName: r.scm_name,
        scmEmail: r.scm_email,
        scmAccessTokenEncrypted: r.scm_access_token_encrypted,
      },
    });
  }
}

class NodeSessionId {
  constructor(readonly name: string) {}
  toString(): string {
    return this.name;
  }
}

export class NodeSessionNamespace {
  constructor(private readonly pool: PgPool) {}

  idFromName(name: string): NodeSessionId {
    return new NodeSessionId(name);
  }

  get(id: NodeSessionId): NodeSessionStub {
    return new NodeSessionStub(id.name, this.pool);
  }
}

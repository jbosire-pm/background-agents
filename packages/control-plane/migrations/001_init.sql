-- Open-Inspect PostgreSQL Schema
-- Consolidated from D1 migrations + Durable Object SQLite schema.
-- Compatible with PostgreSQL 14+.

-- ═══════════════════════════════════════════════════════════════════
-- D1 tables (global state)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS repo_secrets (
  repo_id         BIGINT  NOT NULL,
  repo_owner      TEXT    NOT NULL,
  repo_name       TEXT    NOT NULL,
  key             TEXT    NOT NULL,
  encrypted_value TEXT    NOT NULL,
  created_at      BIGINT  NOT NULL,
  updated_at      BIGINT  NOT NULL,
  PRIMARY KEY (repo_id, key)
);

CREATE INDEX IF NOT EXISTS idx_repo_secrets_repo_name
  ON repo_secrets (repo_owner, repo_name);

CREATE TABLE IF NOT EXISTS sessions (
  id                TEXT    PRIMARY KEY,
  title             TEXT,
  repo_owner        TEXT    NOT NULL,
  repo_name         TEXT    NOT NULL,
  model             TEXT    NOT NULL DEFAULT 'anthropic/claude-haiku-4-5',
  reasoning_effort  TEXT,
  base_branch       TEXT,
  status            TEXT    NOT NULL DEFAULT 'created',
  parent_session_id TEXT,
  spawn_source      TEXT    NOT NULL DEFAULT 'user',
  spawn_depth       INTEGER NOT NULL DEFAULT 0,
  automation_id     TEXT,
  automation_run_id TEXT,
  created_at        BIGINT  NOT NULL,
  updated_at        BIGINT  NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_status_updated
  ON sessions (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_repo
  ON sessions (repo_owner, repo_name, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_parent_session_id
  ON sessions (parent_session_id)
  WHERE parent_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_automation
  ON sessions (automation_id)
  WHERE automation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS repo_metadata (
  repo_owner           TEXT NOT NULL,
  repo_name            TEXT NOT NULL,
  description          TEXT,
  aliases              TEXT,
  channel_associations TEXT,
  keywords             TEXT,
  image_build_enabled  INTEGER NOT NULL DEFAULT 0,
  created_at           BIGINT  NOT NULL,
  updated_at           BIGINT  NOT NULL,
  PRIMARY KEY (repo_owner, repo_name)
);

CREATE TABLE IF NOT EXISTS global_secrets (
  key             TEXT   NOT NULL PRIMARY KEY,
  encrypted_value TEXT   NOT NULL,
  created_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS model_preferences (
  id             TEXT PRIMARY KEY DEFAULT 'global',
  enabled_models TEXT   NOT NULL,
  updated_at     BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS integration_settings (
  integration_id TEXT PRIMARY KEY,
  settings       TEXT   NOT NULL,
  created_at     BIGINT NOT NULL,
  updated_at     BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS integration_repo_settings (
  integration_id TEXT   NOT NULL,
  repo           TEXT   NOT NULL,
  settings       TEXT   NOT NULL,
  created_at     BIGINT NOT NULL,
  updated_at     BIGINT NOT NULL,
  PRIMARY KEY (integration_id, repo)
);

CREATE TABLE IF NOT EXISTS user_scm_tokens (
  provider_user_id        TEXT   NOT NULL PRIMARY KEY,
  access_token_encrypted  TEXT   NOT NULL,
  refresh_token_encrypted TEXT   NOT NULL,
  token_expires_at        BIGINT NOT NULL,
  created_at              BIGINT NOT NULL,
  updated_at              BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS repo_images (
  id                   TEXT PRIMARY KEY,
  repo_owner           TEXT   NOT NULL,
  repo_name            TEXT   NOT NULL,
  provider_image_id    TEXT   NOT NULL,
  base_sha             TEXT   NOT NULL,
  base_branch          TEXT   NOT NULL DEFAULT 'main',
  status               TEXT   NOT NULL DEFAULT 'building',
  build_duration_seconds DOUBLE PRECISION,
  error_message        TEXT,
  created_at           BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
);

CREATE INDEX IF NOT EXISTS idx_repo_images_repo_status
  ON repo_images (repo_owner, repo_name, status);

CREATE TABLE IF NOT EXISTS automations (
  id                   TEXT    PRIMARY KEY,
  name                 TEXT    NOT NULL,
  repo_owner           TEXT    NOT NULL,
  repo_name            TEXT    NOT NULL,
  base_branch          TEXT    NOT NULL,
  repo_id              BIGINT,
  instructions         TEXT    NOT NULL,
  trigger_type         TEXT    NOT NULL DEFAULT 'schedule',
  schedule_cron        TEXT,
  schedule_tz          TEXT    NOT NULL DEFAULT 'UTC',
  model                TEXT    NOT NULL,
  enabled              INTEGER NOT NULL DEFAULT 1,
  next_run_at          BIGINT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_by           TEXT    NOT NULL,
  created_at           BIGINT  NOT NULL,
  updated_at           BIGINT  NOT NULL,
  deleted_at           BIGINT
);

CREATE INDEX IF NOT EXISTS idx_automations_schedule_due
  ON automations (enabled, trigger_type, next_run_at)
  WHERE enabled = 1 AND deleted_at IS NULL AND trigger_type = 'schedule';

CREATE INDEX IF NOT EXISTS idx_automations_repo
  ON automations (repo_owner, repo_name)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS automation_runs (
  id             TEXT   PRIMARY KEY,
  automation_id  TEXT   NOT NULL REFERENCES automations(id),
  session_id     TEXT,
  status         TEXT   NOT NULL DEFAULT 'starting',
  skip_reason    TEXT,
  failure_reason TEXT,
  scheduled_at   BIGINT NOT NULL,
  started_at     BIGINT,
  completed_at   BIGINT,
  created_at     BIGINT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_idempotency
  ON automation_runs (automation_id, scheduled_at);

CREATE INDEX IF NOT EXISTS idx_runs_automation_status
  ON automation_runs (automation_id, status);

CREATE INDEX IF NOT EXISTS idx_runs_automation_created
  ON automation_runs (automation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_runs_session
  ON automation_runs (session_id)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_runs_active_status
  ON automation_runs (status, created_at)
  WHERE status IN ('starting', 'running');


-- ═══════════════════════════════════════════════════════════════════
-- Session state tables (migrated from per-DO SQLite)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS session_state (
  id                   TEXT PRIMARY KEY,
  session_name         TEXT,
  title                TEXT,
  repo_owner           TEXT    NOT NULL,
  repo_name            TEXT    NOT NULL,
  repo_id              BIGINT,
  base_branch          TEXT    NOT NULL DEFAULT 'main',
  branch_name          TEXT,
  base_sha             TEXT,
  current_sha          TEXT,
  opencode_session_id  TEXT,
  model                TEXT    DEFAULT 'anthropic/claude-haiku-4-5',
  reasoning_effort     TEXT,
  status               TEXT    DEFAULT 'created',
  parent_session_id    TEXT,
  spawn_source         TEXT    NOT NULL DEFAULT 'user',
  spawn_depth          INTEGER NOT NULL DEFAULT 0,
  created_at           BIGINT  NOT NULL,
  updated_at           BIGINT  NOT NULL
);

CREATE TABLE IF NOT EXISTS session_participants (
  id                        TEXT PRIMARY KEY,
  session_id                TEXT    NOT NULL REFERENCES session_state(id) ON DELETE CASCADE,
  user_id                   TEXT    NOT NULL,
  scm_user_id               TEXT,
  scm_login                 TEXT,
  scm_email                 TEXT,
  scm_name                  TEXT,
  role                      TEXT    NOT NULL DEFAULT 'member',
  scm_access_token_encrypted  TEXT,
  scm_refresh_token_encrypted TEXT,
  scm_token_expires_at      BIGINT,
  ws_auth_token             TEXT,
  ws_token_created_at       BIGINT,
  joined_at                 BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_participants_session
  ON session_participants (session_id);

CREATE INDEX IF NOT EXISTS idx_session_participants_user
  ON session_participants (user_id);

CREATE TABLE IF NOT EXISTS session_messages (
  id               TEXT PRIMARY KEY,
  session_id       TEXT   NOT NULL REFERENCES session_state(id) ON DELETE CASCADE,
  author_id        TEXT   NOT NULL,
  content          TEXT   NOT NULL,
  source           TEXT   NOT NULL,
  model            TEXT,
  reasoning_effort TEXT,
  attachments      TEXT,
  callback_context TEXT,
  status           TEXT   DEFAULT 'pending',
  error_message    TEXT,
  created_at       BIGINT NOT NULL,
  started_at       BIGINT,
  completed_at     BIGINT
);

CREATE INDEX IF NOT EXISTS idx_session_messages_session
  ON session_messages (session_id);

CREATE INDEX IF NOT EXISTS idx_session_messages_status
  ON session_messages (session_id, status);

CREATE TABLE IF NOT EXISTS session_events (
  id         TEXT PRIMARY KEY,
  session_id TEXT   NOT NULL REFERENCES session_state(id) ON DELETE CASCADE,
  type       TEXT   NOT NULL,
  data       TEXT   NOT NULL,
  message_id TEXT,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_events_session
  ON session_events (session_id);

CREATE INDEX IF NOT EXISTS idx_session_events_type
  ON session_events (session_id, type);

CREATE INDEX IF NOT EXISTS idx_session_events_created
  ON session_events (session_id, created_at, id);

CREATE TABLE IF NOT EXISTS session_artifacts (
  id         TEXT PRIMARY KEY,
  session_id TEXT   NOT NULL REFERENCES session_state(id) ON DELETE CASCADE,
  type       TEXT   NOT NULL,
  url        TEXT,
  metadata   TEXT,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_artifacts_session
  ON session_artifacts (session_id);

CREATE TABLE IF NOT EXISTS session_sandbox (
  id                  TEXT PRIMARY KEY,
  session_id          TEXT   NOT NULL REFERENCES session_state(id) ON DELETE CASCADE,
  modal_sandbox_id    TEXT,
  modal_object_id     TEXT,
  snapshot_id         TEXT,
  snapshot_image_id   TEXT,
  auth_token          TEXT,
  auth_token_hash     TEXT,
  status              TEXT   DEFAULT 'pending',
  git_sync_status     TEXT   DEFAULT 'pending',
  last_heartbeat      BIGINT,
  last_activity       BIGINT,
  last_spawn_error    TEXT,
  last_spawn_error_at BIGINT,
  spawn_failure_count INTEGER DEFAULT 0,
  last_spawn_failure  BIGINT,
  created_at          BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_sandbox_session
  ON session_sandbox (session_id);

CREATE TABLE IF NOT EXISTS session_ws_client_mapping (
  ws_id          TEXT PRIMARY KEY,
  session_id     TEXT   NOT NULL REFERENCES session_state(id) ON DELETE CASCADE,
  participant_id TEXT   NOT NULL,
  client_id      TEXT,
  created_at     BIGINT NOT NULL
);

-- Migration tracking is handled by the migration runner (run.ts).

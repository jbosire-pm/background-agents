"""
FastAPI endpoints for the Docker sandbox manager.

Exposes the same HTTP API that the control plane expects from Modal.
"""

from __future__ import annotations

import logging

from fastapi import Depends, FastAPI, Header
from pydantic import BaseModel

from .auth import require_auth
from .manager import create_sandbox, restore_sandbox, snapshot_sandbox, stop_sandbox

log = logging.getLogger("sandbox-api")

app = FastAPI(title="Open-Inspect Sandbox Manager", version="0.1.0")


class CreateSandboxRequest(BaseModel):
  session_id: str
  sandbox_id: str | None = None
  repo_owner: str
  repo_name: str
  control_plane_url: str
  sandbox_auth_token: str
  model: str = "anthropic/claude-sonnet-4-5"
  provider: str = "anthropic"
  opencode_session_id: str | None = None
  user_env_vars: dict[str, str] | None = None
  repo_image_id: str | None = None
  repo_image_sha: str | None = None
  timeout_seconds: int | None = None
  branch: str | None = None


class RestoreSandboxRequest(BaseModel):
  snapshot_image_id: str
  session_id: str
  sandbox_id: str
  sandbox_auth_token: str
  control_plane_url: str
  repo_owner: str
  repo_name: str
  model: str = "anthropic/claude-sonnet-4-5"
  provider: str = "anthropic"
  user_env_vars: dict[str, str] | None = None
  timeout_seconds: int | None = None
  branch: str | None = None


class SnapshotRequest(BaseModel):
  provider_object_id: str
  session_id: str
  reason: str = "manual"


class StopRequest(BaseModel):
  sandbox_id: str


@app.get("/health")
async def health() -> dict:
  return {"status": "healthy", "service": "open-inspect-sandbox-manager"}


@app.post("/api/create")
async def api_create_sandbox(
  request: CreateSandboxRequest,
  authorization: str | None = Header(None),
) -> dict:
  require_auth(authorization)
  return create_sandbox(**request.model_dump())


@app.post("/api/restore")
async def api_restore_sandbox(
  request: RestoreSandboxRequest,
  authorization: str | None = Header(None),
) -> dict:
  require_auth(authorization)
  return restore_sandbox(**request.model_dump())


@app.post("/api/snapshot")
async def api_snapshot_sandbox(
  request: SnapshotRequest,
  authorization: str | None = Header(None),
) -> dict:
  require_auth(authorization)
  return snapshot_sandbox(**request.model_dump())


@app.post("/api/stop")
async def api_stop_sandbox(
  request: StopRequest,
  authorization: str | None = Header(None),
) -> dict:
  require_auth(authorization)
  return stop_sandbox(**request.model_dump())


@app.post("/api/warm")
async def api_warm_sandbox(
  authorization: str | None = Header(None),
) -> dict:
  require_auth(authorization)
  return {"status": "ok", "message": "Warm pool not implemented in Docker mode"}

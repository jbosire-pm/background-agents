"""
Docker sandbox lifecycle manager.

Creates, snapshots, and restores sandboxes using Docker containers
instead of Modal. Exposes the same API contract the control plane expects.
"""

from __future__ import annotations

import logging
import time
import uuid

import docker
from docker.errors import NotFound

from .config import config

log = logging.getLogger("sandbox-manager")

client = docker.from_env()


def create_sandbox(
  session_id: str,
  sandbox_id: str | None,
  repo_owner: str,
  repo_name: str,
  control_plane_url: str,
  sandbox_auth_token: str,
  model: str = "anthropic/claude-sonnet-4-5",
  provider: str = "anthropic",
  user_env_vars: dict[str, str] | None = None,
  repo_image_id: str | None = None,
  timeout_seconds: int | None = None,
  branch: str | None = None,
  **_kwargs: object,
) -> dict:
  """Create a new sandbox container."""
  sandbox_id = sandbox_id or str(uuid.uuid4())
  timeout = timeout_seconds or config.SANDBOX_TIMEOUT_SECONDS
  image = repo_image_id or config.SANDBOX_IMAGE

  env = {
    "SESSION_ID": session_id,
    "SANDBOX_ID": sandbox_id,
    "REPO_OWNER": repo_owner,
    "REPO_NAME": repo_name,
    "CONTROL_PLANE_URL": control_plane_url,
    "SANDBOX_AUTH_TOKEN": sandbox_auth_token,
    "MODEL": model,
    "PROVIDER": provider,
    "GITHUB_APP_ID": config.GITHUB_APP_ID,
    "GITHUB_APP_PRIVATE_KEY": config.GITHUB_APP_PRIVATE_KEY,
    "GITHUB_APP_INSTALLATION_ID": config.GITHUB_APP_INSTALLATION_ID,
    "ANTHROPIC_API_KEY": config.ANTHROPIC_API_KEY,
  }

  if branch:
    env["BRANCH"] = branch

  if user_env_vars:
    env.update(user_env_vars)

  container = client.containers.run(
    image=image,
    name=f"sandbox-{sandbox_id[:12]}",
    environment=env,
    detach=True,
    remove=False,
    network=config.SANDBOX_NETWORK,
    mem_limit="2g",
    cpu_period=100000,
    cpu_quota=200000,
    labels={
      "open-inspect.session-id": session_id,
      "open-inspect.sandbox-id": sandbox_id,
      "open-inspect.type": "sandbox",
    },
    stop_timeout=timeout,
  )

  log.info("Created sandbox container %s for session %s", container.short_id, session_id)

  return {
    "sandbox_id": sandbox_id,
    "provider_object_id": container.id,
    "status": "spawning",
    "created_at": int(time.time() * 1000),
  }


def snapshot_sandbox(provider_object_id: str, session_id: str, reason: str) -> dict:
  """Snapshot a running sandbox container using docker commit."""
  try:
    container = client.containers.get(provider_object_id)
  except NotFound:
    return {"success": False, "error": f"Container {provider_object_id} not found"}

  snapshot_tag = f"open-inspect-snapshot:{session_id}-{int(time.time())}"
  image = container.commit(repository="open-inspect-snapshot", tag=f"{session_id}-{int(time.time())}")

  log.info("Snapshot %s created for session %s (reason: %s)", snapshot_tag, session_id, reason)

  return {
    "success": True,
    "image_id": image.id,
  }


def restore_sandbox(
  snapshot_image_id: str,
  session_id: str,
  sandbox_id: str,
  sandbox_auth_token: str,
  control_plane_url: str,
  repo_owner: str,
  repo_name: str,
  model: str = "anthropic/claude-sonnet-4-5",
  provider: str = "anthropic",
  user_env_vars: dict[str, str] | None = None,
  **_kwargs: object,
) -> dict:
  """Restore a sandbox from a Docker snapshot image."""
  return create_sandbox(
    session_id=session_id,
    sandbox_id=sandbox_id,
    repo_owner=repo_owner,
    repo_name=repo_name,
    control_plane_url=control_plane_url,
    sandbox_auth_token=sandbox_auth_token,
    model=model,
    provider=provider,
    user_env_vars=user_env_vars,
    repo_image_id=snapshot_image_id,
  )


def stop_sandbox(sandbox_id: str) -> dict:
  """Stop and remove a sandbox container."""
  containers = client.containers.list(
    filters={"label": f"open-inspect.sandbox-id={sandbox_id}"},
    all=True,
  )

  for container in containers:
    try:
      container.stop(timeout=10)
      container.remove(force=True)
      log.info("Stopped sandbox container %s", container.short_id)
    except Exception as e:
      log.warning("Failed to stop container %s: %s", container.short_id, e)

  return {"success": True, "sandbox_id": sandbox_id}

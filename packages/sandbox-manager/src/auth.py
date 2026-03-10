"""
HMAC-based authentication for control plane requests.
"""

import hashlib
import hmac
import time

from fastapi import Header, HTTPException

from .config import config

TOKEN_VALIDITY_MS = 5 * 60 * 1000


def verify_internal_token(authorization: str | None) -> bool:
  """Verify an HMAC-signed internal API token."""
  if not config.INTERNAL_CALLBACK_SECRET:
    raise HTTPException(status_code=503, detail="Auth not configured")

  if not authorization or not authorization.startswith("Bearer "):
    return False

  token = authorization[7:]
  parts = token.split(".")
  if len(parts) != 2:
    return False

  timestamp_str, signature = parts
  try:
    token_time = int(timestamp_str)
  except ValueError:
    return False

  now = int(time.time() * 1000)
  if abs(now - token_time) > TOKEN_VALIDITY_MS:
    return False

  expected = hmac.new(
    config.INTERNAL_CALLBACK_SECRET.encode(),
    timestamp_str.encode(),
    hashlib.sha256,
  ).hexdigest()

  return hmac.compare_digest(signature, expected)


def require_auth(authorization: str | None = Header(None)) -> None:
  """FastAPI dependency to require authentication."""
  if not verify_internal_token(authorization):
    raise HTTPException(status_code=401, detail="Unauthorized")

"""
Configuration for the Docker sandbox manager.
"""

import os


class Config:
  CONTROL_PLANE_URL: str = os.getenv("CONTROL_PLANE_URL", "http://control-plane:8787")
  SANDBOX_IMAGE: str = os.getenv("SANDBOX_IMAGE", "open-inspect-sandbox:latest")
  SANDBOX_NETWORK: str = os.getenv("SANDBOX_NETWORK", "open-inspect_default")
  SANDBOX_TIMEOUT_SECONDS: int = int(os.getenv("SANDBOX_TIMEOUT_SECONDS", "7200"))
  INTERNAL_CALLBACK_SECRET: str = os.getenv("INTERNAL_CALLBACK_SECRET", "")
  ALLOWED_CONTROL_PLANE_HOSTS: str = os.getenv("ALLOWED_CONTROL_PLANE_HOSTS", "")
  GITHUB_APP_ID: str = os.getenv("GITHUB_APP_ID", "")
  GITHUB_APP_PRIVATE_KEY: str = os.getenv("GITHUB_APP_PRIVATE_KEY", "")
  GITHUB_APP_INSTALLATION_ID: str = os.getenv("GITHUB_APP_INSTALLATION_ID", "")
  ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")
  LOG_LEVEL: str = os.getenv("LOG_LEVEL", "info")


config = Config()

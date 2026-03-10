"""
Entry point for the Docker sandbox manager.

Usage:
  python -m src.main
  # or
  uvicorn src.main:app --host 0.0.0.0 --port 8000
"""

import logging

import uvicorn

from .api import app
from .config import config

logging.basicConfig(
  level=getattr(logging, config.LOG_LEVEL.upper(), logging.INFO),
  format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)

if __name__ == "__main__":
  uvicorn.run(app, host="0.0.0.0", port=8000)

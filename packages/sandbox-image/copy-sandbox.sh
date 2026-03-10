#!/bin/bash
# Copies sandbox source and renames internal imports from .sandbox to .open_inspect_sandbox
# This avoids the circular import with Python's stdlib types module.
set -e

SRC="packages/modal-infra/src/sandbox"
DST="packages/sandbox-image/sandbox-src"

rm -rf "$DST"
mkdir -p "$DST"

# Copy all Python files
cp "$SRC"/*.py "$DST/"

# The __init__.py has lazy imports for Modal-specific code. Replace with a minimal one.
cat > "$DST/__init__.py" << 'EOF'
"""Open-Inspect sandbox runtime (Docker mode)."""
from .types import GitSyncStatus, GitUser, SandboxEvent, SandboxStatus, SessionConfig

__all__ = ["GitSyncStatus", "GitUser", "SandboxEvent", "SandboxStatus", "SessionConfig"]
EOF

# Add __main__.py for python -m support
cat > "$DST/__main__.py" << 'EOF'
import asyncio
from .entrypoint import main
asyncio.run(main())
EOF

echo "Sandbox source prepared in $DST"

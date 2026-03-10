FROM python:3.12-slim

# ─── System packages ──────────────────────────────────────────────────────────

RUN apt-get update && apt-get install -y --no-install-recommends \
  git curl build-essential ca-certificates gnupg openssh-client jq unzip \
  && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
     | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo 'deb [arch=amd64 signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main' \
     > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update && apt-get install -y gh \
  && rm -rf /var/lib/apt/lists/*

# ─── Node.js 22 LTS ──────────────────────────────────────────────────────────

RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y nodejs \
  && npm install -g pnpm@latest

# ─── Python packages ─────────────────────────────────────────────────────────

RUN pip install --no-cache-dir \
  uv httpx websockets pydantic>=2.0 "PyJWT[crypto]"

# ─── OpenCode CLI ─────────────────────────────────────────────────────────────

RUN npm install -g opencode-ai@latest \
  && (opencode --version || echo "OpenCode installed")

# ─── Working directories ─────────────────────────────────────────────────────

RUN mkdir -p /workspace /app/open_inspect_sandbox /tmp/opencode

# ─── Sandbox code ─────────────────────────────────────────────────────────────
# Copied into /app/open_inspect_sandbox/ to avoid shadowing Python stdlib
# modules (the original "sandbox/types.py" conflicts with stdlib "types").

COPY packages/modal-infra/src/sandbox/entrypoint.py /app/open_inspect_sandbox/
COPY packages/modal-infra/src/sandbox/bridge.py /app/open_inspect_sandbox/
COPY packages/modal-infra/src/sandbox/types.py /app/open_inspect_sandbox/
COPY packages/modal-infra/src/sandbox/log_config.py /app/open_inspect_sandbox/

RUN printf '%s\n' \
  '"""Open-Inspect sandbox runtime."""' \
  'from .types import GitSyncStatus, GitUser, SandboxEvent, SandboxStatus, SessionConfig' \
  > /app/open_inspect_sandbox/__init__.py \
  && printf '%s\n' \
  'import asyncio' \
  'from .entrypoint import main' \
  'asyncio.run(main())' \
  > /app/open_inspect_sandbox/__main__.py \
  && ln -s /app/open_inspect_sandbox /app/sandbox

ENV HOME=/root \
  NODE_ENV=development \
  PYTHONPATH=/app \
  PYTHONUNBUFFERED=1 \
  NODE_PATH=/usr/lib/node_modules \
  PATH="/root/.bun/bin:/usr/local/bin:/usr/bin:/bin"

WORKDIR /workspace

CMD ["python", "-m", "open_inspect_sandbox"]

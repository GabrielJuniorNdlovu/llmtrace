# LLMTrace

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Rust](https://img.shields.io/badge/rust-1.75%2B-orange.svg)](https://www.rust-lang.org/)

**Security-aware LLM observability for production.**

LLMTrace is a transparent proxy that sits between your application and any OpenAI-compatible LLM provider. It captures traces, scans for prompt injection and PII, enforces cost controls, and exposes a dashboard — without requiring you to change application code beyond pointing the client at a different base URL.

This repository is a fork of the original [LLMTrace](https://github.com/epappas/llmtrace) project. See [Credits](#credits) and [Fork Contributions](#fork-contributions).

## What The Project Does

Your app talks to LLMTrace instead of the provider. LLMTrace forwards the request upstream, then asynchronously:

- Records spans, tokens, latency, and estimated cost
- Runs security detectors (regex + ML ensemble) for prompt injection and PII
- Enforces per-tenant rate limits and cost caps
- Serves a Next.js dashboard for traces, security findings, costs, and tenant management

Email/password signup provisions a dedicated tenant and Operator session. Operators can retrieve or rotate their workspace API token from Settings.

## Key Features

- Transparent OpenAI-compatible proxy (`/v1/chat/completions` and related routes)
- Real-time security scanning (prompt injection, PII)
- Trace and span storage with filtering and detail views
- Cost tracking and budget controls
- Multi-tenant isolation with API keys and dashboard sessions
- Production storage profile: ClickHouse + PostgreSQL + Redis
- Lite profile: SQLite for local single-binary use
- Built-in dashboard (Next.js) with signup/login

## Architecture

```mermaid
flowchart LR
    App[YourApplication] -->|HTTP_OpenAI_SDK| Proxy[LLMTraceProxy]
    Proxy -->|Forward| Provider[LLMProvider]
    Proxy -->|Async| Security[SecurityEngine]
    Proxy -->|Async| Storage[StorageLayer]
    Security --> Meta[(PostgreSQL)]
    Storage --> Traces[(ClickHouse)]
    Storage --> Cache[(Redis)]
    Dashboard[NextjsDashboard] -->|REST| Proxy
```

**Request path**

- Your application sends OpenAI-compatible HTTP to the proxy
- The proxy authenticates the tenant (API token or session cookie via the dashboard)
- Traffic is forwarded to the configured upstream provider
- Security analysis and persistence run asynchronously so the hot path stays fast

## Stack

| Layer | Technology |
|-------|------------|
| Proxy | Rust, Axum |
| Security | Regex detectors + ML ensemble (optional preload) |
| Metadata | PostgreSQL (or SQLite in lite mode) |
| Traces | ClickHouse (or SQLite in lite mode) |
| Cache | Redis |
| Dashboard | Next.js 15, TypeScript |

| Crate / package | Purpose |
|-----------------|---------|
| `llmtrace-core` | Shared types and traits |
| `llmtrace` / `llmtrace-proxy` | HTTP proxy binary |
| `llmtrace-security` | Security analysis engine |
| `llmtrace-storage` | Storage backends |
| `dashboard/` | Web UI |

## Quick Start With Docker Compose

This is the path validated for local development on this fork.

### Prerequisites

- Docker Desktop (or Docker Engine + Compose v2)
- An upstream provider API key (for example `OPENAI_API_KEY`)

### Setup

```bash
git clone https://github.com/GabrielJuniorNdlovu/llmtrace.git
cd llmtrace
cp .env.example .env
```

Edit `.env`:

- Set `OPENAI_API_KEY` (or point `LLMTRACE_UPSTREAM_URL` at your provider)
- Change `LLMTRACE_AUTH_ADMIN_KEY` from the placeholder before any shared use
- Keep `LLMTRACE_AUTH_ENABLED=1` when the dashboard login gate is enabled

### Run

```bash
docker compose up -d --build
```

Services:

| Service | URL |
|---------|-----|
| Dashboard | http://localhost:3000 |
| Proxy | http://localhost:8080 |
| Health | http://localhost:8080/health |
| PostgreSQL | localhost:5432 |
| ClickHouse | localhost:8123 |
| Redis | localhost:6379 |

First build of the Rust proxy image can take 20–30 minutes. Subsequent rebuilds use cache.

### Sign in

- Open http://localhost:3000/login
- Create an account with email and password, or use operator admin-key sign-in
- After signup, Settings shows your one-time workspace API token (also retrievable later)

### Send traffic through the proxy

```python
import openai

client = openai.OpenAI(
    base_url="http://localhost:8080/v1",
    api_key="YOUR_WORKSPACE_API_TOKEN",
)

response = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Hello!"}],
)
```

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer YOUR_WORKSPACE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4","messages":[{"role":"user","content":"Hello!"}]}'
```

### Useful commands

```bash
docker compose ps
docker compose logs -f llmtrace-proxy
docker compose logs -f dashboard
curl http://localhost:8080/health
docker compose down
```

## Configuration

Copy [`.env.example`](.env.example) to `.env`. Important variables:

| Variable | Purpose |
|----------|---------|
| `LLMTRACE_STORAGE_PROFILE` | `production`, `lite`, or `memory` |
| `LLMTRACE_UPSTREAM_URL` | Provider base URL (for example `https://api.openai.com`) |
| `OPENAI_API_KEY` | Upstream credential (or your provider equivalent) |
| `LLMTRACE_AUTH_ENABLED` | Require API-key / session auth on the proxy |
| `LLMTRACE_AUTH_ADMIN_KEY` | Bootstrap operator key for dashboard admin login |
| `LLMTRACE_DASHBOARD_AUTH_DISABLED` | `0` = login required, `1` = local demo bypass |

Proxy YAML configuration is documented under [`docs/getting-started/configuration.md`](docs/getting-started/configuration.md). Compose mounts `config.yaml` into the proxy container.

## API Surface (Selected)

| Endpoint | Description |
|----------|-------------|
| `POST /v1/chat/completions` | OpenAI-compatible chat |
| `GET /api/v1/traces` | List traces |
| `GET /api/v1/security/findings` | Security findings |
| `GET /api/v1/tenants/:id/token` | Tenant API token (admin or own operator) |
| `POST /api/v1/auth/signup` | Email/password signup |
| `POST /api/v1/auth/login` | Email/password login |
| `GET /health` | Health and subsystem status |

## Development From Source

```bash
# Rust toolchain (1.75+)
cargo build --workspace
cargo test --workspace
cargo clippy --workspace -- -D warnings

# Dashboard
cd dashboard
npm install
npm run dev
```

For a host-side proxy against Compose storage, point `.env` URLs at `localhost` published ports instead of Compose DNS names (`postgres`, `clickhouse`, `redis`).

## Fork Contributions

Work added or hardened in this fork includes:

- Email/password signup and login with HttpOnly session cookies
- IP rate limiting on public auth endpoints and password length guards
- Operator-scoped dashboard UX (hide admin-only Tenants nav, skip global stats)
- Workspace API token exposure and rotation on Settings after signup
- Admin-key login that requires a configured key (no “any bearer” when auth is off)
- Same-origin `next` redirect sanitisation after login
- SQLite foreign keys for users/sessions (`009` migration)
- Docker Compose env wiring for dashboard ↔ proxy auth
- Proxy healthcheck fixed to use IPv4 (`127.0.0.1`)
- Google sign-in button removed from the login UI (email/password only)

## Credits

This project is a fork of **LLMTrace**, originally created by **Evangelos Pappas** and contributors.

- Upstream: https://github.com/epappas/llmtrace
- License: [MIT](LICENSE) — copyright retained as required by the license

Please keep the license notice when redistributing.

## Further Documentation

- [`docs/README.md`](docs/README.md) — documentation index
- [`docs/getting-started/`](docs/getting-started/) — install and configuration
- [`docs/guides/`](docs/guides/) — API and integration guides
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — contribution guidelines (upstream)

## License

[MIT](LICENSE) — free for commercial and personal use, subject to the copyright notice in the license file.

-- 008_users_and_sessions.sql: dashboard user accounts and opaque login sessions.
--
-- Each signup creates a user row bound to a dedicated tenant. Sessions store
-- only a SHA-256 hash of the opaque token (prefix llmts_). The plaintext is
-- returned once at login/signup and held in the dashboard HttpOnly cookie.

CREATE TABLE IF NOT EXISTS users (
    id TEXT NOT NULL PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    email TEXT NOT NULL COLLATE NOCASE,
    password_hash TEXT,
    display_name TEXT NOT NULL DEFAULT '',
    google_sub TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (email)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub
    ON users (google_sub)
    WHERE google_sub IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_tenant
    ON users (tenant_id);

CREATE TABLE IF NOT EXISTS user_sessions (
    id TEXT NOT NULL PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user
    ON user_sessions (user_id);

CREATE INDEX IF NOT EXISTS idx_user_sessions_expires
    ON user_sessions (expires_at);

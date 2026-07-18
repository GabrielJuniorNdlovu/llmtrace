-- 007_users_and_sessions.sql: dashboard user accounts and opaque login sessions.
--
-- Each signup creates a user row bound to a dedicated tenant. Sessions store
-- only a SHA-256 hash of the opaque token (prefix llmts_). The plaintext is
-- returned once at login/signup and held in the dashboard HttpOnly cookie.

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email VARCHAR(320) NOT NULL,
    password_hash TEXT,
    display_name VARCHAR(255) NOT NULL DEFAULT '',
    google_sub VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower
    ON users (LOWER(email));

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub
    ON users (google_sub)
    WHERE google_sub IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_tenant
    ON users (tenant_id);

CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user
    ON user_sessions (user_id);

CREATE INDEX IF NOT EXISTS idx_user_sessions_expires
    ON user_sessions (expires_at);

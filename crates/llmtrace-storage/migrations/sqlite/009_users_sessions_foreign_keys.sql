-- 009_users_sessions_foreign_keys.sql: add CASCADE FKs on users and sessions.
--
-- SQLite cannot ALTER TABLE to add foreign keys, so we rebuild both tables.
-- Orphan rows (if any) are dropped before the rebuild so the copy succeeds.

PRAGMA foreign_keys = OFF;

DELETE FROM user_sessions
WHERE user_id NOT IN (SELECT id FROM users);

DELETE FROM users
WHERE tenant_id NOT IN (SELECT id FROM tenants);

DROP TABLE IF EXISTS users_new;
CREATE TABLE users_new (
    id TEXT NOT NULL PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    email TEXT NOT NULL COLLATE NOCASE,
    password_hash TEXT,
    display_name TEXT NOT NULL DEFAULT '',
    google_sub TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (email),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

INSERT INTO users_new (
    id, tenant_id, email, password_hash, display_name, google_sub, created_at
)
SELECT id, tenant_id, email, password_hash, display_name, google_sub, created_at
FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub
    ON users (google_sub)
    WHERE google_sub IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_tenant
    ON users (tenant_id);

DROP TABLE IF EXISTS user_sessions_new;
CREATE TABLE user_sessions_new (
    id TEXT NOT NULL PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO user_sessions_new (id, user_id, token_hash, expires_at, created_at)
SELECT id, user_id, token_hash, expires_at, created_at
FROM user_sessions;

DROP TABLE user_sessions;
ALTER TABLE user_sessions_new RENAME TO user_sessions;

CREATE INDEX IF NOT EXISTS idx_user_sessions_user
    ON user_sessions (user_id);

CREATE INDEX IF NOT EXISTS idx_user_sessions_expires
    ON user_sessions (expires_at);

PRAGMA foreign_keys = ON;

-- Migration number: 0002    2026-07-24
-- Magic-link authentication: one-time login tokens + server-side sessions.
CREATE TABLE auth_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  -- hex SHA-256 of the raw token; the raw token only ever lives in the email link
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX idx_auth_tokens_email ON auth_tokens(email, created_at);

CREATE TABLE sessions (
  -- hex SHA-256 of the raw session token held in the cookie
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

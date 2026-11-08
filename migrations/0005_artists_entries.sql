-- Migration number: 0005    2026-11-08
-- Artist profiles, synced drafts, soft withdrawal. Additive only: no table rebuilds.

CREATE TABLE artists (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,            -- trimmed + lowercased, verified by sign-in
  name          TEXT NOT NULL DEFAULT '',
  country       TEXT NOT NULL DEFAULT '',
  instagram     TEXT NOT NULL DEFAULT '',        -- handle only, no "@" or URL
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at  TEXT
);

-- One row per email sent. Code and link token are stored as HMACs, never raw.
CREATE TABLE artist_login_codes (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  email            TEXT NOT NULL,
  code_hmac        TEXT NOT NULL,               -- HMAC-SHA256(ARTIST_CODE_SECRET, email || ':' || code)
  link_token_hash  TEXT NOT NULL UNIQUE,        -- SHA-256 of the one-click link token
  contest_id       INTEGER REFERENCES contests(id),
  attempts         INTEGER NOT NULL DEFAULT 0,  -- wrong codes typed; locked at 5
  ip               TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at       TEXT NOT NULL,               -- created_at + 15 minutes
  used_at          TEXT
);
CREATE INDEX idx_artist_codes_email ON artist_login_codes(email, created_at);

CREATE TABLE artist_sessions (
  token_hash    TEXT PRIMARY KEY,               -- SHA-256 of the raw session token
  artist_id     INTEGER NOT NULL REFERENCES artists(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at    TEXT NOT NULL,                  -- 30 days, extended on use
  last_seen_at  TEXT,
  user_agent    TEXT
);
CREATE INDEX idx_artist_sessions_artist ON artist_sessions(artist_id);

-- The artist's working copy of each poster. Drafts never touch `submissions`.
CREATE TABLE entries (
  id             TEXT PRIMARY KEY,              -- UUID made by the browser, so offline creates sync safely
  contest_id     INTEGER NOT NULL REFERENCES contests(id),
  artist_id      INTEGER NOT NULL REFERENCES artists(id),
  status         TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft', 'submitted', 'withdrawn', 'discarded')),
  title          TEXT NOT NULL DEFAULT '',
  concept        TEXT NOT NULL DEFAULT '',
  metadata       TEXT NOT NULL DEFAULT '{}',    -- year_designed, designed_for, client_name, ...
  file_key       TEXT,                          -- R2 key under drafts/contest-<id>/<entryId>/
  file_type      TEXT,
  file_name      TEXT,
  file_size      INTEGER,
  assets         TEXT NOT NULL DEFAULT '[]',    -- [{id, key, type, name, size}], max 3
  version        INTEGER NOT NULL DEFAULT 1,    -- bumped on every change; used for If-Match
  submission_id  INTEGER UNIQUE REFERENCES submissions(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  submitted_at   TEXT,
  withdrawn_at   TEXT,
  discarded_at   TEXT
);
CREATE INDEX idx_entries_artist ON entries(artist_id, contest_id, status);
CREATE INDEX idx_entries_contest ON entries(contest_id, status);

-- Append-only history for statistics and review.
CREATE TABLE entry_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id       TEXT REFERENCES entries(id),
  submission_id  INTEGER REFERENCES submissions(id),
  contest_id     INTEGER NOT NULL REFERENCES contests(id),
  artist_id      INTEGER REFERENCES artists(id),
  type           TEXT NOT NULL CHECK (type IN (
                   'created', 'file_added', 'file_replaced', 'file_removed', 'submitted',
                   'withdrawn', 'restored', 'discarded',
                   'disqualified', 'requalified', 'advanced', 'unadvanced')),
  actor          TEXT NOT NULL CHECK (actor IN ('artist', 'admin', 'system')),
  actor_user_id  INTEGER REFERENCES users(id),  -- set when an admin acted
  reason         TEXT,                          -- withdraw / disqualify reason
  detail         TEXT NOT NULL DEFAULT '{}',    -- JSON: consent version, file size, etc.
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_entry_events_contest ON entry_events(contest_id, type, created_at);
CREATE INDEX idx_entry_events_entry ON entry_events(entry_id);

-- Every email sent to an artist (sign-in, receipt, withdrawal), like invite_emails.
CREATE TABLE artist_emails (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  artist_id   INTEGER REFERENCES artists(id),
  email       TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('signin', 'receipt', 'withdrawn')),
  status      TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  resend_id   TEXT,
  error       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Existing tables: new nullable columns only (no rebuild, no data rewritten).
ALTER TABLE submissions ADD COLUMN artist_id INTEGER REFERENCES artists(id);
ALTER TABLE submissions ADD COLUMN entry_id TEXT;
ALTER TABLE submissions ADD COLUMN instagram TEXT NOT NULL DEFAULT '';
ALTER TABLE submissions ADD COLUMN withdrawn_at TEXT;   -- NULL = active
ALTER TABLE submissions ADD COLUMN consent_version TEXT;
CREATE UNIQUE INDEX idx_submissions_entry ON submissions(entry_id) WHERE entry_id IS NOT NULL;
CREATE INDEX idx_submissions_artist ON submissions(artist_id);

ALTER TABLE contests ADD COLUMN closes_at TEXT;                     -- shown in the form
ALTER TABLE contests ADD COLUMN judging_started_at TEXT;            -- set once when status first leaves 'open'; never cleared
ALTER TABLE contests ADD COLUMN max_entries_per_artist INTEGER;     -- NULL = no limit
ALTER TABLE api_keys ADD COLUMN signin_url TEXT;                    -- base URL for sign-in links

-- THE definition of "judgeable". Judge-facing reads use this, never the raw table.
CREATE VIEW judging_pool AS
  SELECT * FROM submissions
  WHERE status = 'submitted' AND withdrawn_at IS NULL;

-- Safety rails: rows are never removed.
CREATE TRIGGER submissions_no_delete BEFORE DELETE ON submissions
BEGIN SELECT RAISE(ABORT, 'submissions are never deleted; set withdrawn_at'); END;

CREATE TRIGGER entries_no_delete BEFORE DELETE ON entries
BEGIN SELECT RAISE(ABORT, 'entries are never deleted; set status'); END;

CREATE TRIGGER entry_events_no_update BEFORE UPDATE ON entry_events
BEGIN SELECT RAISE(ABORT, 'entry_events is append-only'); END;

CREATE TRIGGER entry_events_no_delete BEFORE DELETE ON entry_events
BEGIN SELECT RAISE(ABORT, 'entry_events is append-only'); END;

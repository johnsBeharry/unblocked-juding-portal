-- Migration number: 0001    2026-07-24
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'judge')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT
);

CREATE TABLE contests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  theme TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'open', 'round1', 'round2', 'deliberation', 'complete', 'archived')),
  criteria TEXT NOT NULL DEFAULT '["Theme Relevance","Concept","Execution","Creativity"]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE contest_judges (
  contest_id INTEGER NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (contest_id, user_id)
);

CREATE TABLE submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contest_id INTEGER NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
  public_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  artist_name TEXT NOT NULL DEFAULT '',
  artist_email TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  concept TEXT NOT NULL DEFAULT '',
  metadata TEXT NOT NULL DEFAULT '{}',
  file_key TEXT,
  file_type TEXT,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'disqualified')),
  advanced INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_submissions_contest ON submissions(contest_id);

CREATE TABLE round1_votes (
  submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  judge_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK (decision IN ('yes', 'no')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (submission_id, judge_id)
);

CREATE TABLE round2_ratings (
  submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  judge_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- JSON object mapping criterion name -> integer score 1..10
  ratings TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (submission_id, judge_id)
);

CREATE TABLE api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  -- hex-encoded SHA-256 of the raw key; the raw key is shown once at creation
  key_hash TEXT NOT NULL UNIQUE,
  contest_id INTEGER REFERENCES contests(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);

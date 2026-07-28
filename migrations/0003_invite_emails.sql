-- Migration number: 0003    2026-07-28
-- Tracks every welcome/invite email an admin sends (and its edited content),
-- so the console can show whether a given user was actually emailed.
CREATE TABLE invite_emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  error TEXT,
  sent_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_invite_emails_user ON invite_emails(user_id, created_at);

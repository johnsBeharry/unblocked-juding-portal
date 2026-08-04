-- Migration number: 0004    2026-08-04
-- One-click unsubscribe: records when a user opts out of invite/welcome
-- emails. Sign-in links are unaffected (opting out can't lock you out).
ALTER TABLE users ADD COLUMN opted_out_at TEXT;

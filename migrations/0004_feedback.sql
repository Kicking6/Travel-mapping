-- 0004 — in-app feedback, ported from Site Scout (its 0001 user_feedback + 0003
-- criticality), which ported it from the Akahu app. The value is `context`,
-- not the typed text. Screenshots go to R2 under feedback/<id>.png.
CREATE TABLE user_feedback (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  author_email      TEXT NOT NULL,
  body              TEXT NOT NULL,
  kind              TEXT,              -- 'bug' | 'idea' | 'question'
  criticality       TEXT NOT NULL DEFAULT 'medium',  -- 'low' | 'medium' | 'high' | 'critical'
  context           TEXT NOT NULL DEFAULT '{}',
  route             TEXT,
  element_label     TEXT,
  subject_type      TEXT,              -- 'route' | 'place' | 'album_map' | 'style' | 'photo' …
  subject_id        TEXT,
  screenshot_key    TEXT,
  screenshot_bytes  INTEGER,
  status            TEXT NOT NULL DEFAULT 'new',  -- 'new' | 'triaged' | 'done' | 'wontfix'
  resolution_note   TEXT,              -- the reply
  reply_at          TEXT,
  app_version       TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT,
  edited_since_triage INTEGER NOT NULL DEFAULT 0,
  resolved_at       TEXT,
  deleted_at        TEXT
);
CREATE INDEX idx_user_feedback_author ON user_feedback(author_email, deleted_at, created_at);
CREATE INDEX idx_user_feedback_status ON user_feedback(status, created_at);
CREATE INDEX idx_user_feedback_subject ON user_feedback(subject_type, subject_id);
ALTER TABLE users ADD COLUMN feedback_seen_at TEXT;  -- replies newer than this show as unread

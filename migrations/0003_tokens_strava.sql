-- 0003 — personal access tokens (the MCP connector and scripts) and Strava links.

-- A token acts as the person who made it. Only its sha256 is stored; the
-- token itself is shown once, when it's created (Settings → Connectors).
CREATE TABLE api_tokens (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL,
  name          TEXT NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,
  prefix        TEXT NOT NULL,                       -- first characters, to tell tokens apart in the list
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at  TEXT,
  revoked_at    TEXT
);
CREATE INDEX idx_api_tokens_email ON api_tokens(email);

-- One Strava athlete per person. Tokens refresh themselves (6 h lifetime).
CREATE TABLE strava_links (
  email         TEXT PRIMARY KEY,
  athlete_id    INTEGER NOT NULL,
  athlete_name  TEXT,
  access_token  TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at    INTEGER NOT NULL,                    -- unix seconds
  scope         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

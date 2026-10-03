-- 0001_init.sql — Trip Atlas: people, routes, legs, places, map styles, album maps.
--
-- One shared trip for a household (Rory + Eva), so there is no per-user
-- tenancy on the trip data — `users` only decides who may sign in, and
-- created_by/updated_by record who did what.

-- ── Sign-in (ported from Site Scout: 6-digit email code → 90-day session) ──
CREATE TABLE users (
  email         TEXT PRIMARY KEY,
  name          TEXT,
  status        TEXT NOT NULL DEFAULT 'active',      -- active | paused
  is_admin      INTEGER NOT NULL DEFAULT 0,
  settings      TEXT NOT NULL DEFAULT '{}',          -- JSON: per-person UI preferences
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at  TEXT
);

CREATE TABLE sessions (
  token_hash    TEXT PRIMARY KEY,                    -- sha256 of the cookie value; the raw token is never stored
  email         TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at    TEXT NOT NULL,
  last_used_at  TEXT
);
CREATE INDEX idx_sessions_email ON sessions(email);

CREATE TABLE login_codes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL,
  code_hash     TEXT NOT NULL,                       -- sha256(email:code)
  attempts      INTEGER NOT NULL DEFAULT 0,          -- dies after 5 wrong guesses
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at    TEXT NOT NULL,
  used_at       TEXT
);
CREATE INDEX idx_login_codes_email ON login_codes(email, created_at);

-- ── The trip ──────────────────────────────────────────────────────────────
-- Key/value trip settings: trip_start (ISO date day 1 counts from), trip_name.
CREATE TABLE trip_settings (
  key           TEXT PRIMARY KEY,
  value         TEXT
);
INSERT INTO trip_settings (key, value) VALUES ('trip_start', '2024-07-21'), ('trip_name', 'Our OE');

-- A leg is a named stretch of the trip ("USA road trip", "Norway"). Routes
-- belong to a leg by date unless pinned to one with routes.leg_id.
CREATE TABLE legs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  start_date    TEXT,
  end_date      TEXT,
  color         TEXT,
  notes         TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One journey line. Geometry is stored twice as Google encoded polylines
-- ([lon,lat] pairs, precision 5): `geom` simplified to the type's tolerance
-- (a few metres for hikes, ~15 m for drives) for the map and print export;
-- `geom_lo` at 250 m for the world-scale overview. The original file, when
-- kept, is in R2 under raw/<source_hash>.
CREATE TABLE routes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  date          TEXT,                                -- ISO local date
  date_source   TEXT,                                -- gps-time | filename | trip-day | manual | suggested
  trip_day      INTEGER,
  type          TEXT NOT NULL DEFAULT 'other',       -- see web/lib/types.js
  leg_id        INTEGER,                             -- explicit leg; NULL = by date
  country       TEXT,                                -- ISO 3166 alpha-2 (or several, comma-separated)
  region        TEXT,
  notes         TEXT,
  color         TEXT,                                -- overrides the style's type colour
  width         REAL,                                -- overrides the style's type width
  hidden        INTEGER NOT NULL DEFAULT 0,          -- kept, but off every map
  distance_km   REAL,
  point_count   INTEGER,
  bbox          TEXT,                                -- JSON [w,s,e,n]
  fingerprint   TEXT,                                -- start>end~km, for duplicate detection
  geom          TEXT NOT NULL,
  geom_lo       TEXT,
  started_at    TEXT,
  ended_at      TEXT,
  source_name   TEXT,
  source_folder TEXT,
  source_kind   TEXT,                                -- gpx | csv | flight | manual
  source_hash   TEXT,                                -- sha256 of the original file's text
  review        TEXT,                                -- JSON: open questions, e.g. {"duplicateOf": 12}
  created_by    TEXT,
  updated_by    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_routes_date ON routes(date);
CREATE INDEX idx_routes_fingerprint ON routes(fingerprint);
CREATE INDEX idx_routes_source_hash ON routes(source_hash);

-- Points: accommodation, campsites, viewpoints. Styled per kind in the map style.
CREATE TABLE places (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT,
  lat           REAL NOT NULL,
  lon           REAL NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'other',       -- tent | hut | hotel | hostel | airbnb | sight | other …
  date          TEXT,
  nights        INTEGER,
  notes         TEXT,
  hidden        INTEGER NOT NULL DEFAULT 0,
  created_by    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_places_date ON places(date);

-- A map style: basemap, land/sea/label colours, which base layers show,
-- route colours/widths per type, place markers per kind. JSON so a new knob
-- needs no migration; web/lib/style.js owns the shape and the defaults.
CREATE TABLE map_styles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL UNIQUE,
  spec          TEXT NOT NULL,
  updated_by    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- An album map: one printed page. What's on it (`filter`), where the camera
-- is (`view`), the paper it's printed on, and which style.
CREATE TABLE album_maps (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  filter        TEXT NOT NULL DEFAULT '{}',          -- JSON: {from,to,types[],legs[],countries[],include[],exclude[]}
  view          TEXT,                                -- JSON: {bounds:[w,s,e,n], bearing} — NULL = fit the filtered routes
  paper         TEXT NOT NULL DEFAULT '{"w":300,"h":300,"dpi":300}', -- mm + dpi
  style_id      INTEGER,
  overrides     TEXT NOT NULL DEFAULT '{}',          -- JSON: per-map style tweaks on top of style_id
  title         TEXT,                                -- optional caption printed on the map
  notes         TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  last_export   TEXT,                                -- JSON: {at, by, px:[w,h]}
  created_by    TEXT,
  updated_by    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Bumped on every change to routes/places so the browser can cache the
-- whole geometry payload and revalidate with one tiny read.
CREATE TABLE data_version (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  version       INTEGER NOT NULL
);
INSERT INTO data_version (id, version) VALUES (1, 1);

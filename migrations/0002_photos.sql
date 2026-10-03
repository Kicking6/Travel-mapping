-- 0002_photos.sql — photos linked to the trip.
--
-- The browser reads EXIF (GPS, time), shrinks each photo to a 2048 px JPEG
-- and a 480 px thumbnail, and uploads both to R2 under photos/<sha>-{full,thumb}.jpg.
-- `sha` is the original file's sha256, so the same photo dropped twice is one row.
CREATE TABLE photos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  sha           TEXT NOT NULL UNIQUE,
  file_name     TEXT,
  taken_at      TEXT,                                -- ISO, from EXIF DateTimeOriginal (+ offset when present)
  date          TEXT,                                -- local calendar date
  lat           REAL,
  lon           REAL,
  place_source  TEXT,                                -- gps | route-time | route-date | manual | NULL (unplaced)
  route_id      INTEGER,                             -- the journey it was taken on, when known
  width         INTEGER,
  height        INTEGER,
  caption       TEXT,
  in_film       INTEGER NOT NULL DEFAULT 1,
  hidden        INTEGER NOT NULL DEFAULT 0,
  created_by    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_photos_date ON photos(date, taken_at);
CREATE INDEX idx_photos_route ON photos(route_id);

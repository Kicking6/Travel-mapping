from __future__ import annotations

"""SQLite database layer — schema, queries, and settings management."""

import sqlite3
import json
from pathlib import Path
from typing import Any, Optional

DB_PATH = Path.home() / ".gpx_manager" / "routes.db"


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

def init_db() -> None:
    with _connect() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS routes (
                id               INTEGER PRIMARY KEY,
                file_path        TEXT    UNIQUE NOT NULL,
                display_name     TEXT,
                date             TEXT,
                day_number       INTEGER,
                trip_segment     TEXT,
                country          TEXT,
                region           TEXT,
                route_type       TEXT,
                notes            TEXT,
                distance_km      REAL,
                colour_override  TEXT,
                geometry_cache   TEXT,
                is_waypoint      INTEGER DEFAULT 0,
                exported_path    TEXT,
                imported_at      TEXT    DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS settings (
                category  TEXT NOT NULL,
                value     TEXT NOT NULL,
                sort_order INTEGER DEFAULT 0,
                UNIQUE(category, value)
            );

            CREATE TABLE IF NOT EXISTS app_config (
                key   TEXT PRIMARY KEY,
                value TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_routes_date         ON routes(date);
            CREATE INDEX IF NOT EXISTS idx_routes_country      ON routes(country);
            CREATE INDEX IF NOT EXISTS idx_routes_route_type   ON routes(route_type);
            CREATE INDEX IF NOT EXISTS idx_routes_trip_segment ON routes(trip_segment);
        """)
        _seed_defaults(conn)


_DEFAULT_SETTINGS = {
    "transport_type": [
        "drive", "transit", "ferry", "walk", "flight", "sleep",
    ],
    "country": [],
    "region": [],
    "trip_segment": [],
}


def _seed_defaults(conn: sqlite3.Connection) -> None:
    existing = conn.execute("SELECT COUNT(*) FROM settings").fetchone()[0]
    if existing > 0:
        return
    for cat, values in _DEFAULT_SETTINGS.items():
        for i, v in enumerate(values):
            conn.execute(
                "INSERT OR IGNORE INTO settings (category, value, sort_order) VALUES (?, ?, ?)",
                (cat, v, i),
            )


# ---------------------------------------------------------------------------
# Settings CRUD
# ---------------------------------------------------------------------------

def get_setting_values(category: str) -> list[str]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT value FROM settings WHERE category = ? ORDER BY sort_order, value",
            (category,),
        ).fetchall()
    return [r[0] for r in rows]


def add_setting_value(category: str, value: str) -> None:
    with _connect() as conn:
        max_order = conn.execute(
            "SELECT COALESCE(MAX(sort_order), -1) FROM settings WHERE category = ?",
            (category,),
        ).fetchone()[0]
        conn.execute(
            "INSERT OR IGNORE INTO settings (category, value, sort_order) VALUES (?, ?, ?)",
            (category, value, max_order + 1),
        )


def remove_setting_value(category: str, value: str) -> None:
    with _connect() as conn:
        conn.execute(
            "DELETE FROM settings WHERE category = ? AND value = ?",
            (category, value),
        )


def get_app_config(key: str, default: str = "") -> str:
    with _connect() as conn:
        row = conn.execute("SELECT value FROM app_config WHERE key = ?", (key,)).fetchone()
    return row[0] if row else default


def set_app_config(key: str, value: str) -> None:
    with _connect() as conn:
        conn.execute(
            "INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, value),
        )


# ---------------------------------------------------------------------------
# Route insert / update
# ---------------------------------------------------------------------------

_ROUTE_COLS = [
    "file_path", "display_name", "date", "day_number", "trip_segment",
    "country", "region", "route_type", "notes", "distance_km",
    "colour_override", "geometry_cache", "is_waypoint", "exported_path",
]


def upsert_route(data: dict) -> int:
    row = {c: data.get(c) for c in _ROUTE_COLS}
    if isinstance(row.get("geometry_cache"), list):
        row["geometry_cache"] = json.dumps(row["geometry_cache"])

    placeholders = ", ".join(f":{c}" for c in _ROUTE_COLS)
    col_names = ", ".join(_ROUTE_COLS)
    updates = ", ".join(f"{c}=excluded.{c}" for c in _ROUTE_COLS if c != "file_path")
    sql = f"INSERT INTO routes ({col_names}) VALUES ({placeholders}) ON CONFLICT(file_path) DO UPDATE SET {updates}"

    with _connect() as conn:
        return conn.execute(sql, row).lastrowid


def update_route(route_id: int, fields: dict) -> None:
    if not fields:
        return
    if "geometry_cache" in fields and isinstance(fields["geometry_cache"], list):
        fields["geometry_cache"] = json.dumps(fields["geometry_cache"])
    set_clause = ", ".join(f"{k} = :{k}" for k in fields)
    fields["_id"] = route_id
    with _connect() as conn:
        conn.execute(f"UPDATE routes SET {set_clause} WHERE id = :_id", fields)


def bulk_update_routes(route_ids: list[int], fields: dict) -> None:
    if not fields or not route_ids:
        return
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    placeholders = ",".join("?" * len(route_ids))
    params = list(fields.values()) + list(route_ids)
    with _connect() as conn:
        conn.execute(f"UPDATE routes SET {set_clause} WHERE id IN ({placeholders})", params)


def delete_routes(route_ids: list[int]) -> None:
    if not route_ids:
        return
    placeholders = ",".join("?" * len(route_ids))
    with _connect() as conn:
        conn.execute(f"DELETE FROM routes WHERE id IN ({placeholders})", route_ids)


# ---------------------------------------------------------------------------
# Route queries
# ---------------------------------------------------------------------------

_ORDER = "ORDER BY date ASC, day_number ASC, display_name ASC"


def get_all_routes() -> list[dict]:
    with _connect() as conn:
        return [dict(r) for r in conn.execute(f"SELECT * FROM routes {_ORDER}").fetchall()]


def get_route_by_id(route_id: int) -> Optional[dict]:
    with _connect() as conn:
        row = conn.execute("SELECT * FROM routes WHERE id = ?", (route_id,)).fetchone()
    return dict(row) if row else None


def get_routes_by_ids(route_ids: list[int]) -> list[dict]:
    if not route_ids:
        return []
    placeholders = ",".join("?" * len(route_ids))
    with _connect() as conn:
        return [dict(r) for r in conn.execute(
            f"SELECT * FROM routes WHERE id IN ({placeholders})", route_ids
        ).fetchall()]


def file_path_exists(file_path: str) -> bool:
    with _connect() as conn:
        return conn.execute("SELECT 1 FROM routes WHERE file_path = ?", (file_path,)).fetchone() is not None


def query_routes(filters: dict) -> list[dict]:
    where_parts, params = _build_where(filters)
    where_sql = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""
    with _connect() as conn:
        return [dict(r) for r in conn.execute(
            f"SELECT * FROM routes {where_sql} {_ORDER}", params
        ).fetchall()]


def _build_where(filters: dict) -> tuple[list[str], list[Any]]:
    parts, params = [], []

    for op, key in [(">=", "date_from"), ("<=", "date_to")]:
        if filters.get(key):
            parts.append(f"date {op} ?")
            params.append(filters[key])

    for op, key in [(">=", "day_number_min"), ("<=", "day_number_max")]:
        if filters.get(key) is not None:
            parts.append(f"day_number {op} ?")
            params.append(filters[key])

    for col, key in [("country", "countries"), ("region", "regions"),
                     ("trip_segment", "trip_segments"), ("route_type", "route_types")]:
        vals = filters.get(key)
        if vals:
            parts.append(f"{col} IN ({','.join('?' * len(vals))})")
            params.extend(vals)

    if filters.get("notes_text"):
        parts.append("notes LIKE ?")
        params.append(f"%{filters['notes_text']}%")

    return parts, params

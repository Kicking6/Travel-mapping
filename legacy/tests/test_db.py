from __future__ import annotations

import json
import pytest
import gpx_manager.db as db


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _route(file_path: str = "/tmp/test.gpx", **kwargs) -> dict:
    base = {
        "file_path":     file_path,
        "display_name":  "Test Route",
        "date":          "2025-01-02",
        "day_number":    1,
        "trip_segment":  None,
        "country":       "Peru",
        "region":        "Ancash",
        "route_type":    "drive",
        "notes":         None,
        "distance_km":   120.5,
        "colour_override": None,
        "geometry_cache": json.dumps([[1.0, 2.0], [3.0, 4.0]]),
        "is_waypoint":   0,
    }
    base.update(kwargs)
    return base


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_upsert_route_returns_id():
    rid = db.upsert_route(_route())
    assert isinstance(rid, int)
    assert rid > 0


def test_get_route_by_id_roundtrip():
    rid = db.upsert_route(_route(display_name="Lima Drive", date="2025-01-02"))
    row = db.get_route_by_id(rid)
    assert row is not None
    assert row["display_name"] == "Lima Drive"
    assert row["date"] == "2025-01-02"
    assert row["country"] == "Peru"


def test_get_route_by_id_missing():
    assert db.get_route_by_id(99999) is None


def test_update_route():
    rid = db.upsert_route(_route())
    db.update_route(rid, {"display_name": "Updated Name", "country": "Bolivia"})
    row = db.get_route_by_id(rid)
    assert row["display_name"] == "Updated Name"
    assert row["country"] == "Bolivia"


def test_update_route_no_fields_is_noop():
    rid = db.upsert_route(_route(display_name="Original"))
    db.update_route(rid, {})
    assert db.get_route_by_id(rid)["display_name"] == "Original"


def test_bulk_update_routes():
    id1 = db.upsert_route(_route("/tmp/a.gpx", display_name="A"))
    id2 = db.upsert_route(_route("/tmp/b.gpx", display_name="B"))
    db.bulk_update_routes([id1, id2], {"country": "Chile"})
    assert db.get_route_by_id(id1)["country"] == "Chile"
    assert db.get_route_by_id(id2)["country"] == "Chile"


def test_bulk_update_empty_ids_is_noop():
    db.bulk_update_routes([], {"country": "Chile"})  # should not raise


def test_delete_routes():
    id1 = db.upsert_route(_route("/tmp/del1.gpx"))
    id2 = db.upsert_route(_route("/tmp/del2.gpx"))
    db.delete_routes([id1])
    assert db.get_route_by_id(id1) is None
    assert db.get_route_by_id(id2) is not None


def test_get_all_routes_ordered():
    db.upsert_route(_route("/tmp/c.gpx", date="2025-01-03", day_number=2))
    db.upsert_route(_route("/tmp/d.gpx", date="2025-01-01", day_number=1))
    rows = db.get_all_routes()
    assert len(rows) == 2
    assert rows[0]["date"] <= rows[1]["date"]


def test_upsert_route_conflict_updates():
    db.upsert_route(_route("/tmp/same.gpx", display_name="First"))
    db.upsert_route(_route("/tmp/same.gpx", display_name="Second"))
    rows = db.get_all_routes()
    assert len(rows) == 1
    assert rows[0]["display_name"] == "Second"


def test_app_config_roundtrip():
    db.set_app_config("test.key", "hello")
    assert db.get_app_config("test.key") == "hello"


def test_app_config_default():
    assert db.get_app_config("nonexistent.key", "fallback") == "fallback"
    assert db.get_app_config("nonexistent.key") == ""


def test_app_config_overwrite():
    db.set_app_config("test.overwrite", "v1")
    db.set_app_config("test.overwrite", "v2")
    assert db.get_app_config("test.overwrite") == "v2"


def test_get_setting_values_seeded():
    types = db.get_setting_values("transport_type")
    assert "drive" in types
    assert "walk" in types
    assert "flight" in types


def test_add_and_remove_setting_value():
    db.add_setting_value("country", "Peru")
    assert "Peru" in db.get_setting_values("country")
    db.remove_setting_value("country", "Peru")
    assert "Peru" not in db.get_setting_values("country")


def test_add_setting_value_duplicate_is_ignored():
    db.add_setting_value("region", "Cusco")
    db.add_setting_value("region", "Cusco")
    regions = db.get_setting_values("region")
    assert regions.count("Cusco") == 1


def test_file_path_exists():
    db.upsert_route(_route("/tmp/exists.gpx"))
    assert db.file_path_exists("/tmp/exists.gpx") is True
    assert db.file_path_exists("/tmp/nope.gpx") is False


def test_geometry_cache_list_is_serialised():
    coords = [[1.0, 2.0], [3.0, 4.0]]
    rid = db.upsert_route(_route(geometry_cache=coords))
    row = db.get_route_by_id(rid)
    # DB stores as JSON string; the dict value is returned as-is from DB
    assert row["geometry_cache"] is not None
    parsed = json.loads(row["geometry_cache"]) if isinstance(row["geometry_cache"], str) else row["geometry_cache"]
    assert parsed == coords

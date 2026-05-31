from __future__ import annotations

"""Unit tests for the 7 new map features.

Run all new tests:
    pytest tests/test_new_features.py -v

Run with the full test suite:
    pytest tests/ -v

All tests use the existing `isolated_db` autouse fixture (conftest.py) which
redirects DB_PATH to a temporary file, so the real database is never touched.
"""

import csv
import json
import io
from pathlib import Path

import pytest

import gpx_manager.db as db


# ===========================================================================
# Feature 1 — Per-route line weight
# ===========================================================================

def _make_route(tmp_path, name="test", weight=None):
    """Insert a minimal route and return its id."""
    p = str(tmp_path / f"{name}.gpx")
    Path(p).write_text("<gpx/>")
    row = {
        "file_path": p,
        "display_name": name,
        "geometry_cache": json.dumps([[0.0, 0.0], [1.0, 1.0]]),
        "weight_override": weight,
    }
    return db.upsert_route(row)


def test_weight_override_saves_and_loads(tmp_path):
    """weight_override column persists and round-trips correctly."""
    rid = _make_route(tmp_path, "heavy", weight=7)
    route = db.get_route_by_id(rid)
    assert route is not None
    assert route["weight_override"] == 7


def test_weight_override_nullable(tmp_path):
    """weight_override=None is stored as NULL and means 'use global'."""
    rid = _make_route(tmp_path, "default_weight", weight=None)
    route = db.get_route_by_id(rid)
    assert route is not None
    assert route["weight_override"] is None


def test_weight_override_update(tmp_path):
    """Updating weight_override on an existing route works."""
    rid = _make_route(tmp_path, "changeable", weight=None)
    db.update_route(rid, {"weight_override": 5})
    route = db.get_route_by_id(rid)
    assert route["weight_override"] == 5


def test_weight_override_reset_to_none(tmp_path):
    """Setting weight_override back to None clears the override."""
    rid = _make_route(tmp_path, "reset_weight", weight=3)
    db.update_route(rid, {"weight_override": None})
    route = db.get_route_by_id(rid)
    assert route["weight_override"] is None


# ===========================================================================
# Feature 2 — Per-feature colours for roads and ferry routes
# ===========================================================================

def test_road_color_default_persists():
    """road_color default from _DEFAULTS loads correctly when not yet set."""
    from gpx_manager.ui.map_controls import _DEFAULTS, _get
    val = _get("road_color", _DEFAULTS["road_color"])
    assert val == _DEFAULTS["road_color"]
    assert val.startswith("#")


def test_ferry_width_saves_and_loads():
    """ferry_width saves to app_config and loads back."""
    db.set_app_config("mapstyle.ferry_width", "4")
    from gpx_manager.ui.map_controls import _get
    assert _get("ferry_width", 2) == 4


def test_road_width_saves_and_loads():
    """road_width saves to app_config and loads back."""
    db.set_app_config("mapstyle.road_width", "3")
    from gpx_manager.ui.map_controls import _get
    assert _get("road_width", 1) == 3


def test_ferry_color_saves_and_loads():
    """ferry_color saves to app_config and loads back."""
    db.set_app_config("mapstyle.ferry_color", "#AABB00")
    from gpx_manager.ui.map_controls import _get
    assert _get("ferry_color", "#000") == "#AABB00"


# ===========================================================================
# Feature 3 — Split state / provincial lines
# ===========================================================================

def test_state_province_keys_are_independent():
    """State and province settings are stored and retrieved independently."""
    db.set_app_config("mapstyle.show_state_lines", "1")
    db.set_app_config("mapstyle.show_province_lines", "0")
    db.set_app_config("mapstyle.state_color", "#FF0000")
    db.set_app_config("mapstyle.province_color", "#0000FF")

    from gpx_manager.ui.map_controls import _get
    assert _get("show_state_lines", 1) == 1
    assert _get("show_province_lines", 1) == 0
    assert _get("state_color", "#888") == "#FF0000"
    assert _get("province_color", "#888") == "#0000FF"


def test_state_width_independent_from_province_width():
    db.set_app_config("mapstyle.state_width", "3")
    db.set_app_config("mapstyle.province_width", "1")
    from gpx_manager.ui.map_controls import _get
    assert _get("state_width", 1) == 3
    assert _get("province_width", 1) == 1


# ===========================================================================
# Feature 4 — Map presets
# ===========================================================================

def test_save_and_list_preset():
    """Saved preset appears in list_presets()."""
    settings = {"basemap": "carto_light", "land_color": "#FFFFFF"}
    db.save_preset("My Preset", settings)
    names = [p["name"] for p in db.list_presets()]
    assert "My Preset" in names


def test_load_preset_returns_settings():
    """load_preset returns the exact dict that was saved."""
    settings = {"basemap": "carto_voyager", "sea_color": "#001122", "route_weight": 4}
    db.save_preset("Test Preset", settings)
    loaded = db.load_preset("Test Preset")
    assert loaded is not None
    assert loaded["basemap"] == "carto_voyager"
    assert loaded["sea_color"] == "#001122"
    assert loaded["route_weight"] == 4


def test_delete_preset():
    """Deleted preset no longer appears in list_presets()."""
    db.save_preset("Temp", {"x": 1})
    db.delete_preset("Temp")
    names = [p["name"] for p in db.list_presets()]
    assert "Temp" not in names


def test_save_preset_overwrites_existing():
    """Saving with an existing name updates rather than duplicates."""
    db.save_preset("Dup", {"v": 1})
    db.save_preset("Dup", {"v": 2})
    names = [p["name"] for p in db.list_presets()]
    assert names.count("Dup") == 1
    loaded = db.load_preset("Dup")
    assert loaded["v"] == 2


def test_load_nonexistent_preset_returns_none():
    """Loading a preset that doesn't exist returns None."""
    assert db.load_preset("does_not_exist") is None


def test_preset_serialises_all_default_keys():
    """A preset can hold all _DEFAULTS keys without data loss."""
    from gpx_manager.ui.map_controls import _DEFAULTS
    db.save_preset("AllDefaults", _DEFAULTS)
    loaded = db.load_preset("AllDefaults")
    for key in _DEFAULTS:
        assert key in loaded


# ===========================================================================
# Feature 5 — Map refresh (DB-level: routes survive a logical refresh)
# ===========================================================================

def test_routes_survive_refresh_cycle(tmp_path):
    """Routes remain in DB after a simulated map refresh (clear + re-query)."""
    rid = _make_route(tmp_path, "survivor")
    # Simulate what _refresh_map_display does: clear in-memory cache, re-query DB
    routes = db.get_all_routes()
    ids = [r["id"] for r in routes]
    assert rid in ids


def test_app_config_survives_after_multiple_writes():
    """Settings persist correctly through multiple writes (stress test for refresh)."""
    for i in range(10):
        db.set_app_config("mapstyle.land_color", f"#{'AB' * 3}")
    assert db.get_app_config("mapstyle.land_color") == "#ABABAB"


# ===========================================================================
# Feature 6 — Rendering / smoothing settings
# ===========================================================================

def test_smoothing_flag_saves_and_loads():
    """feature_smoothing saves to app_config and loads back."""
    db.set_app_config("mapstyle.feature_smoothing", "0")
    from gpx_manager.ui.map_controls import _get
    assert _get("feature_smoothing", 1) == 0


def test_render_resolution_saves_and_loads():
    """render_resolution (pixel ratio %) saves and loads correctly."""
    db.set_app_config("mapstyle.render_resolution", "150")
    from gpx_manager.ui.map_controls import _get
    assert _get("render_resolution", 100) == 150


def test_render_resolution_default():
    """Default render_resolution is 100 (= device pixel ratio)."""
    from gpx_manager.ui.map_controls import _DEFAULTS
    assert _DEFAULTS["render_resolution"] == 100


# ===========================================================================
# Feature 7 — CSV POI import (pure Python, no Qt)
# ===========================================================================

def _write_csv(tmp_path, content: str, name="pois.csv") -> str:
    p = tmp_path / name
    p.write_text(content, encoding="utf-8")
    return str(p)


class TestCSVParsing:
    """Tests for parse_poi_csv (pure logic, no Qt)."""

    def _parse(self, path):
        from gpx_manager.csv_parser import parse_poi_csv
        return parse_poi_csv(path)

    def test_valid_csv_produces_correct_rows(self, tmp_path):
        content = "name,lat,lon,type,notes\nBase Camp,51.5074,-0.1278,tent,Nice spot\n"
        path = _write_csv(tmp_path, content)
        rows, warnings = self._parse(path)
        assert len(rows) == 1
        assert rows[0]["name"] == "Base Camp"
        assert rows[0]["lat"] == pytest.approx(51.5074)
        assert rows[0]["lon"] == pytest.approx(-0.1278)
        assert rows[0]["type"] == "tent"
        assert rows[0]["notes"] == "Nice spot"
        assert warnings == []

    def test_multiple_rows(self, tmp_path):
        content = (
            "name,lat,lon,type,notes\n"
            "A,10.0,20.0,hotel,\n"
            "B,-10.0,-20.0,tent,\n"
        )
        path = _write_csv(tmp_path, content)
        rows, warnings = self._parse(path)
        assert len(rows) == 2

    def test_invalid_lat_is_skipped_with_warning(self, tmp_path):
        content = "name,lat,lon,type,notes\nBad,not_a_number,0.0,tent,\n"
        path = _write_csv(tmp_path, content)
        rows, warnings = self._parse(path)
        assert len(rows) == 0
        assert len(warnings) == 1
        assert "invalid lat/lon" in warnings[0]

    def test_lat_out_of_range_is_skipped(self, tmp_path):
        content = "name,lat,lon,type,notes\nBad,999.0,0.0,tent,\n"
        path = _write_csv(tmp_path, content)
        rows, warnings = self._parse(path)
        assert len(rows) == 0
        assert any("out of range" in w for w in warnings)

    def test_missing_lat_column_raises(self, tmp_path):
        content = "name,lon,type,notes\nA,20.0,hotel,\n"
        path = _write_csv(tmp_path, content)
        with pytest.raises(ValueError, match="lat"):
            self._parse(path)

    def test_missing_lon_column_raises(self, tmp_path):
        content = "name,lat,type,notes\nA,10.0,hotel,\n"
        path = _write_csv(tmp_path, content)
        with pytest.raises(ValueError, match="lon"):
            self._parse(path)

    def test_empty_type_becomes_none(self, tmp_path):
        content = "name,lat,lon,type,notes\nA,10.0,20.0,,\n"
        path = _write_csv(tmp_path, content)
        rows, _ = self._parse(path)
        assert rows[0]["type"] is None

    def test_source_file_is_set(self, tmp_path):
        content = "name,lat,lon,type,notes\nA,10.0,20.0,tent,\n"
        path = _write_csv(tmp_path, content)
        rows, _ = self._parse(path)
        assert rows[0]["source_file"] == path

    def test_bom_utf8_header_works(self, tmp_path):
        """Files saved by Excel often have a UTF-8 BOM prefix."""
        content = "﻿name,lat,lon,type,notes\nA,5.0,10.0,hotel,\n"
        path = _write_csv(tmp_path, content)
        rows, _ = self._parse(path)
        assert len(rows) == 1

    def test_alternate_column_names(self, tmp_path):
        """'category' is accepted as alias for 'type', 'description' for 'notes'."""
        content = "name,lat,lon,category,description\nA,1.0,2.0,hostel,Some notes\n"
        path = _write_csv(tmp_path, content)
        rows, _ = self._parse(path)
        assert rows[0]["type"] == "hostel"
        assert rows[0]["notes"] == "Some notes"


class TestPOIDatabase:
    """Tests for the POI DB layer."""

    def test_upsert_and_retrieve(self, tmp_path):
        pois = [
            {"name": "A", "lat": 10.0, "lon": 20.0, "type": "tent",
             "notes": "", "source_file": "test.csv"},
        ]
        count = db.upsert_pois(pois)
        assert count == 1
        all_pois = db.get_all_pois()
        assert len(all_pois) == 1
        assert all_pois[0]["name"] == "A"

    def test_poi_type_style_defaults(self):
        """New type gets default colour and size."""
        style = db.ensure_poi_type_style("glamping")
        assert style["color"].startswith("#")
        assert isinstance(style["size"], int)
        assert style["size"] > 0

    def test_poi_type_style_persists(self):
        db.set_poi_type_style("hotel", "#FFCC00", 12)
        styles = db.get_poi_type_styles()
        assert "hotel" in styles
        assert styles["hotel"]["color"] == "#FFCC00"
        assert styles["hotel"]["size"] == 12

    def test_get_poi_types(self):
        db.upsert_pois([
            {"name": "X", "lat": 1.0, "lon": 2.0, "type": "tent",   "notes": None, "source_file": None},
            {"name": "Y", "lat": 3.0, "lon": 4.0, "type": "hotel",  "notes": None, "source_file": None},
            {"name": "Z", "lat": 5.0, "lon": 6.0, "type": "hostel", "notes": None, "source_file": None},
        ])
        types = db.get_poi_types()
        assert set(types) == {"tent", "hotel", "hostel"}

    def test_delete_pois_by_source(self):
        db.upsert_pois([
            {"name": "A", "lat": 1.0, "lon": 2.0, "type": "tent",
             "notes": None, "source_file": "file1.csv"},
            {"name": "B", "lat": 3.0, "lon": 4.0, "type": "hotel",
             "notes": None, "source_file": "file2.csv"},
        ])
        db.delete_pois_by_source("file1.csv")
        remaining = db.get_all_pois()
        names = [r["name"] for r in remaining]
        assert "A" not in names
        assert "B" in names

    def test_delete_all_pois(self):
        db.upsert_pois([
            {"name": "C", "lat": 1.0, "lon": 2.0, "type": "tent",
             "notes": None, "source_file": None},
        ])
        db.delete_all_pois()
        assert db.get_all_pois() == []

    def test_poi_multiple_bulk_insert(self):
        rows = [
            {"name": str(i), "lat": float(i), "lon": float(i),
             "type": "tent", "notes": None, "source_file": "bulk.csv"}
            for i in range(50)
        ]
        count = db.upsert_pois(rows)
        assert count == 50
        assert len(db.get_all_pois()) == 50

from __future__ import annotations

import json
import pytest
from gpx_manager.export.geojson_exporter import export_geojson


_DEFAULT_GEOM = object()   # sentinel — distinct from explicit None


def _route(rid: int = 1, is_waypoint: int = 0, geometry=_DEFAULT_GEOM, **kwargs) -> dict:
    if geometry is _DEFAULT_GEOM:
        geometry = json.dumps([[-12.046, -77.043], [-9.527, -77.528]])
    return {
        "id":            rid,
        "file_path":     f"/tmp/route{rid}.gpx",
        "display_name":  f"Route {rid}",
        "date":          "2025-01-02",
        "day_number":    1,
        "trip_segment":  None,
        "country":       "Peru",
        "region":        None,
        "route_type":    "drive",
        "notes":         None,
        "distance_km":   100.0,
        "is_waypoint":   is_waypoint,
        "geometry_cache": geometry,
        **kwargs,
    }


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_export_produces_feature_collection(tmp_path):
    path = str(tmp_path / "out.geojson")
    count, warnings = export_geojson([_route(1), _route(2)], path)
    assert count == 2
    assert warnings == []
    with open(path) as f:
        data = json.load(f)
    assert data["type"] == "FeatureCollection"
    assert len(data["features"]) == 2


def test_route_geometry_is_linestring(tmp_path):
    path = str(tmp_path / "out.geojson")
    export_geojson([_route(1)], path)
    with open(path) as f:
        data = json.load(f)
    geom = data["features"][0]["geometry"]
    assert geom["type"] == "LineString"


def test_waypoint_geometry_is_point(tmp_path):
    path = str(tmp_path / "out.geojson")
    wp = _route(1, is_waypoint=1, geometry=json.dumps([[-12.046, -77.043]]))
    export_geojson([wp], path)
    with open(path) as f:
        data = json.load(f)
    geom = data["features"][0]["geometry"]
    assert geom["type"] == "Point"


def test_coordinates_are_lon_lat_order(tmp_path):
    path = str(tmp_path / "out.geojson")
    # Input is [lat, lon]; GeoJSON must be [lon, lat]
    coords = [[-12.046, -77.043], [-9.527, -77.528]]
    r = _route(1, geometry=json.dumps(coords))
    export_geojson([r], path)
    with open(path) as f:
        data = json.load(f)
    first_coord = data["features"][0]["geometry"]["coordinates"][0]
    # Longitude first: lon=-77.043, lat=-12.046
    assert first_coord[0] == pytest.approx(-77.043)
    assert first_coord[1] == pytest.approx(-12.046)


def test_missing_geometry_produces_warning(tmp_path):
    path = str(tmp_path / "out.geojson")
    no_geom = _route(1, geometry=None)
    count, warnings = export_geojson([no_geom], path)
    assert count == 0
    assert len(warnings) == 1
    assert "no geometry" in warnings[0].lower()


def test_empty_geometry_produces_warning(tmp_path):
    path = str(tmp_path / "out.geojson")
    r = _route(1, geometry=json.dumps([]))
    count, warnings = export_geojson([r], path)
    assert count == 0
    assert len(warnings) == 1


def test_properties_include_metadata(tmp_path):
    path = str(tmp_path / "out.geojson")
    export_geojson([_route(1, country="Peru", date="2025-01-02")], path)
    with open(path) as f:
        data = json.load(f)
    props = data["features"][0]["properties"]
    assert props["country"] == "Peru"
    assert props["date"] == "2025-01-02"


def test_mixed_routes_and_waypoints(tmp_path):
    path = str(tmp_path / "out.geojson")
    r1 = _route(1)
    r2 = _route(2, is_waypoint=1, geometry=json.dumps([[-12.0, -77.0]]))
    count, warnings = export_geojson([r1, r2], path)
    assert count == 2
    assert warnings == []

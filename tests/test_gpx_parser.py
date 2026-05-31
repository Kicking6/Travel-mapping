from __future__ import annotations

import pytest
from gpx_manager.gpx_parser import (
    parse_gpx_file,
    parse_filename_metadata,
    calculate_distance,
)
from tests.conftest import DRIVE_GPX, SLEEP_GPX, EMPTY_GPX


# ---------------------------------------------------------------------------
# calculate_distance
# ---------------------------------------------------------------------------

def test_calculate_distance_known_pair():
    # Lima (approx) to Huaraz (approx) straight-line ~300 km
    coords = [[-12.046, -77.043], [-9.527, -77.528]]
    dist = calculate_distance(coords)
    assert 280 < dist < 320


def test_calculate_distance_single_point():
    assert calculate_distance([[-12.0, -77.0]]) == 0.0


def test_calculate_distance_empty():
    assert calculate_distance([]) == 0.0


# ---------------------------------------------------------------------------
# parse_filename_metadata
# ---------------------------------------------------------------------------

def test_parse_filename_standard():
    r = parse_filename_metadata("2025-01-02_drive_lima_to_huaraz")
    assert r["date"] == "2025-01-02"
    assert r["route_type"] == "drive"
    assert r["display_name"] is not None and len(r["display_name"]) > 0


def test_parse_filename_sleep():
    r = parse_filename_metadata("2025-01-01_sleep_lima_hotel")
    assert r["date"] == "2025-01-01"
    assert r["route_type"] == "sleep"


def test_parse_filename_no_type():
    r = parse_filename_metadata("2025-01-05_lima_walk")
    assert r["date"] == "2025-01-05"


def test_parse_filename_alias_flight():
    r = parse_filename_metadata("2025-01-01_flight_arrival_lima")
    assert r["route_type"] == "flight"


def test_parse_filename_no_date():
    r = parse_filename_metadata("random_drive_back")
    assert r["date"] is None
    assert r["route_type"] == "drive"


# ---------------------------------------------------------------------------
# parse_gpx_file — drive route
# ---------------------------------------------------------------------------

def test_parse_drive_route(sample_drive_gpx):
    route = parse_gpx_file(sample_drive_gpx)
    assert route.date == "2025-01-02"
    assert route.route_type == "drive"
    assert route.is_waypoint == 0
    assert len(route.geometry_cache) >= 2
    assert route.distance_km > 0
    assert route.warnings == []


def test_parse_drive_route_coords_valid(sample_drive_gpx):
    route = parse_gpx_file(sample_drive_gpx)
    for lat, lon in route.geometry_cache:
        assert -90 <= lat <= 90
        assert -180 <= lon <= 180


# ---------------------------------------------------------------------------
# parse_gpx_file — sleep waypoint
# ---------------------------------------------------------------------------

def test_parse_sleep_waypoint(sample_sleep_gpx):
    route = parse_gpx_file(sample_sleep_gpx)
    assert route.is_waypoint == 1
    assert len(route.geometry_cache) == 1
    assert route.distance_km == 0.0
    assert route.date == "2025-01-01"


# ---------------------------------------------------------------------------
# parse_gpx_file — empty / no geometry
# ---------------------------------------------------------------------------

def test_parse_empty_gpx(sample_empty_gpx):
    route = parse_gpx_file(sample_empty_gpx)
    assert route.geometry_cache == []
    assert len(route.warnings) > 0
    assert route.distance_km == 0.0


# ---------------------------------------------------------------------------
# parse_gpx_file — non-existent file
# ---------------------------------------------------------------------------

def test_parse_missing_file():
    route = parse_gpx_file("/tmp/does_not_exist_xyz.gpx")
    assert route.geometry_cache == []
    assert len(route.warnings) > 0

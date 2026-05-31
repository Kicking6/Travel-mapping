"""
Generate realistic test GPX files for the GPX Route Manager.

Creates a sample trip through Peru with various route types,
sleeping locations, and edge cases for testing.
"""

import os
import math
import random
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
OUT_DIR = SCRIPT_DIR / "sample_trip"


def _gpx_template(name: str, tracks_xml: str = "", waypoints_xml: str = "") -> str:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="TestGenerator"
     xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>{name}</name></metadata>
  {waypoints_xml}
  {tracks_xml}
</gpx>"""


def _make_track(points: list[tuple[float, float]], name: str = "track") -> str:
    pts = "\n      ".join(
        f'<trkpt lat="{lat}" lon="{lon}"></trkpt>' for lat, lon in points
    )
    return f"""<trk>
    <name>{name}</name>
    <trkseg>
      {pts}
    </trkseg>
  </trk>"""


def _make_waypoint(lat: float, lon: float, name: str) -> str:
    return f'<wpt lat="{lat}" lon="{lon}"><name>{name}</name></wpt>'


def _interpolate(start: tuple, end: tuple, n: int = 30) -> list[tuple[float, float]]:
    """Generate n points along a great-circle-ish line with slight jitter."""
    pts = []
    for i in range(n):
        t = i / (n - 1)
        lat = start[0] + t * (end[0] - start[0]) + random.uniform(-0.01, 0.01)
        lon = start[1] + t * (end[1] - start[1]) + random.uniform(-0.01, 0.01)
        pts.append((round(lat, 6), round(lon, 6)))
    return pts


def _hiking_loop(center: tuple, radius_deg: float = 0.02, n: int = 50) -> list[tuple[float, float]]:
    """Generate a loop around a center point."""
    pts = []
    for i in range(n + 1):
        angle = 2 * math.pi * i / n
        lat = center[0] + radius_deg * math.sin(angle) + random.uniform(-0.002, 0.002)
        lon = center[1] + radius_deg * math.cos(angle) + random.uniform(-0.002, 0.002)
        pts.append((round(lat, 6), round(lon, 6)))
    return pts


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    files = []

    # ── Day 1: Flight Lima arrival + drive to hotel ──
    # Flight: straight line (simplified)
    flight_pts = _interpolate((-12.0219, -77.1143), (-12.0219, -77.1143), n=2)
    f = "2025-01-01_flight_arrival_lima.gpx"
    (OUT_DIR / f).write_text(_gpx_template("Arrival Lima", _make_track(flight_pts, "Flight")))
    files.append(f)

    # Sleep: Lima hotel
    f = "2025-01-01_sleep_lima_hotel.gpx"
    (OUT_DIR / f).write_text(_gpx_template(
        "Lima Hotel", waypoints_xml=_make_waypoint(-12.1191, -77.0300, "Lima Hotel")
    ))
    files.append(f)

    # ── Day 2: Drive Lima to Huaraz ──
    drive_pts = _interpolate((-12.0464, -77.0428), (-9.5279, -77.5278), n=60)
    f = "2025-01-02_drive_lima_to_huaraz.gpx"
    (OUT_DIR / f).write_text(_gpx_template("Lima to Huaraz", _make_track(drive_pts, "Drive")))
    files.append(f)

    # Sleep: Huaraz hostel
    f = "2025-01-02_sleep_huaraz_hostel.gpx"
    (OUT_DIR / f).write_text(_gpx_template(
        "Huaraz Hostel", waypoints_xml=_make_waypoint(-9.5279, -77.5278, "Huaraz Hostel")
    ))
    files.append(f)

    # ── Day 3: Hike Laguna 69 ──
    hike_pts = _hiking_loop((-8.9667, -77.6167), radius_deg=0.015, n=80)
    f = "2025-01-03_walk_laguna_69.gpx"
    (OUT_DIR / f).write_text(_gpx_template("Laguna 69 Hike", _make_track(hike_pts, "Hike")))
    files.append(f)

    # Sleep: same hostel
    f = "2025-01-03_sleep_huaraz_hostel.gpx"
    (OUT_DIR / f).write_text(_gpx_template(
        "Huaraz Hostel", waypoints_xml=_make_waypoint(-9.5279, -77.5278, "Huaraz Hostel")
    ))
    files.append(f)

    # ── Day 4: Bus Huaraz to Lima ──
    bus_pts = _interpolate((-9.5279, -77.5278), (-12.0464, -77.0428), n=50)
    f = "2025-01-04_transit_huaraz_to_lima.gpx"
    (OUT_DIR / f).write_text(_gpx_template("Bus Huaraz to Lima", _make_track(bus_pts, "Bus")))
    files.append(f)

    # ── Day 5: Flight Lima to Cusco ──
    flight_pts = _interpolate((-12.0219, -77.1143), (-13.5320, -71.9675), n=10)
    f = "2025-01-05_flight_lima_to_cusco.gpx"
    (OUT_DIR / f).write_text(_gpx_template("Lima to Cusco", _make_track(flight_pts, "Flight")))
    files.append(f)

    # Sleep: Cusco hostel
    f = "2025-01-05_sleep_cusco_hostel.gpx"
    (OUT_DIR / f).write_text(_gpx_template(
        "Cusco Hostel", waypoints_xml=_make_waypoint(-13.5169, -71.9785, "Cusco Hostel")
    ))
    files.append(f)

    # ── Day 6: Walk around Cusco ──
    walk_pts = _hiking_loop((-13.5169, -71.9785), radius_deg=0.008, n=40)
    f = "2025-01-06_walk_cusco_city_tour.gpx"
    (OUT_DIR / f).write_text(_gpx_template("Cusco City Walk", _make_track(walk_pts, "Walk")))
    files.append(f)

    # ── Day 7: Drive to Sacred Valley + walk ──
    drive_pts = _interpolate((-13.5169, -71.9785), (-13.3324, -72.1171), n=30)
    f = "2025-01-07_drive_cusco_to_ollantaytambo.gpx"
    (OUT_DIR / f).write_text(_gpx_template("Cusco to Ollantaytambo", _make_track(drive_pts, "Drive")))
    files.append(f)

    walk_pts = _hiking_loop((-13.2580, -72.2630), radius_deg=0.01, n=35)
    f = "2025-01-07_walk_ollantaytambo_ruins.gpx"
    (OUT_DIR / f).write_text(_gpx_template("Ollantaytambo Ruins", _make_track(walk_pts, "Walk")))
    files.append(f)

    f = "2025-01-07_sleep_ollantaytambo_lodge.gpx"
    (OUT_DIR / f).write_text(_gpx_template(
        "Ollantaytambo Lodge", waypoints_xml=_make_waypoint(-13.2580, -72.2630, "Ollantaytambo Lodge")
    ))
    files.append(f)

    # ── Day 8: Train to Aguas Calientes ──
    train_pts = _interpolate((-13.2580, -72.2630), (-13.1547, -72.5236), n=25)
    f = "2025-01-08_transit_train_to_aguas_calientes.gpx"
    (OUT_DIR / f).write_text(_gpx_template("Train to Aguas Calientes", _make_track(train_pts, "Train")))
    files.append(f)

    # ── Edge cases ──
    # File with no geometry
    f = "2025-01-09_walk_empty.gpx"
    (OUT_DIR / f).write_text(_gpx_template("Empty File"))
    files.append(f)

    # File with non-standard name (no date prefix)
    drive_pts = _interpolate((-13.1547, -72.5236), (-13.5169, -71.9785), n=20)
    f = "random_drive_back.gpx"
    (OUT_DIR / f).write_text(_gpx_template("Random Drive Back", _make_track(drive_pts, "Drive")))
    files.append(f)

    # ── Sub-folder (tests nested scan) ──
    sub = OUT_DIR / "bolivia"
    sub.mkdir(exist_ok=True)

    ferry_pts = _interpolate((-16.0200, -69.0400), (-16.1967, -68.8133), n=20)
    f = "bolivia/2025-01-15_ferry_lake_titicaca.gpx"
    (sub / "2025-01-15_ferry_lake_titicaca.gpx").write_text(
        _gpx_template("Lake Titicaca Ferry", _make_track(ferry_pts, "Ferry"))
    )
    files.append(f)

    drive_pts = _interpolate((-16.1967, -68.8133), (-16.5000, -68.1500), n=40)
    f = "bolivia/2025-01-16_drive_copacabana_to_la_paz.gpx"
    (sub / "2025-01-16_drive_copacabana_to_la_paz.gpx").write_text(
        _gpx_template("Copacabana to La Paz", _make_track(drive_pts, "Drive"))
    )
    files.append(f)

    print(f"Generated {len(files)} test GPX files in: {OUT_DIR}")
    for f in files:
        print(f"  {f}")


if __name__ == "__main__":
    main()

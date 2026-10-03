from __future__ import annotations

import json
import xml.etree.ElementTree as ET
import pytest

from gpx_manager.export.gpx_exporter import export_gpx

_NS = "http://www.topografix.com/GPX/1/1"


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

def test_export_produces_trk(tmp_path):
    path = str(tmp_path / "out.gpx")
    count, warnings = export_gpx([_route(1)], path)
    assert count == 1
    assert warnings == []
    root = ET.parse(path).getroot()
    trks = root.findall(f"{{{_NS}}}trk")
    assert len(trks) == 1


def test_waypoint_produces_wpt(tmp_path):
    path = str(tmp_path / "out.gpx")
    wp = _route(1, is_waypoint=1, geometry=json.dumps([[-12.046, -77.043]]))
    count, warnings = export_gpx([wp], path)
    assert count == 1
    root = ET.parse(path).getroot()
    wpts = root.findall(f"{{{_NS}}}wpt")
    assert len(wpts) == 1
    assert wpts[0].attrib["lat"] == "-12.046"
    assert wpts[0].attrib["lon"] == "-77.043"


def test_trkpt_coordinates(tmp_path):
    path = str(tmp_path / "out.gpx")
    coords = [[-12.046, -77.043], [-9.527, -77.528]]
    export_gpx([_route(1, geometry=json.dumps(coords))], path)
    root = ET.parse(path).getroot()
    trkseg = root.find(f".//{{{_NS}}}trkseg")
    trkpts = trkseg.findall(f"{{{_NS}}}trkpt")
    assert len(trkpts) == 2
    assert float(trkpts[0].attrib["lat"]) == pytest.approx(-12.046)
    assert float(trkpts[0].attrib["lon"]) == pytest.approx(-77.043)


def test_missing_geometry_produces_warning(tmp_path):
    path = str(tmp_path / "out.gpx")
    count, warnings = export_gpx([_route(1, geometry=None)], path)
    assert count == 0
    assert len(warnings) == 1


def test_extensions_include_metadata(tmp_path):
    path = str(tmp_path / "out.gpx")
    export_gpx([_route(1, country="Peru", route_type="drive", date="2025-01-02")], path)
    root = ET.parse(path).getroot()
    ext = root.find(f".//{{{_NS}}}extensions")
    assert ext is not None
    # Extension child tags may inherit the default GPX namespace on re-parse,
    # so match by local name regardless of namespace prefix.
    children = {el.tag.split("}")[-1]: el for el in ext}
    assert "country" in children
    assert children["country"].text == "Peru"


def test_multiple_routes(tmp_path):
    path = str(tmp_path / "out.gpx")
    count, warnings = export_gpx([_route(1), _route(2, geometry=json.dumps([[-1.0, 1.0], [-2.0, 2.0]]))], path)
    assert count == 2
    root = ET.parse(path).getroot()
    assert len(root.findall(f"{{{_NS}}}trk")) == 2


def test_output_is_valid_xml(tmp_path):
    path = str(tmp_path / "out.gpx")
    export_gpx([_route(1)], path)
    # If parsing doesn't raise, it's well-formed XML
    ET.parse(path)


def test_roundtrip_coordinates(tmp_path):
    """Coordinates written to GPX should be recoverable."""
    path = str(tmp_path / "out.gpx")
    coords = [[-12.046, -77.043], [-9.527, -77.528]]
    export_gpx([_route(1, geometry=json.dumps(coords))], path)
    root = ET.parse(path).getroot()
    trkpts = root.findall(f".//{{{_NS}}}trkpt")
    recovered = [[float(p.attrib["lat"]), float(p.attrib["lon"])] for p in trkpts]
    for orig, rec in zip(coords, recovered):
        assert rec[0] == pytest.approx(orig[0])
        assert rec[1] == pytest.approx(orig[1])

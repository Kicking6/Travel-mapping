from __future__ import annotations

"""
Export a list of route dicts to a combined GPX file.

Each route is written as a separate <trk> element (tracks are not merged).
Waypoints (sleeping locations) are written as <wpt> elements.
"""

import json
import xml.etree.ElementTree as ET
from pathlib import Path
from datetime import datetime


_NS = "http://www.topografix.com/GPX/1/1"
_XSI = "http://www.w3.org/2001/XMLSchema-instance"
_SCHEMA = "http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd"


def export_gpx(routes: list[dict], output_path: str) -> tuple[int, list[str]]:
    """
    Write a combined GPX file containing all provided routes.

    Returns (route_count, warnings).
    """
    ET.register_namespace("", _NS)

    root = ET.Element(f"{{{_NS}}}gpx", attrib={
        "version": "1.1",
        "creator": "GPX Route Manager",
        "{http://www.w3.org/2001/XMLSchema-instance}schemaLocation": _SCHEMA,
    })

    # Metadata block
    meta = ET.SubElement(root, f"{{{_NS}}}metadata")
    ET.SubElement(meta, f"{{{_NS}}}time").text = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    ET.SubElement(meta, f"{{{_NS}}}name").text = "GPX Route Manager Export"

    count = 0
    warnings = []

    for route in routes:
        raw = route.get("geometry_cache")
        if not raw:
            name = route.get("display_name") or str(route.get("id"))
            warnings.append(f"Skipped '{name}' — no geometry")
            continue

        coords: list = json.loads(raw) if isinstance(raw, str) else raw
        if not coords:
            continue

        if route.get("is_waypoint") or len(coords) == 1:
            wpt = ET.SubElement(root, f"{{{_NS}}}wpt", attrib={
                "lat": str(coords[0][0]),
                "lon": str(coords[0][1]),
            })
            ET.SubElement(wpt, f"{{{_NS}}}name").text = (
                route.get("display_name") or "Sleeping Location"
            )
            if route.get("date"):
                ET.SubElement(wpt, f"{{{_NS}}}time").text = route["date"] + "T00:00:00Z"
        else:
            trk = ET.SubElement(root, f"{{{_NS}}}trk")
            ET.SubElement(trk, f"{{{_NS}}}name").text = (
                route.get("display_name") or "Unnamed Route"
            )

            # Write metadata as <extensions> key-value pairs
            _add_extensions(trk, route)

            trkseg = ET.SubElement(trk, f"{{{_NS}}}trkseg")
            for lat, lon in coords:
                ET.SubElement(trkseg, f"{{{_NS}}}trkpt", attrib={
                    "lat": str(lat),
                    "lon": str(lon),
                })

        count += 1

    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)

    tree = ET.ElementTree(root)
    ET.indent(tree, space="  ")
    with open(path, "wb") as f:
        tree.write(f, xml_declaration=True, encoding="utf-8")

    return count, warnings


def _add_extensions(trk: ET.Element, route: dict) -> None:
    ext_keys = [
        ("date", "date"),
        ("day_number", "day_number"),
        ("trip_segment", "trip_segment"),
        ("country", "country"),
        ("region", "region"),
        ("route_type", "route_type"),
        ("notes", "notes"),
        ("distance_km", "distance_km"),
    ]
    ext_el = ET.SubElement(trk, f"{{{_NS}}}extensions")
    for attr, tag in ext_keys:
        val = route.get(attr)
        if val is not None:
            el = ET.SubElement(ext_el, tag)
            el.text = str(val)

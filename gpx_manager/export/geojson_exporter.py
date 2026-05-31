from __future__ import annotations

"""
Export a list of route dicts to a GeoJSON FeatureCollection.

Each route becomes a separate Feature — routes are never merged.
Metadata is preserved in Feature properties.
Coordinates are [longitude, latitude] per the GeoJSON spec (RFC 7946).
"""

import json
from pathlib import Path
from typing import Any


_PROPERTY_KEYS = [
    "display_name", "date", "day_number", "trip_segment",
    "country", "region", "route_type", "notes", "distance_km",
]


def _route_to_feature(route: dict) -> dict | None:
    """Convert a DB route row to a GeoJSON Feature. Returns None if no geometry."""
    raw = route.get("geometry_cache")
    if not raw:
        return None

    coords_latlon: list = json.loads(raw) if isinstance(raw, str) else raw
    if not coords_latlon:
        return None

    # GeoJSON wants [lon, lat]
    coords_lonlat = [[pt[1], pt[0]] for pt in coords_latlon]

    if route.get("is_waypoint") or len(coords_lonlat) == 1:
        geometry = {"type": "Point", "coordinates": coords_lonlat[0]}
    else:
        geometry = {"type": "LineString", "coordinates": coords_lonlat}

    properties: dict[str, Any] = {"id": route["id"]}
    for key in _PROPERTY_KEYS:
        val = route.get(key)
        if val is not None:
            properties[key] = val

    return {
        "type":       "Feature",
        "geometry":   geometry,
        "properties": properties,
    }


def export_geojson(routes: list[dict], output_path: str) -> tuple[int, list[str]]:
    """
    Write a GeoJSON FeatureCollection to output_path.

    Returns (feature_count, warnings) where warnings contains names of
    routes that were skipped due to missing geometry.
    """
    features = []
    warnings = []

    for route in routes:
        feat = _route_to_feature(route)
        if feat:
            features.append(feat)
        else:
            name = route.get("display_name") or route.get("file_path") or str(route.get("id"))
            warnings.append(f"Skipped '{name}' — no geometry")

    collection = {
        "type":     "FeatureCollection",
        "features": features,
    }

    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(collection, f, ensure_ascii=False, indent=2)

    return len(features), warnings

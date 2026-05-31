from __future__ import annotations

"""CSV parser for accommodation / POI data.

Kept in its own module (no Qt imports) so it can be unit-tested without
a QApplication instance being present.
"""

import csv
from pathlib import Path


def parse_poi_csv(path: str) -> tuple[list[dict], list[str]]:
    """Parse a POI CSV file.  Required columns: lat, lon.

    Optional columns: name, type (or category), notes (or description).

    Returns a tuple of (rows, warnings) where ``rows`` is a list of dicts
    ready for :func:`gpx_manager.db.upsert_pois` and ``warnings`` is a
    list of human-readable strings for rows that were skipped.

    Example CSV::

        name,lat,lon,type,notes
        "Base Camp",51.5074,-0.1278,tent,Great views
        "City Hotel",48.8566,2.3522,hotel,Booked via website
    """
    required = {"lat", "lon"}
    rows: list[dict] = []
    warnings: list[str] = []

    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames is None:
            raise ValueError("File appears to be empty or has no header row.")
        headers = {h.strip().lower() for h in reader.fieldnames if h}
        missing = required - headers
        if missing:
            raise ValueError(
                f"Missing required column(s): {', '.join(sorted(missing))}.\n"
                f"Expected columns: name, lat, lon, type, notes"
            )

        for i, raw in enumerate(reader, start=2):
            row = {k.strip().lower(): (v.strip() if v else "") for k, v in raw.items() if k}
            try:
                lat = float(row.get("lat", ""))
                lon = float(row.get("lon", ""))
            except ValueError:
                warnings.append(f"Row {i}: invalid lat/lon — skipped")
                continue
            if not (-90 <= lat <= 90 and -180 <= lon <= 180):
                warnings.append(f"Row {i}: lat/lon out of range ({lat}, {lon}) — skipped")
                continue
            rows.append({
                "name":        row.get("name") or None,
                "lat":         lat,
                "lon":         lon,
                "type":        row.get("type") or row.get("category") or None,
                "notes":       row.get("notes") or row.get("description") or None,
                "source_file": path,
            })

    return rows, warnings

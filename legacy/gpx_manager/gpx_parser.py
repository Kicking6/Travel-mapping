from __future__ import annotations

"""
GPX file parsing, validation, distance calculation and filename metadata extraction.
"""

import math
import re
import json
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Optional

import gpxpy
import gpxpy.gpx


# ---------------------------------------------------------------------------
# Route type taxonomy
# ---------------------------------------------------------------------------

ROUTE_TYPES = ["drive", "transit", "ferry", "walk", "flight", "sleep"]

# Aliases used when parsing filenames
_TYPE_ALIASES: dict[str, str] = {
    "drive":   "drive",  "driving": "drive",  "car":     "drive",
    "transit": "transit","bus":     "transit", "train":   "transit","rail": "transit",
    "ferry":   "ferry",  "boat":    "ferry",
    "walk":    "walk",   "walking": "walk",    "hike":    "walk",   "hiking": "walk",
    "flight":  "flight", "fly":     "flight",  "plane":   "flight",
    "sleep":   "sleep",  "camp":    "sleep",   "stay":    "sleep",
}

# Default colours per type (hex)
TYPE_COLOURS: dict[str, str] = {
    "drive":   "#4A90D9",
    "transit": "#E67E22",
    "ferry":   "#1ABC9C",
    "walk":    "#27AE60",
    "flight":  "#9B59B6",
    "sleep":   "#E74C3C",
    "":        "#95A5A6",
}


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class ParsedRoute:
    file_path: str
    display_name: str
    date: Optional[str]              # ISO 8601
    day_number: Optional[int]
    route_type: Optional[str]
    distance_km: float
    geometry_cache: list             # [[lat, lon], ...]  or  [[lat, lon]] for waypoints
    is_waypoint: int                 # 0 = linestring route, 1 = single point
    warnings: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Distance helpers
# ---------------------------------------------------------------------------

def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Return great-circle distance in km between two WGS84 points."""
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def calculate_distance(coords: list) -> float:
    """Sum haversine distances along a list of [lat, lon] points."""
    total = 0.0
    for i in range(1, len(coords)):
        total += _haversine(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1])
    return round(total, 3)


# ---------------------------------------------------------------------------
# Filename metadata extraction
# ---------------------------------------------------------------------------

_FILENAME_RE = re.compile(
    r"^(?P<date>\d{4}-\d{2}-\d{2})"   # 2025-01-04
    r"(?:_(?P<type>[a-zA-Z]+))?"       # _drive  (optional)
    r"(?:_(?P<name>.+))?"              # _lima_to_huaraz  (optional)
    r"$"
)

# Month name lookup for natural date parsing
_MONTHS = {
    "jan": 1, "january": 1, "feb": 2, "february": 2,
    "mar": 3, "march": 3, "apr": 4, "april": 4,
    "may": 5, "jun": 6, "june": 6, "jul": 7, "july": 7,
    "aug": 8, "august": 8, "sep": 9, "september": 9,
    "oct": 10, "october": 10, "nov": 11, "november": 11,
    "dec": 12, "december": 12,
}

# Patterns for varied date formats in filenames
_DATE_PATTERNS = [
    # 2025-01-04, 2025_01_04
    re.compile(r"(?P<y>\d{4})[-_](?P<m>\d{1,2})[-_](?P<d>\d{1,2})"),
    # 04-01-2025, 04_01_2025 (DD-MM-YYYY)
    re.compile(r"(?P<d>\d{1,2})[-_](?P<m>\d{1,2})[-_](?P<y>\d{4})"),
    # "May 17 2025", "May_17_2025", "May17_2025"
    re.compile(r"(?P<mn>[A-Za-z]+)[\s_-]*(?P<d>\d{1,2})[\s_-]*(?P<y>\d{4})"),
    # "17 May 2025", "17_May_2025"
    re.compile(r"(?P<d>\d{1,2})[\s_-]*(?P<mn>[A-Za-z]+)[\s_-]*(?P<y>\d{4})"),
]


def _try_parse_date(text: str) -> Optional[str]:
    """Try to extract an ISO date from text using multiple patterns."""
    for pat in _DATE_PATTERNS:
        m = pat.search(text)
        if not m:
            continue
        groups = m.groupdict()
        y = int(groups["y"])
        # Month from number or name
        if "mn" in groups:
            mon = _MONTHS.get(groups["mn"].lower())
            if not mon:
                continue
            mo = mon
        else:
            mo = int(groups["m"])
        d = int(groups["d"])
        # Swap DD-MM if month > 12 (handles DD-MM-YYYY ambiguity)
        if mo > 12 and d <= 12:
            mo, d = d, mo
        try:
            dt = date(y, mo, d)
            return dt.isoformat()
        except ValueError:
            continue
    return None


def _extract_type_from_words(words: list[str]) -> Optional[str]:
    """Find the first word that matches a known type alias."""
    for w in words:
        rt = _TYPE_ALIASES.get(w.lower())
        if rt:
            return rt
    return None


def parse_filename_metadata(stem: str) -> dict:
    """
    Extract date, route_type and display_name from a GPX filename stem.
    Handles formats like:
      2025-01-04_drive_lima_to_huaraz
      May 17 2025 driving
      17_05_2025_ferry_lake_titicaca
    Returns dict with keys: date, route_type, display_name (all may be None).
    """
    result: dict = {"date": None, "route_type": None, "display_name": None}

    # Try strict YYYY-MM-DD_type_name pattern first
    m = _FILENAME_RE.match(stem)
    if m:
        raw_date, raw_type, raw_name = m.group("date"), m.group("type"), m.group("name")
        try:
            date.fromisoformat(raw_date)
            result["date"] = raw_date
        except (ValueError, TypeError):
            pass
        if raw_type:
            result["route_type"] = _TYPE_ALIASES.get(raw_type.lower())
        if raw_name:
            result["display_name"] = raw_name.replace("_", " ").title()
        else:
            result["display_name"] = stem.replace("_", " ").title()
        return result

    # Flexible date parsing for non-standard filenames
    result["date"] = _try_parse_date(stem)

    # Split on common separators and look for type keywords
    words = re.split(r"[\s_\-]+", stem)
    result["route_type"] = _extract_type_from_words(words)

    # Build display name: remove date/type tokens, keep the rest
    name_words = []
    skip_nums = {str(y) for y in range(1990, 2100)}  # year numbers
    for w in words:
        wl = w.lower()
        if wl in _TYPE_ALIASES or wl in _MONTHS:
            continue
        if re.match(r"^\d{1,4}$", w) and (w in skip_nums or len(w) <= 2):
            continue
        name_words.append(w)
    if name_words:
        result["display_name"] = " ".join(name_words).title()
    elif result["route_type"]:
        # Only date + type, use type as name
        prefix = result["date"] or ""
        result["display_name"] = f"{prefix} {result['route_type'].title()}".strip()
    else:
        result["display_name"] = stem.replace("_", " ").title()

    return result


# ---------------------------------------------------------------------------
# GPX parsing
# ---------------------------------------------------------------------------

def _validate_coord(lat: float, lon: float) -> bool:
    return -90 <= lat <= 90 and -180 <= lon <= 180


def parse_gpx_file(file_path: str) -> ParsedRoute:
    """
    Parse a GPX file and return a ParsedRoute.
    Handles tracks, routes, and waypoints.
    """
    path = Path(file_path)
    meta = parse_filename_metadata(path.stem)
    warnings: list[str] = []

    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            gpx = gpxpy.parse(f)
    except Exception as e:
        return ParsedRoute(
            file_path=file_path,
            display_name=meta["display_name"] or path.stem,
            date=meta["date"],
            day_number=None,
            route_type=meta["route_type"],
            distance_km=0.0,
            geometry_cache=[],
            is_waypoint=0,
            warnings=[f"Failed to parse GPX: {e}"],
        )

    coords: list = []
    is_waypoint = 0

    # --- Tracks (most common) ---
    for track in gpx.tracks:
        for segment in track.segments:
            for pt in segment.points:
                if _validate_coord(pt.latitude, pt.longitude):
                    coords.append([round(pt.latitude, 6), round(pt.longitude, 6)])
                else:
                    warnings.append(f"Skipped invalid coordinate ({pt.latitude}, {pt.longitude})")

    # --- Routes ---
    if not coords:
        for route in gpx.routes:
            for pt in route.points:
                if _validate_coord(pt.latitude, pt.longitude):
                    coords.append([round(pt.latitude, 6), round(pt.longitude, 6)])

    # --- Waypoints (single-point sleeping locations etc.) ---
    if not coords and gpx.waypoints:
        pt = gpx.waypoints[0]
        if _validate_coord(pt.latitude, pt.longitude):
            coords = [[round(pt.latitude, 6), round(pt.longitude, 6)]]
            is_waypoint = 1

    if not coords:
        warnings.append("No valid route geometry found in this GPX file.")

    distance = 0.0 if is_waypoint else calculate_distance(coords)

    # Use GPX metadata name if filename didn't give us a display name
    display_name = meta["display_name"]
    if not display_name and gpx.name:
        display_name = gpx.name
    if not display_name:
        display_name = path.stem.replace("_", " ").title()

    return ParsedRoute(
        file_path=file_path,
        display_name=display_name,
        date=meta["date"],
        day_number=None,
        route_type=meta["route_type"],
        distance_km=distance,
        geometry_cache=coords,
        is_waypoint=is_waypoint,
        warnings=warnings,
    )


def parsed_route_to_db_dict(pr: ParsedRoute) -> dict:
    return {
        "file_path":      pr.file_path,
        "display_name":   pr.display_name,
        "date":           pr.date,
        "day_number":     pr.day_number,
        "trip_segment":   None,
        "country":        None,
        "region":         None,
        "route_type":     pr.route_type,
        "notes":          None,
        "distance_km":    pr.distance_km,
        "colour_override": None,
        "geometry_cache": json.dumps(pr.geometry_cache),
        "is_waypoint":    pr.is_waypoint,
    }

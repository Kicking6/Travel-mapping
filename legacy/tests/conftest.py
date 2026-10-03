from __future__ import annotations

import shutil
from pathlib import Path

import pytest

SAMPLE_DIR = Path(__file__).parent.parent / "test_data" / "sample_trip"

DRIVE_GPX   = SAMPLE_DIR / "2025-01-02_drive_lima_to_huaraz.gpx"
SLEEP_GPX   = SAMPLE_DIR / "2025-01-01_sleep_lima_hotel.gpx"
EMPTY_GPX   = SAMPLE_DIR / "2025-01-09_walk_empty.gpx"
FLIGHT_GPX  = SAMPLE_DIR / "2025-01-01_flight_arrival_lima.gpx"


@pytest.fixture(autouse=True)
def isolated_db(tmp_path, monkeypatch):
    """Redirect DB_PATH to a temp file so tests never touch the real database."""
    import gpx_manager.db as db
    test_db = tmp_path / "test_routes.db"
    monkeypatch.setattr(db, "DB_PATH", test_db)
    db.init_db()
    yield test_db


@pytest.fixture
def sample_drive_gpx(tmp_path):
    dest = tmp_path / DRIVE_GPX.name
    shutil.copy(DRIVE_GPX, dest)
    return str(dest)


@pytest.fixture
def sample_sleep_gpx(tmp_path):
    dest = tmp_path / SLEEP_GPX.name
    shutil.copy(SLEEP_GPX, dest)
    return str(dest)


@pytest.fixture
def sample_empty_gpx(tmp_path):
    dest = tmp_path / EMPTY_GPX.name
    shutil.copy(EMPTY_GPX, dest)
    return str(dest)

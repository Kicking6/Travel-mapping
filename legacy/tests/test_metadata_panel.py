from __future__ import annotations

"""Tests for pure-logic methods on MetadataPanel — no UI instantiation needed."""

import pytest
from gpx_manager.ui.metadata_panel import MetadataPanel


# ---------------------------------------------------------------------------
# _build_clean_name — static method, no QApplication needed
# ---------------------------------------------------------------------------

class TestBuildCleanName:
    def test_full_route(self):
        r = {"date": "2025-01-02", "route_type": "drive", "country": "Peru", "day_number": 2}
        name = MetadataPanel._build_clean_name(r)
        assert name == "2025-01-02_Drive_Peru_Day2.gpx"

    def test_no_date_returns_none(self):
        r = {"route_type": "drive", "country": "Peru"}
        assert MetadataPanel._build_clean_name(r) is None

    def test_date_only(self):
        r = {"date": "2025-01-05"}
        name = MetadataPanel._build_clean_name(r)
        assert name == "2025-01-05.gpx"

    def test_country_spaces_removed(self):
        r = {"date": "2025-01-05", "country": "New Zealand"}
        name = MetadataPanel._build_clean_name(r)
        assert "NewZealand" in name

    def test_no_day_number(self):
        r = {"date": "2025-01-05", "route_type": "walk", "day_number": None}
        name = MetadataPanel._build_clean_name(r)
        assert "Day" not in name

    def test_day_zero_not_included(self):
        # day_number=0 is falsy, treated as no day
        r = {"date": "2025-01-05", "route_type": "walk", "day_number": 0}
        name = MetadataPanel._build_clean_name(r)
        assert "Day" not in name


# ---------------------------------------------------------------------------
# _read_widget — needs QApplication; use a session-scoped fixture
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def qapp():
    """Session-scoped QApplication so widget tests can run.

    Skips if PyQt6 can't initialise (headless CI with no display server).
    """
    import sys
    try:
        from PyQt6.QtWidgets import QApplication
        app = QApplication.instance() or QApplication(sys.argv[:1])
        yield app
    except Exception as exc:
        pytest.skip(f"QApplication unavailable: {exc}")


@pytest.mark.usefixtures("qapp")
class TestReadWidget:
    def test_qlineedit(self, qapp):
        from PyQt6.QtWidgets import QLineEdit
        from gpx_manager.ui.metadata_panel import MetadataPanel
        w = QLineEdit()
        w.setText("  hello  ")
        assert MetadataPanel._read_widget(w) == "hello"

    def test_qlineedit_empty_returns_none(self, qapp):
        from PyQt6.QtWidgets import QLineEdit
        w = QLineEdit()
        assert MetadataPanel._read_widget(w) is None

    def test_qspinbox_nonzero(self, qapp):
        from PyQt6.QtWidgets import QSpinBox
        w = QSpinBox()
        w.setRange(0, 9999)
        w.setValue(5)
        assert MetadataPanel._read_widget(w) == 5

    def test_qspinbox_zero_returns_none(self, qapp):
        from PyQt6.QtWidgets import QSpinBox
        w = QSpinBox()
        w.setValue(0)
        assert MetadataPanel._read_widget(w) is None

    def test_qcombobox_with_data(self, qapp):
        from PyQt6.QtWidgets import QComboBox
        w = QComboBox()
        w.addItem("—", "")
        w.addItem("Drive", "drive")
        w.setCurrentIndex(1)
        assert MetadataPanel._read_widget(w) == "drive"

    def test_qcombobox_empty_selection_returns_none(self, qapp):
        from PyQt6.QtWidgets import QComboBox
        w = QComboBox()
        w.addItem("—", "")
        w.setCurrentIndex(0)
        assert MetadataPanel._read_widget(w) is None

    def test_qtextedit(self, qapp):
        from PyQt6.QtWidgets import QTextEdit
        w = QTextEdit()
        w.setPlainText("some notes")
        assert MetadataPanel._read_widget(w) == "some notes"

    def test_qtextedit_whitespace_returns_none(self, qapp):
        from PyQt6.QtWidgets import QTextEdit
        w = QTextEdit()
        w.setPlainText("   ")
        assert MetadataPanel._read_widget(w) is None

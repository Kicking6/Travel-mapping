from __future__ import annotations

"""Left panel: route list table + filter panel with pill and popup dropdowns."""

from PyQt6.QtCore import Qt, pyqtSignal, QDate
from PyQt6.QtGui import QColor, QBrush
from PyQt6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QSplitter,
    QTableWidget, QTableWidgetItem, QHeaderView,
    QFrame, QLabel, QPushButton, QLineEdit,
    QSpinBox, QScrollArea,
    QAbstractItemView,
)

import gpx_manager.db as db
from gpx_manager.gpx_parser import TYPE_COLOURS
from gpx_manager.ui.widgets import PillMultiSelect, PopupCheckList, DateRangeButton


def _type_color(route_type: str | None) -> str:
    return TYPE_COLOURS.get(route_type or "", TYPE_COLOURS.get("", "#999"))


# ---------------------------------------------------------------------------
# Filter panel
# ---------------------------------------------------------------------------

class FilterPanel(QWidget):
    filters_changed = pyqtSignal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self._build_ui()

    def _build_ui(self):
        outer = QVBoxLayout(self)
        outer.setContentsMargins(10, 10, 10, 6)
        outer.setSpacing(8)

        # Header
        hdr = QHBoxLayout()
        lbl = QLabel("Filters")
        lbl.setStyleSheet(
            "font-family:'Poppins','Raleway',sans-serif;"
            "font-weight:600;font-size:13px;color:#42383c;"
        )
        clear_btn = QPushButton("Clear All")
        clear_btn.setFixedWidth(68)
        clear_btn.setFlat(True)
        clear_btn.clicked.connect(self.clear_filters)
        hdr.addWidget(lbl)
        hdr.addStretch()
        hdr.addWidget(clear_btn)
        outer.addLayout(hdr)

        # Scroll area for filter controls
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.Shape.NoFrame)
        outer.addWidget(scroll)

        c = QWidget()
        scroll.setWidget(c)
        lay = QVBoxLayout(c)
        lay.setContentsMargins(0, 0, 6, 0)
        lay.setSpacing(10)

        # Notes search
        lay.addWidget(self._section_label("Search notes"))
        self.notes_edit = QLineEdit()
        self.notes_edit.setPlaceholderText("keyword…")
        self.notes_edit.textChanged.connect(self.filters_changed)
        lay.addWidget(self.notes_edit)

        # Date range — single button opens a calendar range picker
        lay.addWidget(self._section_label("Date range"))
        self.date_range = DateRangeButton()
        self.date_range.date_changed.connect(self.filters_changed)
        lay.addWidget(self.date_range)

        # Day range
        lay.addWidget(self._section_label("Day number"))
        day_row = QHBoxLayout()
        self.day_min = QSpinBox()
        self.day_min.setRange(0, 9999)
        self.day_min.setSpecialValueText("—")
        self.day_min.valueChanged.connect(self.filters_changed)
        self.day_max = QSpinBox()
        self.day_max.setRange(0, 9999)
        self.day_max.setSpecialValueText("—")
        self.day_max.valueChanged.connect(self.filters_changed)
        dash = QLabel("–")
        dash.setAlignment(Qt.AlignmentFlag.AlignCenter)
        dash.setFixedWidth(16)
        day_row.addWidget(self.day_min)
        day_row.addWidget(dash)
        day_row.addWidget(self.day_max)
        lay.addLayout(day_row)

        # Type — toggle pills (small fixed set)
        lay.addWidget(self._section_label("Type"))
        self.type_combo = PillMultiSelect()
        self.type_combo.changed.connect(self.filters_changed)
        lay.addWidget(self.type_combo)

        # Country / Region / Segment — popup check-list (variable length)
        lay.addWidget(self._section_label("Country"))
        self.country_combo = PopupCheckList("All countries")
        self.country_combo.changed.connect(self.filters_changed)
        lay.addWidget(self.country_combo)

        lay.addWidget(self._section_label("Region"))
        self.region_combo = PopupCheckList("All regions")
        self.region_combo.changed.connect(self.filters_changed)
        lay.addWidget(self.region_combo)

        lay.addWidget(self._section_label("Segment"))
        self.segment_combo = PopupCheckList("All segments")
        self.segment_combo.changed.connect(self.filters_changed)
        lay.addWidget(self.segment_combo)

        lay.addStretch()

    @staticmethod
    def _section_label(text: str) -> QLabel:
        lbl = QLabel(text)
        lbl.setStyleSheet(
            "font-family:'Poppins','Raleway',sans-serif;"
            "font-weight:600;font-size:11px;color:#748ca0;"
            "text-transform:uppercase;letter-spacing:0.5px;"
        )
        return lbl

    def refresh_options(self):
        self.type_combo.set_options(db.get_setting_values("transport_type"))
        self.country_combo.set_options(db.get_setting_values("country"))
        self.region_combo.set_options(db.get_setting_values("region"))
        self.segment_combo.set_options(db.get_setting_values("trip_segment"))

    def get_filters(self) -> dict:
        f = {}
        t = self.notes_edit.text().strip()
        if t:
            f["notes_text"] = t

        d_from = self.date_range.date_from()
        if d_from is not None:
            f["date_from"] = d_from.toString("yyyy-MM-dd")
        d_to = self.date_range.date_to()
        if d_to is not None:
            f["date_to"] = d_to.toString("yyyy-MM-dd")

        if self.day_min.value() > 0:
            f["day_number_min"] = self.day_min.value()
        if self.day_max.value() > 0:
            f["day_number_max"] = self.day_max.value()

        for key, combo in [("route_types",   self.type_combo),
                           ("countries",     self.country_combo),
                           ("regions",       self.region_combo),
                           ("trip_segments", self.segment_combo)]:
            vals = combo.checked_values()
            if vals:
                f[key] = vals
        return f

    def clear_filters(self):
        self.notes_edit.clear()
        self.date_range.clear()
        self.day_min.setValue(0)
        self.day_max.setValue(0)
        self.type_combo.clear_checks()
        self.country_combo.clear_checks()
        self.region_combo.clear_checks()
        self.segment_combo.clear_checks()


# ---------------------------------------------------------------------------
# Route table
# ---------------------------------------------------------------------------

_COLS = ["", "Name", "Date", "Day", "Type", "Country", "km"]
_CI = {n: i for i, n in enumerate(_COLS)}


class RouteTable(QTableWidget):
    route_hovered   = pyqtSignal(int)
    route_unhovered = pyqtSignal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self._id_map: dict[int, int] = {}
        self._setup()

    def _setup(self):
        self.setColumnCount(len(_COLS))
        self.setHorizontalHeaderLabels(_COLS)
        self.verticalHeader().setVisible(False)
        self.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.setSelectionMode(QAbstractItemView.SelectionMode.ExtendedSelection)
        self.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self.setShowGrid(False)
        self.setSortingEnabled(True)
        self.setMouseTracking(True)
        self.horizontalHeader().setSectionResizeMode(_CI["Name"], QHeaderView.ResizeMode.Stretch)
        for col, w in [("", 6), ("Date", 90), ("Day", 40), ("Type", 70), ("Country", 80), ("km", 55)]:
            self.setColumnWidth(_CI[col], w)

    def mouseMoveEvent(self, event):
        row = self.rowAt(event.pos().y())
        if row >= 0 and row in self._id_map:
            self.route_hovered.emit(self._id_map[row])
        else:
            self.route_unhovered.emit()
        super().mouseMoveEvent(event)

    def leaveEvent(self, event):
        self.route_unhovered.emit()
        super().leaveEvent(event)

    def populate(self, routes: list[dict]):
        self.setSortingEnabled(False)
        self.setRowCount(0)
        self._id_map.clear()

        for row, r in enumerate(routes):
            self.insertRow(row)
            self._id_map[row] = r["id"]

            color = r.get("colour_override") or _type_color(r.get("route_type"))
            swatch = QTableWidgetItem()
            swatch.setBackground(QBrush(QColor(color)))
            swatch.setFlags(Qt.ItemFlag.ItemIsEnabled | Qt.ItemFlag.ItemIsSelectable)
            self.setItem(row, _CI[""], swatch)

            name_item = QTableWidgetItem(r.get("display_name") or "")
            name_item.setData(Qt.ItemDataRole.UserRole, r["id"])
            self.setItem(row, _CI["Name"], name_item)
            self.setItem(row, _CI["Date"], QTableWidgetItem(r.get("date") or ""))

            day = r.get("day_number")
            self.setItem(row, _CI["Day"], QTableWidgetItem(str(day) if day is not None else ""))
            self.setItem(row, _CI["Type"], QTableWidgetItem(r.get("route_type") or ""))
            self.setItem(row, _CI["Country"], QTableWidgetItem(r.get("country") or ""))

            km = r.get("distance_km")
            self.setItem(row, _CI["km"], QTableWidgetItem(f"{km:.1f}" if km else ""))
            self.setRowHeight(row, 30)

        self.setSortingEnabled(True)

    def selected_ids(self) -> list[int]:
        seen = set()
        ids = []
        for idx in self.selectedIndexes():
            rid = self._id_map.get(idx.row())
            if rid is not None and rid not in seen:
                seen.add(rid)
                ids.append(rid)
        return ids

    def restore_selection(self, ids: list[int]):
        """Re-select rows by route ID without emitting selectionChanged."""
        ids_set = set(ids)
        self.blockSignals(True)
        self.clearSelection()
        for row, rid in self._id_map.items():
            if rid in ids_set:
                for col in range(self.columnCount()):
                    item = self.item(row, col)
                    if item:
                        item.setSelected(True)
        self.blockSignals(False)

    def select_by_id(self, route_id: int):
        """Select and scroll to the row for *route_id*, triggering selection signals."""
        for row, rid in self._id_map.items():
            if rid == route_id:
                self.clearSelection()
                for col in range(self.columnCount()):
                    item = self.item(row, col)
                    if item:
                        item.setSelected(True)
                self.scrollTo(self.model().index(row, 0))
                break

    def update_row_color(self, route_id: int, color: str):
        for row, rid in self._id_map.items():
            if rid == route_id:
                item = self.item(row, _CI[""])
                if item:
                    item.setBackground(QBrush(QColor(color)))
                break


# ---------------------------------------------------------------------------
# Left panel — filter + table + status
# ---------------------------------------------------------------------------

class LeftPanel(QWidget):
    routes_selected = pyqtSignal(list)
    route_hovered   = pyqtSignal(int)
    route_unhovered = pyqtSignal()
    filters_changed = pyqtSignal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self._routes: list[dict] = []
        self._build_ui()

    def _build_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        splitter = QSplitter(Qt.Orientation.Vertical)
        splitter.setHandleWidth(4)

        self.filter_panel = FilterPanel()
        self.filter_panel.setMinimumHeight(100)
        self.filter_panel.filters_changed.connect(self.filters_changed)
        splitter.addWidget(self.filter_panel)

        table_w = QWidget()
        tl = QVBoxLayout(table_w)
        tl.setContentsMargins(0, 0, 0, 0)
        tl.setSpacing(0)
        self.table = RouteTable()
        self.table.route_hovered.connect(self.route_hovered)
        self.table.route_unhovered.connect(self.route_unhovered)
        self.table.itemSelectionChanged.connect(self._on_sel)
        tl.addWidget(self.table)

        self._status = QLabel()
        self._status.setStyleSheet("padding:3px 10px;font-size:11px;color:#748ca0;")
        tl.addWidget(self._status)

        splitter.addWidget(table_w)
        splitter.setSizes([300, 500])
        layout.addWidget(splitter)

    def load_routes(self, routes: list[dict]):
        self._routes = routes
        self.table.populate(routes)
        self._update_status()

    def _on_sel(self):
        self.routes_selected.emit(self.table.selected_ids())
        self._update_status()

    def _update_status(self):
        total = len(self._routes)
        sel_ids = set(self.table.selected_ids())
        if sel_ids:
            dist = sum(r.get("distance_km") or 0 for r in self._routes if r["id"] in sel_ids)
            self._status.setText(f"{len(sel_ids)} selected · {dist:.1f} km  |  {total} total")
        else:
            dist = sum(r.get("distance_km") or 0 for r in self._routes)
            self._status.setText(f"{total} routes · {dist:.1f} km total")

    def get_filters(self) -> dict:
        return self.filter_panel.get_filters()

    def refresh_filter_options(self):
        self.filter_panel.refresh_options()

    def selected_ids(self) -> list[int]:
        return self.table.selected_ids()

    def restore_selection(self, ids: list[int]):
        """Re-select table rows by ID without triggering routes_selected signal."""
        self.table.restore_selection(ids)

    def select_route_by_id(self, route_id: int):
        """Select a single row by route ID (triggers routes_selected → metadata panel)."""
        self.table.select_by_id(route_id)

    def update_row_color(self, route_id: int, color: str):
        self.table.update_row_color(route_id, color)

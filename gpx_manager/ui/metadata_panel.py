from __future__ import annotations

"""Metadata editing panel — clean card layout with grouped sections."""

import shutil
from pathlib import Path

from PyQt6.QtCore import Qt, QDate, pyqtSignal
from PyQt6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout,
    QLabel, QLineEdit, QComboBox, QSpinBox, QDoubleSpinBox,
    QPushButton, QFrame, QTextEdit, QSizePolicy, QScrollArea,
)

import gpx_manager.db as db
from gpx_manager.gpx_parser import TYPE_COLOURS
from gpx_manager.ui.widgets import ColorButton, DateButton


# ---------------------------------------------------------------------------
# A field cell — thin wrapper so _cells dict stays consistent.
# ---------------------------------------------------------------------------

class _Cell(QWidget):
    def __init__(self, field: QWidget, bulk: bool = False, parent=None):
        super().__init__(parent)
        lay = QHBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(4)
        # Checkboxes removed from bulk mode — all fields are enabled; only
        # fields the user actually fills in (non-None) get applied.
        lay.addWidget(field, 1)
        self.field = field

    def is_active(self) -> bool:
        return True


def _label(text: str) -> QLabel:
    lbl = QLabel(text.upper())
    lbl.setStyleSheet(
        "font-family:'Poppins','Raleway',sans-serif;"
        "color:#748ca0;font-size:10px;font-weight:600;letter-spacing:0.4px;"
    )
    lbl.setAlignment(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
    return lbl


def _section(text: str) -> QLabel:
    lbl = QLabel(f"  {text}")
    lbl.setFixedHeight(22)
    lbl.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
    lbl.setStyleSheet(
        "background:#c4d4de; color:#4a6070; font-size:10px; font-weight:700;"
        "font-family:'Poppins','Raleway',sans-serif; letter-spacing:0.8px;"
        "border-radius:3px; padding-left:4px;"
    )
    return lbl


# ---------------------------------------------------------------------------
# Metadata panel
# ---------------------------------------------------------------------------

class MetadataPanel(QWidget):
    metadata_saved = pyqtSignal(list, dict)
    color_changed  = pyqtSignal(int, str)
    file_copied    = pyqtSignal(int, str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._route_ids: list[int] = []
        self._bulk = False
        self._cells: dict[str, _Cell] = {}

        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)

        # Header strip
        self._header_frame = QFrame()
        self._header_frame.setFixedHeight(36)
        self._header_frame.setStyleSheet(
            "QFrame { background:#FFFFFF; border-bottom:1px solid #a8bcc8; }"
        )
        hl = QHBoxLayout(self._header_frame)
        hl.setContentsMargins(12, 4, 8, 4)
        hl.setSpacing(8)
        self._header_lbl = QLabel("No selection")
        self._header_lbl.setStyleSheet(
            "font-family:'Poppins','Raleway',sans-serif;"
            "font-weight:600;font-size:13px;color:#42383c;"
        )
        hl.addWidget(self._header_lbl)
        hl.addStretch()
        self._save_btn = QPushButton("Save")
        self._save_btn.setFixedWidth(80)
        self._save_btn.setDefault(True)
        self._save_btn.clicked.connect(self._on_save)
        hl.addWidget(self._save_btn)
        outer.addWidget(self._header_frame)

        # Scrollable form area — rebuilt when switching between single and bulk modes.
        self._scroll = QScrollArea()
        self._scroll.setWidgetResizable(True)
        self._scroll.setFrameShape(QFrame.Shape.NoFrame)
        self._scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self._scroll.setStyleSheet("QScrollArea { background:#d0e0e9; }")
        self._form_host = QFrame()
        self._form_host.setStyleSheet("QFrame { background:#d0e0e9; }")
        self._scroll.setWidget(self._form_host)
        outer.addWidget(self._scroll, 1)

        self._build_form(bulk=False)
        self._set_empty()

    # ------------------------------------------------------------------
    # Form construction
    # ------------------------------------------------------------------

    def _build_form(self, bulk: bool):
        self._bulk = bulk
        self._cells.clear()

        old = self._form_host.layout()
        if old is not None:
            QWidget().setLayout(old)

        outer = QVBoxLayout(self._form_host)
        outer.setContentsMargins(10, 8, 10, 8)
        outer.setSpacing(6)

        # ---- Build widgets ----
        self._name_edit     = QLineEdit()
        self._date_edit     = DateButton(show_today=False)
        self._day_spin      = QSpinBox()
        self._day_spin.setRange(0, 9999)
        self._day_spin.setSpecialValueText("—")
        self._type_combo    = QComboBox()
        self._country_combo = QComboBox()
        self._region_combo  = QComboBox()
        self._segment_combo = QComboBox()
        self._notes_edit    = QTextEdit()
        self._notes_edit.setFixedHeight(64)
        self._type_combo.currentIndexChanged.connect(self._on_type_changed)

        cells = {
            "display_name": _Cell(self._name_edit,    bulk=bulk),
            "date":         _Cell(self._date_edit,    bulk=bulk),
            "day_number":   _Cell(self._day_spin,     bulk=bulk),
            "route_type":   _Cell(self._type_combo,   bulk=bulk),
            "country":      _Cell(self._country_combo,bulk=bulk),
            "region":       _Cell(self._region_combo, bulk=bulk),
            "trip_segment": _Cell(self._segment_combo,bulk=bulk),
            "notes":        _Cell(self._notes_edit,   bulk=bulk),
        }
        self._cells = cells

        # ---- IDENTITY section ----
        outer.addWidget(_section("Identity"))

        outer.addWidget(_label("Name"))
        outer.addWidget(cells["display_name"])

        date_day_row = QHBoxLayout()
        date_day_row.setSpacing(8)
        date_col = QVBoxLayout()
        date_col.setSpacing(2)
        date_col.addWidget(_label("Date"))
        date_col.addWidget(cells["date"])
        day_col = QVBoxLayout()
        day_col.setSpacing(2)
        day_col.addWidget(_label("Day No."))
        day_col.addWidget(cells["day_number"])
        date_day_row.addLayout(date_col, 3)
        date_day_row.addLayout(day_col, 1)
        outer.addLayout(date_day_row)

        # ---- CLASSIFICATION section ----
        outer.addWidget(_section("Classification"))

        type_colour_row = QHBoxLayout()
        type_colour_row.setSpacing(8)

        type_col = QVBoxLayout()
        type_col.setSpacing(2)
        type_col.addWidget(_label("Type"))
        type_col.addWidget(cells["route_type"])
        type_colour_row.addLayout(type_col, 3)

        self._color_btn = ColorButton("#999", "Route colour")
        self._color_btn.color_chosen.connect(self._on_color_picked)
        self._color_reset = QPushButton("↺")
        self._color_reset.setFixedWidth(28)
        self._color_reset.setToolTip("Reset to type default")
        self._color_reset.setFlat(True)
        self._color_reset.clicked.connect(self._on_color_reset)
        colour_inner = QHBoxLayout()
        colour_inner.setContentsMargins(0, 0, 0, 0)
        colour_inner.setSpacing(4)
        colour_inner.addWidget(self._color_btn)
        colour_inner.addWidget(self._color_reset)
        colour_widget = QWidget()
        colour_widget.setLayout(colour_inner)
        colour_col = QVBoxLayout()
        colour_col.setSpacing(2)
        colour_col.addWidget(_label("Colour"))
        colour_col.addWidget(colour_widget)
        type_colour_row.addLayout(colour_col, 2)

        # Feature 1: per-route weight spinbox (0 = use global default)
        self._weight_spin = QSpinBox()
        self._weight_spin.setRange(0, 10)
        self._weight_spin.setSpecialValueText("—")   # 0 means "use global"
        self._weight_spin.setToolTip("Line weight override (0/— = use global setting)")
        weight_col = QVBoxLayout()
        weight_col.setSpacing(2)
        weight_col.addWidget(_label("Weight"))
        weight_col.addWidget(self._weight_spin)
        type_colour_row.addLayout(weight_col, 1)

        outer.addLayout(type_colour_row)

        # ---- LOCATION section ----
        outer.addWidget(_section("Location"))

        loc_row = QHBoxLayout()
        loc_row.setSpacing(8)
        for field_key, label_text in [("country","Country"), ("region","Region"), ("trip_segment","Segment")]:
            col = QVBoxLayout()
            col.setSpacing(2)
            col.addWidget(_label(label_text))
            col.addWidget(cells[field_key])
            loc_row.addLayout(col, 1)
        outer.addLayout(loc_row)

        # ---- NOTES section ----
        outer.addWidget(_section("Notes"))
        outer.addWidget(cells["notes"])

        outer.addStretch(1)

        self._populate_combos()

    # ------------------------------------------------------------------
    # Combo population
    # ------------------------------------------------------------------

    def refresh_dropdowns(self):
        self._populate_combos()

    def _populate_combos(self):
        for combo, cat in [
            (self._type_combo,    "transport_type"),
            (self._country_combo, "country"),
            (self._region_combo,  "region"),
            (self._segment_combo, "trip_segment"),
        ]:
            cur = combo.currentData()
            combo.clear()
            combo.addItem("—", "")
            for v in db.get_setting_values(cat):
                combo.addItem(v.title() if cat == "transport_type" else v, v)
            if cur:
                idx = combo.findData(cur)
                if idx >= 0:
                    combo.setCurrentIndex(idx)

    # ------------------------------------------------------------------
    # Load / clear
    # ------------------------------------------------------------------

    def load_route(self, route: dict):
        self._route_ids = [route["id"]]
        if self._bulk:
            self._build_form(bulk=False)
        self._header_lbl.setText(route.get("display_name") or "Unnamed")
        self._header_lbl.setStyleSheet(
            "font-family:'Poppins','Raleway',sans-serif;"
            "font-weight:600;font-size:13px;color:#42383c;"
        )
        self._header_frame.setStyleSheet(
            "QFrame { background:#FFFFFF; border-bottom:1px solid #a8bcc8; }"
        )
        self._set_fields(route)
        self._set_enabled(True)
        self._save_btn.setText("Save")

    def load_bulk(self, routes: list[dict]):
        self._route_ids = [r["id"] for r in routes]
        if not self._bulk:
            self._build_form(bulk=True)
        n = len(routes)
        self._header_lbl.setText(f"BULK EDIT — {n} routes selected")
        self._header_lbl.setStyleSheet(
            "font-family:'Poppins','Raleway',sans-serif;"
            "font-weight:700;font-size:12px;color:#FFFFFF;letter-spacing:0.3px;"
        )
        self._header_frame.setStyleSheet(
            "QFrame { background:#225875; border-bottom:1px solid #1a4660; }"
        )
        self._clear_fields()
        self._save_btn.setText(f"Apply to {n}")
        self._save_btn.setEnabled(True)

    def clear(self):
        self._route_ids = []
        if self._bulk:
            self._build_form(bulk=False)
        self._header_frame.setStyleSheet(
            "QFrame { background:#FFFFFF; border-bottom:1px solid #a8bcc8; }"
        )
        self._set_empty()

    # ------------------------------------------------------------------
    # Field helpers
    # ------------------------------------------------------------------

    def _set_fields(self, r: dict):
        self._name_edit.setText(r.get("display_name") or "")
        date_str = r.get("date") or ""
        if date_str:
            qd = QDate.fromString(date_str, "yyyy-MM-dd")
            self._date_edit.set_date(qd if qd.isValid() else None)
        else:
            self._date_edit.clear()
        self._day_spin.setValue(int(r["day_number"]) if r.get("day_number") is not None else 0)
        self._set_combo(self._type_combo,    r.get("route_type"))
        self._set_combo(self._country_combo, r.get("country"))
        self._set_combo(self._region_combo,  r.get("region"))
        self._set_combo(self._segment_combo, r.get("trip_segment"))
        self._notes_edit.setPlainText(r.get("notes") or "")
        rt = r.get("route_type") or ""
        if self._color_btn:
            self._color_btn.set_color(r.get("colour_override") or TYPE_COLOURS.get(rt, "#999"))
        # Feature 1: per-route weight (0 = global default, shown as "—")
        self._weight_spin.setValue(int(r.get("weight_override") or 0))

    def _clear_fields(self):
        self._name_edit.clear()
        self._date_edit.clear()
        self._day_spin.setValue(0)
        self._type_combo.setCurrentIndex(0)
        self._country_combo.setCurrentIndex(0)
        self._region_combo.setCurrentIndex(0)
        self._segment_combo.setCurrentIndex(0)
        self._notes_edit.clear()
        if self._color_btn:
            self._color_btn.set_color("#999")
        self._weight_spin.setValue(0)

    def _set_empty(self):
        self._header_lbl.setText("No selection")
        self._clear_fields()
        self._set_enabled(False)

    def _set_enabled(self, on: bool):
        for cell in self._cells.values():
            cell.field.setEnabled(on)
        if self._color_btn:
            self._color_btn.setEnabled(on)
            self._color_reset.setEnabled(on)
        self._weight_spin.setEnabled(on)
        self._save_btn.setEnabled(on)

    @staticmethod
    def _set_combo(combo, value):
        idx = combo.findData(value or "")
        combo.setCurrentIndex(max(0, idx))

    @staticmethod
    def _read_widget(w):
        if isinstance(w, DateButton):
            d = w.date()
            return d.toString("yyyy-MM-dd") if (d is not None and d.isValid()) else None
        if isinstance(w, QLineEdit):  return w.text().strip() or None
        if isinstance(w, QSpinBox):   return w.value() or None
        if isinstance(w, QComboBox):  return w.currentData() or None
        if isinstance(w, QTextEdit):  return w.toPlainText().strip() or None
        return None

    # ------------------------------------------------------------------
    # Colour
    # ------------------------------------------------------------------

    def _on_type_changed(self, _):
        if not self._bulk and self._route_ids and self._color_btn:
            rt = self._type_combo.currentData() or ""
            self._color_btn.set_color(TYPE_COLOURS.get(rt, "#999"))

    def _on_color_picked(self, color):
        for rid in self._route_ids:
            self.color_changed.emit(rid, color)

    def _on_color_reset(self):
        rt = self._type_combo.currentData() or ""
        default = TYPE_COLOURS.get(rt, "#999")
        if self._color_btn:
            self._color_btn.set_color(default)
        for rid in self._route_ids:
            self.color_changed.emit(rid, default)

    # ------------------------------------------------------------------
    # Save
    # ------------------------------------------------------------------

    def _on_save(self):
        if not self._route_ids:
            return
        fields = self._collect_fields()
        self.metadata_saved.emit(self._route_ids, fields)
        self._copy_files(fields)

    def _collect_fields(self) -> dict:
        if self._bulk:
            # Only include fields the user actually filled in (non-None).
            # Leaving a field blank means "don't change it".
            result = {}
            for key, cell in self._cells.items():
                val = self._read_widget(cell.field)
                if val is not None:
                    result[key] = val
            return result
        fields = {}
        for key, cell in self._cells.items():
            fields[key] = self._read_widget(cell.field)
        if self._color_btn:
            fields["colour_override"] = self._color_btn.color()
        # Feature 1: per-route weight (0 = use global, stored as None)
        w = self._weight_spin.value()
        fields["weight_override"] = w if w > 0 else None
        return fields

    # ------------------------------------------------------------------
    # File copy with clean naming
    # ------------------------------------------------------------------

    def _copy_files(self, fields: dict):
        export_folder = db.get_app_config("export_folder")
        if not export_folder:
            return
        dest = Path(export_folder)
        dest.mkdir(parents=True, exist_ok=True)

        for rid in self._route_ids:
            route = db.get_route_by_id(rid)
            if not route:
                continue
            merged = {**route, **{k: v for k, v in fields.items() if v is not None}}
            name = self._build_clean_name(merged)
            if not name:
                continue
            src = Path(route["file_path"])
            if not src.exists():
                continue
            try:
                shutil.copy2(str(src), str(dest / name))
                db.update_route(rid, {"exported_path": str(dest / name)})
                self.file_copied.emit(rid, str(dest / name))
            except OSError:
                pass

    @staticmethod
    def _build_clean_name(r: dict):
        date = r.get("date")
        if not date:
            return None
        parts = [date]
        if r.get("route_type"):
            parts.append(r["route_type"].title())
        if r.get("country"):
            parts.append(r["country"].replace(" ", ""))
        if r.get("day_number"):
            parts.append(f"Day{r['day_number']}")
        return "_".join(parts) + ".gpx"

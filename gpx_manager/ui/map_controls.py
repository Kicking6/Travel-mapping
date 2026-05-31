from __future__ import annotations

"""Right-edge collapsible drawer with map styling controls.

All slider/checkbox/colour values are persisted via db.set_app_config under
keys prefixed with ``mapstyle.`` so the user's look-and-feel survives restarts.
"""

from PyQt6.QtCore import Qt, pyqtSignal
from PyQt6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QGridLayout,
    QLabel, QComboBox, QSlider, QCheckBox, QPushButton, QGroupBox,
    QToolButton, QSizePolicy, QScrollArea, QFrame,
)

import gpx_manager.db as db
from gpx_manager.ui.widgets import ColorButton


_BASEMAPS = [
    ("Liberty (Dark)",    "carto_dark"),
    ("Positron (Light)",  "carto_light"),
    ("Bright",            "carto_voyager"),
    ("Positron (Alt)",    "osm"),
]

_DEFAULTS = {
    "basemap":          "carto_dark",
    "land_color":       "#E8E0D0",
    "sea_color":        "#A8C8E0",
    "show_parks":       1,
    "tile_brightness":  130,    # kept for compat, no-op with vector tiles
    "tile_saturation":  85,
    "tile_opacity":     100,
    "labels_visible":   1,
    "labels_opacity":   100,
    "labels_color":     "#FFFFFF",
    "labels_density":   "all",
    "route_weight":     3,
    "route_opacity":    50,
    "route_sel_weight": 5,
    "show_scale":       1,
    "show_attribution": 1,
    "show_zoom":        1,
    # Feature layer toggles
    "show_ferry":        1,
    "show_roads":        1,
    "roads_density":     "all",   # 'all' | 'major'
    "show_boundaries":   1,
    "boundary_color":    "#888888",
    "boundary_width":    1,
}


def _get(key: str, default):
    raw = db.get_app_config(f"mapstyle.{key}", "")
    if raw == "":
        return default
    if isinstance(default, int):
        try:    return int(raw)
        except: return default
    return raw


def _set(key: str, value):
    db.set_app_config(f"mapstyle.{key}", str(value))


# ---------------------------------------------------------------------------
# Collapsible drawer container
# ---------------------------------------------------------------------------

class MapStyleDrawer(QWidget):
    """Wraps a MapControlsPanel and a thin chevron tab."""

    def __init__(self, map_view, parent=None):
        super().__init__(parent)
        self._panel = MapControlsPanel(map_view)
        self._collapsed = True

        outer = QHBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)

        self._tab = QToolButton()
        self._tab.setText("◄")
        self._tab.setFixedWidth(22)
        self._tab.setSizePolicy(QSizePolicy.Policy.Fixed, QSizePolicy.Policy.Expanding)
        self._tab.setStyleSheet(
            "QToolButton { background:#c4d4de; border:none; "
            "border-left:1px solid #a8bcc8; color:#748ca0; font-size:12px; }"
            "QToolButton:hover { background:#b8c8d4; color:#42383c; }"
        )
        self._tab.clicked.connect(self.toggle)

        outer.addWidget(self._tab)
        outer.addWidget(self._panel)
        self._panel.hide()

    def toggle(self):
        self._collapsed = not self._collapsed
        self._panel.setVisible(not self._collapsed)
        self._tab.setText("►" if not self._collapsed else "◄")

    def panel(self) -> "MapControlsPanel":
        return self._panel

    def apply_initial_state(self):
        self._panel.apply_all_to_map()


# ---------------------------------------------------------------------------
# Map controls panel
# ---------------------------------------------------------------------------

class MapControlsPanel(QWidget):
    """Sliders, dropdowns and toggles that drive the MapLibre GL styling."""

    export_requested = pyqtSignal()

    def __init__(self, map_view, parent=None):
        super().__init__(parent)
        self._map = map_view
        self.setMinimumWidth(240)
        self.setMaximumWidth(280)
        self._build_ui()
        self._load_state()

    # ------------------------------------------------------------------
    # UI
    # ------------------------------------------------------------------

    def _build_ui(self):
        # Top-level layout: scroll area (stretches) + export button (pinned bottom)
        main = QVBoxLayout(self)
        main.setContentsMargins(0, 0, 0, 0)
        main.setSpacing(0)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.Shape.NoFrame)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)

        scroll_content = QWidget()
        outer = QVBoxLayout(scroll_content)
        outer.setContentsMargins(10, 10, 10, 6)
        outer.setSpacing(8)

        scroll.setWidget(scroll_content)
        main.addWidget(scroll, 1)

        # Export button sits below the scroll area, always visible
        btn_bar = QWidget()
        btn_bar.setStyleSheet("border-top:1px solid #a8bcc8;")
        btn_lay = QVBoxLayout(btn_bar)
        btn_lay.setContentsMargins(10, 8, 10, 10)
        self.export_btn = QPushButton("Export Map Image…")
        self.export_btn.clicked.connect(self.export_requested.emit)
        btn_lay.addWidget(self.export_btn)
        main.addWidget(btn_bar)

        title = QLabel("Map Style")
        title.setStyleSheet(
            "font-family:'Poppins','Raleway',sans-serif;"
            "font-weight:700;font-size:13px;color:#42383c;"
        )
        outer.addWidget(title)

        # ---- Basemap ---------------------------------------------------
        basemap_box = self._group("Basemap")
        self.basemap_combo = QComboBox()
        for label, key in _BASEMAPS:
            self.basemap_combo.addItem(label, key)
        self.basemap_combo.currentIndexChanged.connect(self._on_basemap_changed)
        basemap_box.layout().addWidget(self.basemap_combo)
        outer.addWidget(basemap_box)

        # ---- Colours ---------------------------------------------------
        colours_box = self._group("Map Colours")
        cg = colours_box.layout()

        land_row = QHBoxLayout()
        land_row.addWidget(QLabel("Land"))
        land_row.addStretch()
        self.land_btn = ColorButton(_DEFAULTS["land_color"], "Land colour")
        self.land_btn.color_chosen.connect(self._on_land_changed)
        land_row.addWidget(self.land_btn)
        land_holder = QWidget(); land_holder.setLayout(land_row)
        cg.addWidget(land_holder)

        sea_row = QHBoxLayout()
        sea_row.addWidget(QLabel("Sea / Water"))
        sea_row.addStretch()
        self.sea_btn = ColorButton(_DEFAULTS["sea_color"], "Sea colour")
        self.sea_btn.color_chosen.connect(self._on_sea_changed)
        sea_row.addWidget(self.sea_btn)
        sea_holder = QWidget(); sea_holder.setLayout(sea_row)
        cg.addWidget(sea_holder)

        self.parks_check = QCheckBox("Protected areas / parks")
        self.parks_check.toggled.connect(self._on_parks_changed)
        cg.addWidget(self.parks_check)

        outer.addWidget(colours_box)

        # ---- Labels ----------------------------------------------------
        labels_box = self._group("Labels")
        lg = labels_box.layout()
        self.labels_check = QCheckBox("Show labels")
        self.labels_check.toggled.connect(self._on_labels_changed)
        lg.addWidget(self.labels_check)

        lc_row = QHBoxLayout()
        lc_row.addWidget(QLabel("Colour"))
        lc_row.addStretch()
        self.label_color_btn = ColorButton(_DEFAULTS["labels_color"], "Label colour")
        self.label_color_btn.color_chosen.connect(self._on_labels_changed)
        lc_row.addWidget(self.label_color_btn)
        lc_holder = QWidget(); lc_holder.setLayout(lc_row)
        lg.addWidget(lc_holder)

        self.labels_density_combo = QComboBox()
        for label, key in [("All labels", "all"), ("Cities & above", "cities"), ("Countries only", "countries")]:
            self.labels_density_combo.addItem(label, key)
        self.labels_density_combo.currentIndexChanged.connect(self._on_labels_changed)
        lg.addWidget(self._labelled("Density", self.labels_density_combo))

        outer.addWidget(labels_box)

        # ---- Routes ----------------------------------------------------
        routes_box = self._group("Routes")
        rg = routes_box.layout()
        self.route_w_slider  = self._slider(1, 8,   _DEFAULTS["route_weight"],     self._on_route_changed)
        self.route_o_slider  = self._slider(20,100, _DEFAULTS["route_opacity"],    self._on_route_changed)
        self.route_sel_slider= self._slider(3, 10,  _DEFAULTS["route_sel_weight"], self._on_route_changed)
        rg.addWidget(self._labelled("Line width",     self.route_w_slider))
        rg.addWidget(self._labelled("Line opacity",   self.route_o_slider))
        rg.addWidget(self._labelled("Selected width", self.route_sel_slider))
        outer.addWidget(routes_box)

        # ---- Features --------------------------------------------------
        feat_box = self._group("Features")
        fg = feat_box.layout()

        self.ferry_check = QCheckBox("Ferry routes")
        self.ferry_check.toggled.connect(self._on_ferry_changed)
        fg.addWidget(self.ferry_check)

        roads_row = QHBoxLayout()
        self.roads_check = QCheckBox("Roads")
        self.roads_check.toggled.connect(self._on_roads_changed)
        roads_row.addWidget(self.roads_check)
        roads_row.addStretch()
        self.roads_density_combo = QComboBox()
        self.roads_density_combo.setFixedWidth(100)
        for label, key in [("All roads", "all"), ("Major only", "major")]:
            self.roads_density_combo.addItem(label, key)
        self.roads_density_combo.currentIndexChanged.connect(self._on_roads_changed)
        roads_row.addWidget(self.roads_density_combo)
        roads_holder = QWidget(); roads_holder.setLayout(roads_row)
        fg.addWidget(roads_holder)

        boundary_vis_row = QHBoxLayout()
        self.boundary_check = QCheckBox("State / province boundaries")
        self.boundary_check.toggled.connect(self._on_boundary_changed)
        boundary_vis_row.addWidget(self.boundary_check)
        boundary_vis_holder = QWidget(); boundary_vis_holder.setLayout(boundary_vis_row)
        fg.addWidget(boundary_vis_holder)

        boundary_style_row = QHBoxLayout()
        boundary_style_row.addWidget(QLabel("Colour"))
        boundary_style_row.addStretch()
        self.boundary_color_btn = ColorButton(_DEFAULTS["boundary_color"], "Boundary colour")
        self.boundary_color_btn.color_chosen.connect(self._on_boundary_changed)
        boundary_style_row.addWidget(self.boundary_color_btn)
        boundary_style_holder = QWidget(); boundary_style_holder.setLayout(boundary_style_row)
        fg.addWidget(boundary_style_holder)

        self.boundary_w_slider = self._slider(1, 4, _DEFAULTS["boundary_width"], self._on_boundary_changed)
        fg.addWidget(self._labelled("Line width", self.boundary_w_slider))

        outer.addWidget(feat_box)

        # ---- Map chrome ------------------------------------------------
        chrome_box = self._group("Map chrome")
        cg2 = chrome_box.layout()
        self.scale_check = QCheckBox("Scale bar")
        self.attr_check  = QCheckBox("Attribution")
        self.zoom_check  = QCheckBox("Zoom buttons")
        for cb in (self.scale_check, self.attr_check, self.zoom_check):
            cb.toggled.connect(self._on_chrome_changed)
            cg2.addWidget(cb)
        outer.addWidget(chrome_box)

        outer.addStretch()

    # ------------------------------------------------------------------
    # Small builders
    # ------------------------------------------------------------------

    def _group(self, title: str) -> QGroupBox:
        box = QGroupBox(title)
        box.setStyleSheet(
            "QGroupBox { font-family:'Poppins','Raleway',sans-serif; "
            "font-size:11px; font-weight:600; color:#748ca0; "
            "border:1px solid #a8bcc8; border-radius:8px; margin-top:10px; padding:8px; }"
            "QGroupBox::title { left:8px; padding:0 4px; subcontrol-origin:margin; }"
        )
        v = QVBoxLayout(box)
        v.setContentsMargins(8, 14, 8, 6)
        v.setSpacing(4)
        return box

    @staticmethod
    def _slider(lo: int, hi: int, val: int, on_change) -> QSlider:
        s = QSlider(Qt.Orientation.Horizontal)
        s.setRange(lo, hi)
        s.setValue(val)
        s.setFixedHeight(20)
        s.valueChanged.connect(on_change)
        return s

    @staticmethod
    def _labelled(label: str, widget: QWidget) -> QWidget:
        w = QWidget()
        l = QGridLayout(w)
        l.setContentsMargins(0, 0, 0, 0)
        l.setHorizontalSpacing(6)
        l.setVerticalSpacing(0)
        cap = QLabel(label)
        cap.setStyleSheet("color:#748ca0;font-size:10px;")
        l.addWidget(cap, 0, 0)
        l.addWidget(widget, 1, 0)
        return w

    # ------------------------------------------------------------------
    # State load / apply
    # ------------------------------------------------------------------

    def _load_state(self):
        widgets_blocking = [
            self.basemap_combo, self.labels_check, self.labels_density_combo,
            self.route_w_slider, self.route_o_slider, self.route_sel_slider,
            self.scale_check, self.attr_check, self.zoom_check, self.parks_check,
            self.ferry_check, self.roads_check, self.roads_density_combo,
            self.boundary_check, self.boundary_w_slider,
        ]
        for w in widgets_blocking:
            w.blockSignals(True)

        idx = self.basemap_combo.findData(_get("basemap", _DEFAULTS["basemap"]))
        self.basemap_combo.setCurrentIndex(max(0, idx))

        self.land_btn.set_color(_get("land_color", _DEFAULTS["land_color"]))
        self.sea_btn.set_color(_get("sea_color", _DEFAULTS["sea_color"]))
        self.parks_check.setChecked(bool(_get("show_parks", _DEFAULTS["show_parks"])))

        self.labels_check.setChecked(bool(_get("labels_visible", _DEFAULTS["labels_visible"])))
        self.label_color_btn.set_color(_get("labels_color", _DEFAULTS["labels_color"]))

        density_val = _get("labels_density", _DEFAULTS["labels_density"])
        di = self.labels_density_combo.findData(density_val)
        self.labels_density_combo.setCurrentIndex(max(0, di))

        self.route_w_slider.setValue(_get("route_weight",     _DEFAULTS["route_weight"]))
        self.route_o_slider.setValue(_get("route_opacity",    _DEFAULTS["route_opacity"]))
        self.route_sel_slider.setValue(_get("route_sel_weight", _DEFAULTS["route_sel_weight"]))

        self.scale_check.setChecked(bool(_get("show_scale",       _DEFAULTS["show_scale"])))
        self.attr_check.setChecked(bool(_get("show_attribution",   _DEFAULTS["show_attribution"])))
        self.zoom_check.setChecked(bool(_get("show_zoom",          _DEFAULTS["show_zoom"])))

        self.ferry_check.setChecked(bool(_get("show_ferry",     _DEFAULTS["show_ferry"])))
        self.roads_check.setChecked(bool(_get("show_roads",     _DEFAULTS["show_roads"])))
        rd_idx = self.roads_density_combo.findData(_get("roads_density", _DEFAULTS["roads_density"]))
        self.roads_density_combo.setCurrentIndex(max(0, rd_idx))
        self.boundary_check.setChecked(bool(_get("show_boundaries", _DEFAULTS["show_boundaries"])))
        self.boundary_color_btn.set_color(_get("boundary_color", _DEFAULTS["boundary_color"]))
        self.boundary_w_slider.setValue(_get("boundary_width",   _DEFAULTS["boundary_width"]))

        for w in widgets_blocking:
            w.blockSignals(False)

    def apply_all_to_map(self):
        """Push every current control value to the map. Called once at startup."""
        self._on_basemap_changed()
        self._on_land_changed(self.land_btn.color())
        self._on_sea_changed(self.sea_btn.color())
        self._on_parks_changed()
        self._on_labels_changed()
        self._on_route_changed()
        self._on_chrome_changed()
        self._on_ferry_changed()
        self._on_roads_changed()
        self._on_boundary_changed()

    # ------------------------------------------------------------------
    # Snapshot for the offscreen renderer
    # ------------------------------------------------------------------

    def style_state(self) -> dict:
        return {
            "basemap":          self.basemap_combo.currentData(),
            "land_color":       self.land_btn.color(),
            "sea_color":        self.sea_btn.color(),
            "labels_visible":   self.labels_check.isChecked(),
            "labels_color":     self.label_color_btn.color(),
            "labels_density":   self.labels_density_combo.currentData(),
            "route_weight":     self.route_w_slider.value(),
            "route_opacity":    self.route_o_slider.value() / 100,
            "route_sel_weight": self.route_sel_slider.value(),
            "show_scale":       self.scale_check.isChecked(),
            "show_attribution": self.attr_check.isChecked(),
            "show_zoom":        self.zoom_check.isChecked(),
        }

    # ------------------------------------------------------------------
    # Event handlers
    # ------------------------------------------------------------------

    def _on_basemap_changed(self, *_):
        key = self.basemap_combo.currentData()
        _set("basemap", key)
        self._map.set_basemap(key)

    def _on_land_changed(self, hex_color: str):
        _set("land_color", hex_color)
        self._map.set_land_color(hex_color)

    def _on_sea_changed(self, hex_color: str):
        _set("sea_color", hex_color)
        self._map.set_sea_color(hex_color)

    def _on_parks_changed(self, *_):
        visible = self.parks_check.isChecked()
        _set("show_parks", 1 if visible else 0)
        self._map.set_park_areas_visible(visible)

    def _on_labels_changed(self, *_):
        visible = self.labels_check.isChecked()
        color   = self.label_color_btn.color()
        density = self.labels_density_combo.currentData()
        _set("labels_visible", 1 if visible else 0)
        _set("labels_color",   color)
        _set("labels_density", density)
        # set_label_style updates _labelsVisible in JS and re-applies density internally
        self._map.set_label_style(visible, 1.0, None)
        self._map.set_label_color(color)
        # set_label_density is now safe to call — JS respects _labelsVisible
        self._map.set_label_density(density)

    def _on_route_changed(self, *_):
        w  = self.route_w_slider.value()
        op = self.route_o_slider.value() / 100
        sw = self.route_sel_slider.value()
        _set("route_weight",     w)
        _set("route_opacity",    self.route_o_slider.value())
        _set("route_sel_weight", sw)
        self._map.set_route_style(w, op, sw, 1.0)

    def _on_chrome_changed(self, *_):
        scale = self.scale_check.isChecked()
        attr  = self.attr_check.isChecked()
        zoom  = self.zoom_check.isChecked()
        _set("show_scale",       1 if scale else 0)
        _set("show_attribution", 1 if attr  else 0)
        _set("show_zoom",        1 if zoom  else 0)
        self._map.set_controls_visible(scale, attr, zoom)

    def _on_ferry_changed(self, *_):
        visible = self.ferry_check.isChecked()
        _set("show_ferry", 1 if visible else 0)
        self._map.set_ferry_visible(visible)

    def _on_roads_changed(self, *_):
        visible = self.roads_check.isChecked()
        density = self.roads_density_combo.currentData() or "all"
        _set("show_roads",    1 if visible else 0)
        _set("roads_density", density)
        self._map.set_roads_visible(visible, density)

    def _on_boundary_changed(self, *_):
        visible = self.boundary_check.isChecked()
        color   = self.boundary_color_btn.color()
        width   = self.boundary_w_slider.value()
        _set("show_boundaries", 1 if visible else 0)
        _set("boundary_color",  color)
        _set("boundary_width",  width)
        self._map.set_boundary_style(visible, color, width)

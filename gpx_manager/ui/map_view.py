from __future__ import annotations

"""QWebEngineView wrapper — hosts MapLibre GL map, blocks external navigation."""

import json
from pathlib import Path

from PyQt6.QtCore import QUrl, QTimer, pyqtSignal
from PyQt6.QtWebEngineWidgets import QWebEngineView
from PyQt6.QtWebEngineCore import QWebEngineSettings, QWebEnginePage

_MAP_HTML = Path(__file__).parent.parent / "assets" / "map.html"


class _MapPage(QWebEnginePage):
    """Custom page that blocks external navigation and relays JS console messages."""

    route_clicked = pyqtSignal(int)   # emitted when user clicks a route on the map
    map_ready     = pyqtSignal()      # emitted when MapLibre's 'load' event fires (style fully ready)

    def acceptNavigationRequest(self, url, nav_type, is_main_frame):
        if url.scheme() == "file":
            return True
        return False

    def javaScriptConsoleMessage(self, level, message, line_number, source_id):
        if message.startswith("gpx:select:"):
            try:
                self.route_clicked.emit(int(message[11:]))
            except ValueError:
                pass
            return
        if message == "gpx:mapready":
            self.map_ready.emit()
            return
        print(f"[js] {message}")


class MapView(QWebEngineView):
    map_crashed   = pyqtSignal()     # emitted when the Chromium renderer terminates
    route_clicked = pyqtSignal(int)  # emitted when user clicks a route on the map
    map_ready     = pyqtSignal()     # emitted when MapLibre style is fully loaded

    def __init__(self, parent=None):
        super().__init__(parent)
        self._ready = False
        self._pending: list[str] = []
        self._crash_count = 0

        # Use custom page to block external navigation and relay JS messages
        page = _MapPage(self)
        page.route_clicked.connect(self.route_clicked)
        page.map_ready.connect(self.map_ready)
        self.setPage(page)

        # Allow local HTML to fetch remote tile images
        self.settings().setAttribute(
            QWebEngineSettings.WebAttribute.LocalContentCanAccessRemoteUrls, True
        )

        self.loadFinished.connect(self._on_load_finished)
        self.page().renderProcessTerminated.connect(self._on_renderer_terminated)
        self.load(QUrl.fromLocalFile(str(_MAP_HTML.resolve())))

    def _on_load_finished(self, ok):
        self._ready = ok
        if ok:
            self._crash_count = 0   # successful load resets retry counter
            for js in self._pending:
                self.page().runJavaScript(js)
            self._pending.clear()
            self.page().runJavaScript(
                'map.isStyleLoaded()',
                lambda loaded: print(f"[map] ready — style loaded={loaded}")
            )
        else:
            print("[map] WARNING: map.html failed to load")

    def _on_renderer_terminated(self, status, exit_code):
        print(f"[map] renderer terminated: status={status} exit_code={exit_code}")
        self._ready = False
        self.map_crashed.emit()
        if self._crash_count < 3:
            QTimer.singleShot(1500, self._reload_map)
        else:
            print("[map] max crash retries reached — not reloading")

    def resizeEvent(self, event):
        super().resizeEvent(event)
        # Tell MapLibre to recalculate its canvas size / hit-test coordinates after
        # the widget is resized (fixes offset click targets when going fullscreen etc.)
        if self._ready:
            self._js("map.resize();")

    def _reload_map(self):
        self._crash_count += 1
        print(f"[map] reload attempt {self._crash_count}")
        self.load(QUrl.fromLocalFile(str(_MAP_HTML.resolve())))

    def _js(self, script):
        if self._ready:
            self.page().runJavaScript(script)
        else:
            self._pending.append(script)

    def _call(self, method, *args):
        js_args = ", ".join(json.dumps(a) for a in args)
        self._js(f"window.mapBridge.{method}({js_args});")

    # ------------------------------------------------------------------
    # Routes
    # ------------------------------------------------------------------

    def set_route(self, route_id, coords, color, name, is_waypoint=False):
        self._call("setRoute", {
            "id": route_id, "coords": coords, "color": color,
            "name": name, "is_waypoint": 1 if is_waypoint else 0,
        })

    def set_visible_routes(self, ids):
        self._call("setVisibleRoutes", ids)

    def select_routes(self, ids):
        self._call("selectRoutes", ids)

    def hover_route(self, rid):
        self._call("hoverRoute", rid)

    def clear_hover(self):
        self._call("clearHover")

    def fit_bounds(self, ids=None):
        self._call("fitBounds", ids or [])

    def fit_to_bounds(self, bounds: dict):
        self._call("fitToBounds", bounds)

    def update_route_color(self, rid, color):
        self._call("updateRouteColor", rid, color)

    def clear_all(self):
        self._call("clearAll")

    # ------------------------------------------------------------------
    # Styling
    # ------------------------------------------------------------------

    def set_basemap(self, key: str):
        self._call("setBasemap", key)

    def set_background_color(self, hex_color: str):
        self._call("setBackgroundColor", hex_color)

    def set_land_color(self, hex_color: str):
        self._call("setLandColor", hex_color)

    def set_sea_color(self, hex_color: str):
        self._call("setSeaColor", hex_color)

    def set_label_color(self, hex_color: str):
        self._call("setLabelColor", hex_color)

    def set_label_density(self, level: str):
        self._call("setLabelDensity", level)

    def set_park_areas_visible(self, visible: bool):
        self._call("setParkAreasVisible", visible)

    def set_ferry_visible(self, visible: bool):
        self._call("setFerryVisible", visible)

    def set_roads_visible(self, visible: bool, density: str = "all"):
        self._call("setRoadsVisible", visible, density)

    def set_boundary_style(self, visible: bool, color: str | None = None, width: int | None = None):
        self._call("setBoundaryStyle", {"visible": visible, "color": color, "width": width})

    def set_tile_filter(self, brightness: float, saturation: float, opacity: float):
        self._call("setTileFilter", {
            "brightness": brightness, "saturation": saturation, "opacity": opacity,
        })

    def set_label_style(self, visible: bool, opacity: float, tint: str | None):
        self._call("setLabelStyle", {
            "visible": visible, "opacity": opacity, "tint": tint,
        })

    def set_route_style(self, weight: float, opacity: float,
                        selected_weight: float, selected_opacity: float):
        self._call("setRouteStyle", {
            "weight": weight, "opacity": opacity,
            "selectedWeight": selected_weight, "selectedOpacity": selected_opacity,
        })

    def set_controls_visible(self, scale: bool, attribution: bool, zoom: bool):
        self._call("setControlsVisible", {
            "scale": scale, "attribution": attribution, "zoom": zoom,
        })

    # ------------------------------------------------------------------
    # Export frame
    # ------------------------------------------------------------------

    def show_export_frame(self, aspect: float | None, label: str | None = None):
        self._call("showExportFrame", {"aspect": aspect, "label": label})

    def hide_export_frame(self):
        self._call("hideExportFrame")

    def get_export_frame_bounds(self, callback):
        """Async — invokes callback(dict | None) with the frame's geographic bounds."""
        self.page().runJavaScript("window.mapBridge.getExportFrameBounds();", callback)

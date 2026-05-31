from __future__ import annotations

"""Main application window — layout, import, export, toolbar, and light Scandi theme."""

import json
import traceback
from pathlib import Path

from PyQt6.QtCore import Qt, QUrl, QTimer
from PyQt6.QtGui import QAction, QDesktopServices, QDragEnterEvent, QDropEvent, QKeySequence
from PyQt6.QtWidgets import (
    QMainWindow, QSplitter, QWidget, QVBoxLayout, QHBoxLayout, QToolBar,
    QMessageBox, QFileDialog, QProgressDialog, QApplication, QLabel,
)

import gpx_manager.db as db
from gpx_manager.gpx_parser import parse_gpx_file, parsed_route_to_db_dict, TYPE_COLOURS
from gpx_manager.ui.route_list       import LeftPanel
from gpx_manager.ui.map_view         import MapView
from gpx_manager.ui.metadata_panel   import MetadataPanel
from gpx_manager.ui.export_dialog    import ExportDialog
from gpx_manager.ui.settings_dialog  import SettingsDialog
from gpx_manager.ui.map_controls     import MapStyleDrawer
from gpx_manager.ui.map_export_dialog import MapExportDialog
from gpx_manager.ui.help_dialog      import HelpDialog


# ---------------------------------------------------------------------------
# Light Scandinavian QSS
# ---------------------------------------------------------------------------

LIGHT_QSS = """
/* ── Base ── */
QWidget {
    background-color: #d0e0e9;
    color: #42383c;
    font-family: "Raleway", "Helvetica Neue", Arial, sans-serif;
    font-size: 13px;
}
QMainWindow { background-color: #dce8ef; }

/* ── Menu bar ── */
QMenuBar { background: #dce8ef; border-bottom: 1px solid #a8bcc8; padding: 2px 0; }
QMenuBar::item:selected { background: #c4d4de; border-radius: 5px; }
QMenu { background: #FFF; border: 1px solid #b8c8d4; border-radius: 8px; padding: 4px; }
QMenu::item { padding: 5px 20px; border-radius: 4px; }
QMenu::item:selected { background: #225875; color: #FFF; }

/* ── Toolbar ── */
QToolBar {
    background: #dce8ef;
    border-bottom: 1px solid #a8bcc8;
    spacing: 8px;
    padding: 8px 16px;
}
QToolBar QToolButton {
    background: #FFFFFF;
    border: 1px solid #b8c8d4;
    border-radius: 10px;
    padding: 8px 20px;
    min-width: 110px;
    min-height: 30px;
    color: #42383c;
    font-family: "Poppins", "Raleway", sans-serif;
    font-size: 13px;
    font-weight: 500;
}
QToolBar QToolButton:hover {
    background: #c4d4de;
    border-color: #748ca0;
}
QToolBar QToolButton:pressed {
    background: #b8c8d4;
}

/* ── Splitter ── */
QSplitter::handle { background: #a8bcc8; }
QSplitter::handle:horizontal { width: 1px; }
QSplitter::handle:vertical   { height: 1px; }

/* ── Table ── */
QTableWidget {
    background: #FFF;
    alternate-background-color: #e6eff4;
    gridline-color: transparent;
    border: none;
    outline: none;
}
QTableWidget::item { padding: 4px 8px; }
QTableWidget::item:selected { background: #225875; color: #FFF; }
QHeaderView::section {
    background: #dce8ef;
    border: none;
    border-bottom: 1px solid #a8bcc8;
    padding: 5px 8px;
    color: #748ca0;
    font-family: "Poppins", "Raleway", sans-serif;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
}

/* ── Inputs ── */
QLineEdit, QTextEdit, QSpinBox, QDateEdit, QComboBox {
    background: #FFF;
    border: 1px solid #b8c8d4;
    border-radius: 8px;
    padding: 5px 8px;
    color: #42383c;
    selection-background-color: #225875;
    selection-color: #FFF;
}
QLineEdit:focus, QTextEdit:focus, QSpinBox:focus,
QDateEdit:focus, QComboBox:focus {
    border-color: #225875;
}
QComboBox::drop-down {
    border: none; width: 26px;
    subcontrol-position: center right;
}
QComboBox::down-arrow {
    image: none;
    border-left: 4px solid transparent;
    border-right: 4px solid transparent;
    border-top: 5px solid #748ca0;
    margin-right: 8px;
}
QComboBox QAbstractItemView {
    background: #FFF;
    border: 1px solid #b8c8d4;
    border-radius: 8px;
    selection-background-color: #225875;
    selection-color: #FFF;
}

/* ── Buttons ── */
QPushButton {
    background: #FFF;
    border: 1px solid #b8c8d4;
    border-radius: 8px;
    padding: 6px 16px;
    min-height: 26px;
    color: #42383c;
    font-weight: 500;
}
QPushButton:hover { background: #c4d4de; border-color: #748ca0; }
QPushButton:pressed { background: #b8c8d4; }
QPushButton:default {
    background: #225875;
    border-color: #225875;
    color: #FFF;
    font-weight: 600;
}
QPushButton:default:hover { background: #1a4660; }
QPushButton:flat {
    background: transparent;
    border: none;
    color: #225875;
    font-weight: 500;
}
QPushButton:flat:hover { color: #1a4660; }

/* ── Scrollbars ── */
QScrollBar:vertical { background: transparent; width: 8px; }
QScrollBar::handle:vertical {
    background: #96aab8; border-radius: 4px; min-height: 20px;
}
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical { height: 0; }
QScrollBar:horizontal { background: transparent; height: 8px; }
QScrollBar::handle:horizontal { background: #96aab8; border-radius: 4px; }

/* ── Checkboxes ── */
QCheckBox::indicator {
    width: 16px; height: 16px;
    border: 1.5px solid #96aab8; border-radius: 4px; background: #FFF;
}
QCheckBox::indicator:checked {
    background: #225875; border-color: #225875;
}

/* ── Radio buttons ── */
QRadioButton::indicator {
    width: 16px; height: 16px;
    border: 1.5px solid #96aab8; border-radius: 8px; background: #FFF;
}
QRadioButton::indicator:checked { background: #225875; border-color: #225875; }

/* ── Misc ── */
QLabel { background: transparent; }
QScrollArea { border: none; background: transparent; }
QFrame[frameShape="4"] { color: #a8bcc8; }
QToolTip {
    background: #FFF; border: 1px solid #b8c8d4;
    border-radius: 8px; color: #42383c; padding: 6px 8px;
}

/* ── Tabs ── */
QTabWidget::pane { border: 1px solid #a8bcc8; background: #FFF; border-radius: 0 0 8px 8px; }
QTabBar::tab {
    background: #c4d4de; border: 1px solid #a8bcc8;
    border-bottom: none; border-radius: 6px 6px 0 0;
    padding: 7px 16px; margin-right: 2px;
    color: #748ca0; font-weight: 500;
}
QTabBar::tab:selected { background: #FFF; color: #42383c; }
QTabBar::tab:hover { background: #b8c8d4; }

/* ── Lists ── */
QListWidget { background: #FFF; border: 1px solid #b8c8d4; border-radius: 8px; }
QListWidget::item { padding: 5px 10px; }
QListWidget::item:selected { background: #225875; color: #FFF; }

QProgressDialog { background: #d0e0e9; }
QDialog { background: #d0e0e9; }

/* ── Compact inputs inside the metadata panel ── */
MetadataPanel QLineEdit,
MetadataPanel QComboBox,
MetadataPanel QSpinBox,
MetadataPanel QTextEdit {
    padding: 3px 6px;
    min-height: 22px;
    border-radius: 6px;
}
MetadataPanel QPushButton { padding: 3px 10px; min-height: 22px; }

/* ── Map style drawer slider rails ── */
MapControlsPanel QSlider::groove:horizontal {
    height: 4px; background: #a8bcc8; border-radius: 2px;
}
MapControlsPanel QSlider::handle:horizontal {
    background: #225875; width: 14px; height: 14px; margin: -5px 0; border-radius: 7px;
}

/* ── GroupBox (map style drawer sections) ── */
QGroupBox {
    font-family: "Poppins", "Raleway", sans-serif;
    font-size: 11px; font-weight: 600; color: #748ca0;
    border: 1px solid #a8bcc8; border-radius: 8px;
    margin-top: 10px; padding: 8px;
}
QGroupBox::title { left: 8px; padding: 0 4px; subcontrol-origin: margin; }
"""


# ---------------------------------------------------------------------------
# Main window
# ---------------------------------------------------------------------------

class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        db.init_db()
        self._all_routes: list[dict] = []
        self._filtered_routes: list[dict] = []
        self._map_route_ids: set = set()   # tracks IDs currently sent to JS map

        # Debounce timer for filter changes (avoids DB + map churn on every keystroke)
        self._filter_timer = QTimer(self)
        self._filter_timer.setSingleShot(True)
        self._filter_timer.setInterval(250)
        self._filter_timer.timeout.connect(self._apply_filters)

        self.setWindowTitle("GPX Route Manager")
        self.resize(1280, 800)
        self.setAcceptDrops(True)

        self._build_toolbar()
        self._build_ui()
        self._build_menu()
        self._refresh_all()

    # ------------------------------------------------------------------
    # UI
    # ------------------------------------------------------------------

    def _build_toolbar(self):
        tb = QToolBar("Main")
        tb.setMovable(False)
        tb.setFloatable(False)
        tb.setToolButtonStyle(Qt.ToolButtonStyle.ToolButtonTextOnly)

        import_btn = QAction("Import Files", self)
        import_btn.triggered.connect(self._import_files)
        tb.addAction(import_btn)

        import_folder_btn = QAction("Import Folder", self)
        import_folder_btn.triggered.connect(self._import_folder)
        tb.addAction(import_folder_btn)

        tb.addSeparator()

        export_btn = QAction("Export GeoJSON / GPX", self)
        export_btn.triggered.connect(self._open_export)
        tb.addAction(export_btn)

        tb.addSeparator()

        settings_btn = QAction("Settings", self)
        settings_btn.triggered.connect(self._open_settings)
        tb.addAction(settings_btn)

        map_style_btn = QAction("Map Style", self)
        map_style_btn.triggered.connect(lambda: self.map_drawer.toggle())
        tb.addAction(map_style_btn)

        map_export_btn = QAction("Map Export", self)
        map_export_btn.triggered.connect(self._open_map_export)
        tb.addAction(map_export_btn)

        help_btn = QAction("Help", self)
        help_btn.triggered.connect(self._open_help)
        tb.addAction(help_btn)

        self.addToolBar(tb)

    def _build_ui(self):
        outer = QSplitter(Qt.Orientation.Horizontal)
        outer.setHandleWidth(1)

        # Left panel
        self.left_panel = LeftPanel()
        self.left_panel.setMinimumWidth(260)
        self.left_panel.setMaximumWidth(480)
        self.left_panel.routes_selected.connect(self._on_selected)
        self.left_panel.route_hovered.connect(self._on_hovered)
        self.left_panel.route_unhovered.connect(self._on_unhovered)
        self.left_panel.filters_changed.connect(self._schedule_filter)
        outer.addWidget(self.left_panel)

        # Right side: vertical split — (map + style drawer) on top, metadata strip on bottom
        right = QSplitter(Qt.Orientation.Vertical)
        right.setHandleWidth(1)

        self.map_view = MapView()
        self.map_drawer = MapStyleDrawer(self.map_view)
        self.map_drawer.panel().export_requested.connect(self._open_map_export)
        # Apply persisted styling + re-sync routes once MapLibre's style is fully loaded.
        # map_ready fires from JS map.on('load') — the style IS loaded at that point,
        # so setBasemap() can detect "already on this style" and skip setStyle(), which
        # was the source of the "style diff" crash on startup / after crash recovery.
        self.map_view.map_ready.connect(self._on_map_load_finished)
        self.map_view.map_crashed.connect(self._on_map_crashed)
        self.map_view.route_clicked.connect(self._on_map_route_clicked)

        map_row = QWidget()
        mr = QHBoxLayout(map_row)
        mr.setContentsMargins(0, 0, 0, 0)
        mr.setSpacing(0)
        mr.addWidget(self.map_view, 1)
        mr.addWidget(self.map_drawer)
        right.addWidget(map_row)

        self.metadata_panel = MetadataPanel()
        self.metadata_panel.setMinimumHeight(210)
        self.metadata_panel.metadata_saved.connect(self._on_metadata_saved)
        self.metadata_panel.color_changed.connect(self._on_color_changed)
        right.addWidget(self.metadata_panel)
        right.setSizes([590, 210])

        outer.addWidget(right)
        outer.setSizes([300, 980])
        self.setCentralWidget(outer)

        # Status bar — shows route count and DB path; click path to open in Finder.
        sb = self.statusBar()
        self._status_lbl = QLabel()
        self._status_lbl.setStyleSheet("color:#748ca0;font-size:11px;padding:2px 8px;")
        sb.addWidget(self._status_lbl)
        self._db_path_lbl = QLabel()
        self._db_path_lbl.setStyleSheet(
            "color:#225875;font-size:11px;padding:2px 8px;"
        )
        self._db_path_lbl.setCursor(Qt.CursorShape.PointingHandCursor)
        self._db_path_lbl.mousePressEvent = lambda _ev: QDesktopServices.openUrl(
            QUrl.fromLocalFile(str(db.DB_PATH.parent))
        )
        sb.addPermanentWidget(self._db_path_lbl)

    def _build_menu(self):
        mb = self.menuBar()

        file_m = mb.addMenu("File")
        self._add_action(file_m, "Import Files…",  "Ctrl+O",       self._import_files)
        self._add_action(file_m, "Import Folder…",  "Ctrl+Shift+O", self._import_folder)
        file_m.addSeparator()
        self._add_action(file_m, "Export…",         "Ctrl+E",       self._open_export)

        routes_m = mb.addMenu("Routes")
        self._add_action(routes_m, "Select All",    "Ctrl+A",       self._select_all)
        self._add_action(routes_m, "Fit All",       "Ctrl+F",       lambda: self.map_view.fit_bounds())
        routes_m.addSeparator()
        self._add_action(routes_m, "Remove Selected", "Backspace",  self._remove_selected)

        help_m = mb.addMenu("Help")
        self._add_action(help_m, "User Guide",       "F1",          self._open_help)

    @staticmethod
    def _add_action(menu, text, shortcut, slot):
        a = QAction(text, menu)
        a.setShortcut(QKeySequence(shortcut))
        a.triggered.connect(slot)
        menu.addAction(a)

    # ------------------------------------------------------------------
    # Map load / crash handlers
    # ------------------------------------------------------------------

    def _on_map_load_finished(self):
        # Triggered by map_ready (MapLibre 'load' event) — style is fully loaded here.
        self.map_drawer.apply_initial_state()
        # Re-push all visible routes (needed after crash recovery reloads)
        self._map_route_ids.clear()
        self._sync_map()

    def _on_map_crashed(self):
        self.statusBar().showMessage("Map reloading after crash…", 4000)

    # ------------------------------------------------------------------
    # Refresh
    # ------------------------------------------------------------------

    def _schedule_filter(self):
        """Start/restart the debounce timer so filters apply 250 ms after the last change."""
        self._filter_timer.start()

    def _refresh_all(self):
        self._all_routes = db.get_all_routes()
        self.left_panel.refresh_filter_options()
        self.metadata_panel.refresh_dropdowns()
        self._apply_filters()
        self._update_status_bar()

    def _update_status_bar(self):
        total = len(self._all_routes)
        total_km = sum(r.get("distance_km") or 0 for r in self._all_routes)
        self._status_lbl.setText(
            f"Library: {total} route{'s' if total != 1 else ''} · {total_km:.0f} km total"
        )
        self._db_path_lbl.setText(str(db.DB_PATH))

    def _apply_filters(self):
        f = self.left_panel.get_filters()
        self._filtered_routes = db.query_routes(f) if f else list(self._all_routes)
        self.left_panel.load_routes(self._filtered_routes)
        self._sync_map()

    def _sync_map(self):
        ids = [r["id"] for r in self._filtered_routes]
        self.map_view.set_visible_routes(ids)
        # Only push routes not already resident in the JS map (avoids redundant data transfer)
        new_ids = set(ids) - self._map_route_ids
        for r in self._filtered_routes:
            if r["id"] not in new_ids:
                continue
            raw = r.get("geometry_cache")
            if not raw:
                continue
            coords = json.loads(raw) if isinstance(raw, str) else raw
            color = r.get("colour_override") or TYPE_COLOURS.get(r.get("route_type") or "", "#999")
            self.map_view.set_route(r["id"], coords, color,
                                    r.get("display_name") or "", bool(r.get("is_waypoint")))
        self._map_route_ids = set(ids)

    # ------------------------------------------------------------------
    # Import
    # ------------------------------------------------------------------

    def _import_files(self):
        paths, _ = QFileDialog.getOpenFileNames(
            self, "Import GPX Files", str(Path.home()), "GPX Files (*.gpx)")
        if paths:
            self._run_import(paths)

    def _import_folder(self):
        folder = QFileDialog.getExistingDirectory(self, "Import GPX Folder", str(Path.home()))
        if not folder:
            return
        paths = [str(p) for p in Path(folder).rglob("*.gpx")]
        if paths:
            self._run_import(paths)
        else:
            QMessageBox.information(self, "No GPX files", "No .gpx files found in that folder.")

    def _run_import(self, paths: list[str]):
        print(f"[import] Starting import of {len(paths)} file(s)")
        prog = QProgressDialog("Importing…", "Cancel", 0, len(paths), self)
        prog.setWindowModality(Qt.WindowModality.WindowModal)
        prog.setMinimumDuration(0)
        prog.setValue(0)

        warnings: list[tuple[str, list]] = []
        imported = 0

        for i, path in enumerate(paths, 1):
            if prog.wasCanceled():
                print(f"[import] Cancelled after {imported} files")
                break
            try:
                if not db.file_path_exists(path):
                    pr = parse_gpx_file(path)
                    if pr.warnings:
                        warnings.append((path, pr.warnings))
                    db.upsert_route(parsed_route_to_db_dict(pr))
                    imported += 1
                else:
                    print(f"[import] Skipped (already exists): {Path(path).name}")
            except Exception:
                print(f"[import] ERROR importing {Path(path).name}:")
                traceback.print_exc()
                warnings.append((path, [f"Import failed: {traceback.format_exc(limit=1)}"]))
            prog.setValue(i)
            QApplication.processEvents()

        prog.close()
        print(f"[import] Done — {imported} new route(s) imported")

        self._refresh_all()
        if warnings:
            msgs = [f"• {Path(p).name}: {'; '.join(w)}" for p, w in warnings[:20]]
            QMessageBox.warning(self, "Import warnings",
                                "Some files had issues:\n\n" + "\n".join(msgs))

    # ------------------------------------------------------------------
    # Drag and drop
    # ------------------------------------------------------------------

    def dragEnterEvent(self, event: QDragEnterEvent):
        if event.mimeData().hasUrls():
            if any(u.toLocalFile().lower().endswith(".gpx") for u in event.mimeData().urls()):
                event.acceptProposedAction()

    def dropEvent(self, event: QDropEvent):
        paths = [u.toLocalFile() for u in event.mimeData().urls() if u.toLocalFile().lower().endswith(".gpx")]
        if paths:
            self._run_import(paths)

    # ------------------------------------------------------------------
    # Selection / hover
    # ------------------------------------------------------------------

    def _on_selected(self, ids: list[int]):
        self.map_view.select_routes(ids)
        if ids:
            self.map_view.fit_bounds(ids)

        if len(ids) == 1:
            route = db.get_route_by_id(ids[0])
            if route:
                self.metadata_panel.load_route(route)
        elif len(ids) > 1:
            self.metadata_panel.load_bulk(db.get_routes_by_ids(ids))
        else:
            self.metadata_panel.clear()

    def _on_map_route_clicked(self, route_id: int):
        """Map click → select the route row in the table (which then opens metadata)."""
        self.left_panel.select_route_by_id(route_id)

    def _on_hovered(self, rid: int):
        self.map_view.hover_route(rid)

    def _on_unhovered(self):
        self.map_view.clear_hover()

    # ------------------------------------------------------------------
    # Metadata
    # ------------------------------------------------------------------

    def _on_metadata_saved(self, ids: list[int], fields: dict):
        if len(ids) == 1:
            db.update_route(ids[0], fields)
        else:
            db.bulk_update_routes(ids, fields)
        # Route data changed — invalidate the map cache so _sync_map re-sends updated routes
        self._map_route_ids.clear()
        self._refresh_all()
        # Restore selection: _refresh_all repopulates the table (clearing selection), so
        # we must re-select the rows and re-apply the orange map highlight explicitly.
        self.left_panel.restore_selection(ids)
        self.map_view.select_routes(ids)
        if len(ids) == 1:
            route = db.get_route_by_id(ids[0])
            if route:
                self.metadata_panel.load_route(route)

    def _on_color_changed(self, rid: int, color: str):
        db.update_route(rid, {"colour_override": color})
        self.map_view.update_route_color(rid, color)
        self.left_panel.update_row_color(rid, color)

    # ------------------------------------------------------------------
    # Export / settings / misc
    # ------------------------------------------------------------------

    def _open_export(self):
        sel_ids = set(self.left_panel.selected_ids())
        selected = [r for r in self._filtered_routes if r["id"] in sel_ids]
        ExportDialog(self._all_routes, self._filtered_routes, selected, self).exec()

    def _open_settings(self):
        dlg = SettingsDialog(self)
        dlg.settings_changed.connect(self._refresh_all)
        dlg.exec()

    def _open_map_export(self):
        dlg = MapExportDialog(self.map_view, self)
        dlg.exec()

    def _open_help(self):
        if not hasattr(self, "_help_dlg") or self._help_dlg is None:
            self._help_dlg = HelpDialog(self)
        self._help_dlg.show()
        self._help_dlg.raise_()
        self._help_dlg.activateWindow()

    def _select_all(self):
        self.left_panel.table.selectAll()

    def _remove_selected(self):
        ids = self.left_panel.selected_ids()
        if not ids:
            return
        reply = QMessageBox.question(
            self, "Remove routes",
            f"Remove {len(ids)} route(s) from library?\n(Original files are not deleted.)",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No)
        if reply == QMessageBox.StandardButton.Yes:
            db.delete_routes(ids)
            self._refresh_all()
            self.metadata_panel.clear()

from __future__ import annotations

"""
Export dialog — lets the user choose format and scope, then triggers export.

Scope options:
  • Selected routes (pre-filled from current selection)
  • All currently filtered routes
  • All routes in the database
"""

import os
from pathlib import Path

from PyQt6.QtCore import Qt
from PyQt6.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QFormLayout,
    QLabel, QComboBox, QRadioButton, QButtonGroup,
    QPushButton, QFileDialog, QLineEdit,
    QFrame, QWidget, QMessageBox,
)

from gpx_manager.export.geojson_exporter import export_geojson
from gpx_manager.export.gpx_exporter import export_gpx


class ExportDialog(QDialog):
    def __init__(
        self,
        all_routes: list[dict],
        filtered_routes: list[dict],
        selected_routes: list[dict],
        parent=None,
    ):
        super().__init__(parent)
        self._all      = all_routes
        self._filtered = filtered_routes
        self._selected = selected_routes

        self.setWindowTitle("Export Routes")
        self.setMinimumWidth(420)
        self.setModal(True)
        self._build_ui()

    def _build_ui(self):
        layout = QVBoxLayout(self)
        layout.setSpacing(14)
        layout.setContentsMargins(18, 18, 18, 14)

        # --- Help ---
        help_lbl = QLabel("Export routes for upload to Mapbox Studio, geojson.io, or other mapping tools.")
        help_lbl.setStyleSheet("color: #748ca0; font-size: 12px; margin-bottom: 4px;")
        help_lbl.setWordWrap(True)
        layout.addWidget(help_lbl)

        # --- Format ---
        layout.addWidget(self._section_label("Format"))
        self._fmt_combo = QComboBox()
        self._fmt_combo.addItem("GeoJSON (.geojson) — Mapbox compatible", "geojson")
        self._fmt_combo.addItem("GPX (.gpx)",                             "gpx")
        layout.addWidget(self._fmt_combo)

        # --- Scope ---
        layout.addWidget(self._section_label("Routes to export"))
        scope_frame = QFrame()
        scope_layout = QVBoxLayout(scope_frame)
        scope_layout.setContentsMargins(0, 0, 0, 0)
        scope_layout.setSpacing(6)

        self._scope_group = QButtonGroup(self)
        self._radio_selected = QRadioButton(
            f"Selected routes  ({len(self._selected)})"
        )
        self._radio_filtered  = QRadioButton(
            f"Currently filtered routes  ({len(self._filtered)})"
        )
        self._radio_all = QRadioButton(
            f"All routes  ({len(self._all)})"
        )

        self._scope_group.addButton(self._radio_selected, 0)
        self._scope_group.addButton(self._radio_filtered,  1)
        self._scope_group.addButton(self._radio_all,       2)

        scope_layout.addWidget(self._radio_selected)
        scope_layout.addWidget(self._radio_filtered)
        scope_layout.addWidget(self._radio_all)
        layout.addWidget(scope_frame)

        # Default scope
        if self._selected:
            self._radio_selected.setChecked(True)
        elif self._filtered:
            self._radio_filtered.setChecked(True)
        else:
            self._radio_all.setChecked(True)

        # Disable empty options
        self._radio_selected.setEnabled(bool(self._selected))
        self._radio_filtered.setEnabled(bool(self._filtered))
        self._radio_all.setEnabled(bool(self._all))

        # --- Output path ---
        layout.addWidget(self._section_label("Output file"))
        path_row = QHBoxLayout()
        self._path_edit = QLineEdit()
        self._path_edit.setPlaceholderText("Choose a destination…")
        browse_btn = QPushButton("Browse…")
        browse_btn.setFixedWidth(72)
        browse_btn.clicked.connect(self._browse)
        path_row.addWidget(self._path_edit)
        path_row.addWidget(browse_btn)
        layout.addLayout(path_row)

        # Suggest default filename
        self._fmt_combo.currentIndexChanged.connect(self._update_path_extension)

        # --- Buttons ---
        sep = QFrame(); sep.setFrameShape(QFrame.Shape.HLine)
        layout.addWidget(sep)

        btn_row = QHBoxLayout()
        cancel_btn = QPushButton("Cancel")
        cancel_btn.clicked.connect(self.reject)
        self._export_btn = QPushButton("Export")
        self._export_btn.setDefault(True)
        self._export_btn.clicked.connect(self._do_export)
        btn_row.addStretch()
        btn_row.addWidget(cancel_btn)
        btn_row.addWidget(self._export_btn)
        layout.addLayout(btn_row)

    @staticmethod
    def _section_label(text: str) -> QLabel:
        lbl = QLabel(text)
        lbl.setStyleSheet(
            "font-family:'Poppins','Raleway',sans-serif;"
            "font-weight:600;font-size:12px;color:#42383c;margin-top:4px;"
        )
        return lbl

    def _browse(self):
        fmt = self._fmt_combo.currentData()
        ext = ".geojson" if fmt == "geojson" else ".gpx"
        default = str(Path.home() / "Desktop" / f"routes{ext}")
        path, _ = QFileDialog.getSaveFileName(
            self, "Save export file", default,
            f"{'GeoJSON' if fmt == 'geojson' else 'GPX'} (*{ext})"
        )
        if path:
            self._path_edit.setText(path)

    def _update_path_extension(self):
        current = self._path_edit.text()
        if not current:
            return
        fmt = self._fmt_combo.currentData()
        ext = ".geojson" if fmt == "geojson" else ".gpx"
        p = Path(current)
        self._path_edit.setText(str(p.with_suffix(ext)))

    def _get_routes(self) -> list[dict]:
        btn_id = self._scope_group.checkedId()
        if btn_id == 0:
            return self._selected
        if btn_id == 1:
            return self._filtered
        return self._all

    def _do_export(self):
        output = self._path_edit.text().strip()
        if not output:
            QMessageBox.warning(self, "No output path", "Please choose an output file.")
            return

        routes = self._get_routes()
        if not routes:
            QMessageBox.warning(self, "Nothing to export", "No routes match the selected scope.")
            return

        fmt = self._fmt_combo.currentData()

        try:
            if fmt == "geojson":
                count, warnings = export_geojson(routes, output)
            else:
                count, warnings = export_gpx(routes, output)
        except Exception as e:
            QMessageBox.critical(self, "Export failed", str(e))
            return

        msg = f"Exported {count} route(s) to:\n{output}"
        if warnings:
            msg += f"\n\nWarnings ({len(warnings)}):\n" + "\n".join(warnings[:10])

        QMessageBox.information(self, "Export complete", msg)
        self.accept()

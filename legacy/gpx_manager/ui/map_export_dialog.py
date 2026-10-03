from __future__ import annotations

"""Region-aware high-resolution map image exporter.

Workflow:
    1. User opens the dialog and picks aspect, output width and filename.
    2. They click "Position frame on map" — the dialog hides itself and an
       on-map draggable rectangle appears.
    3. A floating capture bar lets them confirm ("Capture") or cancel.
    4. On Capture: a Save File dialog opens so the user picks exactly where
       the PNG goes, then the map renders directly to that path, then a
       preview is shown.  No intermediate temp file.
"""

from datetime import date
from pathlib import Path

from PyQt6.QtCore import Qt, pyqtSignal
from PyQt6.QtGui import QPixmap
from PyQt6.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QFormLayout,
    QLabel, QComboBox, QSpinBox, QLineEdit,
    QPushButton, QFileDialog, QMessageBox, QWidget, QFrame,
    QApplication, QProgressDialog,
)

import gpx_manager.db as db
from gpx_manager.export.map_image_exporter import render_map_png


# (label, aspect ratio width/height)
_ASPECTS = [
    ("3 : 2  (photo)",  3 / 2),
    ("4 : 3",           4 / 3),
    ("16 : 9",          16 / 9),
    ("A4 landscape",    297 / 210),
    ("A4 portrait",     210 / 297),
    ("Square",          1.0),
]


# ---------------------------------------------------------------------------
# Floating capture toolbar — sits on top of the map while the frame is active
# ---------------------------------------------------------------------------

class CaptureBar(QFrame):
    capture_clicked = pyqtSignal()
    cancel_clicked  = pyqtSignal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setStyleSheet(
            "QFrame { background:#FFFFFF; border:1px solid #b8c8d4; border-radius:8px; }"
            "QLabel { color:#42383c; font-size:12px; padding:0 4px; }"
        )
        lay = QHBoxLayout(self)
        lay.setContentsMargins(10, 6, 10, 6)
        lay.setSpacing(8)
        lay.addWidget(QLabel("Drag the frame, then capture →"))
        cancel = QPushButton("Cancel")
        cancel.clicked.connect(self.cancel_clicked.emit)
        capture = QPushButton("Capture")
        capture.setDefault(True)
        capture.clicked.connect(self.capture_clicked.emit)
        lay.addWidget(cancel)
        lay.addWidget(capture)


# ---------------------------------------------------------------------------
# Dialog
# ---------------------------------------------------------------------------

class MapExportDialog(QDialog):
    """Configures and runs a high-resolution map export."""

    def __init__(self, map_view, parent=None):
        super().__init__(parent)
        self._map = map_view
        self._capture_bar: CaptureBar | None = None

        self.setWindowTitle("Export Map Image")
        self.setModal(True)
        self.setMinimumWidth(400)
        self._build_ui()

    # ------------------------------------------------------------------
    # UI
    # ------------------------------------------------------------------

    def _build_ui(self):
        outer = QVBoxLayout(self)
        outer.setContentsMargins(14, 14, 14, 12)
        outer.setSpacing(10)

        intro = QLabel(
            "Export the visible routes as a high-resolution PNG."
        )
        intro.setWordWrap(True)
        intro.setStyleSheet("color:#748ca0;font-size:12px;")
        outer.addWidget(intro)

        form = QFormLayout()
        form.setLabelAlignment(Qt.AlignmentFlag.AlignRight)
        form.setSpacing(8)

        self.aspect_combo = QComboBox()
        for label, ratio in _ASPECTS:
            self.aspect_combo.addItem(label, ratio)
        saved_aspect = db.get_app_config("map_export.aspect", "3 : 2  (photo)")
        idx = self.aspect_combo.findText(saved_aspect)
        if idx >= 0:
            self.aspect_combo.setCurrentIndex(idx)
        form.addRow("Aspect", self.aspect_combo)

        self.width_spin = QSpinBox()
        self.width_spin.setRange(800, 12000)
        self.width_spin.setSingleStep(100)
        self.width_spin.setSuffix(" px")
        self.width_spin.setValue(int(db.get_app_config("map_export.width_px", "3600") or 3600))
        form.addRow("Output width", self.width_spin)

        self.dpi_label = QLabel()
        self._update_dpi_label()
        form.addRow("Print size", self.dpi_label)

        self.filename_edit = QLineEdit()
        self.filename_edit.setText(f"map_{date.today():%Y-%m-%d}")
        form.addRow("Filename", self.filename_edit)

        outer.addLayout(form)

        # Status / preview
        self.status = QLabel("Position the frame on the map, then click Capture.")
        self.status.setStyleSheet("color:#748ca0;font-size:11px;")
        self.status.setWordWrap(True)
        outer.addWidget(self.status)

        self.preview = QLabel()
        self.preview.setFixedHeight(160)
        self.preview.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.preview.setStyleSheet(
            "background:#c4d4de;border:1px solid #a8bcc8;border-radius:8px;"
            "color:#748ca0;font-size:11px;"
        )
        self.preview.setText("Preview will appear here after capture.")
        outer.addWidget(self.preview)

        # Buttons
        btn_row = QHBoxLayout()
        close_btn = QPushButton("Close")
        close_btn.clicked.connect(self.reject)
        self.position_btn = QPushButton("Position frame on map →")
        self.position_btn.setDefault(True)
        self.position_btn.clicked.connect(self._begin_positioning)
        btn_row.addWidget(close_btn)
        btn_row.addStretch()
        btn_row.addWidget(self.position_btn)
        outer.addLayout(btn_row)

        self.width_spin.valueChanged.connect(lambda _v: self._update_dpi_label())
        self.aspect_combo.currentIndexChanged.connect(lambda _i: self._update_dpi_label())

    def _update_dpi_label(self):
        dpi = int(db.get_app_config("map_export.dpi", "300") or 300)
        ratio = self.aspect_combo.currentData() or 1.5
        w_px = self.width_spin.value()
        h_px = int(round(w_px / ratio))
        w_in = w_px / dpi
        h_in = h_px / dpi
        self.dpi_label.setText(
            f"{w_px} × {h_px} px  ·  {w_in:.1f}\" × {h_in:.1f}\" @ {dpi} DPI"
        )

    # ------------------------------------------------------------------
    # Frame positioning
    # ------------------------------------------------------------------

    def _begin_positioning(self):
        ratio = self.aspect_combo.currentData() or 1.5
        label = self.aspect_combo.currentText().split()[0]
        self._map.show_export_frame(ratio, label)

        if self._capture_bar is None:
            self._capture_bar = CaptureBar(self._map)
            self._capture_bar.capture_clicked.connect(self._do_capture)
            self._capture_bar.cancel_clicked.connect(self._cancel_capture)
        self._capture_bar.adjustSize()
        mw = self._map.width()
        bw = self._capture_bar.sizeHint().width()
        bh = self._capture_bar.sizeHint().height()
        self._capture_bar.setGeometry(
            (mw - bw) // 2, self._map.height() - bh - 12, bw, bh
        )
        self._capture_bar.show()
        self._capture_bar.raise_()
        self.hide()

    def _cancel_capture(self):
        self._map.hide_export_frame()
        if self._capture_bar:
            self._capture_bar.hide()
        self.show()
        self.raise_()

    def _do_capture(self):
        self._map.get_export_frame_bounds(self._on_bounds)

    # ------------------------------------------------------------------
    # Render
    # ------------------------------------------------------------------

    def _on_bounds(self, bounds):
        self._map.hide_export_frame()
        if self._capture_bar:
            self._capture_bar.hide()

        if not bounds:
            self.show(); self.raise_()
            self.status.setText("No frame on the map — try positioning it again.")
            return

        ratio = self.aspect_combo.currentData() or 1.5
        w_px = self.width_spin.value()
        h_px = int(round(w_px / ratio))

        # Ask where to save BEFORE rendering so the user knows exactly where
        # the file will end up — no confusing intermediate temp location.
        fname = self.filename_edit.text().strip() or f"map_{date.today():%Y-%m-%d}"
        if not fname.lower().endswith(".png"):
            fname += ".png"
        default_dir = db.get_app_config("map_export_folder") or str(Path.home() / "Downloads")
        default_path = str(Path(default_dir) / fname)

        target, _ = QFileDialog.getSaveFileName(
            None, "Save Map PNG", default_path, "PNG image (*.png)"
        )
        if not target:
            # User cancelled the save dialog — go back to the dialog
            self.show(); self.raise_()
            return
        if not target.lower().endswith(".png"):
            target += ".png"

        # Remember the chosen folder for next time
        db.set_app_config("map_export_folder", str(Path(target).parent))
        db.set_app_config("map_export.aspect",   self.aspect_combo.currentText())
        db.set_app_config("map_export.width_px",  str(w_px))

        self.show()
        self.raise_()
        QApplication.processEvents()

        # Indeterminate (marquee) progress dialog — range 0,0 means Qt shows a
        # spinning animation without ever calling setValue(), which avoids the
        # QProgressDialog.setValue() → QCoreApplication::processEvents() re-entrance
        # that would otherwise exit the nested QEventLoop inside render_map_png
        # prematurely and produce a spurious "empty file" error.
        progress = QProgressDialog("Rendering map — please wait…", None, 0, 0, self)
        progress.setWindowTitle("Exporting Map")
        progress.setWindowModality(Qt.WindowModality.WindowModal)
        progress.setMinimumDuration(0)
        progress.setMinimumWidth(320)
        progress.show()
        QApplication.processEvents()

        try:
            render_map_png(
                bounds=bounds,
                width_px=w_px,
                height_px=h_px,
                output_path=target,
                page=self._map.page(),
                grab_widget=self._map,
            )
        except Exception as e:
            progress.close()
            self.position_btn.setEnabled(True)
            QMessageBox.critical(self, "Render failed", str(e))
            self.status.setText("Render failed — see the error above.")
            return

        progress.close()
        self.position_btn.setEnabled(True)
        self.status.setText(f"✓  Saved to {target}")

        pix = QPixmap(target)
        if not pix.isNull():
            self.preview.setText("")
            self.preview.setPixmap(
                pix.scaled(
                    self.preview.width(), self.preview.height(),
                    Qt.AspectRatioMode.KeepAspectRatio,
                    Qt.TransformationMode.SmoothTransformation,
                )
            )

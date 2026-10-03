from __future__ import annotations

"""Settings dialog — manage transport types, countries, regions, trip segments, export folder."""

from pathlib import Path

from PyQt6.QtCore import Qt, pyqtSignal
from PyQt6.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QFormLayout, QTabWidget,
    QWidget, QLabel, QLineEdit, QPushButton, QSpinBox, QComboBox,
    QListWidget, QFileDialog, QAbstractItemView,
)

import gpx_manager.db as db


# ---------------------------------------------------------------------------
# List editor for a settings category
# ---------------------------------------------------------------------------

class _ListEditor(QWidget):
    changed = pyqtSignal()

    def __init__(self, category: str, description: str, parent=None):
        super().__init__(parent)
        self._category = category
        self._build_ui(description)
        self.refresh()

    def _build_ui(self, description: str):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(12, 12, 12, 12)
        layout.setSpacing(8)

        # Description
        desc = QLabel(description)
        desc.setWordWrap(True)
        desc.setStyleSheet("color: #748ca0; font-size: 12px; margin-bottom: 4px;")
        layout.addWidget(desc)

        # Input row
        row = QHBoxLayout()
        self._input = QLineEdit()
        self._input.setPlaceholderText(f"New {self._category.replace('_', ' ')}…")
        self._input.returnPressed.connect(self._add)
        add_btn = QPushButton("Add")
        add_btn.setFixedWidth(60)
        add_btn.clicked.connect(self._add)
        row.addWidget(self._input)
        row.addWidget(add_btn)
        layout.addLayout(row)

        # List
        self._list = QListWidget()
        self._list.setSelectionMode(QAbstractItemView.SelectionMode.ExtendedSelection)
        layout.addWidget(self._list)

        # Remove
        remove_btn = QPushButton("Remove Selected")
        remove_btn.setMinimumWidth(120)
        remove_btn.clicked.connect(self._remove)
        layout.addWidget(remove_btn)

    def refresh(self):
        self._list.clear()
        for v in db.get_setting_values(self._category):
            self._list.addItem(v)

    def _add(self):
        val = self._input.text().strip()
        if not val:
            return
        db.add_setting_value(self._category, val)
        self._input.clear()
        self.refresh()
        self.changed.emit()

    def _remove(self):
        items = self._list.selectedItems()
        if not items:
            return
        for item in items:
            db.remove_setting_value(self._category, item.text())
        self.refresh()
        self.changed.emit()


# ---------------------------------------------------------------------------
# Export folder config
# ---------------------------------------------------------------------------

class _ExportFolderWidget(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self._build_ui()
        self._load()

    def _build_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(12, 12, 12, 12)
        layout.setSpacing(10)

        desc = QLabel(
            "When you save metadata on a route, a copy of the GPX file is placed in this folder "
            "with a standardised filename:\n\n"
            "    YYYY-MM-DD_Type_Country_DayNN.gpx\n\n"
            "For example: 2025-01-02_Drive_Peru_Day2.gpx\n\n"
            "Leave empty to disable automatic copying."
        )
        desc.setWordWrap(True)
        desc.setStyleSheet("color: #748ca0; font-size: 12px;")
        layout.addWidget(desc)

        row = QHBoxLayout()
        self._path_edit = QLineEdit()
        self._path_edit.setReadOnly(True)
        self._path_edit.setPlaceholderText("No folder set — copies disabled")
        browse = QPushButton("Browse…")
        browse.setMinimumWidth(70)
        browse.clicked.connect(self._browse)
        clear = QPushButton("Clear")
        clear.setMinimumWidth(50)
        clear.clicked.connect(self._clear)
        row.addWidget(self._path_edit)
        row.addWidget(browse)
        row.addWidget(clear)
        layout.addLayout(row)
        layout.addStretch()

    def _load(self):
        self._path_edit.setText(db.get_app_config("export_folder"))

    def _browse(self):
        folder = QFileDialog.getExistingDirectory(self, "Choose export folder", str(Path.home()))
        if folder:
            db.set_app_config("export_folder", folder)
            self._path_edit.setText(folder)

    def _clear(self):
        db.set_app_config("export_folder", "")
        self._path_edit.clear()


# ---------------------------------------------------------------------------
# Map Export defaults tab
# ---------------------------------------------------------------------------

_ASPECT_OPTIONS = [
    "3 : 2  (photo)", "4 : 3", "16 : 9",
    "A4 landscape", "A4 portrait", "Square",
]


class _MapExportWidget(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self._build_ui()
        self._load()

    def _build_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(12, 12, 12, 12)
        layout.setSpacing(10)

        desc = QLabel(
            "Defaults for the map image exporter (Map Style → Export Map Image…). "
            "These pre-fill the export dialog so you don't have to set them every time."
        )
        desc.setWordWrap(True)
        desc.setStyleSheet("color: #748ca0; font-size: 12px;")
        layout.addWidget(desc)

        form = QFormLayout()
        form.setLabelAlignment(Qt.AlignmentFlag.AlignRight)
        form.setSpacing(8)

        self._width_spin = QSpinBox()
        self._width_spin.setRange(800, 12000)
        self._width_spin.setSingleStep(100)
        self._width_spin.setSuffix(" px")
        form.addRow("Default width", self._width_spin)

        self._dpi_spin = QSpinBox()
        self._dpi_spin.setRange(72, 600)
        self._dpi_spin.setSuffix(" DPI")
        form.addRow("Print DPI (label)", self._dpi_spin)

        self._aspect_combo = QComboBox()
        for opt in _ASPECT_OPTIONS:
            self._aspect_combo.addItem(opt)
        form.addRow("Default aspect", self._aspect_combo)

        layout.addLayout(form)

        # Output folder row
        folder_lbl = QLabel("Default output folder")
        folder_lbl.setStyleSheet("color: #748ca0; font-size: 12px; margin-top: 6px;")
        layout.addWidget(folder_lbl)

        row = QHBoxLayout()
        self._folder_edit = QLineEdit()
        self._folder_edit.setReadOnly(True)
        self._folder_edit.setPlaceholderText("Leave empty to ask each time")
        browse = QPushButton("Browse…")
        browse.setMinimumWidth(70)
        browse.clicked.connect(self._browse)
        clear = QPushButton("Clear")
        clear.setMinimumWidth(50)
        clear.clicked.connect(self._clear_folder)
        row.addWidget(self._folder_edit)
        row.addWidget(browse)
        row.addWidget(clear)
        layout.addLayout(row)

        layout.addStretch()

        self._width_spin.valueChanged.connect(self._save)
        self._dpi_spin.valueChanged.connect(self._save)
        self._aspect_combo.currentTextChanged.connect(self._save)

    def _load(self):
        for w in (self._width_spin, self._dpi_spin, self._aspect_combo):
            w.blockSignals(True)
        self._width_spin.setValue(int(db.get_app_config("map_export.width_px") or 3600))
        self._dpi_spin.setValue(int(db.get_app_config("map_export.dpi") or 300))
        cur = db.get_app_config("map_export.aspect") or "3 : 2  (photo)"
        idx = self._aspect_combo.findText(cur)
        self._aspect_combo.setCurrentIndex(max(0, idx))
        self._folder_edit.setText(db.get_app_config("map_export_folder", ""))
        for w in (self._width_spin, self._dpi_spin, self._aspect_combo):
            w.blockSignals(False)
        self._save()  # persists defaults on first-ever launch

    def _save(self):
        db.set_app_config("map_export.width_px", str(self._width_spin.value()))
        db.set_app_config("map_export.dpi",      str(self._dpi_spin.value()))
        db.set_app_config("map_export.aspect",   self._aspect_combo.currentText())

    def _browse(self):
        from pathlib import Path
        folder = QFileDialog.getExistingDirectory(
            self, "Choose map export folder", str(Path.home())
        )
        if folder:
            db.set_app_config("map_export_folder", folder)
            self._folder_edit.setText(folder)

    def _clear_folder(self):
        db.set_app_config("map_export_folder", "")
        self._folder_edit.clear()


# ---------------------------------------------------------------------------
# Main settings dialog
# ---------------------------------------------------------------------------

_TABS = [
    ("Transport Types", "transport_type",
     "Available transport categories for tagging routes.\n"
     "The 'Type' dropdown in the metadata panel only shows values listed here."),
    ("Countries", "country",
     "Countries you've visited.\n"
     "The 'Country' dropdown in the metadata panel only shows values from this list."),
    ("Regions", "region",
     "Regions within countries (e.g. 'Ancash', 'Cusco').\n"
     "The 'Region' dropdown in the metadata panel only shows values from this list."),
    ("Trip Segments", "trip_segment",
     "Named trip legs (e.g. 'Northern Loop', 'Leg 1').\n"
     "The 'Segment' dropdown in the metadata panel only shows values from this list."),
]


class SettingsDialog(QDialog):
    settings_changed = pyqtSignal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Settings")
        self.setMinimumSize(460, 440)
        self.setModal(True)
        self._build_ui()

    def _build_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(12, 12, 12, 8)
        layout.setSpacing(8)

        # Shortcut tips
        tips = QLabel(
            "Keyboard shortcuts:  Cmd+O Import Files  ·  Cmd+Shift+O Import Folder  ·  "
            "Cmd+E Export  ·  Cmd+A Select All  ·  Cmd+F Fit Map  ·  Backspace Remove"
        )
        tips.setWordWrap(True)
        tips.setStyleSheet("color: #748ca0; font-size: 11px; padding: 2px 0 6px 0;")
        layout.addWidget(tips)

        tabs = QTabWidget()
        for label, cat, desc in _TABS:
            editor = _ListEditor(cat, desc)
            editor.changed.connect(self.settings_changed)
            tabs.addTab(editor, label)

        tabs.addTab(_ExportFolderWidget(), "Export Folder")
        tabs.addTab(_MapExportWidget(),    "Map Export")
        layout.addWidget(tabs)

        btn_row = QHBoxLayout()
        close_btn = QPushButton("Done")
        close_btn.setMinimumWidth(70)
        close_btn.clicked.connect(self.accept)
        btn_row.addStretch()
        btn_row.addWidget(close_btn)
        layout.addLayout(btn_row)

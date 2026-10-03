"""
GPX Route Manager — entry point.

Run with:
    python main.py
"""

import sys
import os

# Ensure QtWebEngine can find its resources on macOS
os.environ.setdefault("QTWEBENGINE_DISABLE_SANDBOX", "1")

# Suppress noisy Chromium log messages (e.g. Skia Graphite fallback warnings)
os.environ.setdefault("QTWEBENGINE_CHROMIUM_FLAGS", "--log-level=3")

from PyQt6.QtWidgets import QApplication
from PyQt6.QtCore import Qt

from gpx_manager.ui.fonts import load_fonts
from gpx_manager.ui.main_window import MainWindow, LIGHT_QSS


def main():
    app = QApplication(sys.argv)
    app.setApplicationName("GPX Route Manager")
    app.setOrganizationName("GPXManager")
    load_fonts()
    app.setStyleSheet(LIGHT_QSS)

    window = MainWindow()
    window.show()

    sys.exit(app.exec())


if __name__ == "__main__":
    main()

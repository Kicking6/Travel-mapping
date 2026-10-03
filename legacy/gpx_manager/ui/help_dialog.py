from __future__ import annotations

"""User guide dialog — renders assets/user_guide.md inside a QTextBrowser."""

from pathlib import Path

from PyQt6.QtCore import Qt
from PyQt6.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QPushButton, QTextBrowser,
)


_GUIDE = Path(__file__).parent.parent / "assets" / "user_guide.md"


class HelpDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("GPX Route Manager — User Guide")
        self.setModal(False)
        self.resize(760, 640)
        self._build_ui()

    def _build_ui(self):
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)

        self._browser = QTextBrowser()
        self._browser.setOpenExternalLinks(False)
        self._browser.setStyleSheet(
            "QTextBrowser {"
            "  background:#FFFFFF; border:none;"
            "  padding:24px 32px;"
            "  font-family:'Raleway','Helvetica Neue',Arial,sans-serif;"
            "  font-size:14px; color:#42383c;"
            "}"
        )
        try:
            text = _GUIDE.read_text(encoding="utf-8")
        except OSError:
            text = "# User guide\n\n_(missing assets/user_guide.md)_"
        self._browser.setMarkdown(text)
        outer.addWidget(self._browser, 1)

        # Footer
        footer = QHBoxLayout()
        footer.setContentsMargins(12, 8, 12, 12)
        footer.addStretch()
        close = QPushButton("Close")
        close.setFixedWidth(80)
        close.clicked.connect(self.accept)
        footer.addWidget(close)
        outer.addLayout(footer)

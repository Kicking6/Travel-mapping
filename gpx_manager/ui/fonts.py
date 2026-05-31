from __future__ import annotations

"""Load bundled Poppins + Raleway fonts at startup."""

from pathlib import Path
from PyQt6.QtGui import QFontDatabase

FONTS_DIR = Path(__file__).parent.parent / "assets" / "fonts"
FONT_HEADING = "Poppins"
FONT_BODY = "Raleway"


def load_fonts() -> None:
    """Register all .ttf files in assets/fonts/ with Qt's font database."""
    if not FONTS_DIR.exists():
        return
    for ttf in sorted(FONTS_DIR.glob("*.ttf")):
        QFontDatabase.addApplicationFont(str(ttf))

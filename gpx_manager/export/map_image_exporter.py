from __future__ import annotations

"""High-resolution map renderer.

Uses the *live* QWebEngineView (the one already on screen) rather than
trying to create an offscreen view.  On macOS, offscreen QWebEngineView
windows never fire loadFinished because the Chromium renderer process
doesn't fully initialise without a real compositing surface.

Workflow
--------
1.  Fit the live map to the user-chosen geographic bounds.
2.  Arm the MapLibre idle listener, then poll window._tilesReady until true.
3.  grab() the live view — on Retina displays this gives 2× physical pixels.
4.  Scale the pixmap to the user-requested pixel dimensions.
5.  Save as PNG.

The output quality is limited by the physical pixel size of the live view
(typically 1800–3000 px wide on a 14/16" MacBook Pro retina), which is
more than enough for 12" × 8" photo-album print at 300 DPI.
"""

import json
from pathlib import Path

from PyQt6.QtCore import QTimer, QEventLoop, Qt
from PyQt6.QtGui import QPixmap

_js_bounds = lambda b: json.dumps(b)


def render_map_png(
    bounds: dict,
    width_px: int,
    height_px: int,
    output_path: str | Path,
    page,              # QWebEnginePage  — from the live MapView
    grab_widget,       # QWebEngineView  — the live MapView widget
) -> Path:
    """Fit the live map to *bounds*, wait for tiles, grab, scale, save.

    Raises ``RuntimeError`` on failure.
    """
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    loop = QEventLoop()
    error: list[str] = []
    result = {"saved": False}

    # Fit the map to the export region, then arm the idle listener.
    # Wrapped in a style-load check so it works even when a basemap switch
    # or crash-recovery reload is still in progress.
    page.runJavaScript(
        "(function(){"
        f"  var _b = {_js_bounds(bounds)};"
        "  function _doExport(){"
        "    window.mapBridge.fitToBounds(_b);"
        "    window._tilesReady = false;"
        "    map.once('idle', function(){ window._tilesReady = true; });"
        "  }"
        "  if(map.isStyleLoaded()){ _doExport(); }"
        "  else { map.once('style.load', _doExport); }"
        "})();"
    )

    attempts = {"n": 0}
    MAX_ATTEMPTS = 120  # 120 × 100 ms = 12 s max

    def _poll():
        page.runJavaScript("window._tilesReady === true", _on_poll)

    def _on_poll(ready):
        attempts["n"] += 1
        print(f"[export] tile poll #{attempts['n']} ready={ready}")
        if ready or attempts["n"] > MAX_ATTEMPTS:
            QTimer.singleShot(200, _grab)   # short settle after tiles ready
        else:
            QTimer.singleShot(100, _poll)   # fast poll — 100 ms intervals

    def _grab():
        print("[export] grabbing live view…")
        pixmap: QPixmap = grab_widget.grab()
        print(f"[export] grabbed — physical size {pixmap.width()}×{pixmap.height()}")

        if pixmap.isNull() or pixmap.size().isEmpty():
            error.append("grab() returned a null pixmap")
            loop.quit()
            return

        # Scale to the user-requested pixel dimensions exactly.
        # KeepAspectRatioByExpanding ensures neither output dimension falls short,
        # then we crop-centre to the precise width×height the user asked for.
        if pixmap.width() != width_px or pixmap.height() != height_px:
            from PyQt6.QtCore import QRect
            pixmap = pixmap.scaled(
                width_px, height_px,
                Qt.AspectRatioMode.KeepAspectRatioByExpanding,
                Qt.TransformationMode.SmoothTransformation,
            )
            if pixmap.width() != width_px or pixmap.height() != height_px:
                x = (pixmap.width()  - width_px)  // 2
                y = (pixmap.height() - height_px) // 2
                pixmap = pixmap.copy(QRect(x, y, width_px, height_px))
            print(f"[export] scaled/cropped to {pixmap.width()}×{pixmap.height()}")

        ok = pixmap.save(str(output_path), "PNG")
        print(f"[export] save ok={ok}  path={output_path}")
        if ok:
            result["saved"] = True
        else:
            error.append(f"QPixmap.save() failed writing to {output_path}")
        loop.quit()

    # Give the map 200 ms to start requesting tiles after fitToBounds.
    QTimer.singleShot(200, _poll)
    QTimer.singleShot(30_000, loop.quit)   # hard timeout
    loop.exec()

    if error:
        raise RuntimeError(error[0])
    if not result["saved"]:
        raise RuntimeError(
            "Export produced an empty file — tiles may not have loaded in time."
        )

    return output_path

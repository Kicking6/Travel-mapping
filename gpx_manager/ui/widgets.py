from __future__ import annotations

"""Shared custom widgets used across the UI."""

from PyQt6.QtCore import Qt, QDate, QPoint, QRect, QSize, pyqtSignal
from PyQt6.QtGui import QColor, QKeyEvent
from PyQt6.QtWidgets import (
    QPushButton, QColorDialog, QWidget, QHBoxLayout, QVBoxLayout,
    QLayout, QLabel, QScrollArea, QCheckBox, QFrame,
    QDialog, QGridLayout, QSizePolicy,
)


# ---------------------------------------------------------------------------
# Colour picker button
# ---------------------------------------------------------------------------

class ColorButton(QPushButton):
    """A small swatch button that opens a colour picker on click."""

    color_chosen = pyqtSignal(str)

    def __init__(self, color: str = "#999", title: str = "Pick colour", parent=None):
        super().__init__(parent)
        self._color = color
        self._title = title
        self.setFixedSize(28, 22)
        self._apply()
        self.clicked.connect(self._pick)

    def _apply(self):
        self.setStyleSheet(
            f"background:{self._color};"
            "border:1px solid #96aab8;border-radius:4px;"
            "min-width:28px;max-width:28px;min-height:22px;max-height:22px;"
        )

    def set_color(self, c: str):
        self._color = c
        self._apply()

    def color(self) -> str:
        return self._color

    def _pick(self):
        from vcolorpicker import getColor, hex2rgb, rgb2hex
        old_rgb = hex2rgb(self._color.lstrip("#"))   # (r, g, b) 0-255
        result  = getColor(old_rgb)                   # returns (r, g, b) or None on cancel
        if result:
            self._color = "#" + rgb2hex(result)
            self._apply()
            self.color_chosen.emit(self._color)


# ---------------------------------------------------------------------------
# Flow layout (wrapping horizontal row)
# ---------------------------------------------------------------------------

class _FlowLayout(QLayout):
    """Items wrap to the next line when the available width is exhausted."""

    def __init__(self, parent=None, spacing: int = 4):
        super().__init__(parent)
        self._spacing = spacing
        self._items: list = []

    def addItem(self, item):
        self._items.append(item)

    def count(self) -> int:
        return len(self._items)

    def itemAt(self, index: int):
        return self._items[index] if 0 <= index < len(self._items) else None

    def takeAt(self, index: int):
        return self._items.pop(index) if 0 <= index < len(self._items) else None

    def expandingDirections(self):
        return Qt.Orientation(0)

    def hasHeightForWidth(self) -> bool:
        return True

    def heightForWidth(self, width: int) -> int:
        return self._do_layout(QRect(0, 0, width, 0), test_only=True)

    def setGeometry(self, rect: QRect):
        super().setGeometry(rect)
        self._do_layout(rect, test_only=False)

    def sizeHint(self) -> QSize:
        return self.minimumSize()

    def minimumSize(self) -> QSize:
        size = QSize()
        for item in self._items:
            size = size.expandedTo(item.minimumSize())
        m = self.contentsMargins()
        size += QSize(m.left() + m.right(), m.top() + m.bottom())
        return size

    def _do_layout(self, rect: QRect, test_only: bool) -> int:
        sp = self._spacing
        x, y = rect.x(), rect.y()
        line_height = 0

        for item in self._items:
            iw = item.sizeHint().width()
            ih = item.sizeHint().height()
            next_x = x + iw + sp
            if next_x - sp > rect.right() and line_height > 0:
                x = rect.x()
                y += line_height + sp
                next_x = x + iw + sp
                line_height = 0
            if not test_only:
                item.setGeometry(QRect(QPoint(x, y), item.sizeHint()))
            x = next_x
            line_height = max(line_height, ih)

        return y + line_height - rect.y()


# ---------------------------------------------------------------------------
# Toggle pill multi-select
# ---------------------------------------------------------------------------

_PILL_QSS = """
QPushButton {
    background: #d0e0e9;
    color: #42383c;
    border: 1.5px solid #b8c8d4;
    border-radius: 12px;
    padding: 4px 10px;
    font-size: 12px;
    font-family: "Raleway", sans-serif;
    font-weight: 500;
    min-height: 20px;
}
QPushButton:checked {
    background: #225875;
    color: #FFFFFF;
    border-color: #225875;
}
QPushButton:hover:!checked {
    background: #c4d4de;
    border-color: #748ca0;
}
QPushButton:pressed {
    background: #1a4660;
    color: #FFFFFF;
    border-color: #1a4660;
}
"""


class PillMultiSelect(QWidget):
    """Wrapping row of checkable pill buttons for multi-select filtering."""

    changed = pyqtSignal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self._btns: dict[str, QPushButton] = {}
        self._flow = _FlowLayout(self, spacing=4)
        self.setLayout(self._flow)

    def set_options(self, options: list[str]) -> None:
        while self._flow.count():
            item = self._flow.takeAt(0)
            if item and item.widget():
                item.widget().deleteLater()
        self._btns.clear()

        for opt in options:
            btn = QPushButton(opt.title())
            btn.setCheckable(True)
            btn.setStyleSheet(_PILL_QSS)
            btn.setCursor(Qt.CursorShape.PointingHandCursor)
            btn.toggled.connect(lambda _checked: self.changed.emit())
            self._flow.addWidget(btn)
            self._btns[opt] = btn

        self.updateGeometry()

    def checked_values(self) -> list[str]:
        return [k for k, btn in self._btns.items() if btn.isChecked()]

    def clear_checks(self) -> None:
        for btn in self._btns.values():
            btn.blockSignals(True)
            btn.setChecked(False)
            btn.blockSignals(False)
        self.changed.emit()


# ---------------------------------------------------------------------------
# Popup check-list (for longer, variable-length option sets)
# ---------------------------------------------------------------------------

class _CheckListPopup(QFrame):
    """Frameless popup with a scrollable checkbox list and Select All / Clear."""

    selection_changed = pyqtSignal(object)  # emits frozenset of checked values

    def __init__(self, options: list[str], checked: set[str],
                 min_width: int, parent=None):
        super().__init__(None, Qt.WindowType.Popup)
        self._options = options
        self._checked = set(checked)
        self._checkboxes: list[QCheckBox] = []
        self._emitted = False
        self._build_ui(max(min_width, 160))

    def _build_ui(self, width: int) -> None:
        self.setMinimumWidth(width)
        self.setStyleSheet("""
            QFrame {
                background: #FFFFFF;
                border: 1px solid #b8c8d4;
                border-radius: 8px;
            }
            QCheckBox {
                color: #42383c;
                font-size: 12px;
                font-family: "Raleway", sans-serif;
                padding: 1px 0;
                spacing: 6px;
            }
            QCheckBox::indicator {
                width: 14px; height: 14px;
                border: 1.5px solid #96aab8;
                border-radius: 3px;
                background: #FFFFFF;
            }
            QCheckBox::indicator:checked {
                background: #225875;
                border-color: #225875;
            }
            QPushButton {
                color: #225875;
                font-size: 11px;
                font-family: "Raleway", sans-serif;
                font-weight: 500;
                border: none;
                background: transparent;
                padding: 2px 4px;
                min-height: 0;
            }
            QPushButton:hover { color: #1a4660; }
        """)

        outer = QVBoxLayout(self)
        outer.setContentsMargins(10, 10, 10, 8)
        outer.setSpacing(6)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.Shape.NoFrame)
        scroll.setMaximumHeight(200)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)

        inner_w = QWidget()
        inner_lay = QVBoxLayout(inner_w)
        inner_lay.setContentsMargins(0, 0, 0, 0)
        inner_lay.setSpacing(3)

        for opt in self._options:
            cb = QCheckBox(opt)
            cb.setChecked(opt in self._checked)
            cb.toggled.connect(lambda on, o=opt: self._toggle(o, on))
            inner_lay.addWidget(cb)
            self._checkboxes.append(cb)

        scroll.setWidget(inner_w)
        outer.addWidget(scroll)

        div = QFrame()
        div.setFrameShape(QFrame.Shape.HLine)
        div.setStyleSheet("QFrame { border: none; border-top: 1px solid #a8bcc8; "
                          "background: transparent; }")
        div.setFixedHeight(1)
        outer.addWidget(div)

        footer = QHBoxLayout()
        footer.setContentsMargins(0, 0, 0, 0)
        all_btn = QPushButton("Select All")
        all_btn.clicked.connect(self._select_all)
        clr_btn = QPushButton("Clear")
        clr_btn.clicked.connect(self._clear_all)
        footer.addWidget(all_btn)
        footer.addStretch()
        footer.addWidget(clr_btn)
        outer.addLayout(footer)

    def _toggle(self, opt: str, on: bool) -> None:
        if on:
            self._checked.add(opt)
        else:
            self._checked.discard(opt)

    def _select_all(self) -> None:
        self._checked = set(self._options)
        for cb in self._checkboxes:
            cb.blockSignals(True)
            cb.setChecked(True)
            cb.blockSignals(False)

    def _clear_all(self) -> None:
        self._checked.clear()
        for cb in self._checkboxes:
            cb.blockSignals(True)
            cb.setChecked(False)
            cb.blockSignals(False)

    def _emit_once(self) -> None:
        if not self._emitted:
            self._emitted = True
            self.selection_changed.emit(frozenset(self._checked))

    def closeEvent(self, e):
        self._emit_once()
        super().closeEvent(e)

    def hideEvent(self, e):
        self._emit_once()
        super().hideEvent(e)


class PopupCheckList(QWidget):
    """A labelled button that opens a checkable popup list for multi-select filtering."""

    changed = pyqtSignal()

    def __init__(self, placeholder: str = "All", parent=None):
        super().__init__(parent)
        self._placeholder = placeholder
        self._options: list[str] = []
        self._checked: set[str] = set()

        lay = QHBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)

        self._btn = QPushButton()
        self._btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self._btn.clicked.connect(self._open_popup)
        lay.addWidget(self._btn)
        self._update_label()

    def set_options(self, options: list[str]) -> None:
        self._options = list(options)
        self._checked &= set(options)
        self._update_label()

    def checked_values(self) -> list[str]:
        return [o for o in self._options if o in self._checked]

    def clear_checks(self) -> None:
        self._checked.clear()
        self._update_label()
        self.changed.emit()

    def _update_label(self) -> None:
        n = len(self._checked)
        total = len(self._options)
        if n == 0:
            self._btn.setText(f"{self._placeholder}  ▾")
        elif n == total and total > 0:
            self._btn.setText(f"All ({total})  ▾")
        else:
            self._btn.setText(f"{n} of {total}  ▾")

    def _open_popup(self) -> None:
        popup = _CheckListPopup(
            self._options, self._checked, self._btn.width()
        )
        popup.selection_changed.connect(self._on_closed)
        gpos = self._btn.mapToGlobal(QPoint(0, self._btn.height() + 2))
        popup.move(gpos)
        popup.show()
        popup.raise_()

    def _on_closed(self, new_checked) -> None:
        old = frozenset(self._checked)
        self._checked = set(new_checked)
        self._update_label()
        if old != frozenset(self._checked):
            self.changed.emit()


# ---------------------------------------------------------------------------
# Calendar date picker dialog
# ---------------------------------------------------------------------------

_CELL = 34  # day button size in pixels

_NAV_BTN_QSS = (
    "QPushButton { background: transparent; border: none; color: #225875; "
    "font-size: 16px; font-weight: 700; border-radius: 4px; padding: 0 4px; }"
    "QPushButton:hover { background: #e0eaf2; }"
    "QPushButton:pressed { background: #c8d8e4; }"
)

_SIDE_BTN_QSS = (
    "QPushButton { background: #e0eaf2; border: 1px solid #b8c8d4; "
    "border-radius: 6px; padding: 3px 10px; font-size: 11px; "
    "font-family:'Poppins','Raleway',sans-serif; font-weight:600; color: #748ca0; }"
    "QPushButton:checked { background: #225875; border-color: #225875; color: #FFFFFF; }"
    "QPushButton:hover:!checked { background: #c8d8e4; border-color: #748ca0; }"
)

_QUICK_BTN_QSS = (
    "QPushButton { background: #f0f4f8; border: 1px solid #c8d8e4; "
    "border-radius: 6px; padding: 4px 10px; font-size: 11px; "
    "font-family:'Raleway',sans-serif; color: #42383c; }"
    "QPushButton:hover { background: #e0eaf2; border-color: #748ca0; }"
    "QPushButton:pressed { background: #c8d8e4; }"
)


def _day_btn_style(selected: bool, in_range: bool, is_today: bool) -> str:
    if selected:
        return (
            f"QPushButton {{ background: #225875; color: #FFFFFF; "
            f"border-radius: {_CELL // 2}px; border: none; "
            f"font-family:'Poppins','Raleway',sans-serif; font-size:12px; font-weight:700; }}"
        )
    if in_range:
        return (
            f"QPushButton {{ background: #cfe4f5; color: #225875; "
            f"border-radius: 4px; border: none; "
            f"font-family:'Poppins','Raleway',sans-serif; font-size:12px; }}"
            f"QPushButton:hover {{ background: #bcd8ef; }}"
        )
    if is_today:
        return (
            f"QPushButton {{ background: transparent; color: #225875; "
            f"border-radius: 4px; border: 1.5px solid #225875; "
            f"font-family:'Poppins','Raleway',sans-serif; font-size:12px; font-weight:600; }}"
            f"QPushButton:hover {{ background: #e8f2fa; }}"
        )
    return (
        f"QPushButton {{ background: transparent; color: #42383c; "
        f"border-radius: 4px; border: none; "
        f"font-family:'Poppins','Raleway',sans-serif; font-size:12px; }}"
        f"QPushButton:hover {{ background: #e8f2fa; }}"
    )


class DatePickerDialog(QDialog):
    """Modal calendar picker.

    mode='single': result_date is QDate | None
    mode='range':  result_date is (QDate, QDate) | None
    """

    def __init__(self, parent=None, *, mode: str = "single",
                 start_date: "QDate | None" = None,
                 end_date: "QDate | None" = None):
        super().__init__(parent)
        self.mode = mode
        self.result_date = None

        today = QDate.currentDate()
        self._start: QDate | None = start_date if (start_date and start_date.isValid()) else None
        self._end: QDate | None = end_date if (end_date and end_date.isValid()) else self._start
        self._hot: QDate = self._start or today
        self._view = QDate(self._hot.year(), self._hot.month(), 1)
        self._active_side = "start" if mode == "range" else "single"
        self._day_btns: list[QPushButton] = []

        self.setWindowTitle("Select date" if mode == "single" else "Select date range")
        self.setModal(True)
        self.setFixedWidth(420 if mode == "range" else 380)
        self._build_ui()
        self._paint()

    # ------------------------------------------------------------------ ui

    def _build_ui(self):
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)

        content = QHBoxLayout()
        content.setContentsMargins(0, 0, 0, 0)
        content.setSpacing(0)

        # ── Left accent strip: big date preview ──────────────────────────
        left = QWidget()
        left.setFixedWidth(88)
        left.setStyleSheet("background:#225875;")
        lv = QVBoxLayout(left)
        lv.setContentsMargins(12, 20, 12, 20)
        lv.setSpacing(0)

        self._big_mon = QLabel("—")
        self._big_mon.setStyleSheet(
            "background:transparent; color:rgba(255,255,255,0.65); "
            "font-family:'Poppins','Raleway',sans-serif; font-size:12px; "
            "font-weight:600; letter-spacing:1px;"
        )
        self._big_day = QLabel("—")
        self._big_day.setStyleSheet(
            "background:transparent; color:#FFFFFF; "
            "font-family:'Poppins','Raleway',sans-serif; font-size:42px; "
            "font-weight:700; line-height:1;"
        )
        self._big_year = QLabel("—")
        self._big_year.setStyleSheet(
            "background:transparent; color:rgba(255,255,255,0.65); "
            "font-family:'Poppins','Raleway',sans-serif; font-size:12px;"
        )
        lv.addStretch()
        lv.addWidget(self._big_mon)
        lv.addWidget(self._big_day)
        lv.addWidget(self._big_year)
        lv.addStretch()

        # Side label (only in range mode)
        if self.mode == "range":
            self._side_lbl = QLabel("START")
            self._side_lbl.setStyleSheet(
                "background:transparent; color:rgba(255,255,255,0.5); "
                "font-size:9px; font-weight:700; letter-spacing:1px; "
                "font-family:'Poppins','Raleway',sans-serif;"
            )
            lv.addWidget(self._side_lbl)

        content.addWidget(left)

        # ── Right: calendar ───────────────────────────────────────────────
        right = QWidget()
        right.setStyleSheet("background:#FFFFFF;")
        rv = QVBoxLayout(right)
        rv.setContentsMargins(14, 12, 14, 10)
        rv.setSpacing(6)

        # Navigation header
        hdr = QHBoxLayout()
        hdr.setSpacing(4)

        self._prev_btn = QPushButton("‹")
        self._prev_btn.setFixedSize(28, 28)
        self._prev_btn.setStyleSheet(_NAV_BTN_QSS)
        self._prev_btn.clicked.connect(lambda: self._nav(-1))

        self._month_lbl = QLabel()
        self._month_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._month_lbl.setStyleSheet(
            "font-family:'Poppins','Raleway',sans-serif; font-size:13px; "
            "font-weight:600; color:#225875;"
        )

        self._next_btn = QPushButton("›")
        self._next_btn.setFixedSize(28, 28)
        self._next_btn.setStyleSheet(_NAV_BTN_QSS)
        self._next_btn.clicked.connect(lambda: self._nav(+1))

        hdr.addWidget(self._prev_btn)
        hdr.addWidget(self._month_lbl, 1)
        hdr.addWidget(self._next_btn)

        # Start / End toggle (range mode only)
        if self.mode == "range":
            hdr.addSpacing(6)
            self._start_btn = QPushButton("Start")
            self._start_btn.setCheckable(True)
            self._start_btn.setChecked(True)
            self._start_btn.setStyleSheet(_SIDE_BTN_QSS)
            self._start_btn.clicked.connect(lambda: self._set_side("start"))

            self._end_btn = QPushButton("End")
            self._end_btn.setCheckable(True)
            self._end_btn.setChecked(False)
            self._end_btn.setStyleSheet(_SIDE_BTN_QSS)
            self._end_btn.clicked.connect(lambda: self._set_side("end"))

            hdr.addWidget(self._start_btn)
            hdr.addWidget(self._end_btn)

        rv.addLayout(hdr)

        # Weekday header
        wk = QGridLayout()
        wk.setSpacing(2)
        wk.setContentsMargins(0, 0, 0, 0)
        for col, name in enumerate(["M", "T", "W", "T", "F", "S", "S"]):
            lbl = QLabel(name)
            lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
            lbl.setFixedSize(_CELL, 18)
            lbl.setStyleSheet(
                "color:#96aab8; font-size:11px; font-weight:600; "
                "font-family:'Poppins','Raleway',sans-serif; background:transparent;"
            )
            wk.addWidget(lbl, 0, col)
        rv.addLayout(wk)

        # Day grid 6 × 7
        grid = QGridLayout()
        grid.setSpacing(2)
        grid.setContentsMargins(0, 0, 0, 0)
        for r in range(6):
            for c in range(7):
                idx = r * 7 + c
                btn = QPushButton()
                btn.setFixedSize(_CELL, _CELL)
                btn.setFocusPolicy(Qt.FocusPolicy.NoFocus)
                btn.clicked.connect(lambda _=False, i=idx: self._click(i))
                grid.addWidget(btn, r, c)
                self._day_btns.append(btn)
        rv.addLayout(grid)

        # Quick picks
        qr = QHBoxLayout()
        qr.setSpacing(4)
        for label, offset in [("Yesterday", -1), ("Today", 0), ("Tomorrow", +1)]:
            b = QPushButton(label)
            b.setStyleSheet(_QUICK_BTN_QSS)
            b.clicked.connect(lambda _=False, o=offset: self._quick(o))
            qr.addWidget(b)
        rv.addLayout(qr)

        # Summary
        self._summary_lbl = QLabel()
        self._summary_lbl.setStyleSheet(
            "color:#748ca0; font-size:11px; font-family:'Raleway',sans-serif; "
            "background:transparent;"
        )
        rv.addWidget(self._summary_lbl)

        content.addWidget(right, 1)
        outer.addLayout(content)

        # Footer bar
        footer_w = QWidget()
        footer_w.setStyleSheet("background:#f0f4f8; border-top:1px solid #d0dde6;")
        fv = QHBoxLayout(footer_w)
        fv.setContentsMargins(14, 8, 14, 10)
        fv.setSpacing(8)
        fv.addStretch()

        cancel_btn = QPushButton("Cancel")
        cancel_btn.clicked.connect(self.reject)
        ok_btn = QPushButton("OK")
        ok_btn.setDefault(True)
        ok_btn.clicked.connect(self._on_ok)

        fv.addWidget(cancel_btn)
        fv.addWidget(ok_btn)
        outer.addWidget(footer_w)

    # ------------------------------------------------------------------ paint

    def _paint(self):
        self._month_lbl.setText(self._view.toString("MMMM yyyy"))
        today = QDate.currentDate()

        for i, btn in enumerate(self._day_btns):
            d = self._cell_date(i)
            if d is None:
                btn.setText("")
                btn.setVisible(False)
                continue
            btn.setVisible(True)
            btn.setText(str(d.day()))

            is_start = bool(self._start and d == self._start)
            is_end = bool(self.mode == "range" and self._end and d == self._end)
            selected = is_start or is_end
            in_range = (
                self.mode == "range"
                and bool(self._start and self._end)
                and self._start != self._end
                and self._start <= d <= self._end
                and not selected
            )
            btn.setStyleSheet(_day_btn_style(selected, in_range, d == today))

        self._update_preview()
        self._update_summary()

    def _update_preview(self):
        if self.mode == "single":
            d = self._start
        elif self._active_side == "end":
            d = self._end
        else:
            d = self._start

        if d and d.isValid():
            self._big_mon.setText(d.toString("MMM").upper())
            self._big_day.setText(str(d.day()))
            self._big_year.setText(str(d.year()))
        else:
            self._big_mon.setText("—")
            self._big_day.setText("—")
            self._big_year.setText("—")

        if self.mode == "range" and hasattr(self, "_side_lbl"):
            self._side_lbl.setText("END" if self._active_side == "end" else "START")

    def _update_summary(self):
        if self.mode == "single":
            if self._start:
                self._summary_lbl.setText(self._start.toString("d MMMM yyyy"))
            else:
                self._summary_lbl.setText("Pick a date…")
        else:
            if self._start and self._end:
                days = self._start.daysTo(self._end) + 1
                s = "s" if days != 1 else ""
                self._summary_lbl.setText(
                    f"{self._start.toString('d MMM yyyy')}  →  "
                    f"{self._end.toString('d MMM yyyy')}   ·   {days} day{s}"
                )
            elif self._start:
                self._summary_lbl.setText(
                    f"Start: {self._start.toString('d MMM yyyy')}  ·  pick an end…"
                )
            else:
                self._summary_lbl.setText("Pick a start date…")

    # ------------------------------------------------------------------ helpers

    def _cell_date(self, idx: int) -> "QDate | None":
        # Qt dayOfWeek(): 1=Mon … 7=Sun → offset 0-6
        first_offset = QDate(self._view.year(), self._view.month(), 1).dayOfWeek() - 1
        day = idx - first_offset + 1
        d = QDate(self._view.year(), self._view.month(), day)
        return d if d.isValid() and d.month() == self._view.month() else None

    def _nav(self, delta: int):
        m = self._view.month() + delta
        y = self._view.year()
        while m > 12:
            m -= 12
            y += 1
        while m < 1:
            m += 12
            y -= 1
        self._view = QDate(y, m, 1)
        self._paint()

    def _click(self, idx: int):
        d = self._cell_date(idx)
        if not d:
            return
        if self.mode == "single":
            self._start = d
        elif self._active_side == "start":
            self._start = d
            self._end = d
            self._set_side("end")
        else:
            self._end = d
            if self._start and self._end < self._start:
                self._start, self._end = self._end, self._start
        self._view = QDate(d.year(), d.month(), 1)
        self._paint()

    def _set_side(self, side: str):
        self._active_side = side
        if hasattr(self, "_start_btn"):
            self._start_btn.setChecked(side == "start")
            self._end_btn.setChecked(side == "end")
        self._update_preview()

    def _quick(self, offset: int):
        d = QDate.currentDate().addDays(offset)
        if self.mode == "single":
            self._start = d
        elif self._active_side == "start":
            self._start = d
            self._end = d
            self._set_side("end")
        else:
            self._end = d
            if self._start and self._end < self._start:
                self._start, self._end = self._end, self._start
        self._view = QDate(d.year(), d.month(), 1)
        self._paint()

    def _on_ok(self):
        if self.mode == "single":
            if self._start and self._start.isValid():
                self.result_date = self._start
                self.accept()
        else:
            if self._start and self._end:
                if self._end < self._start:
                    self._start, self._end = self._end, self._start
                self.result_date = (self._start, self._end)
                self.accept()

    def keyPressEvent(self, e: QKeyEvent):
        key = e.key()
        mod = e.modifiers()
        alt = Qt.KeyboardModifier.AltModifier

        if key == Qt.Key.Key_Escape:
            self.reject()
            return
        if key in (Qt.Key.Key_Return, Qt.Key.Key_Enter):
            self._on_ok()
            return
        if key == Qt.Key.Key_Left and (mod & alt):
            self._nav(-1)
            return
        if key == Qt.Key.Key_Right and (mod & alt):
            self._nav(+1)
            return

        offsets = {
            Qt.Key.Key_Left: -1, Qt.Key.Key_Right: +1,
            Qt.Key.Key_Up: -7, Qt.Key.Key_Down: +7,
        }
        if key in offsets:
            new_hot = self._hot.addDays(offsets[key])
            if new_hot.isValid():
                self._hot = new_hot
                if (self._hot.year() != self._view.year()
                        or self._hot.month() != self._view.month()):
                    self._view = QDate(self._hot.year(), self._hot.month(), 1)
                self._click(self._idx_of(self._hot))
            return

        super().keyPressEvent(e)

    def _idx_of(self, d: QDate) -> int:
        if not d or not d.isValid() or d.month() != self._view.month():
            return -1
        first_offset = QDate(self._view.year(), self._view.month(), 1).dayOfWeek() - 1
        return first_offset + d.day() - 1


# ---------------------------------------------------------------------------
# DateButton — drop-in replacement for DateFieldWidget (single date)
# ---------------------------------------------------------------------------

_DATE_BTN_QSS = (
    "QPushButton { background:#FFFFFF; border:1px solid #b8c8d4; border-radius:8px; "
    "padding:4px 8px; color:#42383c; text-align:left; "
    "font-family:'Raleway',sans-serif; font-size:13px; }"
    "QPushButton:hover { border-color:#748ca0; background:#f4f8fc; }"
    "QPushButton:pressed { background:#e8f0f6; }"
)


class DateButton(QWidget):
    """Click-to-open single-date calendar button.

    Drop-in replacement for DateFieldWidget with the same public API:
        date() -> QDate | None
        set_date(QDate | None)
        clear()
        date_changed signal
    """

    date_changed = pyqtSignal()

    def __init__(self, show_today: bool = True, parent=None):
        super().__init__(parent)
        self._date: QDate | None = None

        lay = QHBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(4)

        self._btn = QPushButton("—")
        self._btn.setStyleSheet(_DATE_BTN_QSS)
        self._btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self._btn.clicked.connect(self._open)
        self._btn.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
        lay.addWidget(self._btn, 1)

        if show_today:
            today_btn = QPushButton("Today")
            today_btn.setFlat(True)
            today_btn.setFixedWidth(52)
            today_btn.clicked.connect(self._set_today)
            lay.addWidget(today_btn)

    def _open(self):
        dlg = DatePickerDialog(self.window(), mode="single", start_date=self._date)
        if dlg.exec() == QDialog.DialogCode.Accepted:
            self._date = dlg.result_date
            self._refresh()
            self.date_changed.emit()

    def _set_today(self):
        self.set_date(QDate.currentDate())

    def _refresh(self):
        if self._date and self._date.isValid():
            self._btn.setText(self._date.toString("d MMM yyyy"))
        else:
            self._btn.setText("—")

    # ── public API (same as DateFieldWidget) ──────────────────────────────

    def date(self) -> "QDate | None":
        return self._date if (self._date and self._date.isValid()) else None

    def set_date(self, d: "QDate | None"):
        self._date = d if (d and d.isValid()) else None
        self._refresh()
        self.date_changed.emit()

    def clear(self):
        self.set_date(None)


# ---------------------------------------------------------------------------
# DateRangeButton — single button for the filter panel date-range picker
# ---------------------------------------------------------------------------

_RANGE_BTN_QSS = (
    "QPushButton { background:#FFFFFF; border:1px solid #b8c8d4; border-radius:8px; "
    "padding:5px 10px; color:#42383c; text-align:left; "
    "font-family:'Raleway',sans-serif; font-size:12px; }"
    "QPushButton:hover { border-color:#748ca0; background:#f4f8fc; }"
    "QPushButton:pressed { background:#e8f0f6; }"
)

_CLR_BTN_QSS = (
    "QPushButton { background:transparent; border:none; color:#96aab8; "
    "font-size:13px; padding:0 2px; min-width:0; }"
    "QPushButton:hover { color:#42383c; }"
)


class DateRangeButton(QWidget):
    """Single button that opens a range calendar picker.

    Replaces the two DateFieldWidget instances (date_from / date_to) in the
    filter panel with a cleaner, combined control.

    Public API:
        date_from() -> QDate | None
        date_to()   -> QDate | None
        clear()
        date_changed signal
    """

    date_changed = pyqtSignal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self._start: QDate | None = None
        self._end: QDate | None = None

        lay = QHBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(4)

        self._btn = QPushButton("All dates  ▾")
        self._btn.setStyleSheet(_RANGE_BTN_QSS)
        self._btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self._btn.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
        self._btn.clicked.connect(self._open)
        lay.addWidget(self._btn, 1)

        self._clr = QPushButton("✕")
        self._clr.setStyleSheet(_CLR_BTN_QSS)
        self._clr.setFixedWidth(20)
        self._clr.setToolTip("Clear date filter")
        self._clr.clicked.connect(self.clear)
        self._clr.setVisible(False)
        lay.addWidget(self._clr)

    def _open(self):
        dlg = DatePickerDialog(
            self.window(), mode="range",
            start_date=self._start, end_date=self._end,
        )
        if dlg.exec() == QDialog.DialogCode.Accepted:
            self._start, self._end = dlg.result_date
            self._refresh()
            self.date_changed.emit()

    def _refresh(self):
        if self._start and self._end:
            if self._start == self._end:
                text = self._start.toString("d MMM yyyy") + "  ▾"
            else:
                text = (
                    f"{self._start.toString('d MMM')} – "
                    f"{self._end.toString('d MMM yyyy')}  ▾"
                )
            self._btn.setText(text)
            self._clr.setVisible(True)
        else:
            self._btn.setText("All dates  ▾")
            self._clr.setVisible(False)

    # ── public API ────────────────────────────────────────────────────────

    def date_from(self) -> "QDate | None":
        return self._start

    def date_to(self) -> "QDate | None":
        return self._end

    def clear(self):
        self._start = None
        self._end = None
        self._refresh()
        self.date_changed.emit()

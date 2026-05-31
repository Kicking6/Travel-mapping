#!/bin/bash
# Double-click in Finder to launch GPX Route Manager.
# Pinned to /usr/bin/python3 because that's the interpreter with PyQt6
# installed (in ~/Library/Python/3.9/site-packages).  Do NOT activate any
# virtualenv here — earlier versions sourced an unrelated project's venv
# which didn't have PyQt6 and produced "Could not find the Qt platform
# plugin cocoa" on launch.
cd "$(dirname "$0")"
exec /usr/bin/python3 main.py

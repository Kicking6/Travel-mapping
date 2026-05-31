# GPX OE Trip Editor

A desktop application for importing, organising, and visualising GPX tracks from overland trips.

## Features

- Import GPX files from a folder (including subfolders)
- Interactive map view powered by MapLibre GL
- Edit trip metadata: name, activity type, date, notes, and colour
- Filter and browse tracks by date range or activity type
- Export tracks as GPX or GeoJSON, or save the map as an image
- SQLite database for persistent storage

## Requirements

- Python 3.12+
- macOS (tested on macOS 15)

## Installation

```bash
pip install -r requirements.txt
```

## Usage

```bash
python main.py
```

Or double-click `Launch GPX Manager.command` on macOS.

## Stack

- [PyQt6](https://pypi.org/project/PyQt6/) — UI framework
- [PyQt6-WebEngine](https://pypi.org/project/PyQt6-WebEngine/) — embedded map rendering
- [MapLibre GL JS](https://maplibre.org/) — interactive map
- [gpxpy](https://github.com/tkrajina/gpxpy) — GPX parsing
- SQLite — local data storage

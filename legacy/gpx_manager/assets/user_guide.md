# GPX Route Manager — User Guide

This app is designed to organise the GPX tracks of an overland trip and turn
them into beautiful, print-ready maps for a photo album.

## Quick start

1. **Import** GPX files via **Import Files** or **Import Folder** in the
   toolbar — or just drag-and-drop `.gpx` files anywhere on the window.
2. Click any route in the left-hand list to see it on the map and edit
   its metadata in the bottom panel.
3. Use the **Map Style** drawer (right edge of the map) to make the map
   look the way you want it.
4. When you're ready, click **Export Map Image…** to save a high-resolution
   PNG of any region.

---

## Filtering and selecting routes

The left panel has a filter section above the route table. Filter by:

- Free-text search across notes
- Date range
- Day number range
- Type (drive, walk, ferry, …) — multi-select
- Country / region / segment — multi-select

The route table supports multi-selection — `Cmd-click` to add to selection,
`Shift-click` to range-select, `Cmd-A` to select everything in the current
filter.

---

## Editing metadata

The bottom-right panel edits the metadata for whatever you've selected.

| Field | What it's for |
|---|---|
| **Name** | Display name shown in the table and map tooltip |
| **Date** | ISO date `YYYY-MM-DD` — drives sort order |
| **Day #** | Optional day number within the trip |
| **Type** | Transport type (drive, walk, ferry, …). Sets the default colour. |
| **Country / Region / Segment** | Tags used for filtering |
| **Notes** | Free text |
| **Colour** | Per-route override of the type colour |

When you select **multiple** routes the panel switches to **bulk-edit
mode**. Tick the small checkbox next to any field to apply that field's
value to every selected route. Untouched fields are left alone.

Save flushes to the SQLite database and (optionally) copies the GPX file
into the export folder under a clean filename.

---

## Map controls

The collapsible drawer on the right edge of the map exposes:

- **Basemap** — Carto Dark / Light / Voyager, or OpenStreetMap.
- **Background** — colour shown behind transparent tiles.
- **Tile brightness / saturation / opacity** — fine-tune any basemap.
- **Labels** — show/hide country and city labels, set their opacity, and
  apply a colour tint. Labels can be hidden completely for a totally clean
  look.
- **Routes** — line width, base opacity, and the line width used for
  selected routes.
- **Map chrome** — show/hide the scale bar, attribution text and zoom
  buttons.

Every setting is remembered between sessions.

---

## Exporting a high-resolution map

Click **Export Map Image…** at the bottom of the Map Style drawer.

1. Pick an **aspect ratio** that matches your photo album page (default: 3:2).
2. Pick an **output width in pixels**. 3600 px is the default and gives a
   crisp 12″ wide print at 300 DPI.
3. Click **Position frame on map** — a draggable rectangle locked to your
   chosen aspect ratio appears over the map. Drag the centre to move it,
   drag any corner to resize it. The aspect ratio is locked.
4. Click **Capture**. The app renders the map offscreen at the exact pixel
   size you asked for, then shows a preview.
5. Click **Save PNG…** to write the file wherever you want.

The exported PNG matches the on-screen preview exactly because it uses
the same map.html and the same style settings.

---

## Exporting GeoJSON / GPX

Use **Export GeoJSON / GPX** in the toolbar to export route data
(rather than a rendered image) for use in other tools — Mapbox layers,
Garmin devices, Google Earth, etc.

You can export the current selection, the current filter, or every
route in the library.

---

## Settings

**File → Settings** (or the toolbar **Settings** button) is where you
manage:

- **Transport Types / Countries / Regions / Trip Segments** — the values
  available in the metadata dropdowns.
- **Export Folder** — when set, every save automatically copies the GPX
  into this folder under a clean filename like
  `2025-01-04_Drive_Peru_Day12.gpx`.
- **Map Export** — defaults for the high-res image exporter (width, DPI
  label, aspect, output folder).

---

## Where your data lives

All routes and settings are stored in a single SQLite database at:

```
~/.gpx_manager/routes.db
```

This file persists between sessions — you don't need to re-import
anything when you reopen the app. The status bar at the bottom of the
main window shows the current route count and the database path; click
the path to open the folder in Finder.

To **back up** the library, just copy `routes.db` somewhere safe. To
**move** to a new machine, copy the file to the same location on the new
machine.

---

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Cmd-O` | Import files |
| `Cmd-Shift-O` | Import folder |
| `Cmd-E` | Export GeoJSON / GPX |
| `Cmd-A` | Select all visible routes |
| `Cmd-F` | Fit map to all visible routes |
| `Backspace` | Remove selected routes from library |
| `F1` | Open this user guide |

---

## Troubleshooting

**The map is blank.** Check your internet connection — basemap tiles are
fetched from CDN servers (Carto / OpenStreetMap). The route geometry is
cached locally so routes themselves will still display.

**Routes I imported earlier aren't showing up.** Check the status bar
for the database path. If the route count is zero you may be running
the app under a different user account; the database is per-user.

**My exported PNG is blurry.** Make sure you're not scaling the PNG up
afterwards — the dimensions you choose at export time *are* the final
print dimensions. For a 12″ × 8″ photo album page at 300 DPI you want
3600 × 2400 px or larger.

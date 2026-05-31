# GPX Route Manager — Testing Script

## Setup

```bash
cd "GPX OE Trip Editor"
pip3 install -r requirements.txt
python3 test_data/generate_test_gpx.py   # creates 18 sample GPX files
python3 main.py
```

---

## Test 1: Import from Folder

1. **File → Import Folder…** (Cmd+Shift+O)
2. Navigate to `test_data/sample_trip`
3. **Expected:**
   - 18 routes appear in the left panel list
   - Routes sorted by date
   - "Empty File" row should appear (the empty GPX)
   - A warning dialog should mention `2025-01-09_walk_empty.gpx` has no geometry
   - Bolivia sub-folder files (ferry, drive) should also be imported

---

## Test 2: Map Preview

1. After import, routes should be visible on the dark map (South America region)
2. Hover over different routes in the list
3. **Expected:**
   - The matching route on the map highlights (thicker line)
   - Moving away reverts the highlight
4. Click a single route (e.g. "Lima To Huaraz")
5. **Expected:**
   - Map zooms/fits to that route
   - Route is highlighted with thicker line

---

## Test 3: Multi-Select

1. Hold Cmd and click 3-4 routes in the list
2. **Expected:**
   - All selected routes highlight on the map
   - Map fits to the combined bounds of all selected routes
   - Status bar at the bottom shows selection count + total distance
   - Metadata panel header shows "X routes selected"

---

## Test 4: Filename Auto-Parse

1. Click on "Lima To Huaraz" route
2. **Expected metadata panel values:**
   - Name: "Lima To Huaraz"
   - Date: 2025-01-02
   - Type: drive
3. Click on "Random Drive Back" (the file with no date prefix)
4. **Expected:**
   - Name: "Random Drive Back"
   - Date: empty
   - Type: empty

---

## Test 5: Single Route Metadata Edit

1. Select "Lima To Huaraz"
2. In the metadata panel, set:
   - Country: Peru
   - Region: Ancash
   - Segment: Leg 1
   - Day #: 2
   - Notes: "Long mountain drive, scenic"
3. Click **Save**
4. Deselect, then re-select the route
5. **Expected:** All edited fields are persisted

---

## Test 6: Bulk Metadata Edit

1. Select all Bolivia routes (Cmd+click the ferry and drive)
2. Metadata panel should show "2 routes selected"
3. Tick the checkbox next to "Country", type "Bolivia"
4. Tick the checkbox next to "Segment", type "Leg 2"
5. Click **Apply to 2**
6. Click each Bolivia route individually
7. **Expected:** Both now show Country=Bolivia, Segment=Leg 2

---

## Test 7: Colour Override

1. Select "Lima To Huaraz"
2. Click the colour swatch in the metadata panel
3. Pick a bright red
4. **Expected:**
   - Route immediately turns red on the map
   - List swatch column updates to red
5. Click "Reset to type" button
6. **Expected:** Reverts to default drive blue

---

## Test 8: Filters

1. In the filter panel, check "drive" under Route type
2. **Expected:** Only drive routes visible in list and on map
3. Uncheck "drive", check "walk"
4. **Expected:** Only walk routes visible
5. Clear filters (click "Clear")
6. **Expected:** All routes visible again
7. Set Date from to 2025-01-05, Date to to 2025-01-07
8. **Expected:** Only routes from Jan 5-7 visible

---

## Test 9: Notes Search Filter

1. After Test 5, type "scenic" in the filter notes search box
2. **Expected:** Only "Lima To Huaraz" appears (has that note)
3. Clear the search
4. **Expected:** All routes return

---

## Test 10: GeoJSON Export

1. Select 3-4 routes
2. **File → Export…** (Cmd+E)
3. Choose format: GeoJSON
4. Choose scope: "Selected routes"
5. Browse to Desktop, save as `test_export.geojson`
6. Click **Export**
7. **Expected:** Success dialog showing X features exported
8. **Verify:** Open `test_export.geojson` in a text editor or geojson.io
   - Should be a valid FeatureCollection
   - Each route is a separate Feature
   - Coordinates are [longitude, latitude] (GeoJSON spec)
   - Properties include display_name, date, route_type, distance_km, etc.
   - Sleeping locations are Point geometries
   - Routes are LineString geometries

---

## Test 11: GPX Export

1. Select all routes (Cmd+A)
2. **File → Export…**
3. Choose format: GPX
4. Choose scope: "All routes"
5. Save as `test_export.gpx`
6. Click **Export**
7. **Expected:** Success dialog
8. **Verify:** Open in a GPX viewer — each route is a separate `<trk>`, waypoints are `<wpt>`

---

## Test 12: Drag and Drop

1. Open Finder alongside the app
2. Drag a single `.gpx` file from Finder onto the app window
3. **Expected:** File is imported and appears in the list (if not already present)

---

## Test 13: Remove Route

1. Select a route
2. **Routes → Remove Selected from Library** (Backspace)
3. Confirm the dialog
4. **Expected:** Route removed from list and map. Original file on disk is NOT deleted.

---

## Test 14: Sleeping Locations

1. Find a sleep route (e.g. "Lima Hotel")
2. **Expected:**
   - Appears as a circle marker on the map (not a line)
   - Click the marker on map → shows popup with name
   - Type shown as "sleep" in the list

---

## Test 15: Export Filtered Results

1. Set filter to Country = Peru (after tagging some routes)
2. **File → Export…**
3. Choose scope: "Currently filtered routes"
4. Export as GeoJSON
5. **Expected:** Only Peru-tagged routes in the output file

---

## Edge Cases

- Import the same folder twice → duplicates should not be created
- Very small GPX file (2 points) → should still render
- Empty GPX → warning shown, route in list but no geometry on map
- Non-GPX file drag → should be ignored (not crash)

# Trip Atlas (Travel-mapping)

Rory and Eva's OE trip (Jul 2024 – Sep 2025: USA, Mexico, Peru, Patagonia, Europe, Norway) →
print-quality maps for the photo album. Cloudflare Worker + D1 + R2, plain-JS front end — the same
stack and house style as **Site Scout** (`~/Documents/GitHub/LINZ API Tester`) and **akahu-ledger**.

Feed this file at the start of every session. It describes current state; keep it current.

## Repo

- GitHub: https://github.com/Kicking6/Travel-mapping (private). The rebuild lives on branch
  `rebuild/cloudflare` until it is proven; the PyQt6 desktop app it replaces is in `legacy/` (frozen —
  don't fix it, port from it).
- Only commit when asked. Never commit `.dev.vars`, `.wrangler/`, `node_modules/`.
- `GPX-Files-Raw/` is the trip's source data (committed). See "Data lineage" before importing any of it.

## Structure

- `worker/` — the Worker: `index.js` (routing, sign-in gate), `auth.js` (6-digit email code → 90-day
  session, ported from Site Scout), `pages.js` (sign-in HTML), `email-smtp.js` (byte-identical copy of
  Site Scout's/akahu's Gmail SMTP client), `api/<domain>.js` (routes, trip, maps — each exports
  `handle()` and returns `undefined` for paths it doesn't own; akahu-ledger's dispatcher pattern).
- `web/` — the front end, served only to signed-in people (`run_worker_first = true`).
  - `app.js` router + store + API client; `views/*.js` one per page; `map/atlas.js` the map engine;
    `map/render.js` the print exporter; `app.css` (§1 is Site Scout's tokens/components verbatim).
  - `web/lib/` — **shared code**, imported by the browser, the Worker and the tests:
    `types.js` (transport-type registry), `names.js` (file name → date/type/name), `gpx.js` (GPX/CSV →
    route records), `geo.js` (simplify, polyline, fingerprint, great circle), `style.js` (map style
    spec, defaults, presets, validation), `countries.js` (Natural Earth country lookup),
    `outputs.js` (PNG/JPEG dpi, PDF, SVG, ZIP, GPX/GeoJSON/KML writers), `photos.js` (photo
    placement), `film.js` (the trip film's timeline and camera).
  - Views: `explore` (#/map), `album` (+ `export-dialog`), `styles` (+ `style-controls`, the
    declarative control list shared with an album page's "Look" tab), `draw`, `photos`, `film`,
    `import`, `review`, `settings`, `route-editor`.
  - `web/data/airports.json` — IATA → coords, from the old generator's GlobalAirportDatabase
    (`scripts/build-airports.mjs`, plus EZE which it lacked).
- `migrations/` — D1 schema, numbered. Always add a new migration; never edit an applied one.
- `test/` — `node --test`. `_d1.js` runs every migration on Node's built-in SQLite and drives the real
  Worker (sign-in included). Run before every commit.
- `scripts/import.mjs` — bulk import folders from this Mac (same parser as the Import page).
  `scripts/legacy-style.mjs` — carries the desktop app's tuned look over as a named style.

## Data model (migrations/0001_init.sql)

One shared trip per deployment — no per-user tenancy on trip data; `users` only gates sign-in and
`created_by`/`updated_by` record who changed what.

- `routes` — one journey line. Geometry stored twice as Google encoded polylines of **[lon, lat]**
  (GeoJSON order, everywhere — the legacy app mixed orders across its Python/JS bridge): `geom`
  simplified to the type's tolerance (`types.js`: 4 m walks … 15 m drives) and `geom_lo` at 250 m.
  The whole trip is ~0.6 MB, sent in one ETag'd response keyed on `data_version`.
- `date` + `date_source`: `gps-time` > `filename` > `trip-day` (`trip_start` + N − 1) > `suggested`
  (a guessed year — must be confirmed) > `manual`. Changing `trip_start` re-dates only `trip-day` rows.
- `legs` (named date ranges), `places` (accommodation points, styled by `kind`), `map_styles`
  (JSON spec, shape owned by `web/lib/style.js`), `album_maps` (one printed page: filter, view
  {bounds, camera{center,zoom,bearing,pitch,frameW}}, paper mm + dpi + bleed, style, overrides
  {composition, subtitle, style (per-page partial spec), export (last-used options)}).
- `photos` (0002): one row per original file's sha256; R2 `photos/<sha>-{full,thumb}.jpg`
  (2048 px / 480 px JPEGs made in the browser — originals never upload). `place_source`:
  gps | route-time | route-date | manual | NULL.

## Import rules (worker/api/routes.js `duplicateVerdict`)

Parsing, simplification, hashing and country lookup happen **in the browser** — the Worker never
parses a GPX (10 ms CPU budget). Duplicates are judged against routes with the same start/end
(fingerprint prefix, ~100 m):

- same file hash / identical geometry, or near-identical (length ±2%, points ±15%) **on the same day** → skipped;
- a thinned copy (My Maps CSV, or ≤35% of the points and 50–105% of the length) → skipped;
- length within ~5% otherwise (e.g. same road on two dates) → imported and flagged in `review` for a person;
- same endpoints but a different journey (two walks from one house) → imported, not flagged.

Thresholds come from the real files — thinned copies keep 2–20% of points and 54–99% of length.

## Data lineage (worked out 2026-10-04)

Raw GPX came from mapstogpx.com (Google Maps directions → *planned* routes, one export timestamp) and
Strava/SkiTracks (recorded, timestamped). The old Python "Coordinate Generator"/"Journey Path Combiner"
thinned them (100 m / 10 m) into WKT CSVs for Google My Maps. So:

- **Master set:** `GPX-Files-Raw/June 14 2026 - New data try` + `June 14 2026 - Walking data complete` + `Boat`.
- Also unique: 2 walks in `GPX-Files-Raw/Walking`; the 31 ski days in the generator's
  `Strava/Skiing 0.05km resolution`; 3 flights (re-drawn from airport codes — the old CSV started EZE→YYZ at 0,0).
- Everything else (`Driving/`, `Public Transport/`, the `GPS Data - *.csv` files, generator `Data/`) is
  a copy and is skipped by the rules above. Full import order in `scripts/import.mjs` usage, raw first.
- Known data issues for Review: `Drive from Airport 03-03-2025.gpx` ≡ `Morning_Walk.gpx` (byte-identical,
  one is mislabelled); `May 9`/`May 10 2025 driving` trace the same road; 20 US trail downloads have no
  date (Review suggests one from the drive that passes them).

## Map engine (web/map/atlas.js)

- Every route is **one feature in one GeoJSON source**; colour/width are feature properties computed
  from the style + per-route override; selection/hover/dim are feature-state. Never add a layer per
  route — the legacy app did, and that is why it froze.
- Basemap layers are classified by `source-layer` + filter (`classify()`), never by layer id, so all
  three OpenFreeMap styles (positron/bright/liberty) work with every style knob. Boundaries split by
  the lowest `admin_level` in their filter.

## Map styles

`style.js` owns the spec. A saved style stores only what it has; `resolveStyle()` lays it over
`defaultStyle()`, so a new knob never needs a migration. **Basic** controls (base map, labels, base
lines, per-type route colour/width/dash, places) and **Advanced** (globe projection + atmosphere,
terrain hill-shading from Terrarium DEM tiles + 3D terrain, land-cover classes, coastline/rivers,
visited-country fills + fade-others, typography — fonts, size scale, case, letter-spacing, per-tier
colours —, route glow / gradient (by trip date or along each line) / arrows / end dots / caps,
print finishing — grain, vignette, colour wash, border —, page furniture — title font/size/position,
subtitle, legend, scale bar, north arrow, panel). Eight presets (`PRESETS`). Controls are declared
once in `views/style-controls.js` and rendered for both the Styles page and an album page's Look tab.
Label sizes are scaled by rewriting zoom-curve stops (`map/scale-size.js`) — MapLibre rejects a zoom
curve wrapped in `*`.

## Print export (web/map/render.js)

The legacy exporter screenshotted the window and upscaled it to 10,000 px. Now: an offscreen map laid
out at `composition` CSS px (default 900; the "Map detail" slider) and drawn at
`pixelRatio = printPx / composition`, `maxCanvasSize` 16384, then a `pHYs` chunk stamps the dpi.
Preview uses the same function at screen size — preview = print. Verified: 30 cm @ 300 dpi →
3543 × 3543 px in ~4 s. The card's WebGL limit (`maxRenderSize()`) is checked and explained up front.

Pipeline: `renderMap` (mode all | base | overlay) → finish → decor → encode. Formats: PNG (pHYs dpi),
JPEG (JFIF dpi), WebP, **PDF** (exact mm size, Trim/BleedBox, bleed + crop marks, routes as vector
paths when no glow/gradient, JPEG or lossless-Flate base), **SVG** (vector routes/places in mm, base
map embedded optional — opens in Illustrator), **Layers ZIP** (base, routes, decor as separate
transparent PNGs + composite). Tilted/rotated/globe pages export from the saved camera; its zoom is
rescaled by log₂(layout width / frame width). Route data: GPX / GeoJSON / KML per album page.

## Drawing, photos, film

- **Draw** (#/draw): click waypoints; OSRM on routing.openstreetmap.de (car / foot / bike, fair use)
  or straight lines; saved as `source_kind = manual`.
- **Photos** (#/photos): exifr reads GPS + DateTimeOriginal — never pass exifr a `pick` list, it
  drops GPSLatitudeRef and flips every southern/western photo (verified: Peru → Bay of Bengal).
  Camera times without a zone are local; they're compared with route UTC times using the route's
  longitude, never the browser's zone.
- **Film** (#/film): `lib/film.js` builds the timeline (beats per day/week/leg, √km pacing, glides
  that pull back on long jumps, photo holds, title/end cards). Preview plays it live; Render encodes
  H.264 via WebCodecs + mp4-muxer frame by frame, waiting for tiles with `map.redraw()` polling
  (works even when animation frames are throttled). 4K = 1080p layout at pixelRatio 2. Big renders
  stream to disk via showSaveFilePicker.

## Speed rules

- Filtering never calls `setData`: `atlas.setVisible(ids)` swaps a layer filter (no re-tiling).
- The whole trip's geometry is one ETag'd response; app files are served `Cache-Control: no-cache`
  (cheap 304s) so a deploy can't leave a stale module mixed with new ones.
- Browsers pause maps in hidden tabs/panes — rendering and exports need the tab in front.

## Local development

```
npm run db:local                      # apply migrations to the local D1
npm run dev                           # wrangler dev on :8788
node --test                           # 68 tests, no network
node scripts/import.mjs --email dev@trip-atlas.test --keep-originals <folders…>
```

`.dev.vars` (gitignored): `DEV_SHOW_CODE=1` shows the sign-in code on the page instead of emailing it;
`OPERATOR_EMAILS=dev@trip-atlas.test` keeps real addresses out of local testing.

## Deploy (live since 2026-10-04)

- **https://trip-atlas.rorywadeallen.workers.dev** — Worker `trip-atlas`, D1 `trip-atlas`
  (096324cc-…), R2 `trip-atlas-originals`, account f10b4619… (same as Site Scout).
- Deploy: `npm run deploy` (migrations + deploy, uses the local `wrangler login`; CI=true makes the migration step apply without a prompt — run non-interactively it otherwise silently does nothing). Run `node --test`
  first and don't pipe it through grep — a filtered failure doesn't stop the chain.
- Users: Rory (rorywadeallen@gmail.com) and Eva (evarblok@gmail.com), both admins, both in
  OPERATOR_EMAILS. Gmail addresses are normalised (dots and +tags ignored).
- **Email codes need** `wrangler secret put GMAIL_SMTP_USER` and `GMAIL_SMTP_APP_PASSWORD` (a Gmail
  App Password, set by Rory — never by Claude). Until then the sign-in button goes straight to the code
  screen and `npm run login-code -- <email>` (run by Rory in his terminal) mints a 15-minute code.
- The live data was seeded from the local dev DB (routes, styles, album maps) on 2026-10-04; originals
  were uploaded to R2 under raw/<sha256> with `wrangler r2 object put`.
- Auto-deploy (`.github/workflows/deploy.yml`, pushes to `main`) needs a project-scoped
  `CLOUDFLARE_API_TOKEN` Actions secret, like Site Scout's. Not set up; the branch isn't merged.

## Status (2026-10-04, third pass)

Data wholesale-replaced from ~/Downloads/GPX-Files-Raw "… Renamed for import" folders (+ Strava skiing):
426 routes, 208 stays (OE_Trip_Accommodation_POI.csv, 24 day/month-swapped dates corrected), 17 legs from
trip sections, trip_start 2024-07-23. Added: MCP connector (worker/mcp.js, /mcp + api_tokens), Strava import
(needs STRAVA_CLIENT_ID/SECRET), flights with layovers + OurAirports list (size rank in [5]), Review →
Missing travel (web/lib/travel.js), map detail (coastline = water from capped-zoom tiles, COAST_LEVEL in
atlas.js; baseLevel caps the base source; route simplify), pins (web/lib/pins.js: shapes/glyphs → map
bitmaps, SVG/PDF paths), BRouter hiking in Draw, smoothed film camera + Prerender. Visual checks: headless
Chrome over CDP (a scratch script; the app exposes window.__taMap). Don't draw Natural Earth land as a
GeoJSON fill — antimeridian cuts + tile seams broke it; the capped-water approach replaced it.

## Status (2026-10-04, second pass)

Added: advanced styling + presets, export formats, drawing, photos, trip film, MapLibre 5.24.
Eva (evarblok@gmail.com) is an operator. Not yet visually verified in a browser: globe/terrain/
visited/typography rendering, PDF/SVG/ZIP exports on real data, the film render, drawing — the
logic is unit-tested; the browser pane was hidden during that session.

## Status (2026-10-04, first pass)

Rebuilt end-to-end and verified locally against the real data: 446 routes (443 GPX/CSV after
de-duplication of 1,189 inputs, + 3 flights), 67 queued for Review. Not yet: deployment, Eva's
enrichment data (format unknown — expect a CSV/sheet keyed by route name or date), place/accommodation data.

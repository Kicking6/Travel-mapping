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
    spec, defaults, validation), `countries.js` (Natural Earth country lookup, browser/Node only).
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
  (JSON spec, shape owned by `web/lib/style.js`), `album_maps` (one printed page: filter, view bounds,
  paper mm + dpi, style, overrides incl. `composition`).

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

## Print export (web/map/render.js)

The legacy exporter screenshotted the window and upscaled it to 10,000 px. Now: an offscreen map laid
out at `composition` CSS px (default 900; the "Map detail" slider) and drawn at
`pixelRatio = printPx / composition`, `maxCanvasSize` 16384, then a `pHYs` chunk stamps the dpi.
Preview uses the same function at screen size — preview = print. Verified: 30 cm @ 300 dpi →
3543 × 3543 px in ~4 s. The card's WebGL limit (`maxRenderSize()`) is checked and explained up front.

## Local development

```
npm run db:local                      # apply migrations to the local D1
npm run dev                           # wrangler dev on :8788
node --test                           # 45 tests, no network
node scripts/import.mjs --email dev@trip-atlas.test --keep-originals <folders…>
```

`.dev.vars` (gitignored): `DEV_SHOW_CODE=1` shows the sign-in code on the page instead of emailing it;
`OPERATOR_EMAILS=dev@trip-atlas.test` keeps real addresses out of local testing.

## Deploy (not yet done — needs Rory)

1. `npx wrangler d1 create trip-atlas` → put the id in `wrangler.toml`; `npx wrangler r2 bucket create trip-atlas-originals`.
2. `wrangler secret put GMAIL_SMTP_USER` / `GMAIL_SMTP_APP_PASSWORD` (same sender pattern as Site Scout).
3. `npm run deploy`, then sign in as an `OPERATOR_EMAILS` address and add Eva in Trip & people.
4. Optional auto-deploy: `.github/workflows/deploy.yml` (pushes to `main`), needs the
   `CLOUDFLARE_API_TOKEN` Actions secret scoped to this project only, like Site Scout's.

## Status (2026-10-04)

Rebuilt end-to-end and verified locally against the real data: 446 routes (443 GPX/CSV after
de-duplication of 1,189 inputs, + 3 flights), 67 queued for Review. Not yet: deployment, Eva's
enrichment data (format unknown — expect a CSV/sheet keyed by route name or date), place/accommodation data.

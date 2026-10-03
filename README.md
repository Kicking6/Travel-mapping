# Trip Atlas

Our OE's routes — drives, hikes, buses, ferries, flights, ski days — on one map, tidied up, and printed
as sharp, full-resolution maps for the photo album.

- **Map** — every route of the trip; filter by dates, leg or transport; click a line or a row to edit it
  (one or many at once).
- **Album** — one album map per page: pick the dates/legs/countries, the paper size and dpi, frame it,
  preview, export a print-ready PNG (e.g. 30 × 30 cm at 300 dpi = 3543 × 3543 px).
- **Import** — drop GPX files, Google My Maps CSVs or whole folders. Dates come from the GPS recording
  or the file name ("18:05:2025", "August 02 2025", "day 103 busing"); duplicates and thinned copies
  are caught automatically. Add flights by airport code. Places (accommodation) from a CSV.
- **Review** — what needs a person: no date (with a suggested one), guessed years, possible
  duplicates, unknown transport type, no country.
- **Map styles** — land, water, labels, borders, roads, and a colour/width/pattern per transport type;
  plus an **Advanced** menu: globe, terrain shading, 3D terrain, land cover, countries-we-visited fills,
  typography, route glow / gradients / arrows, paper grain and vignette, title, legend, scale bar,
  north arrow — and eight designer presets.
- **Export** — PNG, JPEG, WebP, print-ready PDF (bleed, crop marks, vector routes), SVG for
  Illustrator, or a ZIP of separate transparent layers; any paper size, 72–600 dpi; route data as
  GPX / GeoJSON / KML.
- **Draw** — add a route by clicking: it follows roads, paths or cycle routes, or straight lines.
- **Photos** — drop photos and they're placed on the map by GPS, by time along the route you were
  on, or by date.
- **Film** — the trip as a video: the routes draw themselves in order, the camera flies between
  places, photos pop up; MP4 up to 4K/60, 16:9, square, 4:5 or vertical.

Built like Site Scout and akahu-ledger: a Cloudflare Worker with D1 and R2, plain JavaScript, no build
step. Sign-in is a 6-digit code by email. See [CLAUDE.md](CLAUDE.md) for how it works and how to run it.

The previous desktop app (PyQt6) is kept in [legacy/](legacy/) for reference.

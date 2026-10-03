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
- **Map styles** — land, water, labels, borders, roads, and a colour/width per transport type.

Built like Site Scout and akahu-ledger: a Cloudflare Worker with D1 and R2, plain JavaScript, no build
step. Sign-in is a 6-digit code by email. See [CLAUDE.md](CLAUDE.md) for how it works and how to run it.

The previous desktop app (PyQt6) is kept in [legacy/](legacy/) for reference.

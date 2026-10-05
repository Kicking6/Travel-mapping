-- 2026-10-05: routes are plain lines — no dot where a walk sits at a drive's end.
-- Saved presets store the whole spec, so the new default (routeFx.walkPoi.show = false)
-- wouldn't reach them; switch it off in every saved preset and album-page override.
-- It stays available under Presets → More options → Route palettes & edges.
UPDATE map_styles
   SET spec = json_set(spec, '$.routeFx.walkPoi.show', json('false')), updated_at = datetime('now')
 WHERE json_valid(spec) AND json_extract(spec, '$.routeFx.walkPoi.show') = 1;

UPDATE album_maps
   SET overrides = json_set(overrides, '$.style.routeFx.walkPoi.show', json('false'))
 WHERE json_valid(overrides) AND json_extract(overrides, '$.style.routeFx.walkPoi.show') = 1;

#!/usr/bin/env bash
# Pulls open in-app feedback (user_feedback, migration 0004) from PRODUCTION
# D1 and downloads each report's screenshot from R2 (trip-atlas-originals,
# under feedback/). Read-only against production. Adapted from Site Scout's
# .claude/skills/linz-feedback/fetch-feedback.sh.
#
#   fetch-feedback.sh [OUT_DIR] [STATUS_FILTER]
#     OUT_DIR        where to write feedback.json + <id>.png (default: a mktemp dir)
#     STATUS_FILTER  SQL list for status (default: 'new','triaged')
#
# Screenshots can show Rory and Eva's real trip, photos and locations — keep
# them in the session scratchpad, never in the repo, and delete when done.
set -euo pipefail
OUT="${1:-$(mktemp -d)}"
STATUSES="${2:-'new','triaged'}"
REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$REPO_ROOT"
mkdir -p "$OUT"

npx -y wrangler@4.142.0 d1 execute trip-atlas --remote --json --command "
  SELECT id, author_email, body, kind, criticality, status,
         route, element_label, subject_type, subject_id, screenshot_key, app_version,
         created_at, updated_at, edited_since_triage, resolved_at, resolution_note, context
    FROM user_feedback
   WHERE deleted_at IS NULL AND status IN (${STATUSES})
   ORDER BY id" 2>/dev/null > "$OUT/raw.json"

python3 - "$OUT" <<'PY'
import json, sys, os
out = sys.argv[1]
rows = json.load(open(os.path.join(out, 'raw.json')))[0]['results']
for r in rows:
    try: r['context'] = json.loads(r['context'] or '{}')
    except Exception: pass
    r['code'] = 'TA-' + str(r['id'])
json.dump(rows, open(os.path.join(out, 'feedback.json'), 'w'), indent=1)
os.remove(os.path.join(out, 'raw.json'))
for r in rows:
    print(f"{r['code']} [{r['status']}/{r['kind']}/{r['criticality']}] {r['author_email']} {r['created_at']}")
    print(f"   {r['body']}")
    if r.get('screenshot_key'): print(f"   screenshot: {r['screenshot_key']}")
open(os.path.join(out, 'keys.txt'), 'w').write(
    '\n'.join(f"{r['id']} {r['screenshot_key']}" for r in rows if r.get('screenshot_key')))
PY

while read -r id key || [ -n "${id:-}" ]; do
  [ -n "${key:-}" ] || continue
  npx -y wrangler@4.142.0 r2 object get "trip-atlas-originals/$key" --file="$OUT/$id.png" --remote >/dev/null 2>&1 \
    && echo "downloaded $OUT/$id.png" || echo "screenshot $key: download failed"
done < "$OUT/keys.txt"
rm -f "$OUT/keys.txt"
echo "OUT=$OUT"

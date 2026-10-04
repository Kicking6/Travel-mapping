---
name: trip-feedback
description: >
  Process the in-app feedback Rory and Eva leave through the ✎ Feedback button
  / Shift+F (Feedback → Mine and Everyone's; table user_feedback): pull every
  open report with its screenshot and captured context from production, trace
  each one to the code or the data, fix what is fixable, and report back on the
  rest. Use when the user says "check my feedback", "process feedback", "what
  has Eva reported", or invokes /trip-feedback.
---

# Processing in-app feedback

Adapted from Site Scout's `/linz-feedback` skill (itself from the Akahu app).
Every report has a short code (`TA-<id>`) and a criticality
(`low`/`medium`/`high`/`critical`); filing one as `critical` already emails the
other person the moment it lands.

Feedback lives in production D1 (`user_feedback`, `migrations/0004_feedback.sql`)
with screenshots in the R2 bucket `trip-atlas-originals` under `feedback/`.
Code: `worker/feedback.js` (rules), `worker/api/feedback.js` (routes),
`web/feedback.js` (capture widget + screenshot editor), `web/diag.js` (error
buffer), `web/views/feedback.js` (Mine / Everyone's). The Claude connector has
`list_feedback` and `reply_feedback` too. Everything here is read-only against
production until step 4. Screenshots show the real trip — keep them in the
session scratchpad, never in the repo, and delete them at the end.

## 1. Pull the open reports

```bash
.claude/skills/trip-feedback/fetch-feedback.sh "<scratchpad>/feedback"
```

Writes `feedback.json` (every `new`/`triaged` row, `context` parsed, `code`
filled in) and `<id>.png` per screenshot. **Read every screenshot** — the typed
text is often vague, and the screenshot (highlights, crop) is where the real
complaint usually is.

## 2. Read the context, not only the text

`context` (see `buildContext` in `web/feedback.js`):

- `who`: `loginEmail`, `isAdmin` (both people are admins).
- `where`: `hash` places it on a page (`#/map`, `#/album/3`, `#/styles/1`,
  `#/draw`…); `map` is the camera (`center` [lon, lat], `zoom`, `bearing`,
  `pitch`) when a map was on screen — open the same view to reproduce.
- `what`: `selector` + `label` identify the clicked element. `subjectType` /
  `subjectId` name the thing: `route` (a route id — also when the click was on
  a line on the map), `place`, `photo`, `leg`, `style_setting` (a style knob's
  path, e.g. `detail.routeSimplify`), or `map_point` ("lat,lon" under the
  pointer).
- `diagnostics.net` / `.console`: failed or slow requests and errors from
  before the report. A 4xx/5xx right before `who.at` is often the real bug.

## 3. Trace each report to a cause

- Data questions (a wrong date, a missing route): query the real rows
  read-only — `npx -y wrangler@4.142.0 d1 execute trip-atlas --remote --json
  --command "SELECT …"`. Only SELECT. Many reports here are about the trip's
  data, not the code; the day-by-day sheet (see memory / CLAUDE.md) is the
  source of truth for where each night was.
- Code questions: grep the selector / `data-path` / view from `where.hash`.

| Bucket | Meaning | Action |
|---|---|---|
| **Fix** | Clear defect (code or data) with a contained cause | Fix it now (step 4) |
| **Not a bug** | Works as designed, or a setting does it | Explain — and say where the setting is |
| **Needs a decision** | A product call, or a data question only they can answer | Write up the options; don't build |
| **Idea** | Feature request | Summarise scope and where it would live; don't build unless asked |

## 4. Fix

- `npm test` must stay green.
- Verify UI fixes in the local Worker (`npm run dev`, port 8788; headless
  Chrome over CDP works when the browser pane is hidden — the app exposes
  `window.__taMap`).
- Put the feedback code in a comment next to a code fix (`TA-12`).
- Data fixes go through the API/MCP or a reviewed SQL file, never ad hoc;
  keep a backup of the rows first.

## 5. Ship

Ask before committing, pushing or deploying (`npm run deploy` applies
migrations and deploys). Confirm the deploy succeeded (the live file or route
answers) before step 6.

## 6. Close the loop (ask first, after a successful deploy)

A reply and status show on the author's Feedback page. Only write one once the
fix is live **and** the user said you may reply to that report. Prefer the
connector's `reply_feedback` or a targeted `UPDATE … WHERE id = <id>` (the
same statement `setFeedbackStatus` / `setFeedbackReply` runs) over clicking
through the UI:

```sql
UPDATE user_feedback SET status = 'done', resolved_at = datetime('now'),
  edited_since_triage = 0, resolution_note = '<what changed; that it is live>',
  reply_at = datetime('now')
WHERE id = <id>;
```

## 7. Report back

One table: `code · who · what they said · cause · outcome`, grouped by bucket.
Say which fixes were checked in a browser and which only by tests, and list the
needs-a-decision items with the actual choice. Delete the scratchpad folder.

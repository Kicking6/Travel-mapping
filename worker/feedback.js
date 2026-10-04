// In-app feedback — adapted from Site Scout (LINZ API Tester/worker/feedback.js),
// which ported it from the Akahu app (IN_APP_FEEDBACK_DESIGN.md). Same rules:
// the captured context is the value and is immutable evidence; the author may
// edit their text or withdraw a report; screenshots are hard-capped well below
// R2's free tier; a reply shows up for the author in Feedback → Mine.
//
// Trip Atlas differences: codes are TA-<id>; screenshots live in the
// originals bucket under feedback/ (no second bucket to create); both people
// are admins, so "triage" is just the shared inbox.

export const KINDS = ['bug', 'idea', 'question'];
export const STATUSES = ['new', 'triaged', 'done', 'wontfix'];
export const CRITICALITIES = ['low', 'medium', 'high', 'critical'];
export const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;
export const MAX_BODY_CHARS = 4000;
const MAX_CONTEXT_CHARS = 64 * 1024;
// Screenshots share the originals bucket, under feedback/.
const bucket = (env) => env.FEEDBACK || env.ORIGINALS || null;

// A short, stable reference so a report can be pointed at in conversation
// ("TA-12") without inventing a second id to keep in sync with the first.
export function feedbackCode(id) {
  return 'TA-' + id;
}

// Billing guard, not tidiness: past this `put` is never called. The report
// still saves; the user is told why the image didn't.
export const STORAGE_HARD_STOP_BYTES = 2 * 1024 * 1024 * 1024;       // 2GB
export const STORAGE_ABSOLUTE_CEILING_BYTES = 10 * 1024 * 1024 * 1024; // R2 free tier — never reach it

export async function feedbackStorageBytes(env) {
  const row = await env.DB.prepare(
    'SELECT COALESCE(SUM(screenshot_bytes), 0) AS n FROM user_feedback WHERE screenshot_key IS NOT NULL AND deleted_at IS NULL'
  ).first();
  return Number(row && row.n) || 0;
}

export function storageVerdict(currentBytes, incomingBytes) {
  const after = currentBytes + incomingBytes;
  if (currentBytes >= STORAGE_HARD_STOP_BYTES) return { allowed: false, reason: 'hard_stop', currentBytes, after };
  if (after > STORAGE_ABSOLUTE_CEILING_BYTES) return { allowed: false, reason: 'absolute_ceiling', currentBytes, after };
  // Refuse the upload that would CROSS the line, so the stop point doesn't
  // depend on the size of whichever image happened to arrive last.
  if (after > STORAGE_HARD_STOP_BYTES) return { allowed: false, reason: 'would_cross', currentBytes, after };
  return { allowed: true, currentBytes, after };
}

export { bucket as feedbackBucket };

export function decodeDataUrl(dataUrl) {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || '').trim());
  if (!m) return null;
  const binary = atob(m[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  if (bytes.length > MAX_SCREENSHOT_BYTES) return null;
  return { contentType: m[1], bytes };
}

function denormaliseContext(context) {
  const c = context && typeof context === 'object' ? context : {};
  const where = c.where || {};
  const what = c.what || {};
  return {
    route: [where.pathname || '', where.hash || ''].join('').slice(0, 500) || null,
    elementLabel: what.label ? String(what.label).slice(0, 200) : null,
    subjectType: what.subjectType ? String(what.subjectType).slice(0, 40) : null,
    subjectId: what.subjectId != null ? String(what.subjectId).slice(0, 120) : null,
  };
}

function clampContext(context) {
  let json = JSON.stringify(context || {});
  if (json.length <= MAX_CONTEXT_CHARS) return json;
  // Drop the diagnostic buffer first — where/what are what make it reproducible.
  const c = { ...(context || {}) };
  if (c.diagnostics) {
    c.diagnostics = { truncated: true, note: 'dropped: context exceeded size cap' };
    json = JSON.stringify(c);
  }
  return json.slice(0, MAX_CONTEXT_CHARS);
}

export async function createFeedback(env, { authorEmail, body, kind, criticality, context, screenshot }) {
  const text = String(body || '').trim();
  if (!text) return { ok: false, error: 'Tell us what happened first.' };
  const d = denormaliseContext(context);
  const crit = CRITICALITIES.includes(criticality) ? criticality : 'medium';
  const res = await env.DB.prepare(
    `INSERT INTO user_feedback (author_email, body, kind, criticality, context, route, element_label, subject_type, subject_id, app_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    authorEmail, text.slice(0, MAX_BODY_CHARS), KINDS.includes(kind) ? kind : null, crit,
    clampContext(context), d.route, d.elementLabel, d.subjectType, d.subjectId,
    (env.CF_VERSION_METADATA && env.CF_VERSION_METADATA.id) || null
  ).run();
  const id = res.meta.last_row_id;

  let screenshotError = null;
  if (screenshot) {
    const decoded = decodeDataUrl(screenshot);
    if (!decoded) {
      screenshotError = 'The screenshot couldn’t be read, so the report was saved without it.';
    } else if (!bucket(env)) {
      screenshotError = 'Screenshot storage isn’t set up yet, so the report was saved without the image.';
    } else {
      const verdict = storageVerdict(await feedbackStorageBytes(env), decoded.bytes.length);
      if (!verdict.allowed) {
        screenshotError = 'Screenshot storage is full, so the image wasn’t saved — your report was.';
        console.log('feedback screenshot REFUSED:', JSON.stringify(verdict));
      } else {
        try {
          const key = `feedback/${id}.png`;
          await bucket(env).put(key, decoded.bytes, { httpMetadata: { contentType: decoded.contentType } });
          await env.DB.prepare('UPDATE user_feedback SET screenshot_key = ?, screenshot_bytes = ? WHERE id = ?')
            .bind(key, decoded.bytes.length, id).run();
        } catch (e) {
          screenshotError = 'The screenshot failed to upload, so the report was saved without it.';
        }
      }
    }
  }
  return { ok: true, id, code: feedbackCode(id), criticality: crit, screenshotError };
}

export async function listFeedback(env, { authorEmail = null, status = null, kind = null, limit = 200 } = {}) {
  const where = ['deleted_at IS NULL'];
  const binds = [];
  if (authorEmail) { where.push('author_email = ?'); binds.push(authorEmail); }
  if (status && STATUSES.includes(status)) { where.push('status = ?'); binds.push(status); }
  if (kind && KINDS.includes(kind)) { where.push('kind = ?'); binds.push(kind); }
  binds.push(Math.min(Number(limit) || 200, 500));
  const rows = await env.DB.prepare(
    `SELECT id, author_email, body, kind, criticality, route, element_label, subject_type, subject_id, context,
            screenshot_key, screenshot_bytes, status, resolution_note, reply_at, app_version,
            created_at, updated_at, edited_since_triage, resolved_at
       FROM user_feedback WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?`
  ).bind(...binds).all();
  return (rows.results || []).map((r) => ({ ...r, code: feedbackCode(r.id) }));
}

export async function getFeedback(env, id, { authorEmail = null } = {}) {
  const row = await env.DB.prepare('SELECT * FROM user_feedback WHERE id = ? AND deleted_at IS NULL').bind(Number(id)).first();
  if (!row) return null;
  if (authorEmail && row.author_email !== authorEmail) return null;
  return { ...row, code: feedbackCode(row.id) };
}

/** Author edit: body, kind and criticality. An edit after triage flags rather than silently reopening. */
export async function editFeedback(env, { id, authorEmail, body, kind, criticality }) {
  const row = await getFeedback(env, id, { authorEmail });
  if (!row) return { ok: false, error: 'That report no longer exists.' };
  const text = String(body == null ? row.body : body).trim();
  if (!text) return { ok: false, error: 'A report needs some text.' };
  const newKind = KINDS.includes(kind) ? kind : row.kind;
  const newCriticality = CRITICALITIES.includes(criticality) ? criticality : row.criticality;
  await env.DB.prepare(
    `UPDATE user_feedback SET body = ?, kind = ?, criticality = ?, updated_at = datetime('now'),
            edited_since_triage = CASE WHEN status <> 'new' THEN 1 ELSE edited_since_triage END
      WHERE id = ?`
  ).bind(text.slice(0, MAX_BODY_CHARS), newKind, newCriticality, row.id).run();
  return { ok: true };
}

/** Soft delete; the screenshot goes immediately. */
export async function deleteFeedback(env, { id, authorEmail }) {
  const row = await getFeedback(env, id, { authorEmail });
  if (!row) return { ok: false, error: 'That report no longer exists.' };
  if (row.screenshot_key && bucket(env)) { try { await bucket(env).delete(row.screenshot_key); } catch (_) {} }
  await env.DB.prepare("UPDATE user_feedback SET deleted_at = datetime('now'), screenshot_key = NULL WHERE id = ?").bind(row.id).run();
  return { ok: true };
}

export async function setFeedbackStatus(env, { id, status, note }) {
  if (!STATUSES.includes(status)) return { ok: false, error: 'Unknown status.' };
  const row = await getFeedback(env, id);
  if (!row) return { ok: false, error: 'That report no longer exists.' };
  const resolved = status === 'done' || status === 'wontfix';
  await env.DB.prepare(
    `UPDATE user_feedback SET status = ?, resolved_at = ${resolved ? "datetime('now')" : 'NULL'}, edited_since_triage = 0 WHERE id = ?`
  ).bind(status, row.id).run();
  if (note != null && String(note).trim() && String(note).trim() !== (row.resolution_note || '')) {
    await setFeedbackReply(env, { id, note });
  }
  return { ok: true };
}

export async function setFeedbackReply(env, { id, note }) {
  const text = String(note == null ? '' : note).trim();
  if (!text) return { ok: false, error: 'Write a reply first.' };
  const row = await getFeedback(env, id);
  if (!row) return { ok: false, error: 'That report no longer exists.' };
  await env.DB.prepare("UPDATE user_feedback SET resolution_note = ?, reply_at = datetime('now') WHERE id = ?")
    .bind(text.slice(0, 2000), row.id).run();
  return { ok: true };
}

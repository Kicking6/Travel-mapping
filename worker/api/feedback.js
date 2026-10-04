// /api/feedback — in-app feedback (worker/feedback.js holds the rules).
// Same routes as Site Scout: an author files, lists, edits and withdraws their
// own reports; an admin sees everyone's, sets status and replies. Both of us
// are admins here, so the inbox is shared.
import { json, err, readJson } from './shared.js';
import { operatorEmails } from '../auth.js';
import { sendViaGmailSmtp } from '../email-smtp.js';
import {
  createFeedback, listFeedback, getFeedback, editFeedback, deleteFeedback,
  setFeedbackStatus, setFeedbackReply, feedbackStorageBytes, feedbackBucket, KINDS, STATUSES, CRITICALITIES,
  STORAGE_HARD_STOP_BYTES,
} from '../feedback.js';

const parse = (s, d) => { try { return JSON.parse(s); } catch (_) { return d; } };

// A critical report emails the other admins straight away. Best-effort: a send
// failure must never fail the report itself.
async function sendCriticalEmail(env, { id, code, authorEmail, body, route, origin }) {
  if (!(env.GMAIL_SMTP_USER && env.GMAIL_SMTP_APP_PASSWORD)) return;
  const to = operatorEmails(env).filter((e) => e !== authorEmail);
  const e = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;max-width:520px;color:#16202b">
    <h2 style="font-size:19px;margin:0 0 10px;color:#b3261e">Critical: ${e(code)}</h2>
    <p style="font-size:14px;line-height:1.55;color:#3a4553">${e(authorEmail)} just filed this as <strong>critical</strong>${route ? ' on ' + e(route) : ''}:</p>
    <p style="font-size:14px;line-height:1.5;background:#f4f1ec;padding:10px 14px;border-radius:8px;white-space:pre-wrap">${e(body).slice(0, 1000)}</p>
    <p style="margin:18px 0 8px"><a href="${e(origin)}/#/feedback/all/${Number(id)}" style="display:inline-block;background:#1c5d8c;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:8px">Open ${e(code)} in Trip Atlas →</a></p></div>`;
  for (const address of to) {
    try {
      await sendViaGmailSmtp({ user: env.GMAIL_SMTP_USER, appPassword: env.GMAIL_SMTP_APP_PASSWORD, to: address, subject: `🔴 Critical: ${code} — ${String(body || '').slice(0, 60)}`, html, text: String(body || '') });
    } catch (x) { console.log('critical feedback email failed for', address, x.message); }
  }
}

// Badge counts for the app shell, in one read.
export async function feedbackCounts(env, user) {
  const r = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM user_feedback WHERE author_email = ?1 AND deleted_at IS NULL
          AND reply_at IS NOT NULL AND (?2 IS NULL OR reply_at > ?2)) AS unread,
       CASE WHEN ?3 THEN (SELECT COUNT(*) FROM user_feedback WHERE status = 'new' AND deleted_at IS NULL AND author_email <> ?1) ELSE 0 END AS fresh`
  ).bind(user.email, user.feedback_seen_at || null, user.is_admin ? 1 : 0).first();
  return { unreadReplies: (r && r.unread) || 0, adminNewFeedback: (r && r.fresh) || 0 };
}

export async function handle(request, env, url, user) {
  const p = url.pathname, m = request.method;
  if (!p.startsWith('/api/feedback')) return undefined;

  if (p === '/api/feedback' && m === 'POST') {
    const b = await readJson(request, 12 * 1024 * 1024);
    const r = await createFeedback(env, { authorEmail: user.email, body: b.body, kind: b.kind, criticality: b.criticality, context: b.context, screenshot: b.screenshot });
    if (r.ok && r.criticality === 'critical') {
      const w = b.context && b.context.where;
      await sendCriticalEmail(env, { id: r.id, code: r.code, origin: url.origin, authorEmail: user.email, body: b.body, route: w && (w.pathname + (w.hash || '')) }).catch(() => {});
    }
    return r.ok ? json(r) : err(r.error);
  }
  if (p === '/api/feedback' && m === 'GET') {
    const seen = (await env.DB.prepare('SELECT feedback_seen_at FROM users WHERE email = ?').bind(user.email).first() || {}).feedback_seen_at || null;
    const reports = await listFeedback(env, { authorEmail: user.email });
    // Opening the list is what marks replies read — written only if there's something unread.
    if (reports.some((r) => r.reply_at && (!seen || r.reply_at > seen))) {
      await env.DB.prepare("UPDATE users SET feedback_seen_at = datetime('now') WHERE email = ?").bind(user.email).run();
    }
    return json({ reports: reports.map(({ context, ...r }) => r), kinds: KINDS, statuses: STATUSES, criticalities: CRITICALITIES, seenBefore: seen });
  }
  if (p === '/api/feedback/counts' && m === 'GET') {
    const seen = (await env.DB.prepare('SELECT feedback_seen_at FROM users WHERE email = ?').bind(user.email).first() || {}).feedback_seen_at || null;
    return json(await feedbackCounts(env, { ...user, feedback_seen_at: seen }));
  }
  const one = p.match(/^\/api\/feedback\/(\d+)$/);
  if (one && m === 'PATCH') {
    const b = await readJson(request);
    const r = await editFeedback(env, { id: one[1], authorEmail: user.email, body: b.body, kind: b.kind, criticality: b.criticality });
    return r.ok ? json(r) : err(r.error);
  }
  if (one && m === 'DELETE') {
    const r = await deleteFeedback(env, { id: one[1], authorEmail: user.email });
    return r.ok ? json(r) : err(r.error);
  }
  const shot = p.match(/^\/api\/feedback\/(\d+)\/screenshot$/);
  if (shot && m === 'GET') {
    const row = await getFeedback(env, shot[1], user.is_admin ? {} : { authorEmail: user.email });
    const bucket = feedbackBucket(env);
    if (!row || !row.screenshot_key || !bucket) return err('Not found', 404);
    const obj = await bucket.get(row.screenshot_key);
    if (!obj) return err('Not found', 404);
    return new Response(obj.body, { headers: { 'Content-Type': (obj.httpMetadata && obj.httpMetadata.contentType) || 'image/png', 'Cache-Control': 'private, max-age=600' } });
  }

  // ── Admin ──
  if (!user.is_admin) return err('Not found', 404);
  if (p === '/api/feedback/all' && m === 'GET') {
    const reports = await listFeedback(env, { status: url.searchParams.get('status'), kind: url.searchParams.get('kind'), limit: 300 });
    const bytes = await feedbackStorageBytes(env);
    return json({ reports: reports.map((r) => ({ ...r, context: parse(r.context, {}) })), storage: { bytes, limit: STORAGE_HARD_STOP_BYTES } });
  }
  const st = p.match(/^\/api\/feedback\/(\d+)\/status$/);
  if (st && m === 'PUT') {
    const b = await readJson(request);
    const r = await setFeedbackStatus(env, { id: st[1], status: b.status, note: b.note });
    return r.ok ? json(r) : err(r.error);
  }
  const rp = p.match(/^\/api\/feedback\/(\d+)\/reply$/);
  if (rp && m === 'PUT') {
    const b = await readJson(request);
    const r = await setFeedbackReply(env, { id: rp[1], note: b.note });
    return r.ok ? json(r) : err(r.error);
  }
  return undefined;
}

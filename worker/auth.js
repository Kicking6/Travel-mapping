// Sign-in, the Site Scout way (worker/auth.js there), cut down to two people.
//
// Who may sign in is the `users` table (Settings → People) plus OPERATOR_EMAILS,
// who are let in on first use. Getting in: enter your email, receive a 6-digit
// code (Gmail SMTP, worker/email-smtp.js), type it back → 90-day session cookie.
// Codes, not links: mail filters pre-open links and burn them.
//
// In local dev (DEV_SHOW_CODE=1 in .dev.vars) the code is shown on the page
// instead of emailed, so the app can be run with no mail account at all.

export const SESSION_COOKIE = 'ta_session';
const SESSION_DAYS = 90;
export const CODE_MINUTES = 15;
const CODE_MAX_ATTEMPTS = 5;
const CACHE_TTL_MS = 30 * 1000;

export function operatorEmails(env) {
  return String(env.OPERATOR_EMAILS || '').split(',').map((s) => normaliseEmail(s)).filter(Boolean);
}

// Gmail ignores dots and "+tags" in the local part, so rorywade.allen@ and
// rorywadeallen@ are one inbox — and must be one person here.
export function normaliseEmail(e) {
  let s = String(e || '').trim().toLowerCase();
  if (!(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254)) return null;
  const [local, domain] = s.split('@');
  if (domain === 'gmail.com' || domain === 'googlemail.com') s = `${local.split('+')[0].replace(/\./g, '')}@gmail.com`;
  return s;
}

function randomToken() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function readCookie(request, name) {
  for (const part of (request.headers.get('Cookie') || '').split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1);
  }
  return null;
}

const secure = (request) => (new URL(request.url).protocol === 'https:' ? '; Secure' : '');
export const sessionCookie = (token, request) =>
  `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure(request)}`;
export const clearedCookie = (request) => `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure(request)}`;

// One indexed read per request, cached per isolate for 30 s, so a page that
// fires ten API calls costs one D1 read for identity.
const cache = new Map();
export function forgetAll() { cache.clear(); }

export async function identify(request, env) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token || !/^[A-Za-z0-9_-]{30,60}$/.test(token)) return null;
  const hash = await sha256Hex(token);
  const hit = cache.get(hash);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.user;
  const user = await env.DB.prepare(
    `SELECT u.email, u.name, u.is_admin, u.settings FROM sessions s JOIN users u ON u.email = s.email
      WHERE s.token_hash = ? AND s.expires_at > datetime('now') AND u.status = 'active'`
  ).bind(hash).first();
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  cache.set(hash, { user, at: Date.now() });
  return user;
}

export async function mayUse(env, email) {
  const row = await env.DB.prepare('SELECT status FROM users WHERE email = ?').bind(email).first();
  if (row) return row.status === 'active';
  return operatorEmails(env).includes(email);
}

async function ensureUser(env, email) {
  const admin = operatorEmails(env).includes(email) ? 1 : 0;
  await env.DB.prepare('INSERT OR IGNORE INTO users (email, is_admin) VALUES (?, ?)').bind(email, admin).run();
}

const codeHash = (email, code) => sha256Hex(`${email}:${code}`);

export async function createLoginCode(env, email) {
  const n = new Uint32Array(1);
  crypto.getRandomValues(n);
  const code = String(n[0] % 1000000).padStart(6, '0');
  await env.DB.batch([
    env.DB.prepare("UPDATE login_codes SET used_at = datetime('now') WHERE email = ? AND used_at IS NULL").bind(email),
    env.DB.prepare(`INSERT INTO login_codes (email, code_hash, expires_at) VALUES (?, ?, datetime('now', '+${CODE_MINUTES} minutes'))`)
      .bind(email, await codeHash(email, code)),
  ]);
  return code;
}

/** true when the code matches the address's live code; burns it on success. */
export async function consumeLoginCode(env, email, code) {
  if (!/^\d{6}$/.test(code || '')) return false;
  const row = await env.DB.prepare(
    `SELECT id, code_hash FROM login_codes WHERE email = ? AND used_at IS NULL AND expires_at > datetime('now')
        AND attempts < ${CODE_MAX_ATTEMPTS} ORDER BY id DESC LIMIT 1`
  ).bind(email).first();
  if (!row) return false;
  if (row.code_hash !== await codeHash(email, code)) {
    await env.DB.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?').bind(row.id).run();
    return false;
  }
  const res = await env.DB.prepare("UPDATE login_codes SET used_at = datetime('now') WHERE id = ? AND used_at IS NULL").bind(row.id).run();
  return res.meta.changes === 1;
}

export async function createSession(env, email) {
  await ensureUser(env, email);
  const token = randomToken();
  await env.DB.prepare(
    `INSERT INTO sessions (token_hash, email, expires_at) VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`
  ).bind(await sha256Hex(token), email).run();
  await env.DB.prepare("UPDATE users SET last_seen_at = datetime('now') WHERE email = ?").bind(email).run();
  return token;
}

export async function revokeSession(env, request) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return;
  const hash = await sha256Hex(token);
  cache.delete(hash);
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(hash).run();
}

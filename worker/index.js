// Trip Atlas Worker — sign-in, the JSON API, and the gate in front of web/.
//
// Efficiency rules (Workers Free: 10 ms CPU per request; D1 billed per row):
//  - GPX parsing and simplification happen in the browser; the Worker only
//    validates and stores already-small records;
//  - the whole trip's geometry is one ETag'd response (~0.6 MB), revalidated
//    with a single-row read of data_version;
//  - identity is one indexed read, cached 30 s per isolate (auth.js).
import {
  identify, normaliseEmail, mayUse, createLoginCode, consumeLoginCode, createSession, revokeSession,
  sessionCookie, clearedCookie, CODE_MINUTES,
} from './auth.js';
import { signInPage, codePage, notListedPage } from './pages.js';
import { sendViaGmailSmtp } from './email-smtp.js';
import { json, err, HttpError } from './api/shared.js';
import * as routesApi from './api/routes.js';
import * as tripApi from './api/trip.js';
import * as mapsApi from './api/maps.js';
import * as photosApi from './api/photos.js';
import { defaultStyle } from '../web/lib/style.js';

const API_MODULES = [routesApi, tripApi, mapsApi, photosApi];

async function form(request) {
  const f = await request.formData();
  return Object.fromEntries([...f.entries()].map(([k, v]) => [k, String(v)]));
}

async function sendCode(env, email, code) {
  if (env.GMAIL_SMTP_USER && env.GMAIL_SMTP_APP_PASSWORD) {
    await sendViaGmailSmtp({
      user: env.GMAIL_SMTP_USER, appPassword: env.GMAIL_SMTP_APP_PASSWORD, to: email,
      subject: `${code} is your Trip Atlas code`,
      text: `Your Trip Atlas sign-in code is ${code}. It lasts ${CODE_MINUTES} minutes.\n\nIf you didn't ask for it, ignore this email.`,
      html: `<p style="font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif">Your Trip Atlas sign-in code is</p>
<p style="font:700 28px/1 -apple-system,Segoe UI,Roboto,sans-serif;letter-spacing:.3em">${code}</p>
<p style="font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#677384">It lasts ${CODE_MINUTES} minutes. If you didn't ask for it, ignore this email.</p>`,
    });
    return { sent: true };
  }
  if (env.DEV_SHOW_CODE === '1') return { sent: false, devCode: code };
  throw new Error('Email is not set up on this server (GMAIL_SMTP_USER / GMAIL_SMTP_APP_PASSWORD).');
}

const redirect = (to, cookie) => new Response(null, { status: 303, headers: { Location: to, ...(cookie ? { 'Set-Cookie': cookie } : {}) } });

async function handleAuth(request, env, url) {
  if (url.pathname === '/auth/code' && request.method === 'POST') {
    const f = await form(request);
    const email = normaliseEmail(f.email);
    if (!email) return signInPage({ error: 'Enter a valid email address.', email: f.email });
    if (!(await mayUse(env, email))) return notListedPage(email);
    // No mail sender configured (and not local dev): don't mint a code that
    // can't be delivered — and don't cancel one an admin made with
    // `npm run login-code`. Go straight to the code screen.
    if (!(env.GMAIL_SMTP_USER && env.GMAIL_SMTP_APP_PASSWORD) && env.DEV_SHOW_CODE !== '1') {
      return codePage({ email, error: "Email sign-in isn't switched on yet. Ask Rory for a code (he makes one with “npm run login-code”), then type it here." });
    }
    const code = await createLoginCode(env, email);
    try {
      const r = await sendCode(env, email, code);
      return codePage({ email, devCode: r.devCode });
    } catch (e) {
      return signInPage({ error: String(e.message || e), email });
    }
  }
  if (url.pathname === '/auth/verify' && request.method === 'POST') {
    const f = await form(request);
    const email = normaliseEmail(f.email);
    if (!email) return signInPage({ error: 'Start again — that link was missing your email.' });
    if (!(await consumeLoginCode(env, email, String(f.code || '').trim())))
      return codePage({ email, error: 'That code is wrong or has expired. Check the latest email, or send another.' });
    const token = await createSession(env, email);
    return redirect('/', sessionCookie(token, request));
  }
  if (url.pathname === '/auth/signout' && request.method === 'POST') {
    await revokeSession(env, request);
    return redirect('/', clearedCookie(request));
  }
  return null;
}

async function ensureSeeded(env) {
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM map_styles').first();
  if (!r.n) await env.DB.prepare("INSERT OR IGNORE INTO map_styles (name, spec, updated_by) VALUES ('Album light', ?, 'seed')").bind(JSON.stringify(defaultStyle())).run();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/auth/')) {
        const r = await handleAuth(request, env, url);
        if (r) return r;
      }

      const user = await identify(request, env);

      if (url.pathname.startsWith('/api/')) {
        if (!user) return err('Signed out', 401);
        // Same-origin only for writes: a cross-site form can't drive the API.
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          const origin = request.headers.get('Origin');
          if (origin && origin !== url.origin) return err('Cross-origin request refused', 403);
        }
        if (url.pathname === '/api/bootstrap') await ensureSeeded(env);
        for (const mod of API_MODULES) {
          const res = await mod.handle(request, env, url, user);
          if (res !== undefined) return res;
        }
        return err('Not found', 404);
      }

      if (!user) {
        if (url.pathname === '/' || url.pathname === '/index.html') return signInPage({ email: url.searchParams.get('email') || '' });
        return redirect('/');
      }
      // File names aren't content-hashed, so make browsers revalidate (a cheap
      // 304) — otherwise an old app.js/atlas.js can outlive a deploy and mix
      // with new modules. Static data files can be cached for a day.
      const res = await env.ASSETS.fetch(request);
      const out = new Response(res.body, res);
      out.headers.set('Cache-Control', url.pathname.startsWith('/data/') ? 'private, max-age=86400' : 'private, no-cache');
      return out;
    } catch (e) {
      if (e instanceof HttpError) return err(e.message, e.status);
      console.error('worker error', url.pathname, e && e.stack || e);
      return url.pathname.startsWith('/api/') ? err('Something went wrong on the server', 500) : new Response('Server error', { status: 500 });
    }
  },
};

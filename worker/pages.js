// Server-rendered sign-in pages (Site Scout worker/pages.js pattern): plain
// HTML, inline styles from the same tokens as web/app.css, no scripts.

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const ICON = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%231c5d8c'/%3E%3Cpath d='M7 22c4-1 5-8 9-8s4 5 9 3' fill='none' stroke='white' stroke-width='2.4' stroke-linecap='round'/%3E%3Ccircle cx='7' cy='22' r='2.2' fill='white'/%3E%3Ccircle cx='25' cy='17' r='2.2' fill='white'/%3E%3C/svg%3E`;

function shell(title, inner, status = 200, headers = {}) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive"><title>${esc(title)} · Trip Atlas</title>
<link rel="icon" href="${ICON}">
<style>
:root{--ink:#16202b;--mute:#677384;--rule:#e1e5ea;--accent:#1c5d8c;--accent-ink:#0f3a58;--bg:#f4f6f8;--over:#b3261e;--over-bg:#fbeae8}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px 16px;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.c{width:100%;max-width:400px;background:#fff;border:1px solid var(--rule);border-radius:14px;padding:28px;box-shadow:0 1px 2px rgba(20,30,40,.05)}
.b{display:flex;align-items:center;gap:9px;font-weight:700;margin-bottom:20px}.b img{width:28px;height:28px}
h1{font-size:20px;margin:0 0 6px;letter-spacing:-.01em}p{color:var(--mute);margin:0 0 14px}label{display:block;font-size:12px;font-weight:600;color:var(--mute);margin:12px 0 4px}
input{width:100%;padding:10px 12px;border:1px solid var(--rule);border-radius:8px;font:inherit;font-size:16px}input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px rgba(28,93,140,.14)}
input.code{letter-spacing:.4em;font-size:22px;text-align:center;font-variant-numeric:tabular-nums}
button{width:100%;margin-top:16px;padding:11px;border:0;border-radius:8px;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer}button:hover{background:var(--accent-ink)}
.err{background:var(--over-bg);color:var(--over);border-radius:8px;padding:9px 12px;margin:0 0 12px;font-size:14px}
.dev{background:#f8efe0;color:#92560f;border-radius:8px;padding:9px 12px;margin:0 0 12px;font-size:14px}
.who{background:#f2f4f7;border-radius:8px;padding:10px 12px;font-weight:600;margin:6px 0 2px;overflow-wrap:anywhere}
a{color:var(--accent)}.f{margin-top:18px;font-size:13px;color:var(--mute)}
</style></head><body><main class="c"><div class="b"><img src="${ICON}" alt="">Trip Atlas</div>
${inner}
</main></body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', ...headers } });
}

export function signInPage({ error, email } = {}) {
  return shell('Sign in', `<h1>Sign in</h1><p>We'll email you a 6-digit code.</p>
${error ? `<div class="err">${esc(error)}</div>` : ''}
<form method="post" action="/auth/code"><label for="e">Email</label>
<input id="e" name="email" type="email" autocomplete="email" required autofocus value="${esc(email || '')}">
<button type="submit">Email me a code</button></form>`);
}

export function codePage({ email, error, devCode }) {
  return shell('Enter your code', `<h1>${error && /switched on/.test(error) ? 'Enter your code' : 'Check your email'}</h1><p>${error && /switched on/.test(error) ? 'Signing in as' : 'We sent a 6-digit code to'}</p><div class="who">${esc(email)}</div>
${devCode ? `<div class="dev" style="margin-top:12px">Local dev — no email sent. Your code is <strong>${esc(devCode)}</strong>.</div>` : ''}
${error ? `<div class="err" style="margin-top:12px">${esc(error)}</div>` : ''}
<form method="post" action="/auth/verify"><input type="hidden" name="email" value="${esc(email)}">
<label for="c">Code</label><input id="c" class="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="\\d{6}" maxlength="6" required autofocus>
<button type="submit">Sign in</button></form>
<div class="f">Didn't get it? Check spam, or <a href="/?email=${encodeURIComponent(email)}">send another</a>. Codes last 15 minutes.</div>`);
}

export function notListedPage(email) {
  return shell('Not on the list', `<h1>Not on the list</h1><p><strong>${esc(email)}</strong> isn't set up for Trip Atlas. Ask Rory to add you in Settings → People.</p><a href="/">Try another email</a>`, 403);
}

// /api/tokens — personal access tokens for the MCP connector and scripts.
// A token acts as its owner; only sha256(token) is stored, shown once.
import { json, err, readJson, v } from './shared.js';
import { sha256Hex } from '../auth.js';

function newToken() {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return 'ta_' + btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function handle(request, env, url, user) {
  if (url.pathname === '/api/tokens' && request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT id, name, prefix, created_at, last_used_at FROM api_tokens WHERE email = ? AND revoked_at IS NULL ORDER BY id DESC').bind(user.email).all();
    return json({ tokens: results });
  }
  if (url.pathname === '/api/tokens' && request.method === 'POST') {
    if (user.via === 'token') return err('Create tokens in the app, not with another token', 403);
    const name = v.name((await readJson(request)).name || 'Claude');
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM api_tokens WHERE email = ? AND revoked_at IS NULL').bind(user.email).first();
    if (n.n >= 20) return err('At most 20 active tokens — revoke an old one first');
    const token = newToken();
    await env.DB.prepare('INSERT INTO api_tokens (email, name, token_hash, prefix) VALUES (?, ?, ?, ?)').bind(user.email, name, await sha256Hex(token), token.slice(0, 7)).run();
    return json({ ok: true, token, mcpUrl: `${url.origin}/mcp/${token}` });
  }
  const m = url.pathname.match(/^\/api\/tokens\/(\d+)$/);
  if (m && request.method === 'DELETE') {
    await env.DB.prepare("UPDATE api_tokens SET revoked_at = datetime('now') WHERE id = ? AND email = ?").bind(+m[1], user.email).run();
    return json({ ok: true });
  }
  return undefined;
}

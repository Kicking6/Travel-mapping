// Copied unchanged from Site Scout (LINZ API Tester/worker/email-smtp.js), itself ported from
// akahu-ledger. Keep the three copies byte-identical below this line.
// email-smtp.js — raw SMTP client over Cloudflare Workers' TCP Sockets API.
// Ported unchanged (bar the EHLO name and step logging) from the Akahu app
// (akahu-ledger/cloudflare/src/email-smtp.js), where it sends the production
// daily digest. Gmail App Password via AUTH LOGIN over STARTTLS; Gmail forces
// From to be the authenticated account.
//
// Optional here: with GMAIL_SMTP_USER + GMAIL_SMTP_APP_PASSWORD set, invites
// and sign-in links are emailed automatically; without them the admin sends
// links from their own mail client (see worker/index.js).

const CRLF = '\r\n';

function toBase64(str) {
  // btoa is UTF-16-unsafe for non-Latin1 text; App Passwords/addresses here are
  // always ASCII, so a plain byte-per-char encode is sufficient and avoids
  // pulling in a TextEncoder round-trip for the common case.
  return btoa(str);
}

/** Splits a socket's readable stream into SMTP reply lines (CRLF-terminated). */
class SmtpLineReader {
  constructor(readable) {
    this.reader = readable.getReader();
    this.buf = '';
    this.decoder = new TextDecoder();
  }

  async readLine() {
    for (;;) {
      const idx = this.buf.indexOf('\n');
      if (idx !== -1) {
        const line = this.buf.slice(0, idx).replace(/\r$/, '');
        this.buf = this.buf.slice(idx + 1);
        return line;
      }
      const { value, done } = await this.reader.read();
      if (done) {
        if (this.buf) { const rest = this.buf; this.buf = ''; return rest.replace(/\r$/, ''); }
        throw new Error('SMTP connection closed unexpectedly');
      }
      this.buf += this.decoder.decode(value, { stream: true });
    }
  }

  /** Releases the underlying reader's lock — required before startTls() can take the stream over. */
  release() { this.reader.releaseLock(); }

  /** Reads a full (possibly multi-line "250-...") reply and returns {code, text}. */
  async readReply() {
    let code = null;
    const lines = [];
    for (;;) {
      const line = await this.readLine();
      const m = line.match(/^(\d{3})([ -])(.*)$/);
      if (!m) { lines.push(line); continue; }
      code = m[1];
      lines.push(m[3]);
      if (m[2] === ' ') break; // last line of the reply has a space, not a dash, after the code
    }
    return { code: Number(code), text: lines.join('\n') };
  }
}

async function expect(reader, allowedCodes, step) {
  const reply = await reader.readReply();
  if (allowedCodes.indexOf(reply.code) === -1) {
    throw new Error('SMTP ' + step + ' failed: ' + reply.code + ' ' + reply.text);
  }
  return reply;
}

// UTF-8-safe base64, wrapped at 76 columns as RFC 2045 requires.
function b64Utf8(str) {
  const bytes = new TextEncoder().encode(String(str || ''));
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/.{76}/g, '$&' + CRLF);
}

// RFC 2047 encoded-word for non-ASCII header text (e.g. a ’ in the subject).
const encodeHeader = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : '=?UTF-8?B?' + btoa(String.fromCharCode(...new TextEncoder().encode(s))) + '?=');

// Spam filters score HTML-only, Message-ID-less, raw-8bit mail as suspect, so
// every message goes out as multipart/alternative (plain text + HTML), base64
// bodies, an encoded subject and our own Message-ID.
export function buildMimeMessage({ from, to, subject, html, text }) {
  const domain = (String(from).match(/@([\w.-]+)/) || [])[1] || 'localhost';
  const boundary = 'ss-' + crypto.randomUUID();
  const plain = text || String(html || '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|h\d)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*/g, '\n\n').trim();
  const headers = [
    'From: ' + from,
    'To: ' + to,
    'Subject: ' + encodeHeader(subject),
    'Date: ' + new Date().toUTCString(),
    'Message-ID: <' + crypto.randomUUID() + '@' + domain + '>',
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="' + boundary + '"',
  ].join(CRLF);
  const part = (type, body) => ['--' + boundary, 'Content-Type: ' + type + '; charset=utf-8', 'Content-Transfer-Encoding: base64', '', b64Utf8(body)].join(CRLF);
  return headers + CRLF + CRLF + [part('text/plain', plain), part('text/html', html), '--' + boundary + '--'].join(CRLF);
}

const SEND_TIMEOUT_MS = 20000;

/** Races a promise against a timeout so a stalled socket fails loudly instead of hanging the request forever. */
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('SMTP timed out after ' + ms + 'ms (' + label + ') — the socket stopped responding without erroring.')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Sends one email via Gmail's SMTP relay (smtp.gmail.com:587, STARTTLS).
 * `connectFn` defaults to the real `cloudflare:sockets` connect() but is
 * injectable so tests can supply a mock socket instead of hitting the network.
 */
export async function sendViaGmailSmtp({ user, appPassword, to, subject, html, text, from }, connectFn) {
  if (!user || !appPassword) throw new Error('Email sender is not configured (GMAIL_SMTP_USER / GMAIL_SMTP_APP_PASSWORD).');
  return withTimeout(sendViaGmailSmtpInner_({ user, appPassword, to, subject, html, text, from }, connectFn), SEND_TIMEOUT_MS, 'send');
}

async function sendViaGmailSmtpInner_({ user, appPassword, to, subject, html, text, from }, connectFn) {
  if (!connectFn) {
    ({ connect: connectFn } = await import('cloudflare:sockets'));
  }

  const socket = connectFn({ hostname: 'smtp.gmail.com', port: 587 }, { secureTransport: 'starttls' });
  const writer = socket.writable.getWriter();
  const encoder = new TextEncoder();
  const send = (line) => writer.write(encoder.encode(line + CRLF));

  let reader = new SmtpLineReader(socket.readable);
  // Tracks which socket is actually live right now, so the catch block below
  // only ever touches the one the platform hasn't already torn down.
  let activeSocket = socket;
  try {
    await expect(reader, [220], 'connect');
    await send('EHLO site-scout.workers.dev');
    await expect(reader, [250], 'EHLO');

    await send('STARTTLS');
    await expect(reader, [220], 'STARTTLS');

    // startTls() needs to take exclusive ownership of the socket's underlying
    // streams to perform the upgrade — it throws "WritableStream is currently
    // locked to a writer" if the plaintext writer/reader haven't released their
    // locks first. Per Cloudflare's docs, once startTls() is called the original
    // socket is closed outright and its reader/writer "no longer work" — so
    // release (not close!) both locks here and never touch them again. Calling
    // writer.close() afterward (the original bug) hung forever awaiting a close
    // ack from an already-torn-down resource instead of failing.
    writer.releaseLock();
    reader.release();
    const tlsSocket = socket.startTls();
    activeSocket = tlsSocket;
    const tlsWriter = tlsSocket.writable.getWriter();
    reader = new SmtpLineReader(tlsSocket.readable);
    const tlsSend = (line) => tlsWriter.write(encoder.encode(line + CRLF));

    await tlsSend('EHLO site-scout.workers.dev');
    await expect(reader, [250], 'EHLO (TLS)');

    await tlsSend('AUTH LOGIN');
    await expect(reader, [334], 'AUTH LOGIN');
    await tlsSend(toBase64(user));
    await expect(reader, [334], 'AUTH LOGIN username');
    await tlsSend(toBase64(appPassword));
    await expect(reader, [235], 'AUTH LOGIN password — check the App Password is current');

    await tlsSend('MAIL FROM:<' + user + '>');
    await expect(reader, [250], 'MAIL FROM');
    await tlsSend('RCPT TO:<' + to + '>');
    await expect(reader, [250, 251], 'RCPT TO');

    await tlsSend('DATA');
    await expect(reader, [354], 'DATA');
    const message = buildMimeMessage({ from: from || user, to, subject, html, text });
    await tlsWriter.write(encoder.encode(message + CRLF + '.' + CRLF));
    const sent = await expect(reader, [250], 'message body');

    await tlsSend('QUIT');
    // Same reasoning as above — don't await a close against a socket the
    // request is about to finish with anyway; let the Worker runtime reclaim it.
    tlsWriter.releaseLock();
    return { messageId: (sent.text.match(/[\w.-]+@[\w.-]+/) || [])[0] || null };
  } catch (e) {
    console.log('smtp:step error', e && e.name, e && e.message, e && e.stack);
    // Best-effort teardown of whichever socket is actually still live — never
    // awaited, since a close() against a stalled/half-dead socket can itself
    // hang (the exact bug being fixed here), which would just trade one hang
    // for another inside error handling.
    try { activeSocket.close().catch(() => {}); } catch (_) {}
    throw e;
  }
}

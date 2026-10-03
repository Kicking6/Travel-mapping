// Operator fallback when email isn't working: make a one-time sign-in code
// for an allowed person, straight in the live D1. Run it yourself, in your
// own terminal (it uses your `wrangler login`); the code is printed here and
// nowhere else. 15 minutes, one use, 5 wrong guesses — same as an emailed code.
//   npm run login-code -- evarblok@gmail.com
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { normaliseEmail } from '../worker/auth.js';

const email = normaliseEmail(process.argv[2]);
if (!email) { console.error('usage: npm run login-code -- someone@example.com'); process.exit(1); }
const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
const hash = crypto.createHash('sha256').update(`${email}:${code}`).digest('hex');
const sql = `UPDATE login_codes SET used_at = datetime('now') WHERE email = '${email}' AND used_at IS NULL;
INSERT INTO login_codes (email, code_hash, expires_at) VALUES ('${email}', '${hash}', datetime('now', '+15 minutes'));`;
execFileSync('npx', ['-y', 'wrangler@4.142.0', 'd1', 'execute', 'trip-atlas', '--remote', '-y', '--command', sql], { stdio: 'ignore' });
console.log(`\n  Sign-in code for ${email}: ${code}\n  Valid 15 minutes, once. On the site: enter the email, press the button, type the code.\n`);

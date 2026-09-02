// validate-auth-log-pii.ts — the signed-out auth screens must not print who
// the user is.
//
// THE BUG THIS PINS (2026-09-02 launch-readiness audit, finding #16).
// contexts/AuthContext.tsx sendMagicLink did:
//
//     const trimmed = email.trim().toLowerCase();
//     ...
//     console.log('[Auth] Sending magic link to', trimmed);
//
// Nothing in this project strips console calls from a release bundle: there is
// no babel-plugin-transform-remove-console in babel.config.js and no
// drop_console in metro.config.js (this guard re-checks both below and says so
// out loud). So that line wrote the user's email address into iOS os_log on
// device, and into the browser console on app.mageid.app — from the SIGNED-OUT
// login screen, before any authentication had happened. On a shared or kiosk
// machine the next person to open Console.app or DevTools learns who has an
// account there.
//
// The rest of AuthContext already logs outcomes only ('found' / 'none',
// error.message, 'session set successfully' without the token), so the fix was
// to make the outlier match the file. This guard keeps it that way: no console
// call on the auth surface may pass an identifier that holds an email, a
// password, a token or a phone number. String literals are stripped first, so
// logging the WORD "email" ('[Auth] Password reset email sent') is fine and
// logging the VALUE is not.
//
// Run: bun run scripts/validate-auth-log-pii.ts

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  PASS ', name); }
  else { fail++; console.log('  FAIL ', name, detail ? `\n        ${detail}` : ''); }
}

// The signed-out surface: the context that talks to Supabase auth plus the two
// screens that hold a typed-in email in a state variable.
const FILES = ['contexts/AuthContext.tsx', 'app/login.tsx', 'app/signup.tsx']
  .filter(f => existsSync(join(ROOT, f)));

function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

/**
 * Strings are the safe part of a log line — the whole point is that
 * console.log('[Auth] Sending magic link') is fine. Drop quoted text, but keep
 * the ${...} bodies of template literals, because that is code and it is
 * exactly how a PII leak would be spelled.
 */
function stripStringText(s: string): string {
  return s
    .replace(/`(?:[^`\\]|\\.)*`/g, lit =>
      ' ' + [...lit.matchAll(/\$\{([^}]*)\}/g)].map(m => m[1]).join(' ') + ' ')
    .replace(/'(?:[^'\\]|\\.)*'/g, ' ')
    .replace(/"(?:[^"\\]|\\.)*"/g, ' ');
}

/** Argument text of the console call whose '(' is at openIdx, parens balanced. */
function callArgs(s: string, openIdx: number): string {
  let depth = 0;
  let quote: string | null = null;
  let out = '';
  for (let i = openIdx; i < s.length; i++) {
    const c = s[i];
    const escaped = s[i - 1] === '\\';
    if (quote) {
      out += c;
      if (c === quote && !escaped) quote = null;
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') { quote = c; out += c; continue; }
    if (c === '(') { depth++; if (depth === 1) continue; }
    if (c === ')') { depth--; if (depth === 0) return out; }
    out += c;
  }
  return out;
}

// Identifiers that hold a value we must never print. Whole-word so `redirectUrl`
// and `error.message` are fine and `user.email` / `trimmed` are not.
const PII = /\b(email|emails|trimmed|password|passcode|passphrase|token|jwt|otp|secret|phone|address|credential|credentials)\b/i;

console.log('\n1. no console call on the auth surface prints an identifier:');

for (const rel of FILES) {
  const code = stripComments(src(rel));
  const hits: string[] = [];
  for (const m of code.matchAll(/console\.(log|warn|error|info|debug)\s*\(/g)) {
    const open = m.index! + m[0].length - 1;
    const args = callArgs(code, open);
    const bare = stripStringText(args);
    const bad = bare.match(PII);
    if (bad) {
      const line = code.slice(0, m.index!).split('\n').length;
      hits.push(`${rel}:${line}  console.${m[1]}(${args.trim().slice(0, 90)})  -> "${bad[0]}"`);
    }
  }
  ok(`${rel} logs outcomes, not identifiers`, hits.length === 0, hits.join('\n        '));
}

// ── 2. the exact line that leaked ───────────────────────────────────────────
console.log('\n2. sendMagicLink logs the event, not the address:');

const auth = stripComments(src('contexts/AuthContext.tsx'));
ok("the magic-link log is bare console.log('[Auth] Sending magic link')",
  /console\.log\('\[Auth\] Sending magic link'\);/.test(auth),
  "it must take no second argument — `', trimmed)` is the shipped bug");
ok('sendMagicLink still exists to be guarded', /const sendMagicLink = useCallback/.test(auth),
  'the function was renamed or removed — re-point this guard rather than deleting it');

// ── 3. why this matters: nothing strips these calls ─────────────────────────
// Recomputed every run so the reasoning above cannot go stale silently.
console.log('\n3. release-build reality check:');

const babel = existsSync(join(ROOT, 'babel.config.js')) ? src('babel.config.js') : '';
const metro = existsSync(join(ROOT, 'metro.config.js')) ? src('metro.config.js') : '';
const pkg = src('package.json');
const stripsConsole =
  /transform-remove-console/.test(babel) ||
  /drop_console/.test(metro) ||
  (/transform-remove-console/.test(pkg) && /transform-remove-console/.test(babel));
console.log(stripsConsole
  ? '  NOTE  a console-stripping transform is configured; this guard is now belt-and-braces.'
  : '  NOTE  no console-stripping transform is configured (checked babel.config.js,\n' +
    '        metro.config.js, package.json) — every console call above ships to\n' +
    '        production and lands in iOS os_log / the browser console.');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

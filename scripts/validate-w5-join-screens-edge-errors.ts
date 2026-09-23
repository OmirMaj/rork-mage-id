// validate-w5-join-screens-edge-errors.ts — wave 5, join lane w5-join-screens.
//
// CONTRACT 26 (#124), the repo-wide guard. supabase-js turns every non-2xx
// edge-function reply into a FunctionsHttpError whose .message is the generic
// "Edge Function returned a non-2xx status code" and hangs the function's own
// JSON body (its sentence, its `code`) off error.context. A screen that throws
// `new Error(error.message)` therefore shows the generic line and loses the
// code — a monthly cap reads as "try again", a withdrawn bid as a crash. Every
// error from supabase.functions.invoke / invokeWithTimeout must go through
// utils/edgeError (edgeFunctionError / readEdgeError), which reads the body.
//
// Also pinned: edgeFunctionError rewrites the vision functions' "Resets on
// the 1st." (00:00 UTC) to the real local moment (#123/#128), keeping `code`.
//
// Run: bun run scripts/validate-w5-join-screens-edge-errors.ts

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.env.W5JS_ROOT ?? join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

function walk(dir: string, out: string[] = []): string[] {
  let names: string[] = [];
  try { names = readdirSync(join(ROOT, dir)); } catch { return out; }
  for (const n of names) {
    if (n === 'node_modules' || n.startsWith('.')) continue;
    const rel = join(dir, n);
    const st = statSync(join(ROOT, rel));
    if (st.isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(n)) out.push(rel);
  }
  return out;
}

/**
 * Sites where a raw `error.message` is thrown on purpose, with the reason.
 * Each entry must still match (a stale entry fails), so the list can't rot.
 */
const ALLOWED: { file: string; line: RegExp; why: string }[] = [
  {
    file: 'contexts/AuthContext.tsx',
    line: /throw new Error\(serverText \?\? `Could not delete account: \$\{error\.message\}`\)/,
    why: 'delete-account (#175) reads the body itself (serverText = body.error) and falls back to the transport message only when no body came back',
  },
];

console.log('\nCONTRACT 26 — no raw error.message from an edge function:');
const CALL = /await\s+(?:supabase\.functions\.invoke|invokeWithTimeout)\s*[<(]/g;
const files = ['app', 'components', 'utils', 'hooks', 'contexts', 'lib'].flatMap(d => walk(d));
const offenders: string[] = [];
const allowedHits = new Set<number>();
let calls = 0;
for (const f of files) {
  const src = read(f);
  const at = [...src.matchAll(CALL)].map(m => m.index ?? 0);
  at.forEach((pos, i) => {
    calls++;
    // The destructured error variable: `{ data, error }` or `{ error: fnErr }`.
    const head = src.slice(Math.max(0, pos - 200), pos);
    const d = /\{([^{}]*)\}\s*=\s*$/.exec(head);
    if (!d) return;
    const alias = /\berror\s*:\s*(\w+)/.exec(d[1])?.[1];
    const v = alias ?? (/\berror\b/.test(d[1]) ? 'error' : null);
    if (!v) return;
    // Scope: up to the next invoke in the file, capped.
    const end = i + 1 < at.length ? Math.min(at[i + 1], pos + 1500) : pos + 1500;
    const scope = src.slice(pos, end);
    const re = new RegExp(`throw\\s+new\\s+Error\\([^;]*?\\b${v}\\??\\.message[^;]*;`, 'g');
    for (const hit of scope.matchAll(re)) {
      const line = src.slice(0, pos + (hit.index ?? 0)).split('\n').length;
      const allowIdx = ALLOWED.findIndex(a => a.file === f && a.line.test(hit[0]));
      if (allowIdx >= 0) { allowedHits.add(allowIdx); continue; }
      offenders.push(`${f}:${line}  ${hit[0].replace(/\s+/g, ' ').slice(0, 110)}`);
    }
  });
}
ok(`the scan found the app's edge-function calls (${calls})`, calls >= 40, 'the call pattern stopped matching — the guard would pass on nothing');
ok('no edge-function error is rethrown as a bare error.message (use edgeFunctionError)', offenders.length === 0, `\n      ${offenders.join('\n      ')}`);
ALLOWED.forEach((a, i) => ok(`allow-list entry still matches (${a.file}): ${a.why}`, allowedHits.has(i)));

console.log('\nthe converted sites read the body (spot checks):');
ok('rfp-responses-review: the award refusal (409, withdrawn bid) shows the server sentence',
  /if \(error\) throw await edgeFunctionError\(error, 'Award failed\.'\);/.test(read('app/rfp-responses-review.tsx')));
ok('connect-claude: all three mcp-token calls', (read('app/connect-claude.tsx').match(/throw await edgeFunctionError\(error, /g) ?? []).length === 3);
ok('ClientPaywall: checkout start', /if \(error\) throw await edgeFunctionError\(error, 'Could not start checkout'\);/.test(read('components/ClientPaywall.tsx')));
ok('qbo-setup: connection register', /if \(error\) throw await edgeFunctionError\(error, 'QuickBooks connection not registered'\);/.test(read('app/qbo-setup.tsx')));
ok('AuthContext: magic link', /throw await edgeFunctionError\(error, "Couldn't send the sign-in link\. Try again\."\);/.test(read('contexts/AuthContext.tsx')));
ok('contractSealing: seal-document', /const e = await edgeFunctionError\(error, 'seal-document failed'\);/.test(read('utils/contractSealing.ts')));

console.log('\n#123/#128 — edgeFunctionError names the real local monthly reset:');
{
  // Executed, not pattern-matched: the real module under Bun.
  const mod = await import(join(ROOT, 'utils/edgeError.ts')) as typeof import('../utils/edgeError');
  const httpErr = (status: number, body: unknown) => ({
    message: 'Edge Function returned a non-2xx status code',
    context: { status, json: async () => body },
  });
  const cap = await mod.edgeFunctionError(httpErr(429, { code: 'monthly_cap_reached', error: "You've used this month's 50 photo analyses. Resets on the 1st." }), 'Analysis failed');
  ok('a monthly-cap body keeps its code', mod.edgeErrorCode(cap) === 'monthly_cap_reached', mod.edgeErrorCode(cap));
  ok('…and no longer names "the 1st" (00:00 UTC is the last evening of the month in the Americas)',
    !/the 1st/i.test(cap.message) && /^You've used this month's 50 photo analyses\. Resets /.test(cap.message), cap.message);
  const other = await mod.edgeFunctionError(httpErr(429, { code: 'hourly_limit', error: 'Too many scans this hour. Try again at 3:10 PM.' }), 'Analysis failed');
  ok('any other sentence passes through untouched', other.message === 'Too many scans this hour. Try again at 3:10 PM.' && mod.edgeErrorCode(other) === 'hourly_limit', other.message);
  const net = await mod.edgeFunctionError(new Error('Failed to fetch'), 'Analysis failed');
  ok('a transport failure keeps its own message and an empty code', net.message === 'Failed to fetch' && mod.edgeErrorCode(net) === '');
  const plain = await mod.edgeFunctionError(httpErr(502, 'not json'), 'Analysis failed');
  ok('a non-JSON reply says the fallback with the status', plain.message === 'Analysis failed (HTTP 502)' && mod.edgeErrorCode(plain) === 'http_502', plain.message);
}

console.log(`\n${failed === 0 ? '✓' : '✗'} validate-w5-join-screens-edge-errors: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

// scripts/validate-edge-cors-headers.ts — every edge function the app calls from a
// browser must allow the headers supabase-js actually sends.
//
// WHY (2026-09-24): an internal tester linking Stripe on the web app got "Failed to
// send a request to the Edge Function". connect-onboarding and connect-status
// answered the CORS preflight with `authorization, content-type` only, but
// supabase.functions.invoke also sends `apikey` and `x-client-info`, so the browser
// refused to send the request at all. The iPhone app has no CORS check, so it never
// showed there. The Home screen's Stripe status check failed silently on web the
// same way.
//
// RULE: for every function name the client calls (supabase.functions.invoke('x')
// or a fetch to /functions/v1/x), if the function declares a literal
// Access-Control-Allow-Headers value, that value must include apikey,
// x-client-info, authorization and content-type. Webhooks and cron targets are
// not called from a browser and are not checked.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
let fails = 0;
const ok = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) fails++;
};

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    if (f === 'node_modules' || f.startsWith('.')) continue;
    const p = join(dir, f);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
}

const clientFiles = ['app', 'components', 'utils', 'hooks', 'contexts', 'lib']
  .map(d => join(ROOT, d)).filter(existsSync).flatMap(d => walk(d));
const invoked = new Set<string>();
for (const f of clientFiles) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/functions\.invoke\(\s*['"`]([a-z0-9-]+)['"`]/g)) invoked.add(m[1]);
  for (const m of src.matchAll(/functions\/v1\/([a-z0-9-]+)/g)) invoked.add(m[1]);
}

const REQUIRED = ['authorization', 'x-client-info', 'apikey', 'content-type'];
export function allowsAll(value: string): string[] {
  const have = value.toLowerCase().split(',').map(s => s.trim());
  return REQUIRED.filter(h => !have.includes(h));
}

console.log(`edge CORS headers — ${invoked.size} functions called from the client`);
ok('the scan finds the Stripe onboarding call', invoked.has('connect-onboarding'));
ok('the scan finds the Stripe status call', invoked.has('connect-status'));
let checked = 0;
for (const fn of [...invoked].sort()) {
  const dir = join(ROOT, 'supabase/functions', fn);
  if (!existsSync(dir)) continue;
  for (const f of walk(dir)) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/["']Access-Control-Allow-Headers["']\s*:\s*["']([^"']*)["']/g)) {
      checked++;
      const missing = allowsAll(m[1]);
      ok(`${fn} allows the headers supabase-js sends`, missing.length === 0, missing.length ? `missing ${missing.join(', ')} in ${f.slice(ROOT.length + 1)}` : '');
    }
  }
}
ok('at least the two Stripe functions were checked', checked >= 2, `${checked} literal Allow-Headers checked`);
// Self-test of the rule itself.
ok('self-test: the old narrow list is rejected', allowsAll('authorization, content-type').length === 2);
ok('self-test: the full list passes', allowsAll('authorization, x-client-info, apikey, content-type').length === 0);

if (fails) { console.error(`\n✗ validate-edge-cors-headers: ${fails} failure(s)`); process.exit(1); }
console.log('\n✓ validate-edge-cors-headers: every browser-called function allows the supabase-js headers');

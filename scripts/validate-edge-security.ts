// scripts/validate-edge-security.ts — drift guard for the 2026-07-13 edge-function
// security hardening. These are STRUCTURAL source assertions (the properties are
// I/O-bound, so we can't unit-test the runtime behavior without jest, which this
// repo doesn't use). They fail ship-check if a future refactor silently removes a
// control: fail-closed metering, the project_memory cap, the memory rate limits,
// the og-image DNS-resolving SSRF guard, or the lead-intake rate limit.
//
// Path is relative to the repo root — ship-check runs validators from there
// (NOT new URL(import.meta.url) — tsc rejects it on this repo's spaced path).
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
function ok(n: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, extra ? `\n   ${extra}` : ''); }
}
const read = (p: string): string => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };

// ── 1. _shared/auth.ts: metering fails CLOSED + project_memory cap + limiter ──
const auth = read('supabase/functions/_shared/auth.ts');
ok('auth.ts loaded', auth.length > 0);
// aiUsageIncrement/aiUsageGet must NOT contain the old fail-open `return 0`.
ok('metering fails closed (no `return 0` on error)', !/if \(!r\.ok\) return 0;/.test(auth),
  'aiUsageIncrement/aiUsageGet must return Number.MAX_SAFE_INTEGER on RPC error, not 0');
ok('metering uses MAX_SAFE_INTEGER sentinel', (auth.match(/Number\.MAX_SAFE_INTEGER/g) ?? []).length >= 4,
  'expected >=4 MAX_SAFE_INTEGER (2 per function × increment+get)');
// project_memory cap present for every tier.
for (const tier of ['free', 'pro', 'business', 'enterprise']) {
  const block = auth.match(new RegExp(`${tier}:\\s*\\{([\\s\\S]*?)\\}`));
  ok(`MONTHLY_CAPS.${tier} has project_memory`, !!block && /project_memory:\s*\d+/.test(block[1]));
}
ok('auth.ts exports rateLimitCount', /export async function rateLimitCount\(/.test(auth));
ok('rateLimitCount fails safe (-1 on error, caller decides)', /return -1;/.test(auth));

// ── 2. og-image: DNS-resolving SSRF guard + manual redirect ───────────────────
const og = read('supabase/functions/og-image/index.ts');
ok('og-image loaded', og.length > 0);
ok('og-image resolves DNS for SSRF check', /Deno\.resolveDns/.test(og),
  'the guard must resolve A/AAAA and reject private IPs, not just denylist literal hosts');
ok('og-image has isPrivateIp check', /function isPrivateIp\(/.test(og) && /169 && b === 254/.test(og));
ok('og-image follows redirects manually (re-validates each hop)', /redirect:\s*"manual"/.test(og),
  'redirect:"follow" would chase a 30x to an internal host unchecked');
ok('og-image no longer uses redirect:"follow"', !/redirect:\s*"follow"/.test(og));

// ── 3. project-memory-embed / -search: cap precheck + rate limit + charge ─────
for (const fn of ['project-memory-embed', 'project-memory-search']) {
  const src = read(`supabase/functions/${fn}/index.ts`);
  ok(`${fn} loaded`, src.length > 0);
  ok(`${fn} prechecks the monthly cap`, /aiUsageGet\(auth\.userId,\s*"project_memory"\)/.test(src) && /MONTHLY_CAPS\[auth\.tier\]/.test(src));
  ok(`${fn} enforces the hourly rate limit`, /rateLimitCount\(`pm:\$\{auth\.userId\}`\)/.test(src) && /PM_HOURLY_LIMIT/.test(src));
  ok(`${fn} charges usage after success`, /aiUsageIncrement\(auth\.userId,\s*"project_memory",\s*1\)/.test(src));
}

// ── 4. public-lead-intake: per-IP + per-slug rate limit ───────────────────────
const lead = read('supabase/functions/public-lead-intake/index.ts');
ok('public-lead-intake loaded', lead.length > 0);
ok('lead-intake rate-limits per IP', /rateLimitCount\(`lead:ip:/.test(lead));
ok('lead-intake rate-limits per slug', /rateLimitCount\(`lead:slug:/.test(lead));
ok('lead-intake returns 429 when over the limit', /LEAD_IP_HOURLY_LIMIT|LEAD_SLUG_HOURLY_LIMIT/.test(lead) && /429/.test(lead));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

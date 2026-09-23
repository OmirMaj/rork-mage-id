// scripts/validate-w5-ai-limits-reset.ts — the AI allowance says when it REALLY resets.
//
// Audit #123/#128: every AI counter is dated by the server's UTC clock
// (ai_daily_usage_* on current_date, ai_usage_daily_* on CURRENT_DATE, the
// monthly caps on date_trunc('month', now())), so the daily allowance refills
// at 00:00 UTC — 8 PM in New York — while the copy said "Resets at midnight",
// "Try again tomorrow" and "Resets the 1st". The interim fix is the COPY (a
// client-picked date would let anyone refill a SECURITY DEFINER counter):
// nextAiResetLabel() names the real moment in the reader's clock.
//
// This validator re-runs itself under fixed time zones (TZ is read at process
// start), then checks the pure core and pins every call site that claimed a
// local midnight / tomorrow / the 1st.
//
// Run: bun run scripts/validate-w5-ai-limits-reset.ts

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const ROOT = join(dirname(SELF), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
/** Code only — the WHY comments quote the old copy on purpose. */
const code = (p: string) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map(l => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra ? `\n     ${extra}` : ''); }
}

const ZONE = process.env.W5_RESET_ZONE;

if (!ZONE) {
  // ── Parent: fan out one child per zone, then pin the call sites. ──────────
  for (const tz of ['America/New_York', 'America/Los_Angeles', 'UTC', 'Asia/Kolkata']) {
    const r = spawnSync(process.execPath, ['run', SELF], {
      env: { ...process.env, TZ: tz, W5_RESET_ZONE: tz },
      encoding: 'utf8',
    });
    process.stdout.write(r.stdout ?? '');
    process.stderr.write(r.stderr ?? '');
    ok(`zone ${tz}: all checks passed`, r.status === 0, `exit ${r.status}`);
  }

  console.log('\nCall sites');
  const core = code('utils/aiRateLimiterCore.ts');
  ok('core: no "Resets at midnight." literal in evaluateLimit',
    !/Resets at midnight\.["`]/.test(core));
  ok('core: no "Try again tomorrow" in evaluateLimit', !/Try again tomorrow/.test(core));
  ok('core: evaluateLimit keeps its six positional params + a trailing OPTIONAL label',
    /lifetimeUsed: number,\s*\n(?:\s*\/\*\*[\s\S]*?\*\/\s*\n)?\s*dailyResetLabel\?: string,\s*\n\): LimitCheck/.test(core));

  const limiter = code('utils/aiRateLimiter.ts');
  const limiterRaw = read('utils/aiRateLimiter.ts');
  ok('checkAILimit passes nextAiResetLabel().daily into evaluateLimit',
    /lifetimeUsed,[\s\S]{0,200}nextAiResetLabel\(\)\.daily,\s*\n\s*\);/.test(limiter));
  ok('aiRateLimiter header no longer claims "Resets at midnight"', !/→ "You've used today's quick AI\. Resets at midnight\."/.test(limiterRaw));

  const alert = code('utils/aiLimitAlert.ts');
  ok('aiLimitAlert: no local-midnight countdown (setHours(24…))', !/setHours\(24/.test(alert));
  ok('aiLimitAlert: no "Resets at midnight (in"', !/Resets at midnight \(in/.test(alert));
  ok('aiLimitAlert: no local "first of next month" label', !/getMonth\(\) \+ 1, 1\)/.test(alert));
  ok('aiLimitAlert: reset text comes from nextAiResetLabel + timeUntilAiDailyReset',
    /nextAiResetLabel\(\)/.test(alert) && /timeUntilAiDailyReset\(\)/.test(alert));
  ok('aiLimitAlert: no "Wait until tomorrow" button', !/Wait until tomorrow/.test(alert));

  const sites: [string, RegExp][] = [
    ['app/(tabs)/construction-ai/index.tsx', /Resets at midnight|Resets on the 1st/],
    ['components/AIHomeBriefing.tsx', /resets at midnight/i],
    ['components/AIInvoicePredictor.tsx', /reset at midnight/i],
    ['app/ask.tsx', /Try again tomorrow/],
    ['app/project-memory.tsx', /Try again tomorrow/],
  ];
  for (const [file, bad] of sites) {
    const src = code(file);
    ok(`${file}: no false reset claim`, !bad.test(src));
    ok(`${file}: uses nextAiResetLabel()`, /nextAiResetLabel\(\)\.(daily|monthly)/.test(src));
  }
  const cai = read('app/(tabs)/construction-ai/index.tsx');
  ok('construction-ai: code-check + roadmap caps use the DAILY label, plan review the MONTHLY',
    /code checks\. \$\{nextAiResetLabel\(\)\.daily\}/.test(cai)
    && /roadmap generations\. \$\{nextAiResetLabel\(\)\.daily\}/.test(cai)
    && /plan reviews\. \$\{nextAiResetLabel\(\)\.monthly\}/.test(cai));

  const mage = read('utils/mageAI.ts');
  ok('mageAI: the 429 cap sentence is rewritten into the local monthly reset',
    /withLocalMonthlyReset\(capMsg\)/.test(mage));
  const ca = read('utils/constructionAnswer.ts');
  ok('constructionAnswer: the monthly cap message is rewritten too', /withLocalMonthlyReset\(/.test(ca));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

// ── Child: pure checks under one fixed zone. ─────────────────────────────────
const core = await import('../utils/aiRateLimiterCore');
const { nextAiResetLabel, timeUntilAiDailyReset, evaluateLimit, withLocalMonthlyReset, nextAiResetAt } = core;
console.log(`\nZone ${ZONE}`);

// A fixed instant: 2026-09-23 19:00 UTC (= 3:00 PM EDT, 12:00 PM PDT, 00:30 IST next day).
const t = new Date(Date.UTC(2026, 8, 23, 19, 0, 0));
const at = nextAiResetAt(t);
ok('daily reset is the next 00:00 UTC', at.daily.toISOString() === '2026-09-24T00:00:00.000Z', at.daily.toISOString());
ok('monthly reset is the next UTC month start', at.monthly.toISOString() === '2026-10-01T00:00:00.000Z', at.monthly.toISOString());

const l = nextAiResetLabel(t);
const expected: Record<string, { daily: string; monthly: string; left: string }> = {
  'America/New_York': { daily: 'Resets at 8:00 PM', monthly: 'Resets Sep 30, 8:00 PM', left: '5h' },
  'America/Los_Angeles': { daily: 'Resets at 5:00 PM', monthly: 'Resets Sep 30, 5:00 PM', left: '5h' },
  UTC: { daily: 'Resets at midnight', monthly: 'Resets Oct 1', left: '5h' },
  // 00:30 IST on the 24th → the reset is 5:30 AM the SAME local day.
  'Asia/Kolkata': { daily: 'Resets at 5:30 AM', monthly: 'Resets Oct 1, 5:30 AM', left: '5h' },
};
const want = expected[ZONE];
ok(`daily label (${ZONE})`, l.daily === want.daily, `got "${l.daily}"`);
ok(`monthly label (${ZONE})`, l.monthly === want.monthly, `got "${l.monthly}"`);
ok(`countdown to the real reset (${ZONE})`, timeUntilAiDailyReset(t) === want.left, `got "${timeUntilAiDailyReset(t)}"`);

if (ZONE === 'America/New_York') {
  // 9:00 PM EDT = 01:00 UTC next day: the allowance already reset at 8 PM, the
  // next one is tomorrow evening — say "tomorrow".
  const late = new Date(Date.UTC(2026, 8, 24, 1, 0, 0));
  ok('after the boundary it says tomorrow', nextAiResetLabel(late).daily === 'Resets tomorrow at 8:00 PM', nextAiResetLabel(late).daily);
  ok('…and the countdown is 23h, not 3h', timeUntilAiDailyReset(late) === '23h', timeUntilAiDailyReset(late));

  // evaluateLimit carries the label into the two messages that promised a time.
  const ent = evaluateLimit('enterprise', 'fast', undefined, 150, 0, 0, l.daily);
  ok('enterprise daily cap names the real reset', ent.message === "You've reached today's AI limit. Resets at 8:00 PM.", ent.message);
  const entSmart = evaluateLimit('enterprise', 'smart', undefined, 10, 40, 0, l.daily);
  ok('enterprise smart cap names the real reset, no "tomorrow"',
    !!entSmart.message && entSmart.message.includes('Resets at 8:00 PM') && !/tomorrow/i.test(entSmart.message), entSmart.message);
  // Positional callers without the label (validate-schedule-copilot-meter, …)
  // still compile and still never claim a local midnight.
  const bare = evaluateLimit('enterprise', 'fast', undefined, 150, 0, 0);
  ok('without a label the copy names UTC, never a bare "midnight."',
    bare.message === "You've reached today's AI limit. Resets at midnight UTC.", bare.message);
  ok('reason codes unchanged', ent.reason === 'daily_cap' && entSmart.reason === 'smart_cap');

  ok('server "Resets the 1st of next month." → local monthly label',
    withLocalMonthlyReset('Monthly AI limit reached (900/mo on pro). Resets the 1st of next month.', t)
      === 'Monthly AI limit reached (900/mo on pro). Resets Sep 30, 8:00 PM.');
  ok('server "Resets the 1st (UTC)." → local monthly label',
    withLocalMonthlyReset('Limit reached (10/mo on business). Resets the 1st (UTC).', t)
      === 'Limit reached (10/mo on business). Resets Sep 30, 8:00 PM.');
  const hourly = 'Hourly limit reached (60 per hour). Try again in an hour.';
  ok('an hourly-limit sentence is left alone', withLocalMonthlyReset(hourly, t) === hourly);
}

console.log(`\n  ${pass} passed, ${fail} failed (${ZONE})`);
process.exit(fail > 0 ? 1 : 0);

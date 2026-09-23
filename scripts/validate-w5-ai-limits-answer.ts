// scripts/validate-w5-ai-limits-answer.ts — Ask MAGE says WHY it didn't answer.
//
// Audit #119: blocked by the monthly cap, the hourly cap or an expired session,
// Ask MAGE said "I couldn't reach the AI right now" and printed two unrelated
// fact lines — he was never told he was out of AI or needed to sign in. Now a
// BLOCKED reply is the relay's own sentence with no facts, and the screen adds
// the one action that fixes it; the verbatim-facts fallback is kept only for an
// UNREACHABLE model and opens by saying it is not an answer.
//
// Also pins the wiring #36 needs end to end (FAB → ask → askOneMind anchor).
//
// Run: bun run scripts/validate-w5-ai-limits-answer.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { oneMindFailureReply, FALLBACK_OPENING } from '../utils/oneMind/failureAnswer';
import type { FactBlock } from '../utils/oneMind/factBlocks';

const SELF = fileURLToPath(import.meta.url);
const ROOT = join(dirname(SELF), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra ? `\n     ${extra}` : ''); }
}

const blocks: FactBlock[] = [
  { domain: 'BRAIN WATCH', ref: 'WATCH', facts: ['Henderson: invoice #4 is 21d overdue ($5,000)'] },
  { domain: 'CASH FLOW', ref: 'CASH', facts: ['Cash low point $-3K in week 4.'] },
  { domain: 'BUSINESS RECORDS', ref: 'RECORDS', facts: ['Projects: 3'] },
];

console.log('\nBlocked: the reason, no facts');
{
  const r = oneMindFailureReply({
    error: 'Monthly AI limit reached (900/mo on pro). Resets Sep 30, 8:00 PM.',
    errorKind: 'monthly_cap', errorCode: 'monthly_cap',
  }, blocks);
  ok('monthly cap → the relay sentence verbatim', r.answer === 'Monthly AI limit reached (900/mo on pro). Resets Sep 30, 8:00 PM.', r.answer);
  ok('monthly cap → no facts quoted', r.used.length === 0 && !r.answer.includes('overdue'));
  ok('monthly cap → never "couldn\'t reach the AI"', !/couldn't reach/i.test(r.answer));
  ok('monthly cap → errorKind kept for the screen', r.errorKind === 'monthly_cap' && r.blocked);
}
{
  const r = oneMindFailureReply({
    error: 'Hourly limit reached (60 per hour). Try again in an hour.',
    errorKind: 'monthly_cap', errorCode: 'hourly_limit',
  }, blocks);
  ok('hourly limit (a 429 mapped to monthly_cap) → its own sentence', r.answer.startsWith('Hourly limit reached'));
  ok('hourly limit → errorCode carried so the screen offers no paywall', r.errorCode === 'hourly_limit');
  ok('hourly limit → no facts', r.used.length === 0);
}
{
  const r = oneMindFailureReply({ error: 'Session expired. Sign in again.', errorKind: 'unauthenticated' }, blocks);
  ok('unauthenticated → "sign in" sentence, no facts', /sign in/i.test(r.answer) && r.used.length === 0 && r.blocked);
}
{
  const r = oneMindFailureReply({ errorKind: 'unauthenticated' }, blocks);
  ok('unauthenticated with no message → still says sign in', /sign in/i.test(r.answer));
}

console.log('\nUnreachable: facts, labelled as not an answer');
for (const kind of ['network', 'timeout', 'http', 'model', 'unknown']) {
  const r = oneMindFailureReply({ error: 'AI server returned 502.', errorKind: kind }, blocks);
  ok(`${kind} → verbatim facts`, r.used.length > 0 && r.answer.includes('overdue'));
  ok(`${kind} → opens by saying it does not answer the question`, r.answer.startsWith(FALLBACK_OPENING));
  ok(`${kind} → not "blocked"`, !r.blocked);
}
ok('the opening says plainly it is not an answer', /doesn't answer your question/.test(FALLBACK_OPENING));
ok('RECORDS dump is skipped when better blocks exist',
  !oneMindFailureReply({ errorKind: 'network' }, blocks).used.some(b => b.ref === 'RECORDS'));
{
  const r = oneMindFailureReply({ error: 'boom', errorKind: 'network' }, []);
  ok('no facts at all → the error, not an empty bubble', r.answer === "MAGE couldn't answer that: boom");
}

console.log('\nWiring');
const answer = read('utils/oneMind/answer.ts');
ok('askOneMind routes every model failure through oneMindFailureReply',
  (answer.match(/oneMindFailureReply\(/g) ?? []).length >= 2 && !/function fallbackAnswer/.test(answer));
ok('askOneMind returns errorCode', /errorCode: reply\.errorCode/.test(answer));
ok('askOneMind takes an anchor and applies it after resolveScope',
  /opts: \{ anchorProjectId\?: string \| null \}/.test(answer)
    && /applyAnchorScope\(\s*resolveScope\(question, bundle\.projects\), question, opts\.anchorProjectId, bundle\.projects,?\s*\)/.test(answer));

const mage = read('utils/mageAI.ts');
ok('mageAI: errorKind union unchanged (wave-4 screens switch on it)',
  /errorKind\?: 'timeout' \| 'network' \| 'http' \| 'model' \| 'validation' \| 'unauthenticated' \| 'monthly_cap' \| 'unknown';/.test(mage));
ok('mageAI: errorCode?: string added (CONTRACT 9)', /\n\s*errorCode\?: string;/.test(mage));
ok('mageAI: 429 carries the relay body.code', /errorKind: 'monthly_cap',\s*\n\s*errorCode: errorCode \?\? 'monthly_cap'/.test(mage));
ok('mageAI: body.code read from the error body', /const errorCode = typeof errBody\?\.code === 'string' \? errBody\.code : undefined;/.test(mage));

const ask = read('app/ask.tsx');
ok('ask: turn stores errorKind + errorCode', /errorKind: res\.errorKind,\s*\n\s*errorCode: res\.errorCode,/.test(ask));
ok('ask: See plans only for monthly cap on Free/Pro, never the hourly limit',
  /t\.errorKind === 'monthly_cap' && t\.errorCode !== 'hourly_limit' && \(tier === 'free' \|\| tier === 'pro'\)/.test(ask));
ok('ask: Sign in for unauthenticated', /t\.errorKind === 'unauthenticated'\) return 'signin'/.test(ask));
ok('ask: the actions route to /paywall and /login',
  /router\.push\(action === 'plans' \? '\/paywall' : '\/login'\)/.test(ask));
ok('ask: passes the anchor to askOneMind', /askOneMind\(q, prior, bundle, \{ anchorProjectId \}\)/.test(ask));
ok('ask: resolves the anchor against his own projects', /projects\.find\(p => p\.id === anchorParam\)/.test(ask));
ok('ask: shows "Answering for <job>" with a clear action',
  /Answering for \{anchorProject\.name\}/.test(ask) && /setAnchorCleared\(true\)/.test(ask));
ok('ask: starters are built from the anchored job', /resolveStarters\(screen, anchorProject\?\.name\)/.test(ask));

const fab = read('components/brain/BrainFab.tsx');
ok('FAB: reads the current route params', /useGlobalSearchParams\(\)/.test(fab));
ok('FAB: forwards projectId only via anchorProjectIdFor', /anchorProjectIdFor\(screen, globalParams\)/.test(fab)
  && /params: projectId \? \{ screen, projectId \} : \{ screen \}/.test(fab));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

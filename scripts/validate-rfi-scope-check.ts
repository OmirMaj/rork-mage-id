// validate-rfi-scope-check.ts — pins the RFI answer → priced CO draft check
// (utils/profitLeak/rfiScopePrompt.ts + components/rfi/RfiScopeCheckCard.tsx).
// Run: bun run scripts/validate-rfi-scope-check.ts
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  buildRfiScopePrompt,
  hashRfiAnswer,
  parseRfiScopeResult,
  rfiScopeHeadline,
  rfiScopeTotalCents,
  RFI_SCOPE_CHECKS_KEY,
  RFI_SCOPE_SCHEMA_HINT,
} from '../utils/profitLeak/rfiScopePrompt';
import { coerceLeakResult, LEAK_SCHEMA_HINT } from '../utils/profitLeak/leakPrompt';
import { buildScopeCoDraft, RFI_DRAFT_ACTION, toCents } from '../utils/brain/scopeCoDraft';
import type { Project } from '../types';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, detail ? `\n        ${detail}` : ''); }
}

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
/** Source with // and block comments removed, so a comment cannot satisfy or trip a check. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

console.log('\nRFI scope check:');

// ── The prompt ──────────────────────────────────────────────────────────────
const rfi = {
  number: 14,
  subject: 'TV blocking',
  question: 'Is blocking required behind the living room TV?',
  response: 'Add 2x10 blocking at all four TV locations and a recessed box at each.',
  linkedDrawing: 'A-201',
};
const prompt = buildRfiScopePrompt('PROJECT: Oak St\nCONTRACTED SCOPE (estimate line items):\n- Framing — Walls (400 lf)', rfi);
ok('prompt carries the answer', prompt.includes(`Answer: ${rfi.response}`));
ok('prompt carries the question', prompt.includes(`Question: ${rfi.question}`));
ok('prompt asks for the exact phrase from the ANSWER', prompt.includes('exact phrase from the ANSWER'));
ok('prompt allows an empty items list for a clarification', prompt.includes('Return an empty items list'));
ok('prompt names the RFI', prompt.includes('=== RFI #14: TV blocking ==='));
ok('prompt carries the drawing when set', prompt.includes('Drawing: A-201'));
ok('no drawing line when unset', !buildRfiScopePrompt('s', { ...rfi, linkedDrawing: null }).includes('Drawing:'));
ok('empty question reads (none)', buildRfiScopePrompt('s', { ...rfi, question: '  ' }).includes('Question: (none)'));
ok('scope sits under CONTRACTED SCOPE', prompt.includes('=== CONTRACTED SCOPE ===\nPROJECT: Oak St'));
ok('first line is the auditor role',
  prompt.split('\n')[0] === 'You are a construction change-order auditor working for the general contractor.');

// ── Parser, hint, hash, key ─────────────────────────────────────────────────
ok('parseRfiScopeResult === coerceLeakResult', parseRfiScopeResult === coerceLeakResult);
ok('RFI_SCOPE_SCHEMA_HINT === LEAK_SCHEMA_HINT', RFI_SCOPE_SCHEMA_HINT === LEAK_SCHEMA_HINT);
const h1 = hashRfiAnswer({ question: rfi.question, response: rfi.response });
const h2 = hashRfiAnswer({ question: rfi.question, response: rfi.response + ' Also add a chase.' });
ok('hashRfiAnswer changes when the response changes', h1 !== h2);
ok('hashRfiAnswer is stable', h1 === hashRfiAnswer({ question: rfi.question, response: rfi.response }));
ok('verdict key sits under the mageid_ prefix (swept at sign-out)', RFI_SCOPE_CHECKS_KEY === 'mageid_rfi_scope_checks');

// ── Headline cents === the drafted CO's changeAmount cents ──────────────────
const items = [
  { name: 'Blocking at TV locations', quantity: 4, unit: 'ea', unitRate: 37.335 },
  { name: 'Recessed TV box', quantity: 3, unit: 'ea', unitRate: 129.99 },
  { name: 'Wall patch', quantity: 12.5, unit: 'sf', unitRate: 4.07 },
];
const lines = items.map(i => ({ quantity: i.quantity, rateUsed: i.unitRate }));
const project = { id: 'p1', linkedEstimate: { grandTotal: 50000 } } as unknown as Project;
const co = buildScopeCoDraft({
  project, existingCOs: [], lines: items,
  description: 'Change from RFI #14 response: TV blocking.', reason: 'Design change from RFI response',
  marker: { action: RFI_DRAFT_ACTION, detail: 'rfi-1' }, nowISO: '2026-09-26T12:00:00.000Z',
});
const headline = rfiScopeHeadline(lines);
ok('headline cents === CO changeAmount cents (3 priced items)',
  headline.cents === toCents(co.changeAmount), `${headline.cents} vs ${toCents(co.changeAmount)}`);
ok('headline total equals Σ line totals too', rfiScopeTotalCents(lines) === co.lineItems.reduce((s, l) => s + toCents(l.total), 0));
ok('headline text names the count and money', /^This answer adds scope: 3 items, about \$[\d,.]+ at your rates$/.test(headline.text), headline.text);
const withUnpriced = rfiScopeHeadline([...lines, { quantity: 1, rateUsed: null }]);
ok('unpriced items add nothing and are named',
  withUnpriced.cents === headline.cents && withUnpriced.text.endsWith(' · 1 with no price of yours yet'), withUnpriced.text);
ok('one item reads singular', rfiScopeHeadline([{ quantity: 1, rateUsed: 10 }]).text.startsWith('This answer adds scope: 1 item,'));
const nonePriced = rfiScopeHeadline([{ quantity: 2, rateUsed: null }, { quantity: 1, rateUsed: 0 }]);
ok('nothing priced never reads as $0',
  nonePriced.cents === 0 && nonePriced.unpriced === 2 && !/\$/.test(nonePriced.text)
  && nonePriced.text === 'This answer adds scope: 2 items · none has a price of yours yet', nonePriced.text);
ok('one unpriced item reads singular without money',
  rfiScopeHeadline([{ quantity: 1, rateUsed: null }]).text === 'This answer adds scope: 1 item · no price of yours yet');

// ── The card, by source ─────────────────────────────────────────────────────
const CARD = 'components/rfi/RfiScopeCheckCard.tsx';
const card = code(CARD);
ok('card uses feature profitLeak on the AI call', /feature:\s*'profitLeak'/.test(card));
ok('card checks the limit for profitLeak', /checkAILimit\(tier,\s*'fast',\s*'profitLeak'\)/.test(card));
const usage = card.match(/recordAIUsage\(/g) ?? [];
ok('recordAIUsage is called exactly once', usage.length === 1, `${usage.length}`);
ok('recordAIUsage only under !res.fromCache',
  /if\s*\(\s*!res\.fromCache\s*\)\s*void\s+recordAIUsage\('fast',\s*'profitLeak'\)/.test(card));
ok('card marks drafts with RFI_DRAFT_ACTION', /RFI_DRAFT_ACTION/.test(card) && /findScopeDraft\(/.test(card));
ok('card gates on isLeakDraftOwner', /isLeakDraftOwner\(project,\s*user\?\.id\)/.test(card));
const raw = read(CARD);
ok('card says the estimate blocked reason',
  raw.includes('Link an estimate to this job first. The check compares the answer with your contracted scope.'));
ok('card says the owner blocked reason', raw.includes('Only the project owner drafts change orders.'));
ok("card groups 'Looks already in your scope'", raw.includes('Looks already in your scope'));
ok('card says verdicts are kept until you sign out', raw.includes('until you sign out'));
ok('card prices through useScopeCostBook + scopeRateFor', /useScopeCostBook\(\)/.test(card) && /scopeRateFor\(/.test(card));
ok('card never uses priceLeakItems or buildCostDatabase', !/priceLeakItems|buildCostDatabase/.test(card));
ok('card never calls updateChangeOrder', !/updateChangeOrder/.test(card));
ok('card never sends to the portal or emails', !/sendToPortal|SendToClientButton|portalState|sendEmail|sendChangeOrder/i.test(card));
ok("card checks addChangeOrder's outcome for 'failed'",
  /const out = await addChangeOrder\(co\)/.test(card) && /out === 'failed'/.test(card));
ok('card reads only a SAVED answered/closed RFI',
  /rfi\.response\?\.trim\(\)/.test(card) && /rfi\.status !== 'answered' && rfi\.status !== 'closed'/.test(card));
ok('card root testID is rfiscope-card', /testID="rfiscope-card"/.test(card));
ok('card sets busy before the first await',
  card.indexOf("setRun({ kind: 'busy' })") > -1 && card.indexOf("setRun({ kind: 'busy' })") < card.indexOf('await checkAILimit'));

// ── The mount ───────────────────────────────────────────────────────────────
const rfiScreen = code('app/rfi.tsx');
const mounts = rfiScreen.match(/<RfiScopeCheckCard\b/g) ?? [];
ok('app/rfi.tsx mounts <RfiScopeCheckCard exactly once', mounts.length === 1, `${mounts.length}`);
ok('the mount passes the saved RFI', /<RfiScopeCheckCard rfi=\{existingRFI\} project=\{project\} \/>/.test(rfiScreen));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

// Client-estimate-share validation — utils/clientEstimateShareToken.ts (pure)
// plus the Review screen that mints the link (app/(tabs)/estimate/review.tsx).
//
// The shareable proposal link carries the estimate OUTSIDE the app, so it is a
// second safety boundary: the token must round-trip cleanly, be URL-safe, and
// never contain the contractor's internal numbers. Guards:
//   1. Payload is built from the client view (total + scope + allowances).
//   2. encode → decode round-trips exactly.
//   3. Token is URL-safe (no +, /, =).
//   4. decode rejects garbage / wrong version.
//   5. No forbidden internal key appears in the payload.
//
// And, since Direction B ("ask when it matters", 2026-09-17), the link's
// payment schedule is the GC's OWN split. Before it, Review printed
// clientEstimateView.defaultPaymentSchedule — a 10% deposit nobody chose —
// while the quick-estimate PDF printed 25 / 65 / 10, so one homeowner could
// hold two different deposits for the same job. Guards:
//   6. The pay lines come from utils/paymentTerms.proposalPaymentLines: three
//      lines at 25 / 65 / 10 that foot to the total in cents, the deposit
//      detail names its percent, and a 0% deposit still prints first as
//      "No deposit" at $0.
//   7. Review (structural — the defect is where the schedule is read, and
//      there is no arithmetic to assert): no defaultPaymentSchedule; the
//      clipboard is imported statically (a dynamic import is an await before
//      the web clipboard write, which then falls outside the user gesture);
//      the token is encoded only inside the gate.run continuation, from the
//      split that continuation is handed rather than from settings; and the
//      client preview has a not-set branch instead of a guessed schedule.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { toClientEstimateView } from '@/utils/clientEstimateView';
import { proposalPaymentLines } from '@/utils/paymentTerms';
import {
  buildClientEstimateSharePayload, encodeClientEstimateToken, decodeClientEstimateToken,
  shareProceedBlock, SHARE_REPLY_FALLBACK,
} from '@/utils/clientEstimateShareToken';
import { acceptanceSentence } from '@/utils/paymentTerms';
import type { LinkedEstimate, PaymentSplit } from '@/types';

let failed = 0;
let passed = 0;
const assert = (c: boolean, m: string) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.error('  FAIL  ' + m); } };

console.log('\nclient-estimate-share validation:');

const est: LinkedEstimate = {
  id: 'e1', globalMarkup: 0.25, baseTotal: 200000, markupTotal: 50000, grandTotal: 250000,
  createdAt: '2026-07-27T00:00:00.000Z',
  items: [
    { materialId: 'm', name: 'Foundations', category: 'c', unit: 'ea', quantity: 1, unitPrice: 0, bulkPrice: 0, markup: 0, usesBulk: false, lineTotal: 150000, supplier: 'ACME', csiDivision: '03' },
    { materialId: 'm', name: 'Electrical', category: 'c', unit: 'ea', quantity: 1, unitPrice: 0, bulkPrice: 0, markup: 0, usesBulk: false, lineTotal: 40000, supplier: 'ACME', csiDivision: '26' },
    { materialId: 'm', name: 'Tile', category: 'c', unit: 'ea', quantity: 1, unitPrice: 0, bulkPrice: 0, markup: 0, usesBulk: false, lineTotal: 10000, supplier: 'ACME', csiDivision: '09', isAllowance: true },
  ],
};

const SPLIT_25_65_10: PaymentSplit = { depositPct: 25, progressPct: 65, finalPct: 10 };

const view = toClientEstimateView(est);
const payload = buildClientEstimateSharePayload(view, {
  projectName: 'Harborview Office Building',
  gcName: 'Harborview Construction Co.',
  clientName: 'Meridian Partners',
  inclusions: ['All labor & materials', 'Permits & inspections'],
  exclusions: ['Furniture & FF&E'],
  paymentSchedule: proposalPaymentLines(view.projectTotal, SPLIT_25_65_10),
  validThrough: '2026-08-31',
});

// 1. Payload reflects the client view
assert(payload.total === view.projectTotal, `payload total matches client total (${payload.total})`);
assert(payload.scope.length === view.scopeGroups.length, 'payload carries every scope group');
assert(payload.allow?.length === 1, 'payload carries the allowance');
assert(payload.pay?.length === 3, 'payload carries the payment schedule');
assert(payload.n === 'Harborview Office Building' && payload.cl === 'Meridian Partners', 'payload carries labels');

// 2. Round-trip
const token = encodeClientEstimateToken(payload);
const back = decodeClientEstimateToken(token);
assert(JSON.stringify(back) === JSON.stringify(payload), 'encode → decode round-trips exactly');

// 3. URL-safe
assert(/^[A-Za-z0-9_-]+$/.test(token), 'token is URL-safe (no +, /, =)');

// 4. Garbage / wrong version rejected
assert(decodeClientEstimateToken('!!!not-base64!!!') === null, 'garbage token → null');
assert(decodeClientEstimateToken('') === null, 'empty token → null');

// 5. No forbidden internal keys anywhere in the payload
const FORBIDDEN = ['markup', 'baseTotal', 'markupTotal', 'globalMarkup', 'unitPrice', 'bulkPrice', 'supplier', 'margin', 'usesBulk'];
const keys = new Set<string>();
const walk = (v: unknown) => {
  if (Array.isArray(v)) { v.forEach(walk); return; }
  if (v && typeof v === 'object') { for (const k of Object.keys(v)) { keys.add(k); walk((v as Record<string, unknown>)[k]); } }
};
walk(payload);
for (const f of FORBIDDEN) assert(!keys.has(f), `payload never exposes internal key '${f}'`);

// 6. The pay lines are his split, footing to the cent
const cents = (n: number) => Math.round(n * 100);
const footsTo = (lines: { amount?: number }[], total: number) =>
  lines.every((l) => typeof l.amount === 'number' && Number.isFinite(l.amount))
  && lines.reduce((s, l) => s + cents(l.amount ?? 0), 0) === cents(total);

const pay = payload.pay ?? [];
assert(pay.length === 3 && pay.every((l) => typeof l.a === 'number'), '25 / 65 / 10 → three pay lines, each with an amount');
assert(pay.reduce((s, l) => s + cents(l.a ?? 0), 0) === cents(view.projectTotal), `the pay lines add up to the total in cents (${view.projectTotal})`);
assert(/25%/.test(pay[0]?.d ?? ''), `the deposit detail names 25% ("${pay[0]?.d}")`);
assert(pay[0]?.a === 62500, `deposit is 25% of the total ($${pay[0]?.a})`);
assert(!pay.some((l) => /10%/.test(l.d) && /deposit/i.test(l.l)), 'no 10% deposit (the old guessed default) on the link');

// Totals that do not divide evenly still foot — the remainder cent lands on
// progress, never a line that does not add up.
for (const total of [1001, 33333, 250001, 99.99]) {
  const lines = proposalPaymentLines(total, SPLIT_25_65_10);
  assert(lines.length === 3 && footsTo(lines, total), `25 / 65 / 10 of $${total} foots to the cent`);
}

const noDeposit = proposalPaymentLines(view.projectTotal, { depositPct: 0, progressPct: 90, finalPct: 10 });
assert(noDeposit[0]?.label === 'Deposit' && noDeposit[0]?.detail === 'No deposit' && noDeposit[0]?.amount === 0,
  `0 / 90 / 10 starts with a "No deposit" line at 0 (${JSON.stringify(noDeposit[0])})`);
assert(footsTo(noDeposit, view.projectTotal), '0 / 90 / 10 foots to the total');

// 7. Review mints the link from the gate's answer, not a guess
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const reviewRaw = readFileSync(join(ROOT, 'app', '(tabs)', 'estimate', 'review.tsx'), 'utf8');
// Strip comments (keeping string literals intact) so a comment that NAMES a
// forbidden pattern cannot satisfy or trip a check.
const stripComments = (src: string): string => {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') { out += n ?? ''; i += 2; continue; }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { const end = src.indexOf('*/', i + 2); i = end === -1 ? src.length : end + 2; continue; }
    if (c === '\'' || c === '"' || c === '`') quote = c;
    out += c;
    i++;
  }
  return out;
};
const review = stripComments(reviewRaw);

/** The balanced (...) or {...} span starting at `open` (an index of '(' or '{'). */
const balanced = (src: string, open: number): string => {
  const o = src[open];
  const cl = o === '(' ? ')' : o === '{' ? '}' : o === '[' ? ']' : '';
  if (!cl) return '';
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === o) depth++;
    else if (src[i] === cl) { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  return '';
};

assert(!/defaultPaymentSchedule/.test(review), 'review.tsx never names defaultPaymentSchedule (the guessed 10% deposit)');
assert(/import\s*\{\s*copyToClipboard\s*\}\s*from\s*'@\/utils\/clipboard'/.test(review),
  'review.tsx imports copyToClipboard statically');
assert(!/import\(\s*['"]@\/utils\/clipboard['"]\s*\)/.test(review),
  'review.tsx has no dynamic import of utils/clipboard (an await before the web clipboard write)');

// The one encoder call sits in copyProposalLink(split), a synchronous function
// whose schedule is built from its own `split` parameter.
const encodeCalls = review.match(/encodeClientEstimateToken\(/g) ?? [];
assert(encodeCalls.length === 1, `review.tsx encodes the token in exactly one place (found ${encodeCalls.length})`);
const linkDecl = /const copyProposalLink = useCallback\(\((\w+): PaymentSplit\) => \{/.exec(review);
const linkParam = linkDecl?.[1] ?? '';
const linkBody = linkDecl ? balanced(review, linkDecl.index + linkDecl[0].length - 1) : '';
assert(!!linkBody, 'review.tsx has copyProposalLink(split: PaymentSplit) as a synchronous (non-async) callback');
assert(/encodeClientEstimateToken\(/.test(linkBody), 'the token is encoded inside copyProposalLink');
assert(new RegExp(`paymentSchedule:\\s*proposalPaymentLines\\(\\s*clientView\\.projectTotal\\s*,\\s*${linkParam}\\s*\\)`).test(linkBody),
  'copyProposalLink builds the schedule with proposalPaymentLines(clientView.projectTotal, <its split argument>)');
assert(!/savedSplit|paymentSplit|resolvePaymentSplit/.test(linkBody),
  'copyProposalLink never reads the split from settings (the saved value may be a render behind the answer)');
assert(!/\bawait\b/.test(linkBody), 'copyProposalLink awaits nothing before the clipboard write');
assert(/copyToClipboard\(/.test(linkBody), 'the clipboard write starts inside copyProposalLink (in the press)');

// copyProposalLink is reached only from a gate.run continuation.
const linkUses = [...review.matchAll(/copyProposalLink\(/g)].map((m) => m.index ?? -1);
const runCalls = [...review.matchAll(/gate\.run\(/g)].map((m) => {
  const open = (m.index ?? 0) + 'gate.run'.length;
  return { start: open, span: balanced(review, open) };
});
const insideRun = (idx: number) => runCalls.some((r) => idx > r.start && idx < r.start + r.span.length);
assert(linkUses.length >= 1 && linkUses.every(insideRun),
  `every copyProposalLink(...) call is inside a gate.run(...) continuation (${linkUses.length} call(s))`);
const shareRun = runCalls.find((r) => /copyProposalLink\(/.test(r.span));
assert(!!shareRun && /terms:\s*true/.test(shareRun.span) && /purpose:\s*'proposal_link'/.test(shareRun.span),
  "the share gate asks for terms with purpose 'proposal_link'");
assert(!!shareRun && !/identity:\s*true/.test(shareRun.span), 'the share gate asks no identity step (the link prints no letterhead)');
assert(!!shareRun && /\((\w+)\)\s*=>\s*\{[^}]*copyProposalLink\(\s*\1\.split\s*\)/.test(shareRun.span),
  "the continuation passes the gate's own answer (a.split) to copyProposalLink");
assert(!!shareRun && /afterDismiss/.test(shareRun.span),
  'the "Proposal link copied" alert waits for the ask sheet to finish closing (afterDismiss)');

// The client preview: his split when set, a not-set branch when not.
assert(/paymentSchedule=\{\s*savedSplit\s*\?\s*proposalPaymentLines\(\s*clientView\.projectTotal\s*,\s*savedSplit\s*\)\s*:\s*undefined\s*\}/.test(review),
  'the client preview prints proposalPaymentLines when set and no schedule when not');
// While his profile is still loading (or the read failed) the card says so
// instead of "not set" — so the not-set branch now sits after a status branch,
// reached as `) : !savedSplit ? (`. Anchor on either form, and pin that the
// loading/failed branch comes FIRST so "not set" can never show before a load.
const notSet = /(?:\{|:\s*)!savedSplit \?/.exec(review);
const statusBranch = review.indexOf("savedTerms.status !== 'ready' ? (");
assert(statusBranch >= 0 && !!notSet && statusBranch < notSet.index,
  'the terms card checks the profile-load status before it can say "not set yet"');
assert(/testID="review-terms-loading"/.test(review) && /onPress=\{savedTerms\.retry\}/.test(review),
  '…and the loading/failed branch has its own card with a Retry on a failed read');
const notSetSpan = notSet ? review.slice(notSet.index, notSet.index + 900) : '';
assert(/Payment schedule — not set yet\. You’ll be asked before you share\./.test(notSetSpan),
  'the client preview has the GC-only "not set yet" line');
assert(/label="Set now"/.test(notSetSpan) && /onPress=\{handleSetTermsNow\}/.test(notSetSpan),
  '…with a Set now button');
const setNowDecl = /const handleSetTermsNow = useCallback\(\(\) => \{/.exec(review);
const setNowBody = setNowDecl ? balanced(review, setNowDecl.index + setNowDecl[0].length - 1) : '';
assert(/gate\.run\(\s*\{\s*terms:\s*true[^}]*\}\s*,\s*\(\)\s*=>\s*\{\s*\}\s*\)/.test(setNowBody),
  'Set now opens the same gate with a no-op continuation (nothing paused behind it)');
assert((review.match(/<ClientDocumentAskSheet\b/g) ?? []).length === 1, 'review.tsx renders the ask sheet exactly once');

// 8. How the homeowner says yes (audit 2026-09-18, #123). The link ended at
// "Powered by MAGE ID": no phone, no email, no next step.
{
  const withContact = buildClientEstimateSharePayload(view, {
    projectName: 'Kitchen', gcName: 'Acme Builders',
    paymentSchedule: proposalPaymentLines(view.projectTotal, SPLIT_25_65_10),
    gcPhone: ' (512) 555-0142 ', gcEmail: 'bids@acme.test', acceptance: acceptanceSentence(SPLIT_25_65_10),
  });
  assert(withContact.v === 1, 'the contact fields are additive — the token stays v:1');
  assert(withContact.ph === '(512) 555-0142' && withContact.em === 'bids@acme.test', 'phone and email ride on the link, trimmed');
  assert(withContact.acc === acceptanceSentence(SPLIT_25_65_10), 'the closing sentence is acceptanceSentence for his split — the PDF’s words');
  const rt = decodeClientEstimateToken(encodeClientEstimateToken(withContact));
  assert(JSON.stringify(rt) === JSON.stringify(withContact), 'a link with contact fields round-trips exactly');
  const blank = buildClientEstimateSharePayload(view, { projectName: 'Kitchen', gcPhone: '', gcEmail: '   ' });
  assert(!('ph' in JSON.parse(JSON.stringify(blank))) && !('em' in JSON.parse(JSON.stringify(blank))),
    'an unsaved phone / email is left OFF the link, never sent blank');
  // A link minted before this change carries none of the three and must still open.
  const old = decodeClientEstimateToken(encodeClientEstimateToken({ v: 1, n: 'Old', total: 100, scope: [] }));
  assert(!!old, 'a link sent before the contact fields existed still decodes');

  const b1 = shareProceedBlock(withContact);
  assert(b1.phone?.href === 'tel:5125550142' && b1.phone?.label === '(512) 555-0142',
    `the phone becomes a tel: link of its digits (${b1.phone?.href})`);
  assert(b1.email?.href === 'mailto:bids@acme.test', `the email becomes a mailto: link (${b1.email?.href})`);
  assert(!/reply to this estimate/.test(b1.sentence) && /contact details below/.test(b1.sentence),
    `a web page cannot be replied to — the sentence points at the links (“${b1.sentence}”)`);
  assert(/deposit received/.test(b1.sentence), '…and keeps the rest of his acceptance sentence');
  const b2 = shareProceedBlock({});
  assert(b2.sentence === SHARE_REPLY_FALLBACK && !b2.phone && !b2.email,
    'no contact saved (or an old link): one honest line, no invented phone or email');
  const b3 = shareProceedBlock({ acc: acceptanceSentence(null) });
  assert(/reply to the message this link came in/.test(b3.sentence), 'a sentence with no contact points at the message the link came in');
  const b4 = shareProceedBlock({ ph: 'javascript:alert(1)', em: 'not an email' });
  assert(!b4.phone && !b4.email, 'a crafted token cannot make a contact link out of junk');
  const b5 = shareProceedBlock({ ph: '+1 512 555 0142' });
  assert(b5.phone?.href === 'tel:+15125550142', `only digits and + reach the tel: target (${b5.phone?.href})`);

  // The screen renders it, to the cent.
  const shared = stripComments(readFileSync(join(ROOT, 'app', 'shared-estimate.tsx'), 'utf8'));
  assert(/shareProceedBlock\(payload\)/.test(shared) && /testID="shared-estimate-proceed"/.test(shared),
    'shared-estimate renders the To proceed block from shareProceedBlock');
  assert(/Linking\.openURL\(proceed\.phone!\.href\)/.test(shared) && /Linking\.openURL\(proceed\.email!\.href\)/.test(shared),
    '…whose links open the tel: / mailto: targets it built');
  assert(/minimumFractionDigits: 2, maximumFractionDigits: 2/.test(shared) && !/Math\.round\(n\)/.test(shared),
    'shared-estimate prints money to the cent, not Math.round whole dollars');

  // Review fills them from his saved branding and the gate's split.
  assert(new RegExp(`gcPhone:\\s*settings\\?\\.branding\\?\\.phone`).test(linkBody)
    && new RegExp(`gcEmail:\\s*settings\\?\\.branding\\?\\.email`).test(linkBody),
    'copyProposalLink passes his saved phone and email');
  assert(new RegExp(`acceptance:\\s*acceptanceSentence\\(\\s*${linkParam}\\s*\\)`).test(linkBody),
    'copyProposalLink passes acceptanceSentence(<its split argument>) — the same split the schedule uses');
  assert(/validThrough:\s*toCalendarDayString\(addCalendarDays\(new Date\(\), 30\)\)/.test(linkBody),
    'copyProposalLink states the 30-day validity as a calendar day');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

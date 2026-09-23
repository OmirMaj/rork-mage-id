// validate-activation-signals.ts — the first ten minutes of a new account.
//
// Originally this file pinned one thing: the grounding props attached to the
// activation funnel's aha event. It now also pins the three defects the
// 2026-09 activation audit found on that same path, because all three are the
// kind that a screen refactor silently re-opens:
//
//   ITEM 18  The sample job (utils/demoSeed) is the fastest "oh, I get it" the
//            product has, and its only door was a link under the Home empty
//            state — which a user reaches by ABANDONING onboarding. It is now a
//            peer CTA on the final preview card, and it must not be able to
//            seed two projects from two taps in one frame.
//   ITEM 19  utils/pdfDesign.ts prints `branding.companyName || 'MAGE ID'` and
//            drops the licence line when the number is blank, and the wizard
//            passed 'MAGE ID' as its own default — so a contractor's first bid
//            went to a homeowner under the software vendor's name with no
//            licence number. CA/FL/AZ fine you for the second half of that.
//            2026-09-17: the share asks through the one "ask when it matters"
//            sheet (identity, then payment terms) instead of its own modal.
//   ITEM 20  Nothing outside a Settings toggle ever raised the push permission
//            dialog, so notify / notification_outbox / morning-digest /
//            invoice-dunning had no device token to reach. The ask is now
//            contextual, once, and never inside onboarding.
//   ITEM 22  The quick-estimate PDF and wizard preview printed 25 / 65 / 10
//            nobody chose. Every schedule now comes from utils/paymentTerms
//            with the GC's own answer, changed under Company Profile/Settings.
//
// FIRST-PRINCIPLE FOR ANYONE EDITING THIS FILE, inherited from
// scripts/validate-location-consent.ts: a check a bug can walk around is worse
// than no check, because it reports "all passed" over the bug. Every scan below
// was mutation-tested — the defect was restored in a scratch mirror of the file
// and the scan was confirmed to fail. Structural scans read BALANCED regions,
// not substrings, so moving a line out of a guarded branch is visible.
//
// Run via: bun run scripts/validate-activation-signals.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { estimateGroundingProps } from '@/utils/activationSignals';
import type { CostDatabase } from '@/utils/costDatabase';
import {
  BID_LICENCE_RULES, PDF_VENDOR_PLACEHOLDER,
  bidIdentityGap, bidLicenceRuleForState, bidStateFromBranding, mergedBidBranding,
  bidLicenceStateSource, licenceStateColumnValue, licenceExpiryColumnValue,
} from '@/utils/bidDocumentIdentity';
import { splitLocationText } from '@/utils/codeJurisdiction';
import {
  decidePushAsk, pushAskCopy, PUSH_ASK_MOMENTS, PUSH_ASK_COPY,
  type PushAskMoment,
} from '@/utils/pushPermissionAsk';
import { isAppStorageKey } from '@/utils/localCacheKeys';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
function eq(name: string, got: unknown, want: unknown) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
    `got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Balanced-region reader. Substring scans are what let a guard pass over a
// mutation: `contains('return')` is true whether or not the return sits inside
// the branch that matters. These read the actual block.
// ─────────────────────────────────────────────────────────────────────────────

/** The `{ … }` region beginning at the first brace at/after `from`, matched,
 *  skipping string literals and comments so a brace inside copy or a URL does
 *  not throw the count off. Returns '' when nothing balances. */
function balancedFrom(src: string, from: number): string {
  const start = src.indexOf('{', from);
  if (start < 0) return '';
  let depth = 0;
  let i = start;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') { i = src.indexOf('\n', i); if (i < 0) return ''; continue; }
    if (c === '/' && next === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) return ''; i = e + 2; continue; }
    if (c === '\'' || c === '"' || c === '`') {
      const quote = c;
      i++;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
    i++;
  }
  return '';
}

/** The source with comments removed, so a scan for a forbidden literal reads
 *  what the app DOES and not what a comment says about it. Without this, the
 *  only way to pass the "no vendor name in the wizard" check would be to stop
 *  explaining the bug the check exists for. */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') { const e = src.indexOf('\n', i); if (e < 0) break; i = e; continue; }
    if (c === '/' && next === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) break; i = e + 2; continue; }
    if (c === '\'' || c === '"' || c === '`') {
      const quote = c;
      out += c; i++;
      while (i < src.length) {
        if (src[i] === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
        out += src[i];
        if (src[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

/** The body of a `const <name> = useCallback(...)` / `= (...)` declaration. */
function callbackBody(src: string, name: string): string {
  const decl = src.indexOf(`const ${name} = `);
  if (decl < 0) return '';
  // Skip past the parameter list to the arrow, so the body brace is found and
  // not a destructured parameter.
  const arrow = src.indexOf('=>', decl);
  if (arrow < 0) return '';
  return balancedFrom(src, arrow);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\nactivation signals (aha grounding props):');
// ═════════════════════════════════════════════════════════════════════════════
const db = (entries: { provenance: string }[], jobsAnalyzed: number): CostDatabase =>
  ({ entries, jobsAnalyzed } as unknown as CostDatabase);

eq('empty', estimateGroundingProps(db([], 0)),
  { used_learned_costs: false, learned_rate_count: 0, jobs_analyzed: 0 });
eq('seeded-only', estimateGroundingProps(db([{ provenance: 'seeded' }, { provenance: 'seeded' }], 0)),
  { used_learned_costs: true, learned_rate_count: 0, jobs_analyzed: 0 });
eq('mixed-and-earned', estimateGroundingProps(db([{ provenance: 'earned' }, { provenance: 'mixed' }, { provenance: 'seeded' }], 3)),
  { used_learned_costs: true, learned_rate_count: 2, jobs_analyzed: 3 });
eq('all-earned', estimateGroundingProps(db([{ provenance: 'earned' }, { provenance: 'earned' }], 5)),
  { used_learned_costs: true, learned_rate_count: 2, jobs_analyzed: 5 });
// A legacy entry with no provenance predates the seeded-rate feature, so it is
// earned data — it MUST count toward learned_rate_count (undefined !== 'seeded').
eq('undefined-provenance-counts-as-learned',
  estimateGroundingProps(db([{ provenance: undefined as unknown as string }], 1)),
  { used_learned_costs: true, learned_rate_count: 1, jobs_analyzed: 1 });

// ═════════════════════════════════════════════════════════════════════════════
console.log('\nITEM 19 — bid document identity (pure):');
// ═════════════════════════════════════════════════════════════════════════════
const CA = { companyName: 'Ortiz Builders', address: '1200 Wilshire Blvd, Los Angeles, CA 90017', licenseNumber: '' };
const TXT = { companyName: 'Ortiz Builders', address: '900 Congress Ave, Austin, TX 78701', licenseNumber: '' };

ok('licence table is cited row by row',
  BID_LICENCE_RULES.every(r => /^[A-Z]{2}$/.test(r.state)
    && r.citation.length > 6 && r.requirement.length > 10
    && /^\d{4}-\d{2}-\d{2}$/.test(r.checkedOn)
    && r.sourceUrl.startsWith('https://')),
  'every row needs a statute, what it covers, the date it was read and the URL it was read at');
ok('licence table has no duplicate states',
  new Set(BID_LICENCE_RULES.map(r => r.state)).size === BID_LICENCE_RULES.length);
// The table is deliberately small. An uncited state is asked for nothing —
// that is the correct answer, not a coverage gap to be padded with recall.
eq('CA has a rule', bidLicenceRuleForState('California')?.authority, 'CSLB');
eq('AZ has a rule', bidLicenceRuleForState('az')?.authority, 'AZ ROC');
eq('TX has no rule (no state residential licence to cite)', bidLicenceRuleForState('TX'), null);
eq('unparseable state has no rule', bidLicenceRuleForState('Freedonia'), null);
eq('empty state has no rule', bidLicenceRuleForState(''), null);

eq('state comes off the profile address', bidStateFromBranding(CA), 'CA');
eq('address with no state yields no state', bidStateFromBranding({ address: 'Main St' }), '');

// The exact shape that shipped: `?? 'MAGE ID'` only ever caught null/undefined,
// so a blank string reached pdfDesign's own `|| 'MAGE ID'` fallback and the
// vendor's name printed on the bid.
eq('blank company name is missing',
  bidIdentityGap({ companyName: '', address: '', licenseNumber: '' }).needsCompanyName, true);
eq('whitespace company name is missing',
  bidIdentityGap({ companyName: '   ', address: '', licenseNumber: '' }).needsCompanyName, true);
eq('the vendor placeholder itself is missing',
  bidIdentityGap({ companyName: PDF_VENDOR_PLACEHOLDER, address: '', licenseNumber: '' }).needsCompanyName, true);
eq('the vendor placeholder in any case is missing',
  bidIdentityGap({ companyName: 'mage id', address: '', licenseNumber: '' }).needsCompanyName, true);
eq('a real company name is not missing',
  bidIdentityGap({ companyName: 'Ortiz Builders', address: '', licenseNumber: '' }).needsCompanyName, false);

eq('CA with no licence number blocks', bidIdentityGap(CA).blocking, true);
eq('CA with no licence number names the licence', bidIdentityGap(CA).needsLicence, true);
eq('CA with a licence number does not block',
  bidIdentityGap({ ...CA, licenseNumber: '1043927' }).blocking, false);
eq('whitespace licence number still blocks',
  bidIdentityGap({ ...CA, licenseNumber: '  ' }).needsLicence, true);
eq('TX with no licence number does not block', bidIdentityGap(TXT).blocking, false);
eq('unknown state with a name does not block',
  bidIdentityGap({ companyName: 'Ortiz Builders', address: '', licenseNumber: '' }).blocking, false);

// The repo rule is that a blocked button says why. The reason must name the
// DOCUMENT and the consequence, not the field — and it must cite the statute
// whenever it is the licence that is blocking.
const caGap = bidIdentityGap({ ...CA, companyName: '' });
ok('reason names the vendor string a homeowner would see',
  caGap.reason.includes(PDF_VENDOR_PLACEHOLDER), caGap.reason);
ok('reason cites the statute when the licence blocks',
  caGap.reason.includes('7030.5'), caGap.reason);
ok('reason is empty when nothing is missing',
  bidIdentityGap({ ...CA, licenseNumber: '1043927' }).reason === '');
ok('title names the document, not the form',
  /homeowner/i.test(caGap.title), caGap.title);

const merged = mergedBidBranding(
  { companyName: '', contactName: 'R. Ortiz', address: CA.address, licenseNumber: '', tagline: 't', email: 'e', phone: 'p' },
  { companyName: '  Ortiz Builders  ', licenseNumber: ' 1043927 ' },
);
eq('merge trims what was typed', [merged.companyName, merged.licenseNumber], ['Ortiz Builders', '1043927']);
eq('merge keeps the fields the ask never showed', [merged.contactName, merged.tagline], ['R. Ortiz', 't']);
eq('merged branding clears the block', bidIdentityGap(merged).blocking, false);
eq('a merge that only fills the name still blocks in CA',
  bidIdentityGap(mergedBidBranding({ address: CA.address }, { companyName: 'Ortiz Builders' })).blocking, true);

// ═════════════════════════════════════════════════════════════════════════════
console.log('\nITEM 20 — push ask decision (pure):');
// ═════════════════════════════════════════════════════════════════════════════
const ASKABLE = {
  platform: 'ios', hasSeenOnboarding: true, signedIn: true,
  alreadyAsked: false, permission: 'undetermined' as const, canAskAgain: true,
};
eq('a settled first-run user at a real moment is asked', decidePushAsk(ASKABLE).ask, true);
eq('web is never asked', decidePushAsk({ ...ASKABLE, platform: 'web' }).ask, false);
eq('a signed-out user is never asked', decidePushAsk({ ...ASKABLE, signedIn: false }).ask, false);
// The whole point of the contextual ask: it must not fire inside first-run,
// where the user has seen nothing and iOS spends the one dialog forever.
eq('mid-onboarding is never asked', decidePushAsk({ ...ASKABLE, hasSeenOnboarding: false }).ask, false);
eq('unknown onboarding state is never asked (context still loading)',
  decidePushAsk({ ...ASKABLE, hasSeenOnboarding: null }).ask, false);
eq('a device already asked is never asked again',
  decidePushAsk({ ...ASKABLE, alreadyAsked: true }).ask, false);
eq('a denial is never re-asked', decidePushAsk({ ...ASKABLE, permission: 'denied' }).ask, false);
eq('canAskAgain:false is never asked', decidePushAsk({ ...ASKABLE, canAskAgain: false }).ask, false);
eq('already granted is not asked', decidePushAsk({ ...ASKABLE, permission: 'granted' }).ask, false);

// `remember` writes the once-only record. A TRANSIENT no must not write it, or
// a render that lands while ProjectContext is still loading its onboarding flag
// would cost the user the ask permanently.
const notAsked = (d: ReturnType<typeof decidePushAsk>) => (d.ask ? null : d.remember);
eq('a permanent OS denial is remembered', notAsked(decidePushAsk({ ...ASKABLE, permission: 'denied' })), true);
eq('canAskAgain:false is remembered', notAsked(decidePushAsk({ ...ASKABLE, canAskAgain: false })), true);
eq('an existing grant is remembered', notAsked(decidePushAsk({ ...ASKABLE, permission: 'granted' })), true);
eq('mid-onboarding is NOT remembered', notAsked(decidePushAsk({ ...ASKABLE, hasSeenOnboarding: false })), false);
eq('unknown onboarding state is NOT remembered', notAsked(decidePushAsk({ ...ASKABLE, hasSeenOnboarding: null })), false);
eq('signed out is NOT remembered', notAsked(decidePushAsk({ ...ASKABLE, signedIn: false })), false);
// Ordering: onboarding is checked before the already-asked latch, so a stray
// first-run evaluation cannot be reported as "already handled".
eq('onboarding outranks the already-asked latch',
  decidePushAsk({ ...ASKABLE, hasSeenOnboarding: false, alreadyAsked: true }).because,
  'onboarding is not finished');

// Driven off the module's own exported list, NOT a literal repeated here. A
// hardcoded copy of the moments is the guard-weakness this campaign keeps
// finding: add a third moment and the literal still lists two, so the new one
// ships verified by nothing.
ok('there is at least one ask moment', PUSH_ASK_MOMENTS.length > 0);
for (const m of PUSH_ASK_MOMENTS) {
  // Own entry, not the fallback pushAskCopy() returns for an off-union value —
  // otherwise a moment with no copy of its own would silently borrow another's
  // headline and pass.
  const own = Object.prototype.hasOwnProperty.call(PUSH_ASK_COPY, m);
  ok(`${m} has copy of its own`, own,
    'pushAskCopy falls back so the dialog never reads "undefined"; the fallback must not be how a moment gets its wording');
  const copy = pushAskCopy(m);
  ok(`${m} has copy`, !!copy && copy.title.length > 0 && copy.body.length > 0
    && copy.confirm.length > 0 && copy.decline.length > 0);
  // The soft ask is a question, not a wall — declining has to be an offered
  // answer, because a decline here leaves the OS dialog unspent.
  ok(`${m} offers a decline`, /not now|later|no thanks/i.test(copy.decline), copy.decline);
}
ok('every moment has a distinct headline',
  new Set(PUSH_ASK_MOMENTS.map(m => pushAskCopy(m).title)).size === PUSH_ASK_MOMENTS.length,
  'two moments sharing a headline means one of them is reading the other\'s copy');
// pushAskCopy's own header says it is total because the record is written
// BEFORE the copy is read, so a bare `COPY[moment]` would spend the device's
// one and only ask on a dialog reading "undefined". Nothing verified that:
// dropping the `??` arm left every check green. TypeScript cannot reach this —
// the point is a moment arriving from somewhere the union does not describe.
{
  const offUnion = 'invoice_sent' as unknown as PushAskMoment;
  const copy = pushAskCopy(offUnion);
  ok('pushAskCopy is total — an unknown moment still yields real copy',
    !!copy && typeof copy.title === 'string' && copy.title.length > 0
    && typeof copy.body === 'string' && copy.body.length > 0
    && typeof copy.confirm === 'string' && copy.confirm.length > 0
    && typeof copy.decline === 'string' && copy.decline.length > 0,
    `got ${JSON.stringify(copy)} — the one push dialog a user ever gets must not read "undefined"`);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\nITEM 18 — the sample job is offered inside onboarding:');
// ═════════════════════════════════════════════════════════════════════════════
const onboarding = read('app/onboarding.tsx');

ok('there is exactly one final preview card',
  (onboarding.match(/isTryIt: true/g) ?? []).length === 1);
ok('the primary CTA on it prices a real bid',
  onboarding.includes("isLast ? 'Price a real bid' : 'Next'"),
  'the last card must name the real-bid path, not a generic advance');

const tourJsx = balancedFrom(onboarding, onboarding.indexOf('{isLast && ('));
ok('the sample-job CTA is rendered on the final card',
  tourJsx.includes('testID="onboarding-tour-sample"'),
  'the sample tour must sit beside the real-bid CTA, not behind abandoning the flow');
ok('the sample-job CTA calls the guarded handler',
  tourJsx.includes('onPress={handleTourSample}'), tourJsx.slice(0, 200));
ok('the sample-job CTA is disabled while a seed is running',
  tourJsx.includes('disabled={seedingSample}'),
  'without this the button stays tappable through the whole async seed');

const tour = callbackBody(onboarding, 'handleTourSample');
ok('handleTourSample exists', tour.length > 0);
const firstAwait = tour.indexOf('await ');
const latchRead = tour.indexOf('if (seedingRef.current) return;');
const latchSet = tour.indexOf('seedingRef.current = true;');
ok('the double-fire latch is a ref, read before anything async',
  latchRead >= 0 && latchSet >= 0 && firstAwait >= 0 && latchRead < latchSet && latchSet < firstAwait,
  `read@${latchRead} set@${latchSet} firstAwait@${firstAwait} — a state flag does not update until the next render, so two taps in one frame would both pass`);
ok('handleTourSample seeds the demo project', tour.includes('seedDemoProject({'));
ok('handleTourSample completes onboarding so the user is not looped back',
  tour.includes('await completeOnboarding();'));

// The landing, and why it is two calls and not one. app/_layout.tsx declares NO
// `initialRouteName` anchor on purpose (UX-F18 there), so a bare
// `router.replace('/project-detail')` out of onboarding leaves a root stack of
// exactly one entry: project-detail is not inside (tabs), so there is no tab
// bar, and the native header draws no back chevron at index 0. The user who
// picked the sample tour could see the sample and nothing else, ever. Replace
// onto the tab shell FIRST, then push the job on top of it.
const replaceIdx = tour.indexOf("router.replace('/(tabs)/(home)'");
// team-invites #93: a stashed invite deep link replayed after onboarding wins
// over the sample job, but it is still PUSHED on top of the tab shell — the
// ordering invariant is unchanged, only the push target gained a `replayTarget ??`.
const pushMatch = /router\.push\(\(?(?:replayTarget \?\? )?\{ pathname: '\/project-detail'/.exec(tour);
const pushIdx = pushMatch ? pushMatch.index : -1;
ok('the sample tour lands on the tab shell, not on a stack of one',
  replaceIdx >= 0, 'replace onto /(tabs)/(home) is what gives Back something to pop to');
ok('…and opens the sample job on top of it',
  pushIdx > replaceIdx && replaceIdx >= 0,
  `replace@${replaceIdx} push@${pushIdx} — pushing first would put the tab shell above the job`);
ok('the sample job is never the whole stack',
  !/router\.replace\(\{\s*pathname:\s*'\/project-detail'/.test(tour),
  'replacing straight onto project-detail is the dead end this check exists for');

const seedCatchIdx = tour.indexOf('} catch');
const latchRelease = tour.indexOf('seedingRef.current = false;');
ok('the latch is released only when the SEED itself failed',
  seedCatchIdx > 0 && latchRelease > seedCatchIdx && latchRelease < tour.indexOf('await completeOnboarding();'),
  'a seed that threw is the one failure worth another tap — everything AFTER it (completeOnboarding, the navigation) has a sample project already on the account, and re-arming there means the next tap writes a second one');
ok('the seed failure path returns rather than falling through to the navigation',
  balancedFrom(tour, seedCatchIdx).includes('return;'),
  'without the return a failed seed still routes the user to a project id that was never created');
ok('the latch is released exactly once',
  (tour.match(/seedingRef\.current = false;/g) ?? []).length === 1,
  'a second release is a second way to re-arm the button over an account that already has the sample');

// ═════════════════════════════════════════════════════════════════════════════
console.log('\nITEM 19 — the share is what asks, and it asks once:');
// ═════════════════════════════════════════════════════════════════════════════
// 2026-09-17 (Direction B, "ask when it matters"): the wizard's own identity
// modal is gone. The share now goes through the ONE ask sheet
// (hooks/useClientDocumentGate + components/ClientDocumentAskSheet), which asks
// for the company identity only when bidIdentityGap blocks and for the GC's
// payment terms only when his profile has none. What the sheet asks and whether
// each ask is satisfiable is held by scripts/validate-payment-terms.ts (j);
// this block holds the WIZARD to using it — one send, reached only through it.
const wizard = read('app/estimate-wizard.tsx');
const wizardCode = stripComments(wizard);

ok('the wizard no longer carries the vendor name as a branding default',
  !wizardCode.includes(`'${PDF_VENDOR_PLACEHOLDER}'`),
  `a literal '${PDF_VENDOR_PLACEHOLDER}' in this file is the defect: it is what printed on the homeowner's copy`);
ok('the PDF leaves from exactly one place',
  (wizardCode.match(/shareQuickEstimatePDF\(/g) ?? []).length === 1,
  'a second send path is a second way past the ask');

const genBody = callbackBody(wizard, 'generateAndSharePdf');
// It takes the PRICED estimate, the branding and the split as arguments: the
// markup gate hands it a freshly-priced breakdown one tick before React has
// re-rendered `result`, and the ask sheet hands it a branding and a split typed
// one tick before savePaymentTerms / updateSettings have re-rendered settings.
// Reading any of the three from the closure prints the contractor's cost, the
// blank profile, or no payment schedule on the homeowner's PDF.
ok('the send takes its priced estimate, branding and payment split as arguments',
  genBody.includes('shareQuickEstimatePDF(priced, answers, branding, split)'),
  genBody.slice(0, 240));
ok('…and its signature requires the split',
  /const generateAndSharePdf = useCallback\(async \(branding: CompanyBranding, priced: EstimateResult, split: PaymentSplit\)/.test(wizard),
  'an optional split is how "not set" reaches the PDF');
ok('…and never the closure `result`',
  !/shareQuickEstimatePDF\(\s*result\b/.test(genBody),
  'the closure `result` is still the at-cost breakdown one tick after the markup is recorded');

// Two presses reach this one send — the share button and the ask sheet's last
// press — and `sharingPdf` only disables them on the render AFTER the first
// tap. The re-entry latch has to be a ref, and it has to sit on the send.
const sendLatchRead = genBody.indexOf('if (sharingRef.current) return;');
const sendLatchSet = genBody.indexOf('sharingRef.current = true;');
const sendFirstAwait = genBody.indexOf('await ');
ok('the send carries a ref re-entry latch, taken before anything async',
  sendLatchRead >= 0 && sendLatchSet > sendLatchRead && sendFirstAwait > sendLatchSet,
  `read@${sendLatchRead} set@${sendLatchSet} firstAwait@${sendFirstAwait}`);
ok('the send latch is released in finally, so a failed share can be retried',
  balancedFrom(genBody, genBody.indexOf('} finally')).includes('sharingRef.current = false;'),
  'releasing anywhere but finally leaves the share button dead after one failure');

const shareBody = stripComments(callbackBody(wizard, 'share'));
const goBody = callbackBody(shareBody, 'go');
const runIdx = goBody.indexOf('gate.run(');
const runNeeds = runIdx >= 0 ? balancedFrom(goBody, runIdx) : '';
ok('share asks through the one gate — identity and payment terms, as a proposal PDF, on this job’s total',
  runIdx >= 0 && /identity: true/.test(runNeeds) && /terms: true/.test(runNeeds)
  && /purpose: 'proposal_pdf'/.test(runNeeds) && /total: priced\.total/.test(runNeeds),
  runNeeds.slice(0, 240));
const reqIdx = shareBody.indexOf('if (!requireMarkup(go)) return;');
const goCallIdx = shareBody.indexOf('go(markupPct as number);');
ok('share takes the markup answer first, and only then runs the gate',
  reqIdx >= 0 && goCallIdx > reqIdx && runIdx >= 0,
  `requireMarkup@${reqIdx} go@${goCallIdx} gate@${runIdx}`);
// The continuation, both halves. `then` keeps the press (web: window.open);
// the native print → share sheet waits for the ask sheet to finish sliding out
// (iOS refuses a share sheet over a dismissing modal). Both send the ANSWERS.
{
  const thenStart = goBody.indexOf('(a) => {', runIdx);
  const thenArm = thenStart >= 0 ? balancedFrom(goBody, thenStart) : '';
  ok('on web the send runs inside the last press, with the answers',
    /if \(Platform\.OS === 'web'\) void generateAndSharePdf\(a\.branding, priced, a\.split\);/.test(thenArm),
    thenArm.slice(0, 240));
  ok('…elsewhere the answers are held for afterDismiss, not sent under a closing modal',
    /else answered = \{ branding: a\.branding, split: a\.split \};/.test(thenArm), thenArm.slice(0, 240));
  const afterIdx = goBody.indexOf('afterDismiss:', runIdx);
  const afterArm = afterIdx >= 0 ? balancedFrom(goBody, goBody.indexOf('=>', afterIdx)) : '';
  ok('afterDismiss sends exactly what the sheet answered',
    /if \(answered\) void generateAndSharePdf\(answered\.branding, priced, answered\.split\);/.test(afterArm),
    afterArm.slice(0, 240));
  ok('share has exactly those two sends, and nothing waits before either',
    (shareBody.match(/generateAndSharePdf\(/g) ?? []).length === 2
    && !/\bawait\b|setTimeout|InteractionManager/.test(shareBody),
    'an await or timer before the send loses the web gesture — the popup is blocked and nothing goes out');
}

ok('the wizard’s own identity modal is gone',
  !wizardCode.includes('showIdentityModal') && !wizardCode.includes('saveIdentityAndShare')
  && !wizardCode.includes('identityDraft') && !wizardCode.includes('wizard-identity-'),
  'a second ask beside the gate is a second set of rules for the same homeowner document');
ok('the ask sheet is rendered exactly once, from the gate',
  (wizardCode.match(/<ClientDocumentAskSheet\b/g) ?? []).length === 1
  && wizardCode.includes('<ClientDocumentAskSheet {...gate.sheet} />')
  && /const gate = useClientDocumentGate\(\);/.test(wizardCode));
ok('the wizard calls bidIdentityGap nowhere directly',
  !/bidIdentityGap\(/.test(wizardCode),
  'the gate owns the identity check (with the market); a direct call is a second, drifting copy');

// ── THE ASK HAS TO BE SATISFIABLE ────────────────────────────────────────────
// This is the one that would cost every new account: a gate whose ask has no
// field for the thing that is blocking is a wall. Blocking can only ever be
// caused by the two fields the ask collects; that the sheet renders those two
// fields is held by validate-payment-terms (j).
{
  const sweep: Parameters<typeof bidIdentityGap>[0][] = [
    {}, { companyName: '' }, { companyName: 'Ortiz Builders' },
    { companyName: PDF_VENDOR_PLACEHOLDER }, { address: CA.address },
    { companyName: 'Ortiz Builders', address: CA.address },
    { companyName: 'Ortiz Builders', address: CA.address, licenseNumber: '1043927' },
    { companyName: 'Ortiz Builders', address: TXT.address },
    ...BID_LICENCE_RULES.map(r => ({ companyName: '', address: `1 Main St, Springfield, ${r.state} 10001` })),
  ];
  ok('nothing can block the share except the two fields the ask collects',
    sweep.every(b => {
      const g = bidIdentityGap(b);
      return g.blocking === (g.needsCompanyName || g.needsLicence);
    }),
    'a third blocking reason would be a wall with no field behind it');
}

// ── iOS: ONE MODAL AT A TIME ─────────────────────────────────────────────────
// The markup sheet's continuation opens the ask sheet (or the share sheet). On
// iOS a Modal presented while another is still sliding out is refused, and the
// tap he made is honoured by nothing. So on iOS the continuation waits for the
// markup Modal's onDismiss; web and Android run it in the press (web needs the
// gesture for window.open).
{
  const apply = stripComments(callbackBody(wizard, 'applyMarkupChoice'));
  const iosIdx = apply.indexOf("if (Platform.OS === 'ios') {");
  const iosArm = iosIdx >= 0 ? balancedFrom(apply, iosIdx) : '';
  const elseIdx = iosIdx >= 0 ? apply.indexOf('} else {', iosIdx) : -1;
  const elseArm = elseIdx >= 0 ? balancedFrom(apply, elseIdx) : '';
  ok('on iOS applyMarkupChoice parks its continuation for the Modal’s onDismiss',
    /afterMarkupDismissRef\.current = \(\) => then\(pct\);/.test(iosArm),
    iosArm.slice(0, 200));
  ok('…and runs it in the press everywhere else',
    /then\(pct\);/.test(elseArm), elseArm.slice(0, 200));
  ok('…and nowhere outside those two arms',
    (apply.match(/then\??\.?\(pct\)/g) ?? []).length === 2,
    'a stray then(pct) outside the platform branch presents the ask sheet under the closing markup sheet on iOS');
  ok('the markup Modal drains the parked continuation on dismiss',
    /<Modal visible=\{showMarkupSheet\}[^>]*onDismiss=\{onMarkupSheetDismissed\}/.test(wizardCode)
    && /afterMarkupDismissRef\.current = null;\s*next\?\.\(\);/.test(stripComments(callbackBody(wizard, 'onMarkupSheetDismissed'))));
  ok('closing the markup sheet drops a parked continuation too',
    stripComments(callbackBody(wizard, 'dismissMarkupSheet')).includes('afterMarkupDismissRef.current = null;'),
    'a parked send surviving a close would fire the next time the sheet is dismissed for any reason');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\nITEM 20 — one permission path, contextual, never in onboarding:');
// ═════════════════════════════════════════════════════════════════════════════
const notifCtx = read('contexts/NotificationContext.tsx');
const notifSettings = read('app/notifications-settings.tsx');

// The inventory is closed on purpose. Two surfaces racing for the single iOS
// dialog is how an app spends it with no context attached.
ok('only two files raise the OS push dialog',
  notifCtx.includes('registerForPushNotifications({ prompt: true })')
  && notifSettings.includes('registerForPushNotifications({ prompt: true })'));
for (const f of ['app/onboarding.tsx', 'app/estimate-wizard.tsx', 'app/_layout.tsx']) {
  ok(`${f} does not raise the dialog itself`,
    !read(f).includes('registerForPushNotifications'),
    'the ask belongs to NotificationContext; a second path cannot be gated by the once-only record');
}

const PUSH_KEY = (notifCtx.match(/const PUSH_ASK_KEY = '([^']+)'/) ?? [])[1] ?? '';
ok('the once-only record has a key the app owns',
  !!PUSH_KEY && isAppStorageKey(PUSH_KEY),
  `${PUSH_KEY || '(none)'} — a key under an undeclared prefix is invisible to the tenant-switch sweep`);

const ask = callbackBody(notifCtx, 'maybeAskForPush');
ok('maybeAskForPush exists', ask.length > 0);
ok('it reads the persisted record and asks the pure decision',
  ask.includes('AsyncStorage.getItem(PUSH_ASK_KEY)') && ask.includes('decidePushAsk({'));
// Reading the record is not the same as USING it. This asserted only that the
// getItem call existed, and `alreadyAsked: false` passed it — the whole
// "asked once, ever" promise gone, with every qualifying moment raising the
// dialog again, and nothing red.
const decisionCall = balancedFrom(ask, ask.indexOf('decidePushAsk('));
ok('the persisted record is what tells the decision the device was already asked',
  /alreadyAsked:\s*stored\b/.test(decisionCall),
  `${decisionCall.slice(0, 240)} — a constant here breaks "asked once, ever" while the getItem call above still reads`);
ok('it passes the onboarding flag into the decision',
  /hasSeenOnboarding,/.test(decisionCall),
  'the decision cannot exclude first-run if it is never told about it');
const setIdx = ask.indexOf("outcome: 'prompted'");
const alertIdx = ask.indexOf('showAlert(');
ok('the ask is recorded BEFORE the dialog is shown',
  setIdx > 0 && alertIdx > 0 && setIdx < alertIdx,
  'recording after the answer loses the race with a backgrounding, a crash, or a fast second call — and the user gets asked twice');

// The two no-branches, read as BRANCHES. This was a substring test for
// `askStateRef.current = 'idle';` anywhere in the callback — and the catch at
// the bottom sets exactly that line, so flipping the transient-no branch to
// 'settled' (a render that landed while ProjectContext was still loading its
// onboarding flag, latching the ask shut for the life of the install) passed.
const notAskBranch = balancedFrom(ask, ask.indexOf('if (!decision.ask)'));
const rememberBranch = balancedFrom(notAskBranch, notAskBranch.indexOf('if (decision.remember)'));
const transientBranch = balancedFrom(notAskBranch, notAskBranch.indexOf('} else {', notAskBranch.indexOf('if (decision.remember)')));
ok('a permanent no is recorded and settled for this session',
  rememberBranch.includes('AsyncStorage.setItem(PUSH_ASK_KEY')
  && rememberBranch.includes("askStateRef.current = 'settled';"),
  rememberBranch.slice(0, 200));
ok('a transient no leaves the door open',
  transientBranch.length > 0
  && transientBranch.includes("askStateRef.current = 'idle';")
  && !transientBranch.includes("askStateRef.current = 'settled';"),
  `${transientBranch.slice(0, 200)} — latching shut on "context still loading" costs the user the ask forever`);
ok('…and so does a read that throws',
  balancedFrom(ask, ask.indexOf('} catch')).includes("askStateRef.current = 'idle';"),
  'a storage or permissions read that throws must not cost the device its one ask');

// Both call sites sit in the ELSE of the onboarding branch — i.e. the arc that
// routes to the paywall never reaches the ask.
const sites = [...wizard.matchAll(/maybeAskForPush\('/g)].map(m => m.index ?? -1);
ok('the wizard has both contextual call sites', sites.length === 2, `found ${sites.length}`);
for (const idx of sites) {
  const before = wizard.slice(0, idx);
  const elseIdx = before.lastIndexOf('} else {');
  const ifIdx = before.lastIndexOf('if (isOnboarding) {');
  const between = ifIdx >= 0 && elseIdx > ifIdx ? before.slice(ifIdx, elseIdx) : '';
  ok(`call site at ${idx} is inside the non-onboarding branch`,
    ifIdx >= 0 && elseIdx > ifIdx && between.includes('ONBOARDING_PAYWALL_ROUTE'),
    'a permission dialog raised mid-onboarding spends the one iOS prompt with nothing on screen to justify it');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\nITEM 21 — the profile surface that feeds the bid and the price (2026-09-16 screen audit):');
// ═════════════════════════════════════════════════════════════════════════════
// Five findings, one theme: a control on the profile surface that asked for a
// value and then did nothing with it.
//   (a) the bid licence gate read ONLY a state parsed from the company address,
//       whose placeholder taught "123 Main St, City" — so it never fired for a
//       new CA/FL/AZ account; Get Verified asked for the state and emailed it away.
//       2026-09-17: the fix stored that state on the pricing market; it now has
//       its own profile columns (license_state / license_expiry) and outranks
//       address and market — the checks below hold that precedence.
//   (b) Location / tax / contingency were saved only by a "Save Changes" button
//       ten sections below them, so leaving the tab dropped them silently.
//   (c) Contingency Rate was validated, synced, and read by nobody.
//   (d) "Edit public profile" pushed a per-project route with no project id.
//   (e) the Materials market picker was the one structured "where do you work"
//       control and it forgot the pick on the next visit.
{
  // (a) pure — precedence: the explicit licensing state, then the address
  // state, then the pricing market. Until 2026-09-17 the licensing answer was
  // STORED on the market (CompanyBranding had no state), so a CA metro picked
  // in Materials switched on California's statute and a contractor licensed
  // in one state who prices in another could not say so. The market stays as
  // the last fallback, so accounts that answered through it keep their gate.
  const NEW_CA = { companyName: 'Ortiz Builders', address: '', licenseNumber: '' };
  eq('a new account with no address but a CA market is asked for the licence',
    bidIdentityGap(NEW_CA, 'San Francisco, CA').needsLicence, true);
  eq('…from the market, and says so',
    bidLicenceStateSource(NEW_CA, 'San Francisco, CA'), { state: 'CA', source: 'market' });
  const marketReason = bidIdentityGap(NEW_CA, 'Phoenix, AZ').reason;
  ok('…and the reason names the market and the field that overrides it',
    /pricing market/i.test(marketReason) && /licensing state in Company Profile/.test(marketReason), marketReason);
  ok('…and no longer tells him to put a state he is not in into his address',
    !/company address/i.test(marketReason), marketReason);
  eq('the United States default names no state, so nothing is asked',
    bidIdentityGap(NEW_CA, 'United States').blocking, false);
  eq('an address state wins over the market (licensed where the office is)',
    bidStateFromBranding(TXT, 'San Francisco, CA'), 'TX');
  eq('no market passed behaves exactly as before',
    bidStateFromBranding(NEW_CA), '');

  // The explicit field — the coupling this item removes.
  eq('the licensing state wins over a CA market: a TX-licensed GC pricing in LA is not walled by CSLB',
    bidIdentityGap({ ...NEW_CA, licenseState: 'TX' }, 'Los Angeles, CA').blocking, false);
  eq('the licensing state wins over the address',
    bidLicenceStateSource({ ...TXT, licenseState: 'AZ' }, 'Las Vegas, NV'), { state: 'AZ', source: 'licence' });
  const licReason = bidIdentityGap({ ...TXT, licenseState: 'AZ' }, 'Las Vegas, NV');
  ok('…and an AZ licensing state still gets AZ\u2019s cited statute, naming its source',
    licReason.needsLicence && licReason.rule?.state === 'AZ' && licReason.reason.includes('32-1124')
    && /licensing state on your company profile/.test(licReason.reason), licReason.reason);
  const addrReason = bidIdentityGap(CA).reason;
  ok('an address-sourced block names the address', /from your company address/.test(addrReason), addrReason);
  eq('a licensing state that is not a state falls through to the address',
    bidLicenceStateSource({ ...TXT, licenseState: 'Freedonia' }), { state: 'TX', source: 'address' });
  eq('a blank licensing state falls through',
    bidLicenceStateSource({ ...NEW_CA, licenseState: '  ' }, 'Phoenix, AZ'), { state: 'AZ', source: 'market' });

  // Column values. A CHECK violation or a failed date cast is TERMINAL in the
  // offline queue and drops the WHOLE settings update, so the client must
  // never send what the migration refuses — held to parity with its CHECK.
  const migration = read('supabase/migrations/20260917120000_profile_license_fields.sql');
  const checkRe = migration.match(/license_state ~ '([^']+)'/)?.[1] ?? '';
  ok('the migration CHECKs license_state\u2019s shape', checkRe === '^[A-Z]{2}$', checkRe);
  const stateInputs = ['ca', 'California', ' AZ ', 'fl', 'TX', '', '  ', 'Calif.', 'Freedonia', 'C', null, undefined];
  ok('every licensing-state value the client can send passes the CHECK or is NULL',
    stateInputs.every(v => { const c = licenceStateColumnValue(v); return c === null || new RegExp(checkRe || '$^').test(c); }),
    JSON.stringify(stateInputs.map(v => licenceStateColumnValue(v))));
  eq('state column values', ['ca', 'California', '', 'Freedonia'].map(licenceStateColumnValue), ['CA', 'CA', null, null]);
  eq('expiry column values', [
    '2027-06-30', '2027-06-30T00:00:00+00:00', '2026-02-30', '06/30/2027', '2027-06-30abc', '', null,
  ].map(licenceExpiryColumnValue), ['2027-06-30', '2027-06-30', null, null, null, null, null]);
  ok('the migration stores the expiry as a date and says to apply it before the OTA',
    /add column if not exists license_expiry date/.test(migration) && /BEFORE THE OTA/.test(migration));

  // Every writer of a whole branding object carries the licence fields — the
  // object REPLACES settings.branding and ProjectContext saves an absent state
  // as NULL, so one forgetful writer erases the answer on every save.
  const kept = mergedBidBranding({ companyName: '', licenseState: 'AZ', licenseExpiry: '2027-06-30' }, { companyName: 'Ortiz Builders' });
  eq('the wizard\u2019s ask (mergedBidBranding) keeps a saved licensing state and expiry',
    [kept.licenseState, kept.licenseExpiry], ['AZ', '2027-06-30']);
  eq('an explicit \u2018\u2019 clears the licensing state',
    mergedBidBranding({ licenseState: 'AZ' }, { licenseState: '' }).licenseState, '');

  const ctx = stripComments(read('contexts/ProjectContext.tsx'));
  const saveMut = callbackBody(ctx, 'saveSettingsMutation');
  ok('the settings save writes both columns through the normalisers',
    saveMut.includes('license_state: licenceStateColumnValue(updatedSettings.branding.licenseState)')
    && saveMut.includes('license_expiry: licenceExpiryColumnValue(updatedSettings.branding.licenseExpiry)'),
    saveMut.slice(0, 200));
  const loadQ = callbackBody(ctx, 'settingsQuery');
  ok('the settings load maps both columns back onto branding',
    // Wave-4 final fix round 8: the settings columns are mapped off `row` —
    // the profiles row with his Not-saved settings save laid over it.
    /licenseState: licenceStateColumnValue\(row\.license_state/.test(loadQ)
    && /licenseExpiry: licenceExpiryColumnValue\(row\.license_expiry/.test(loadQ)
    && /const row = settingsRowWithUnsaved\(data as Record<string, unknown>,/.test(loadQ));
  for (const [file, src] of [
    ['app/company-profile.tsx', stripComments(read('app/company-profile.tsx'))],
    ['app/(tabs)/settings/index.tsx', stripComments(read('app/(tabs)/settings/index.tsx'))],
  ] as const) {
    const literals: string[] = [];
    for (let i = src.indexOf('branding: {'); i >= 0; i = src.indexOf('branding: {', i + 1)) literals.push(balancedFrom(src, i));
    ok(`${file}: every whole-branding write carries licenseState and licenseExpiry`,
      literals.length > 0 && literals.every(l => l.includes('licenseState:') && l.includes('licenseExpiry:')),
      `${literals.length} literal(s); missing in: ${literals.filter(l => !l.includes('licenseState:') || !l.includes('licenseExpiry:')).map(l => l.slice(0, 60)).join(' | ')}`);
  }

  // (a) structural — the identity gate carries the market. The wizard no
  // longer calls bidIdentityGap itself (ITEM 19); the one ask sheet does, so
  // it is the sheet's calls that must pass the location, or the hole re-opens
  // for exactly the accounts the fix is for.
  {
    const hook = stripComments(read('hooks/useClientDocumentGate.ts'));
    const askFlow = stripComments(read('utils/clientDocumentAsk.ts'));
    const hookCalls = [...hook.matchAll(/bidIdentityGap\(([^)]*)\)/g)].map(m => m[1]);
    ok('every gate call in the ask sheet passes the saved location',
      hookCalls.length > 0 && hookCalls.every(args => /,\s*settings\.location\s*$/.test(args))
      && /bidIdentityGap\(profile\.branding, profile\.location\)\.blocking/.test(askFlow),
      hookCalls.join(' | '));
  }

  const profile = stripComments(read('app/company-profile.tsx'));
  const addrIdx = profile.indexOf('testID="branding-address"');
  const addrInput = addrIdx >= 0 ? profile.slice(profile.lastIndexOf('<TextInput', addrIdx), addrIdx) : '';
  const placeholder = addrInput.match(/placeholder="([^"]*)"/)?.[1] ?? '';
  ok('the company address placeholder teaches a shape that carries a state',
    splitLocationText(placeholder).state.length === 2 && bidStateFromBranding({ address: placeholder }) !== '',
    `placeholder "${placeholder}" parses to no state — typing what the box shows switches the licence check off`);
  ok('the company profile shows the licensing state and where it came from',
    profile.includes('testID="branding-license-state"')
    && /bidLicenceStateSource\(\{ address: brandingAddress, licenseState: savedLicenceState \}, settings\.location\)/.test(profile));
  const pickSave = callbackBody(profile, 'saveLicenceState');
  ok('the licensing-state pick saves branding.licenseState, not the pricing market',
    pickSave.includes('updateSettings({ branding: mergedBidBranding(settings.branding, { licenseState: code }) })')
    && !/location/.test(pickSave), pickSave.slice(0, 200));
  ok('the company profile never writes the pricing market',
    !/updateSettings\(\{[^}]*\blocation\b/.test(profile));
  ok('the market-edit path for licensing is gone from every screen that used it',
    !profile.includes('licenceStateMarketEdit') && !stripComments(read('app/get-verified.tsx')).includes('licenceStateMarketEdit')
    && !read('utils/bidDocumentIdentity.ts').includes('export function licenceStateMarketEdit'));
  ok('the licence "why" renders only when a cited rule exists',
    /\{licenceRule \? \(/.test(profile) && profile.includes('testID="branding-license-why"'),
    'a TX contractor must never be told of a requirement his board does not have');

  const verified = stripComments(read('app/get-verified.tsx'));
  const submit = callbackBody(verified, 'handleSubmit');
  ok('Get Verified has no free-text jurisdiction box',
    !verified.includes('onChangeText={setJurisdiction}'),
    '"CSLB" / "Calif." normalise to nothing — the gate stays dead while the form looks filled in');
  ok('Get Verified validates the state through normalizeState',
    /normalizeState\(jurisdiction\)/.test(callbackBody(verified, 'validate')));
  // One write carries the number, the state and the expiry — a second
  // updateSettings in the same tick merges onto the stale settings and undoes
  // the first — and it lands before the send, so a failed email still feeds
  // the gate. The state goes onto licenseState; the market is never written.
  const profileWriteIdx = submit.indexOf('updateSettings({');
  const profileWrite = profileWriteIdx >= 0 ? balancedFrom(submit, profileWriteIdx) : '';
  const sendIdx2 = submit.indexOf('sendEmail(');
  ok('Get Verified writes number, state and expiry to the profile in one write, before it sends',
    profileWriteIdx >= 0 && sendIdx2 > profileWriteIdx
    && /mergedBidBranding\(saved, \{/.test(profileWrite)
    && /licenseNumber: typedNumber/.test(profileWrite)
    && /licenseState: code\b/.test(profileWrite)
    && /licenseExpiry: typedExpiry/.test(profileWrite)
    && (submit.match(/updateSettings\(/g) ?? []).length === 1,
    `write@${profileWriteIdx} send@${sendIdx2} ${profileWrite.slice(0, 160)}`);
  ok('Get Verified never writes the pricing market',
    !/\blocation\b/.test(profileWrite) && !/updateSettings\(\{[^}]*\blocation\b/.test(submit));
  ok('Get Verified validates the expiry as a real calendar day before saving it',
    /licenceExpiryColumnValue\(expires\)/.test(callbackBody(verified, 'validate')));
  ok('Get Verified prefills from the profile',
    /useState\(settings\?\.branding\?\.licenseNumber/.test(verified) && /bidStateFromBranding\(settings\?\.branding, settings\?\.location\)/.test(verified)
    && /useState\(settings\?\.branding\?\.licenseExpiry/.test(verified));

  // (b) the settings screen: no orphan "Save Changes"; location commits itself;
  // the numerics' save sits under them and leaving with an edit asks.
  const settingsSrc = stripComments(read('app/(tabs)/settings/index.tsx'));
  ok('the mid-screen "Save Changes" button is gone', !settingsSrc.includes('testID="save-settings"'));
  const locInputStart = settingsSrc.indexOf('testID="settings-location"');
  const locInput = locInputStart >= 0 ? settingsSrc.slice(settingsSrc.lastIndexOf('<TextInput', locInputStart), locInputStart) : '';
  ok('Location commits on blur and on return',
    locInput.includes('onBlur={commitLocation}') && locInput.includes('onSubmitEditing={commitLocation}'),
    locInput.slice(0, 200));
  ok('commitLocation actually writes', /commitScreen\(\{ location: next \}\)/.test(callbackBody(settingsSrc, 'commitLocation')));
  const contIdx = settingsSrc.indexOf('testID="settings-contingency"');
  const saveDefaultsIdx = settingsSrc.indexOf('testID="save-estimate-defaults"');
  const nextHeaderIdx = settingsSrc.indexOf('<Text style={styles.sectionHeader}>', contIdx);
  ok('the estimate-defaults save sits directly under the fields it saves',
    contIdx >= 0 && saveDefaultsIdx > contIdx && (nextHeaderIdx < 0 || saveDefaultsIdx < nextHeaderIdx),
    `contingency@${contIdx} save@${saveDefaultsIdx} nextSection@${nextHeaderIdx}`);
  const saveDefaults = callbackBody(settingsSrc, 'saveEstimateDefaults');
  ok('the save validates both ranges before writing',
    saveDefaults.indexOf('tax > 30') >= 0 && saveDefaults.indexOf('cont > 50') >= 0
    && saveDefaults.indexOf('commitScreen(') > saveDefaults.indexOf('cont > 50'));
  ok('leaving the tab with an unsaved edit asks instead of dropping it',
    /useFocusEffect\(\s*useCallback\(\(\) => \(\) => \{[^]*?guard\.dirty[^]*?showAlert\(/.test(settingsSrc));

  // (c) contingency has a reader, and it is the number on the estimate.
  const gen = callbackBody(wizard, 'generate');
  const contLine = gen.slice(gen.indexOf('const contingency ='), gen.indexOf(';', gen.indexOf('const contingency =')));
  ok('the wizard builds contingency from settings.contingencyRate',
    /settings\?\.contingencyRate/.test(gen) && /subtotal \* rate \/ 100/.test(contLine),
    `${contLine} — a validated, synced, unread setting is a control that does nothing`);
  ok('the totals block names the rate it used',
    wizard.includes('testID="wizard-contingency-label"') && wizard.includes('contingencyRateUsed'));

  // (d) the public page row cannot land on "Project not found."
  const publicSetup = stripComments(read('app/public-profile-setup.tsx'));
  const noProject = balancedFrom(publicSetup, publicSetup.indexOf('if (!project) {'));
  ok('opened with no project, the page asks which job instead of erroring',
    !noProject.includes('Project not found') && noProject.includes('router.setParams({ id: p.id })'),
    noProject.slice(0, 200));
  ok('Settings no longer promises a company profile the route does not build',
    !settingsSrc.includes('Used in the sub directory + bid award notifications'));

  // (e) a market pick persists, checked by the resolver round trip.
  const materials = stripComments(read('app/(tabs)/materials/index.tsx'));
  const pick = callbackBody(materials, 'pickMarket');
  ok('a market pick saves settings.location when the resolver reads it back as the same market',
    pick.includes('updateSettings({ location: candidate })') && pick.includes('resolvePricingMarket(candidate)'),
    pick.slice(0, 200));
  ok('no picker chip bypasses pickMarket', !/setOverride\(\{ regionId: (region\.id|null), city/.test(materials.replace(pick, '')),
    'a chip that only sets the override is a pick that is forgotten on the next visit');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\nITEM 22 — payment terms on the wizard, its PDF, and where he changes them (Direction B):');
// ═════════════════════════════════════════════════════════════════════════════
// The quick-estimate PDF and the wizard preview printed 25 / 65 / 10 that
// nobody chose, while the portal proposal printed a 10% deposit and a new
// contract seeded 25/25/25/25 — three deposits for one job. Every printed
// schedule now comes from utils/paymentTerms.ts with the GC's own answer
// (asked at the share), and "not set" is a state the preview names, never a
// number. Guard for the resolver itself: scripts/validate-payment-terms.ts.
{
  const pdf = read('utils/pdfGenerator.ts');
  const pdfCode = stripComments(pdf);

  // No literal terms left in either file, in any spelling the old code used.
  for (const [file, code] of [['app/estimate-wizard.tsx', wizardCode], ['utils/pdfGenerator.ts', pdfCode]] as const) {
    ok(`${file}: no 0.25 / 0.65 / 0.10 payment multipliers`,
      !/\*\s*0?\.(25|65|10?)\b/.test(code) && !/\b(25|65|10)\s*\/\s*100\b/.test(code),
      (code.match(/.*\*\s*0?\.(25|65|10?)\b.*|.*\b(25|65|10)\s*\/\s*100\b.*/) ?? [''])[0].trim().slice(0, 160));
    ok(`${file}: no 'Deposit (25%)' / 'Progress (65%)' / 'Final (10%)' copy`,
      !/(Deposit|Progress|Final) \((25|65|10)%\)/.test(code));
    ok(`${file}: no depositPct / completionPct literal left`,
      !/\b(depositPct|completionPct)\s*=\s*\d/.test(code) && !/\bconst depositPct\b/.test(code));
    ok(`${file}: the old acceptance sentence is not hard-coded`,
      !code.includes('Final pricing is locked once the contract is signed and the deposit received.'),
      'it promised a deposit whether or not he takes one — acceptanceSentence decides');
  }

  // The PDF generator.
  const quickHtml = balancedFrom(pdf, pdf.indexOf('function buildQuickEstimateHtml('));
  ok('buildQuickEstimateHtml takes a required PaymentSplit',
    /function buildQuickEstimateHtml\(\s*result: QuickEstimateResultForPdf,\s*answers: QuickEstimateAnswersForPdf,\s*branding: CompanyBranding,\s*split: PaymentSplit,\s*\): string \{/.test(pdf));
  const quickHtmlCode = stripComments(quickHtml);
  ok('…its rows come from paymentStageRows on the estimate total',
    /paymentStageRows\(result\.total, split\)/.test(quickHtmlCode)
    && /stageRows\.map\(/.test(quickHtmlCode) && /\$\{fmtMoney\(r\.amount(, \{ decimals: 2 \})?\)\}/.test(quickHtmlCode),
    'a second amount function on the PDF is how the printed deposit and the billed deposit drift apart');
  ok('…and its closing sentence from acceptanceSentence(split)',
    /acceptanceSentence\(split\)/.test(quickHtmlCode));
  ok('shareQuickEstimatePDF requires the split and passes it through',
    /export async function shareQuickEstimatePDF\(\s*result: QuickEstimateResultForPdf,\s*answers: QuickEstimateAnswersForPdf,\s*branding: CompanyBranding,\s*split: PaymentSplit,\s*\): Promise<void>/.test(pdf)
    && /buildQuickEstimateHtml\(result, answers, branding, split\)/.test(pdfCode),
    'an optional split is how "not set" reaches a homeowner');
  ok('generateQuickEstimatePDFUri is gone (no callers; an unasked second way out)',
    !pdfCode.includes('generateQuickEstimatePDFUri'));
  ok('buildQuickEstimateHtml is called from exactly one place',
    (pdfCode.match(/buildQuickEstimateHtml\(/g) ?? []).length === 2,
    'one declaration + the one send');
  const contractHtml = stripComments(balancedFrom(pdf, pdf.indexOf('function buildContractHtml(')));
  ok('the sealed contract’s Due cell prints milestoneDueText when there is no date',
    /m\.triggerDate \? fmtDate\(m\.triggerDate\) : milestoneDueText\(m\)/.test(contractHtml),
    'a blank "Due" on the deposit, progress and final rows of the PDF the homeowner signs');

  // The wizard preview.
  ok('the preview reads his split through useSavedPaymentTerms and prints paymentStageRows',
    /const savedTerms = useSavedPaymentTerms\(\);/.test(wizardCode)
    && /const previewSplit = jobStamp \?\? savedTerms\.split;/.test(wizardCode) && /const jobStamp = useMemo<PaymentSplit \| null>\(\s*\(\) => \(projectId \? resolvePaymentSplit\(\{ record: scopedProject\?\.clientPortal\?\.proposalPaymentTerms \}\)\.split : null\)/.test(wizardCode)
    && /previewSplit \? paymentStageRows\(result\.total, previewSplit\) : \[\]/.test(wizardCode));
  const cardStart = wizardCode.indexOf('testID="wizard-payment-terms"');
  const cardEnd = wizardCode.indexOf('testID="wizard-payment-terms-set"', cardStart);
  const card = cardStart >= 0 && cardEnd > cardStart ? wizardCode.slice(cardStart, cardEnd + 200) : '';
  const statusAt = card.indexOf("{savedTerms.status !== 'ready' ? (");
  const splitAt = card.indexOf(': previewSplit ? (');
  ok('…a loading / could-not-load branch comes first, with Retry on a failed read',
    statusAt >= 0 && splitAt > statusAt && card.includes('testID="wizard-payment-terms-loading"')
    && /onPress=\{savedTerms\.retry\}/.test(card) && card.includes('testID="wizard-payment-terms-retry"'), card.slice(0, 200));
  ok('…with a not-set branch that says so and offers "Set now" through the gate',
    splitAt >= 0 && card.includes('testID="wizard-payment-terms-not-set"')
    && card.includes("You'll be asked before this goes to your client.")
    && /gate\.run\(\{ terms: true, purpose: 'proposal_pdf', total: result\.total/.test(card),
    card.slice(0, 200));
  ok('…and the acceptance sentence comes from acceptanceSentence',
    wizardCode.includes('{acceptanceSentence(previewSplit)}'));

  // Company Profile — where he changes it.
  const profileSrc = stripComments(read('app/company-profile.tsx'));
  ok('Company Profile resolves both rows through the resolvers',
    /const savedSplit = resolvePaymentSplit\(\{ settings \}\)\.split;/.test(profileSrc)
    && /const savedWarrantyMonths = resolveWarrantyMonths\(settings\);/.test(profileSrc));
  const openTag = (src: string, testID: string) => {
    const at = src.indexOf(`testID="${testID}"`);
    return at >= 0 ? src.slice(src.lastIndexOf('<TouchableOpacity', at), at) : '';
  };
  ok('the Payment terms row opens the ask sheet for terms',
    openTag(profileSrc, 'company-payment-terms').includes("onPress={() => gate.edit('terms')}"));
  ok('the Workmanship warranty row opens it for the warranty',
    openTag(profileSrc, 'company-warranty').includes("onPress={() => gate.edit('warranty')}"));
  const howIdx = profileSrc.indexOf('>HOW YOU GET PAID<');
  ok('HOW YOU GET PAID sits after COMPANY BRANDING and before COMPANY LOGO',
    howIdx > profileSrc.indexOf('>COMPANY BRANDING<') && howIdx < profileSrc.indexOf('>COMPANY LOGO<')
    && profileSrc.indexOf('testID="company-warranty"') < profileSrc.indexOf('>COMPANY LOGO<'));
  ok('Company Profile renders the sheet once',
    (profileSrc.match(/<ClientDocumentAskSheet \{\.\.\.gate\.sheet\} \/>/g) ?? []).length === 1);
  ok('the branding Save and the logo/signature autoSave never carry the terms',
    ['handleSave', 'autoSave'].every(n => !/paymentSplit|warrantyMonths|savePaymentTerms/.test(callbackBody(profileSrc, n))),
    'a whole-branding save that also wrote the terms would race the terms write and undo it');

  // Settings shortcut.
  const settingsCode = stripComments(read('app/(tabs)/settings/index.tsx'));
  ok('Settings has the How you get paid row, opening the same sheet',
    openTag(settingsCode, 'settings-how-you-get-paid').includes('onPress={() => gate.edit(howYouGetPaidStep)}')
    && (settingsCode.match(/<ClientDocumentAskSheet \{\.\.\.gate\.sheet\} \/>/g) ?? []).length === 1);
  // …at the step its label says is missing: split set + warranty not set opens
  // the warranty, never the terms question he already answered.
  ok('…opening the warranty step when only the warranty is missing',
    /const howYouGetPaidStep = useMemo<'terms' \| 'warranty'>\(\s*\(\) => \(resolvePaymentSplit\(\{ settings \}\)\.split && resolveWarrantyMonths\(settings\) == null \? 'warranty' : 'terms'\)/.test(settingsCode));
  const howRowIdx = settingsCode.indexOf('testID="settings-how-you-get-paid"');
  const saveDefIdx = settingsCode.indexOf('testID="save-estimate-defaults"');
  const nextHdr = settingsCode.indexOf('<Text style={styles.sectionHeader}>', saveDefIdx);
  ok('…directly under the Save estimate defaults button',
    saveDefIdx >= 0 && howRowIdx > saveDefIdx && (nextHdr < 0 || howRowIdx < nextHdr),
    `save@${saveDefIdx} row@${howRowIdx} nextSection@${nextHdr}`);
  ok('…and its label comes from the resolvers, with a not-set wording',
    /resolvePaymentSplit\(\{ settings \}\)\.split/.test(settingsCode) && /resolveWarrantyMonths\(settings\)/.test(settingsCode)
    && settingsCode.includes('asked the first time a document prints it'));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

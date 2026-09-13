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
//   ITEM 20  Nothing outside a Settings toggle ever raised the push permission
//            dialog, so notify / notification_outbox / morning-digest /
//            invoice-dunning had no device token to reach. The ask is now
//            contextual, once, and never inside onboarding.
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
} from '@/utils/bidDocumentIdentity';
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
const pushIdx = tour.indexOf('router.push({ pathname: \'/project-detail\'');
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
const wizard = read('app/estimate-wizard.tsx');

ok('the wizard no longer carries the vendor name as a branding default',
  !stripComments(wizard).includes(`'${PDF_VENDOR_PLACEHOLDER}'`),
  `a literal '${PDF_VENDOR_PLACEHOLDER}' in this file is the defect: it is what printed on the homeowner's copy`);
ok('the PDF leaves from exactly one place',
  (wizard.match(/shareQuickEstimatePDF\(/g) ?? []).length === 1,
  'a second send path is a second way past the identity gate');

const genBody = callbackBody(wizard, 'generateAndSharePdf');
ok('the send path takes its branding as an argument',
  genBody.includes('shareQuickEstimatePDF(result, answers, branding)'),
  'reading settings here would re-read the blank profile the user was just asked to fill in');

// Two buttons reach this one send — the share button and the identity ask's
// "Save and send" — and `sharingPdf` only disables them on the render AFTER
// the first tap. The re-entry latch has to be a ref, and it has to sit on the
// send, or a fast double tap files two PDFs and two ESTIMATE_SHARED events
// against the activation funnel the top of this file exists to keep honest.
const sendLatchRead = genBody.indexOf('if (sharingRef.current) return;');
const sendLatchSet = genBody.indexOf('sharingRef.current = true;');
const sendFirstAwait = genBody.indexOf('await ');
ok('the send carries a ref re-entry latch, taken before anything async',
  sendLatchRead >= 0 && sendLatchSet > sendLatchRead && sendFirstAwait > sendLatchSet,
  `read@${sendLatchRead} set@${sendLatchSet} firstAwait@${sendFirstAwait}`);
ok('the send latch is released in finally, so a failed share can be retried',
  balancedFrom(genBody, genBody.indexOf('} finally')).includes('sharingRef.current = false;'),
  'releasing anywhere but finally leaves the share button dead after one failure');

const shareBody = callbackBody(wizard, 'share');
const gapIdx = shareBody.indexOf('bidIdentityGap(');
const blockIdx = shareBody.indexOf('if (gap.blocking)');
const sendIdx = shareBody.indexOf('generateAndSharePdf(');
ok('share checks the identity gap before it sends',
  gapIdx >= 0 && blockIdx >= 0 && sendIdx >= 0 && gapIdx < blockIdx && blockIdx < sendIdx,
  `gap@${gapIdx} block@${blockIdx} send@${sendIdx}`);
const blockingBranch = balancedFrom(shareBody, blockIdx);
ok('the blocking branch opens the ask and returns',
  blockingBranch.includes('setShowIdentityModal(true)') && blockingBranch.includes('return;'),
  'without the return the PDF still goes out under the vendor name');

const saveBody = callbackBody(wizard, 'saveIdentityAndShare');
ok('the ask re-checks the gap before accepting what was typed',
  saveBody.includes('bidIdentityGap(') && saveBody.includes('setIdentityHint(gap.reason)'),
  'a half-filled ask must say what is still missing, not save and send anyway');
ok('the ask saves to the profile so the second bid is not gated',
  saveBody.includes('updateSettings({ branding: merged })'));
ok('the ask sends the MERGED branding, not context state',
  saveBody.includes('generateAndSharePdf(merged)') && !saveBody.includes('generateAndSharePdf(savedBranding())'),
  'updateSettings writes through the offline queue — re-reading settings here sends the blank profile');
ok('the ask renders the reason, not a bare required-field message',
  wizard.includes('testID="wizard-identity-reason"') && wizard.includes('{savedGap.reason}'),
  'blocked buttons say why');

// ── THE ASK HAS TO BE SATISFIABLE ────────────────────────────────────────────
// This is the one that would cost every new account. The share is the arc's
// last step and it is now GATED; a gate whose ask has no field for the thing
// that is blocking is not friction, it is a wall with nothing on the other
// side. Nothing checked this: deleting the company-name TextInput — which
// blocks literally every brand-new profile — left all 96 checks green.
//
// Two halves. First: blocking can only ever be caused by the two fields the
// ask collects, so "has a field for each" is the whole of it.
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

// Second: the ask actually renders those fields, and a way back out.
const identityModalStart = wizard.indexOf('<Modal visible={showIdentityModal}');
const identityModal = identityModalStart >= 0
  ? wizard.slice(identityModalStart, wizard.indexOf('</Modal>', identityModalStart))
  : '';
ok('the identity ask is a modal that can be found', identityModal.length > 0);
ok('the ask offers a company-name field — the one every new profile needs',
  identityModal.includes('testID="wizard-identity-company"')
  && identityModal.includes('value={identityDraft.companyName}'),
  'without it a brand-new account is told its name is blank and given no way to say what it is');
{
  // The licence field has to sit INSIDE the rule gate, and it has to exist
  // whenever the gate can block: needsLicence is only ever true when
  // `rule` is non-null, so the gate and the field must be the same branch.
  const gateIdx = identityModal.indexOf('{savedGap.rule && (');
  const gateEnd = gateIdx >= 0 ? identityModal.indexOf('</>', gateIdx) : -1;
  const licIdx = identityModal.indexOf('testID="wizard-identity-licence"');
  ok('the ask offers the licence field inside the same branch that can block on it',
    gateIdx >= 0 && gateEnd > gateIdx && licIdx > gateIdx && licIdx < gateEnd
    && identityModal.includes('value={identityDraft.licenseNumber}'),
    `gate@${gateIdx} field@${licIdx} end@${gateEnd} — a CA/FL/AZ contractor blocked on the number with no field for it can never send the bid`);
}
ok('the ask can be dismissed',
  identityModal.includes('onPress={() => setShowIdentityModal(false)}'),
  'the gate is on the activation arc; a modal with no way out strands every user whose answer is "not now"');

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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

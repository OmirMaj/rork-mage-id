// scripts/validate-ny-home-improvement.ts — the New York home improvement
// contract checklist (utils/nyHomeImprovement.ts, lane NYCHECK).
//
// What it pins:
//   1. applies(): a New York jobsite (structured or "Brooklyn, NY 11201"
//      text) is 'yes'; another state is 'no'; no state + a New York
//      contractor is 'maybe'; commercial is 'no'; a new home in New York is
//      'maybe'; $500.00 is 'maybe' and $500.01 is 'yes' (§ 770: MORE than $500).
//   2. check(): the app's real default draft (DEFAULT_TERMS and the legacy
//      warranty, read from source as TEXT, because contractEngine imports
//      supabase and cannot load under bun) reads lien, escrow, three-day
//      cancel and contingencies as missing and insurance as 'check'. No
//      fixture ever reads a notice (d, e, h, i) as 'found'.
//   3. The rule table: every row cites § 771 on nysenate.gov, read on
//      2026-10-01, and the counsel marks sit on d, e, h, i, a-licence,
//      b-contingencies and c-materials.
//   4. Copy and purity: no he/his, sentence case, the disclaimer in the
//      component, no hex/rgba in the component, no supabase / AsyncStorage /
//      supabaseWrite / react import in the pure module.
//   5. app/contract.tsx: the card renders only for drafts; the sign gate
//      counts missing items only (never the to-check count); the warning sits
//      after the lock and the missing-terms ask and before the drift card and
//      the mode, so "Continue" never skips a gate.
//
// VALIDATE_ROOT=<dir> reads every file (and imports the module) from a
// scratch copy, for the planted-mutation proof. Run:
//   bun run scripts/validate-ny-home-improvement.ts

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isTitleCase } from './copy-title-case';

const ROOT = process.env.VALIDATE_ROOT
  ? resolve(process.env.VALIDATE_ROOT)
  : join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;
function assert(cond: unknown, label: string): void {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.error(`  FAIL  ${label}`); }
}
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

type Mod = typeof import('../utils/nyHomeImprovement');
const mod: Mod = await import(pathToFileURL(join(ROOT, 'utils/nyHomeImprovement.ts')).href);
const { nyHomeImprovementApplies, checkNyHomeImprovementContract, nyMissingBeforeSign, NY_HIC_RULES, NY_HIC_THRESHOLD_CENTS } = mod;

// ─── 1. applies() ───────────────────────────────────────────────────────────
console.log('\napplies()');
const NY_SA = { street: '124 Park Pl', city: 'Brooklyn', state: 'NY', zip: '11217', county: 'Kings' };
const big = 2500000;
const ap = (project: unknown, branding: unknown = null, cents = big) =>
  nyHomeImprovementApplies({ project: project as never, branding: branding as never, contractValueCents: cents });

assert(ap({ structuredAddress: NY_SA, type: 'renovation' }).applies === 'yes', 'NY structured address, $25,000 → yes');
assert(ap({ location: 'Brooklyn, NY 11201', type: 'renovation' }).applies === 'yes', '"Brooklyn, NY 11201" location text → yes');
assert(ap({ location: '12 Main St, Montclair, NJ 07042' }).applies === 'no', 'NJ jobsite → no');
assert(ap({ location: '12 Main St, Montclair, NJ 07042' }, { licenseState: 'NY' }).applies === 'no', 'NJ jobsite, NY contractor → no (the jobsite decides)');
{
  const r = ap({ location: 'Kitchen job' }, { licenseState: 'NY' });
  assert(r.applies === 'maybe' && r.reason === 'no-state', 'no state + branding licenseState NY → maybe (no-state)');
}
assert(ap({ location: '' }, { address: '55 Water St, Brooklyn, NY 11201' }).applies === 'maybe', 'no state + NY business address → maybe');
assert(ap({ location: '' }, { licenseState: 'NJ' }).applies === 'no', 'no state + NJ contractor → no');
assert(ap({ location: '' }, null).applies === 'no', 'nothing says New York → no');
assert(ap(null, { licenseState: 'NY' }).applies === 'maybe', 'no project + NY contractor → maybe');
assert(ap({ structuredAddress: NY_SA, type: 'commercial' }).applies === 'no', 'commercial in NY → no');
assert(ap({ location: '' , type: 'commercial' }, { licenseState: 'NY' }).applies === 'no', 'commercial, no state, NY contractor → no');
{
  const r = ap({ structuredAddress: NY_SA, type: 'new_build' });
  assert(r.applies === 'maybe' && r.reason === 'new-home', 'new_build in NY → maybe (new-home)');
}
assert(NY_HIC_THRESHOLD_CENTS === 50000, 'threshold is 50000 cents');
{
  const r = ap({ structuredAddress: NY_SA, type: 'renovation' }, null, 50000);
  assert(r.applies === 'maybe' && r.reason === 'amount', '$500.00 (50000 cents) → maybe (amount)');
}
assert(ap({ structuredAddress: NY_SA, type: 'renovation' }, null, 50001).applies === 'yes', '$500.01 (50001 cents) → yes');
assert(ap({ structuredAddress: NY_SA }, null, 0).applies === 'maybe', '$0 → maybe');
assert(ap({ structuredAddress: NY_SA }, null, Number.NaN).applies === 'maybe', 'NaN cents → maybe, never yes');

// ─── 2. check() ─────────────────────────────────────────────────────────────
console.log('\ncheck()');
function templateLiteral(src: string, name: string): string {
  const m = new RegExp(`const ${name} = \`([\\s\\S]*?)\`\\.trim\\(\\);`).exec(src);
  return m ? m[1].trim() : '';
}
const DEFAULT_TERMS = templateLiteral(read('utils/contractEngine.ts'), 'DEFAULT_TERMS');
const LEGACY_WARRANTY = templateLiteral(read('utils/paymentTerms.ts'), 'LEGACY_WARRANTY_TEXT').replace('one (1) year', 'twelve (12) months');
assert(DEFAULT_TERMS.includes('INSURANCE') && DEFAULT_TERMS.length > 500, 'DEFAULT_TERMS extracted from utils/contractEngine.ts as text');
assert(LEGACY_WARRANTY.includes('warrants the workmanship'), 'the warranty text extracted from utils/paymentTerms.ts');

const FULL_BRANDING = { companyName: 'Park Slope Builders', address: '55 Water St, Brooklyn, NY 11201', phone: '718-555-0100', licenseNumber: 'DCWP 2091234' };
const THREE = [
  { id: 'm1', label: 'Deposit', trigger: 'on_signing', percent: 10, status: 'pending' },
  { id: 'm2', label: 'Rough-in', trigger: 'on_milestone', percent: 50, status: 'pending' },
  { id: 'm3', label: 'Completion', trigger: 'on_final', percent: 40, status: 'pending' },
];
const draft = (over: Record<string, unknown> = {}) => ({
  startDate: '2026-11-02', durationDays: 45,
  scopeText: 'Gut and rebuild the kitchen: cabinets, counters, tile, electrical and plumbing rough-in.',
  termsText: DEFAULT_TERMS, warrantyText: LEGACY_WARRANTY,
  paymentSchedule: THREE, contractValue: 48500, ...over,
});
const check = (contract: Record<string, unknown>, branding: unknown = FULL_BRANDING) =>
  checkNyHomeImprovementContract({ contract: contract as never, branding: branding as never });
const statusOf = (r: ReturnType<typeof check>, id: string) => r.items.find((i) => i.id === id)?.status;

const def = check(draft());
assert(def.items.length === 14 && def.items.map((i) => i.id).join() === NY_HIC_RULES.map((r) => r.id).join(), 'one item per rule row, in rule order');
for (const id of ['d-lien', 'e-escrow', 'h-cancel']) assert(statusOf(def, id) === 'missing', `default draft: ${id} missing`);
assert(statusOf(def, 'i-insurance') === 'check', 'default draft: i-insurance check (clause 5 is generic)');
assert(statusOf(def, 'b-contingencies') === 'missing', 'default draft: b-contingencies missing');
for (const id of ['a-name', 'a-address', 'a-phone', 'a-licence', 'b-dates', 'c-scope', 'c-price', 'f-schedule']) assert(statusOf(def, id) === 'found', `default draft, full profile: ${id} found`);
assert(statusOf(def, 'c-materials') === 'check', 'c-materials is always check');
assert(def.missing === 4 && def.toCheck === 2, `default draft counts: 4 missing, 2 to check (got ${def.missing}/${def.toCheck})`);

const noProfile = check(draft(), {});
for (const id of ['a-name', 'a-address', 'a-phone']) assert(statusOf(noProfile, id) === 'missing', `blank profile: ${id} missing`);
assert(statusOf(noProfile, 'a-licence') === 'check', 'blank licence → check, never missing ("if applicable")');
assert(noProfile.items.find((i) => i.id === 'a-name')?.detail === 'Add it in your company profile.', 'missing profile item says where to add it');
assert(check(draft(), { companyName: '   ' }).items.find((i) => i.id === 'a-name')?.status === 'missing', 'whitespace company name → missing');
assert(statusOf(check(draft(), null), 'a-name') === 'missing', 'null branding → missing, no crash');

assert(statusOf(check(draft({ startDate: undefined })), 'b-dates') === 'missing', 'no start date → b-dates missing');
assert(statusOf(check(draft({ durationDays: 0 })), 'b-dates') === 'missing', 'duration 0 → b-dates missing');
assert(statusOf(check(draft({ scopeText: 'Kitchen Remodel' })), 'c-scope') === 'missing', 'scope under 20 characters → missing');
assert(statusOf(check(draft({ contractValue: 0 })), 'c-price') === 'missing', 'value 0 → c-price missing');
assert(statusOf(check(draft({ paymentSchedule: [] })), 'f-schedule') === 'missing', 'no schedule → f-schedule missing');
assert(statusOf(check(draft({ paymentSchedule: [THREE[0]] })), 'f-schedule') === 'found', 'one payment → f-schedule found');
assert(statusOf(check(draft({ paymentSchedule: [THREE[0], { ...THREE[1], percent: 0 }] })), 'f-schedule') === 'check', 'a milestone with no amount → check');
assert(statusOf(check(draft({ paymentSchedule: [THREE[0], { ...THREE[1], label: ' ' }] })), 'f-schedule') === 'check', 'a milestone with no label → check');
assert(statusOf(check(draft({ paymentSchedule: [THREE[0], { id: 'x', label: 'Final', trigger: 'on_final', amount: 2000, status: 'pending' }] })), 'f-schedule') === 'found', 'amount OR percent counts');

const LOADED = `${DEFAULT_TERMS}
11. LIEN NOTICE. Subcontractors and material suppliers who are not paid may file a mechanic's lien.
12. ESCROW. Payments received before substantial completion are held in an escrow account, or covered by a bond.
13. CANCELLATION. The Owner may cancel this contract until midnight of the third business day after signing.
14. DELAYS. Completion may be delayed by weather, unforeseen conditions or change orders.`;
const loaded = check(draft({ termsText: LOADED }));
for (const id of ['d-lien', 'e-escrow', 'h-cancel', 'i-insurance', 'b-contingencies']) assert(statusOf(loaded, id) === 'check', `wording present: ${id} check`);
assert(loaded.missing === 0, 'everything present: 0 missing');
assert(statusOf(check(draft({ termsText: 'Lien waivers will be provided.', warrantyText: '' })), 'd-lien') === 'missing', 'the word lien alone (no sub/supplier/material) → missing');
assert(statusOf(check(draft({ termsText: 'You may cancel within 3rd business day of signing.' })), 'h-cancel') === 'check', '"3rd business day" + cancel → check');
assert(statusOf(check(draft({ termsText: 'You may cancel at any time.' })), 'h-cancel') === 'missing', 'cancel without the third business day → missing');
assert(statusOf(check(draft({ termsText: '', warrantyText: 'Covered by a letter of credit.' })), 'e-escrow') === 'check', 'warranty text is read too (letter of credit)');

// No fixture ever reads a notice as 'found'.
const FIXTURES = [def, noProfile, loaded,
  check(draft({ termsText: `${LOADED}\nlien lien subcontractor supplier material escrow bond letter of credit cancel three business day insurance` })),
  check(draft({ termsText: '' , warrantyText: '' }))];
const noticeFound = FIXTURES.flatMap((r) => r.items.filter((i) => ['d-lien', 'e-escrow', 'h-cancel', 'i-insurance'].includes(i.id) && i.status === 'found'));
assert(noticeFound.length === 0, `no fixture reads d/e/h/i as found (found: ${noticeFound.map((i) => i.id).join(', ') || 'none'})`);
assert(loaded.items.filter((i) => ['d-lien', 'e-escrow', 'h-cancel', 'i-insurance'].includes(i.id)).every((i) => /check it with your counsel/i.test(i.detail)), 'a notice with wording says to check it with counsel');
assert(def.items.filter((i) => ['d-lien', 'e-escrow', 'h-cancel'].includes(i.id)).every((i) => /Add this notice in your contract terms\./.test(i.detail)), 'a missing notice hints where it goes (the app writes none)');

// The sign gate's number.
const NY_PROJECT = { structuredAddress: NY_SA, type: 'renovation' };
assert(nyMissingBeforeSign({ project: NY_PROJECT as never, contract: draft() as never, branding: FULL_BRANDING }) === 4, 'sign gate: NY default draft → 4 missing');
assert(nyMissingBeforeSign({ project: { location: 'Hoboken, NJ' } as never, contract: draft() as never, branding: FULL_BRANDING }) === 0, 'sign gate: NJ → 0 (no warning)');
assert(nyMissingBeforeSign({ project: NY_PROJECT as never, contract: draft({ termsText: LOADED }) as never, branding: FULL_BRANDING }) === 0, 'sign gate: a check-only list → 0 (never interrupts)');

// ─── 3. The rule table ──────────────────────────────────────────────────────
console.log('\nrule table');
const COUNSEL = new Set(['d-lien', 'e-escrow', 'h-cancel', 'i-insurance', 'a-licence', 'b-contingencies', 'c-materials']);
assert(NY_HIC_RULES.length === 14 && new Set(NY_HIC_RULES.map((r) => r.id)).size === 14, '14 rows, unique ids');
for (const r of NY_HIC_RULES) {
  const ok = /^GBL § 771\(1\)\([a-i]\)$/.test(r.citation)
    && /^https:\/\/www\.nysenate\.gov\/legislation\/laws\/GBS\/771$/.test(r.sourceUrl)
    && r.checkedOn === '2026-10-01'
    && r.requirement.trim().length > 0
    && r.counselConfirm === COUNSEL.has(r.id)
    && r.citation.endsWith(`(${r.id[0]})`);
  assert(ok, `${r.id}: ${r.citation}, nysenate.gov, 2026-10-01, counsel ${r.counselConfirm}`);
}

// ─── 4. Copy and purity ─────────────────────────────────────────────────────
console.log('\ncopy and purity');
const modSrc = read('utils/nyHomeImprovement.ts');
const cmpSrc = read('components/contract/NyContractChecklist.tsx');
const modCode = stripComments(modSrc);
const cmpCode = stripComments(cmpSrc);
assert(!/from ['"](react|react-native|@supabase[^'"]*|@react-native-async-storage[^'"]*)['"]/.test(modCode) && !/supabase|AsyncStorage|supabaseWrite/.test(modCode), 'the pure module imports no react, react-native, supabase or storage');
assert(!/supabase|AsyncStorage|supabaseWrite|enqueue/.test(cmpCode), 'the component writes nothing (no supabase, storage or queue)');
assert(!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(cmpCode), 'no hex or rgba in the component');
assert(cmpSrc.includes("'This is a checklist, not legal advice.'") && cmpSrc.includes('testID="contract-ny-disclaimer"'), 'the disclaimer string and its testID are in the component');
assert(/<Text style=\{styles\.disclaimer\}/.test(cmpCode) && !/open \? \([\s\S]*contract-ny-disclaimer[\s\S]*\) : null\}\s*<\/Card>/.test(cmpCode), 'the disclaimer renders outside the collapsible list');
const strings = [
  ...[...modCode.matchAll(/(?:label|detail): '([^']+)'/g)].map((m) => m[1]),
  ...[...modCode.matchAll(/const (?:PROFILE_MISSING|NOTICE_HINT|FOUND_WORDING|SCHEDULE_INCOMPLETE) = '([^']+)'/g)].map((m) => m[1]),
  ...[...cmpCode.matchAll(/t\('office\.nyContract\.[\w.]+', '([^']+)'/g)].map((m) => m[1]),
  ...[...cmpCode.matchAll(/(?:one|other): '([^']+)'/g)].map((m) => m[1]),
];
assert(strings.length >= 40, `copy strings found (${strings.length})`);
const he = strings.filter((s) => /\b(he|him|his|she|her)\b/i.test(s));
assert(he.length === 0, `no he/his/she/her (${he.join(' | ') || 'none'})`);
const lower = strings.filter((s) => !/^\{\w+\}/.test(s) && /^[a-z]/.test(s));
assert(lower.length === 0, `sentence case: every string starts upper case (${lower.join(' | ') || 'none'})`);
// docs/VOICE.md section 3 (2026-10-05): a label (a title, a button, an alert title) is Title Case and
// validate-copy-voice R15 owns that. What this check still holds is that a SENTENCE is never typed in
// Title Case: a string with end punctuation, or longer than a label, must read as a sentence.
const isLabel = (s: string) => !/[.?!:…]$/.test(s) && s.split(/\s+/).length <= 8 && isTitleCase(s);
const titleCase = strings.filter((s) => !isLabel(s) && (s.match(/\s[A-Z][a-z]+/g) ?? []).filter((w) => !/^\s(New|York|City|I)$/.test(w)).length >= 2);
assert(titleCase.length === 0, `no title case outside labels (${titleCase.join(' | ') || 'none'})`);
const banned = strings.filter((s) => /\b(compliant|compliance|approved|guarantee|licence|homeowner)\b/i.test(s) || /—.*—/.test(s));
assert(banned.length === 0, `never "compliant", "approved", British "licence", "homeowner" or two dashes (${banned.join(' | ') || 'none'})`);
assert(!/['"]Found wording — /.test(cmpCode), 'no em dash in a status label');
const tKeys = [...cmpCode.matchAll(/\b(?:t|tn)\('([^']+)'/g)].map((m) => m[1]);
assert(tKeys.length > 0 && tKeys.every((k) => k.startsWith('office.nyContract.')), 'every t() key is under office.nyContract.');
assert(!tKeys.some((k) => k.startsWith('office.nyContract.legal.')), 'legal paraphrase is not routed through t()');

// ─── 5. app/contract.tsx ────────────────────────────────────────────────────
console.log('\napp/contract.tsx');
const contract = read('app/contract.tsx');
assert(/\{contract\.status === 'draft' && \(\s*<NyContractChecklist /.test(contract), 'the checklist renders only for a draft');
const mount = contract.indexOf('<NyContractChecklist ');
assert(mount > 0 && mount < contract.indexOf('{/* Action bar */}') && mount > contract.indexOf('testID="contract-review-before-signing"'), 'the card sits below the review notice, above the draft action bar');
assert(/testID="contract-ny-checklist"/.test(contract), 'testID contract-ny-checklist');
const press = contract.slice(contract.indexOf('const handleSignPress = useCallback('), contract.indexOf('const handleSignTogetherPress = useCallback('));
const lockAt = press.indexOf('if (contractTermsLocked(c)) {');
const termsAt = press.indexOf("askContractTerms({ terms: needsTerms, warranty: needsWarranty }, 'review');");
const nyAt = press.indexOf('nyMissingBeforeSign(');
const askAt = press.indexOf('askNyMissingItems(');
const driftAt = press.indexOf('setDriftAsk(!!drift && drift.lines.length > 0);');
const modeAt = press.indexOf('const mode = pendingSignModeRef.current;');
assert(lockAt > 0 && termsAt > lockAt && nyAt > termsAt && askAt > nyAt && driftAt > askAt && modeAt > driftAt,
  'order: lock < missing-terms ask < NY warning < drift card < mode (Continue re-enters every gate)');
assert(/if \(nyMissing > 0 && nyAckRef\.current !== c\.id\) \{/.test(press), 'the gate checks missing > 0 and the per-contract acknowledgement');
assert(!/toCheck/.test(press), 'the gate never reads the to-check count');
assert(/onContinue: \(\) => \{ nyAckRef\.current = c\.id; signPressRef\.current\(\); \}/.test(press), '"Continue" acknowledges and re-runs the whole press');
assert(/onReview: \(\) => \{[^}]*setNyReveal\(/.test(press) && !/onReview: \(\) => \{[^}]*(setSignatureModal|signPressRef)/.test(press), '"Review the List" reveals the card and signs nothing');
assert(/signPressRef\.current = handleSignPress;/.test(contract), 'signPressRef follows handleSignPress');
assert(/askNyMissingItems\(nyMissing, \{[\s\S]*?\}\);\s*return;/.test(press), 'the warning returns before the pad');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

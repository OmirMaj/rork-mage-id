// scripts/validate-prequal-engine.ts
// Run: bun scripts/validate-prequal-engine.ts
//
// reviewPrequalPacket is pure (types-only imports), so bun runs it directly.
//
// The bug this pins: `packet.safety.emr3yr ?? []` guarded null/undefined but
// not a NON-array. A packet whose emr3yr came back from JSON as an object, a
// bare number or a string threw "emrs.find is not a function". Since
// app/prequal-manager.tsx has no route-level error boundary — the only one in
// the tree wraps the entire app — a single malformed packet blanked the whole
// screen. Same hazard on `packet.licenses.filter(...)`.
//
// The engine must degrade to "nothing on file" for these, never throw.

import {
  reviewPrequalPacket, parsePrequalDate, normalizePrequalDateInput, computePrequalExpiry,
  prequalApprovalRisk, prequalTokenFromBytes, PREQUAL_TOKEN_LENGTH, renewalBucket,
} from '@/utils/prequalEngine';
import { prequalAwardLeg } from '@/utils/prequalAwardGate';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PrequalPacket } from '@/types';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { console.error(`FAIL: ${msg}`); failures++; }
  else { console.log(`PASS: ${msg}`); }
}

const FUTURE = '2099-01-01';

function makePacket(overrides: Partial<PrequalPacket> = {}): PrequalPacket {
  return {
    id: 'pk-1',
    subcontractorId: 'sub-1',
    status: 'submitted',
    criteria: {
      minCglPerOccurrence: 1_000_000,
      minCglAggregate: 2_000_000,
      requireWorkersComp: true,
      requireCG2010: true,
      requireCG2037: true,
      requireW9: true,
      maxEmr: 1.0,
      minYearsInBusiness: 3,
    },
    financials: { yearsInBusiness: 10 },
    safety: { emr3yr: [0.87, 0.9, 0.95], writtenSafetyProgram: true },
    insurance: {
      cglPerOccurrence: 1_000_000,
      cglAggregate: 2_000_000,
      workersCompActive: true,
      hasCG2010: true,
      hasCG2037: true,
      coiExpiry: FUTURE,
    },
    licenses: [{ id: 'l1', state: 'CA', number: '123', classification: 'B', expiresAt: FUTURE }],
    w9OnFile: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as PrequalPacket;
}

function survives(label: string, packet: PrequalPacket): ReturnType<typeof reviewPrequalPacket> | null {
  try {
    const r = reviewPrequalPacket(packet);
    assert(true, label);
    return r;
  } catch (e) {
    assert(false, `${label} — threw: ${(e as Error).message}`);
    return null;
  }
}

// ── 0. Baseline: a well-formed packet still reviews correctly ────────────
const ok = reviewPrequalPacket(makePacket());
assert(ok.overall === 'pass', 'well-formed packet passes');
const emrFinding = ok.findings.find(f => f.criterion === 'emr');
assert(emrFinding?.note === 'Latest reported: 0.87', "EMR finding reads the first reported year ('Latest reported: 0.87')");
assert(emrFinding?.passed === true, 'EMR 0.87 <= maxEmr 1.0 passes');
assert(ok.findings.some(f => f.criterion === 'license_current'), 'current license produces license_current finding');

// ── 1. emr3yr arrives as a non-array (the reported crash) ────────────────
const bad = (v: unknown) => makePacket({ safety: { emr3yr: v as any, writtenSafetyProgram: true } });
for (const [label, value] of [
  ['object', { 0: 0.9 }],
  ['bare number', 0.9],
  ['string', '0.9'],
  ['null', null],
  ['undefined', undefined],
  ['true', true],
] as const) {
  const r = survives(`emr3yr as ${label} does not throw`, bad(value));
  if (r) assert(!r.findings.some(f => f.criterion === 'emr'), `emr3yr as ${label} → EMR check skipped, not invented`);
}

// ── 2. Non-numeric entries inside the array don't poison the finding ─────
const withJunk = makePacket({ safety: { emr3yr: [null, 'x', 0.7] as any, writtenSafetyProgram: true } });
const junkResult = survives('emr3yr with junk entries does not throw', withJunk);
assert(
  junkResult?.findings.find(f => f.criterion === 'emr')?.note === 'Latest reported: 0.70',
  'a null/string entry does not hide a real EMR further along the array',
);
const withNaN = makePacket({ safety: { emr3yr: [NaN, 1.4] as any, writtenSafetyProgram: true } });
const nanResult = survives('emr3yr containing NaN does not throw', withNaN);
assert(
  nanResult?.findings.find(f => f.criterion === 'emr')?.note === 'Latest reported: 1.40',
  'NaN is skipped rather than rendered as "Latest reported: NaN"',
);

// ── 3. licenses arrives as a non-array ───────────────────────────────────
for (const [label, value] of [
  ['object', { id: 'l1' }],
  ['string', 'CA-123'],
  ['null', null],
  ['undefined', undefined],
] as const) {
  const r = survives(`licenses as ${label} does not throw`, makePacket({ licenses: value as any }));
  if (r) {
    assert(
      !r.findings.some(f => f.criterion === 'license_expired' || f.criterion === 'license_current'),
      `licenses as ${label} → license checks skipped, not invented`,
    );
  }
}

// ── 3b. A whole packet SUBOBJECT is missing / null / a primitive ─────────
// The reported crash class one level up: `packet.safety.emr3yr` on a null
// `safety` threw "undefined is not an object". safety:null is the closest
// corruption to the report. Every top-level subobject must degrade, not throw.
for (const field of ['safety', 'financials', 'insurance', 'criteria'] as const) {
  for (const [label, value] of [
    ['missing', undefined],
    ['null', null],
    ['a primitive', 7],
    ['a string', 'nope'],
  ] as const) {
    // Build a packet then blow away one subobject.
    const p = makePacket();
    (p as any)[field] = value;
    survives(`packet.${field} = ${label} does not throw`, p as PrequalPacket);
  }
}

// safety:null specifically must skip the EMR check rather than inventing one.
const nullSafety = makePacket();
(nullSafety as any).safety = null;
const nullSafetyResult = survives('safety:null (closest to the reported crash) does not throw', nullSafety);
if (nullSafetyResult) {
  assert(!nullSafetyResult.findings.some(f => f.criterion === 'emr'),
    'safety:null → EMR check skipped, not invented');
  assert(nullSafetyResult.findings.some(f => f.criterion === 'written_safety_program' && !f.passed),
    'safety:null → written safety program reads as not-on-file (advisory, not a throw)');
}

// criteria missing must not throw on the `.toLocaleString()` / `.toFixed()` in
// the finding labels (undefined thresholds default to 0 = no minimum).
const noCriteria = makePacket();
delete (noCriteria as any).criteria;
const noCriteriaResult = survives('packet.criteria missing does not throw on label formatting', noCriteria);
if (noCriteriaResult) {
  assert(noCriteriaResult.findings.some(f => f.criterion === 'cgl_per_occurrence'),
    'a missing criteria still produces the CGL finding (threshold defaults to 0)');
}

// insurance missing must still record the COI-missing blocker rather than throw.
const noInsurance = makePacket();
delete (noInsurance as any).insurance;
const noInsuranceResult = survives('packet.insurance missing does not throw', noInsurance);
if (noInsuranceResult) {
  assert(noInsuranceResult.missingFields.includes('COI expiry date'),
    'insurance missing → COI expiry recorded as missing, not swallowed');
  assert(noInsuranceResult.overall !== 'pass',
    'insurance missing does not silently auto-approve');
}

// ── 4. A malformed packet must not silently become an approval ───────────
// Degrading to "nothing on file" is only safe because the blockers are judged
// on their own fields — prove a genuinely failing packet still fails even with
// a garbage emr3yr.
const failing = makePacket({
  w9OnFile: false,
  safety: { emr3yr: 0.9 as any, writtenSafetyProgram: false },
});
const failingResult = survives('blocked packet with garbage emr3yr does not throw', failing);
assert(failingResult?.overall !== 'pass', 'garbage emr3yr does not turn a blocked packet into a pass');

// ── 5. An expired license is still caught through the guard ──────────────
const expired = makePacket({
  licenses: [{ id: 'l1', state: 'TX', number: '9', classification: 'A', expiresAt: '2000-01-01' }],
});
const expiredResult = reviewPrequalPacket(expired);
assert(
  expiredResult.findings.some(f => f.criterion === 'license_expired' && !f.passed),
  'expired license still produces a blocker after the array guard',
);
assert(expiredResult.overall === 'fail', 'expired license fails the packet');

// ── 6. Q5 (2026-09-24): an unreadable COI date never passes ─────────────
// daysBetween returned NaN for "next March", NaN fails both `< 0` and `< 30`,
// and the packet read "COI valid" / "Auto-review passed. Ready for approval."
for (const typed of ['next March', '2026-13-45', '2026-02-30', '12/31/2099', '2099-1-1', 'soon']) {
  const r = reviewPrequalPacket(makePacket({ insurance: { ...makePacket().insurance, coiExpiry: typed } }));
  const coi = r.findings.find(f => f.criterion === 'coi_expiry');
  assert(r.overall !== 'pass', `COI "${typed}" does not pass auto-review (got ${r.overall})`);
  assert(!!coi && !coi.passed && coi.severity === 'blocker', `COI "${typed}" is a failed blocker, not "COI valid"`);
  assert(!!coi?.note?.includes(typed), `COI "${typed}" names what was typed in the finding`);
  assert(r.missingFields.includes('COI expiry date (YYYY-MM-DD)'), `COI "${typed}" asks the sub for a YYYY-MM-DD date`);
}
{
  const past = reviewPrequalPacket(makePacket({ insurance: { ...makePacket().insurance, coiExpiry: '2001-05-05' } }));
  assert(past.overall !== 'pass' && past.findings.some(f => f.criterion === 'coi_expiry' && !f.passed && f.severity === 'blocker'),
    'a past COI date is a failed blocker');
  const padded = reviewPrequalPacket(makePacket({ insurance: { ...makePacket().insurance, coiExpiry: '  2099-01-01 ' } }));
  assert(padded.overall === 'pass', 'a real date with stray spaces still reads');
  const blank = reviewPrequalPacket(makePacket({ insurance: { ...makePacket().insurance, coiExpiry: '   ' } }));
  assert(blank.missingFields.includes('COI expiry date') && blank.overall !== 'pass', 'a whitespace-only COI date is "missing", not valid');
}
// Licence expiry: the same NaN hole — an unreadable typed date counted as current.
{
  const r = reviewPrequalPacket(makePacket({
    licenses: [{ id: 'l1', state: 'CA', number: '1', classification: 'B', expiresAt: 'June' }],
  }));
  assert(r.findings.some(f => f.criterion === 'license_date_unreadable' && !f.passed && f.severity === 'blocker'),
    'an unreadable licence expiry is a failed blocker');
  assert(!r.findings.some(f => f.criterion === 'license_current'), 'and the licences are not called current');
  assert(r.overall !== 'pass', 'an unreadable licence expiry does not pass');
  const noDate = reviewPrequalPacket(makePacket({
    licenses: [{ id: 'l1', state: 'CA', number: '1', classification: 'B', expiresAt: '' }],
  }));
  assert(noDate.overall === 'pass', 'a licence with NO expiry typed is still fine (not every licence has one)');
}

// parsePrequalDate / normalizePrequalDateInput
assert(parsePrequalDate('2026-12-31') === '2026-12-31', 'parse: ISO date reads');
assert(parsePrequalDate('2024-02-29') === '2024-02-29', 'parse: a real leap day reads');
assert(parsePrequalDate('2026-02-29') === null, 'parse: 2026-02-29 is not a day (Date would roll it to March 1)');
assert(parsePrequalDate('2026-12-31T00:00:00Z') === null, 'parse: strict — a timestamp is not a typed date');
assert(parsePrequalDate(undefined) === null && parsePrequalDate(42) === null, 'parse: non-strings are null');
assert(normalizePrequalDateInput('12/31/2026') === '2026-12-31', 'normalize: M/D/YYYY → ISO');
assert(normalizePrequalDateInput('1/5/2027') === '2027-01-05', 'normalize: single digits pad');
assert(normalizePrequalDateInput('2027/1/5') === '2027-01-05', 'normalize: YYYY/M/D → ISO');
assert(normalizePrequalDateInput('13/01/2027') === null, 'normalize: day-first is refused, not guessed');
assert(normalizePrequalDateInput('12/31/26') === null, 'normalize: two-digit year is refused');
assert(normalizePrequalDateInput('next March') === null, 'normalize: words are refused');

// ── 7. Q5: approval never outlives a COI date nobody could read ──────────
const REVIEW = '2026-09-24T15:00:00.000Z';
assert(computePrequalExpiry(REVIEW, '2026-12-31') === '2026-12-31', 'expiry: capped at a real COI date inside the year');
assert(computePrequalExpiry(REVIEW, '2030-01-01') === '2027-09-24', 'expiry: capped at one year when the COI runs longer');
assert(computePrequalExpiry(REVIEW, undefined) === '2027-09-24', 'expiry: no COI typed keeps the one-year default');
assert(computePrequalExpiry(REVIEW, 'next March') === '2026-09-24', 'expiry: an unreadable COI caps at the review day, never a year');
assert(computePrequalExpiry(REVIEW, '2026-13-45') === '2026-09-24', 'expiry: an impossible COI caps at the review day');
assert(computePrequalExpiry(REVIEW, '2020-01-01') === '2020-01-01', 'expiry: a past COI date is the expiry (already lapsed)');
assert(renewalBucket(computePrequalExpiry(REVIEW, '2020-01-01')) === 'expired', 'expiry: …and shows as expired');
{
  const u = prequalApprovalRisk(REVIEW, 'next March');
  assert(u?.kind === 'unreadable' && u.typed === 'next March', 'risk: unreadable COI is flagged with what was typed');
  const l = prequalApprovalRisk(REVIEW, '2020-01-01');
  assert(l?.kind === 'lapsed' && l.coi === '2020-01-01' && !l.today, 'risk: past COI is flagged as lapsed');
  const t = prequalApprovalRisk(REVIEW, '2026-09-24');
  assert(t?.kind === 'lapsed' && t.today, 'risk: a COI expiring today is flagged');
  assert(prequalApprovalRisk(REVIEW, '2026-12-31') === null, 'risk: a future COI is fine');
  assert(prequalApprovalRisk(REVIEW, '') === null, 'risk: a blank COI is not this warning');
}

// ── 8. Q5: the magic-link token is 32 unbiased CSPRNG characters ─────────
{
  const bytes = new Uint8Array(64);
  for (let i = 0; i < 64; i++) bytes[i] = i * 3; // 0..189, all under the 216 ceiling
  const t = prequalTokenFromBytes(bytes);
  assert(t !== null && t.length === PREQUAL_TOKEN_LENGTH && PREQUAL_TOKEN_LENGTH === 32, 'token: 32 characters');
  assert(!!t && /^[A-HJKMNP-Z2-9a-hjkmnp-z]+$/.test(t), 'token: URL-safe alphabet, no look-alike characters');
  const high = new Uint8Array(64).fill(250);
  assert(prequalTokenFromBytes(high) === null, 'token: bytes above the ceiling are rejected (no modulo bias), never a short token');
  const mixed = new Uint8Array(40);
  for (let i = 0; i < 40; i++) mixed[i] = i % 2 === 0 ? 255 : 7;
  assert(prequalTokenFromBytes(mixed) === null, 'token: 20 usable bytes is not enough — null, not 20 characters');
  const src = readFileSync(join(__dirname, '..', 'utils', 'prequalToken.ts'), 'utf8');
  assert(/Crypto\.getRandomBytes\(/.test(src) && !/Math\.random/.test(src.replace(/\/\/[^\n]*/g, '')), 'token: minted from expo-crypto, never Math.random');
  const eng = readFileSync(join(__dirname, '..', 'utils', 'prequalEngine.ts'), 'utf8');
  assert(!/Math\.random\(/.test(eng), 'token: the engine has no Math.random left');
}

// ── 9. Q5: the award gate reads the packet's STATUS ───────────────────────
{
  const NOW = Date.parse('2026-09-24T12:00:00Z');
  const blank = makePacket({ status: 'invited', insurance: {}, financials: {}, safety: {}, licenses: [], w9OnFile: false });
  const inv = prequalAwardLeg(blank, null, 'Ace', NOW);
  assert(inv.blockers.length === 0 && inv.notes.some(n => /not yet submitted/.test(n)), 'award: invited-but-unfilled is a pending NOTE, never blockers');
  for (const st of ['draft', 'in_progress'] as const) {
    const r = prequalAwardLeg({ ...blank, status: st }, null, 'Ace', NOW);
    assert(r.blockers.length === 0 && r.notes.length === 1, `award: ${st} is pending, not failed`);
  }
  const passingRejected = makePacket({ status: 'rejected', reviewedAt: '2026-09-20T15:00:00Z', reviewerNotes: 'Lapsed WC last year' });
  const rej = prequalAwardLeg(passingRejected, reviewPrequalPacket(passingRejected), 'Ace', NOW);
  assert(rej.blockers.length === 1 && /You rejected Ace's prequal on Sep 20, 2026: "Lapsed WC last year"/.test(rej.blockers[0]),
    `award: the GC's Reject is a blocker with date and note even when the answers pass (${rej.blockers[0]})`);
  const nc = prequalAwardLeg(makePacket({ status: 'needs_changes', reviewerNotes: 'Need CG 20 10' }), null, 'Ace', NOW);
  assert(nc.blockers.length === 0 && /back for changes.*Need CG 20 10/.test(nc.notes[0] ?? ''), 'award: needs_changes is a note carrying the GC\'s note');
  const subFail = makePacket({ status: 'submitted', w9OnFile: false });
  const sf = prequalAwardLeg(subFail, reviewPrequalPacket(subFail), 'Ace', NOW);
  assert(sf.blockers.some(b => /W-9/.test(b)) && sf.notes.some(n => /awaiting your review/.test(n)), 'award: a SUBMITTED packet\'s failed blockers still block, and it says it awaits review');
  const subOk = prequalAwardLeg(makePacket({ status: 'submitted' }), reviewPrequalPacket(makePacket()), 'Ace', NOW);
  assert(subOk.blockers.length === 0 && subOk.notes.length === 1, 'award: a passing submitted packet is a note only');
  const appr = prequalAwardLeg(makePacket({ status: 'approved', expiresAt: '2027-01-01', w9OnFile: false }), null, 'Ace', NOW);
  assert(appr.blockers.length === 0 && appr.notes.length === 0, 'award: approved is clean — the GC\'s approval outranks the robot');
  const lapsed = prequalAwardLeg(makePacket({ status: 'approved', expiresAt: '2026-01-01' }), null, 'Ace', NOW);
  assert(lapsed.blockers.length === 0 && /lapsed on Jan 1, 2026/.test(lapsed.notes[0] ?? ''), 'award: a lapsed approval is a renewal note');
  const exp = prequalAwardLeg(makePacket({ status: 'expired' }), null, 'Ace', NOW);
  assert(exp.blockers.length === 0 && /expired/.test(exp.notes[0] ?? ''), 'award: expired is a renewal note');
}

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log('\nAll prequal-engine tests passed');

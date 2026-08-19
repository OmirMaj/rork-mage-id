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

import { reviewPrequalPacket } from '@/utils/prequalEngine';
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

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log('\nAll prequal-engine tests passed');

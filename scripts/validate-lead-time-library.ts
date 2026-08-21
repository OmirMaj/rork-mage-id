// validate-lead-time-library.ts — pins utils/automation/leadTimeLibrary.ts.
//
// Invariants:
//   • every kind returns a POSITIVE lead (a lead can never collapse to 0/neg)
//   • every return carries PROVENANCE (source + confidence)
//   • default vs jurisdiction sourcing is honest (unknown jurisdiction falls
//     back to default, not silently to a made-up jurisdiction value)
//   • purity: same inputs → identical output
// Run: bun run scripts/validate-lead-time-library.ts
import { getLeadTime, LEAD_TIME_KINDS } from '../utils/automation/leadTimeLibrary';
import type { LeadTimeSource, LeadTimeConfidence } from '../utils/automation/leadTimeLibrary';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

const SOURCES: LeadTimeSource[] = ['default', 'jurisdiction', 'learned'];
const CONFIDENCES: LeadTimeConfidence[] = ['low', 'med', 'high'];

console.log('\nlead time library:');

// ── every kind: positive lead + provenance ──
for (const kind of LEAD_TIME_KINDS) {
  const lt = getLeadTime(kind);
  ok(`${kind}: positive lead`, lt.days > 0, `got ${lt.days}`);
  ok(`${kind}: integer lead`, Number.isInteger(lt.days), `got ${lt.days}`);
  ok(`${kind}: carries a source`, SOURCES.includes(lt.source), `got ${lt.source}`);
  ok(`${kind}: carries a confidence`, CONFIDENCES.includes(lt.confidence), `got ${lt.confidence}`);
  ok(`${kind}: unqualified lookup is a default`, lt.source === 'default', `got ${lt.source}`);
  // HONESTY: a national default is an ungrounded guess, so its confidence must
  // be 'low'. Only a real jurisdiction override or a learned value earns more.
  // A 'med'/'high' on a default presents a guess as truth — fail the build.
  ok(`${kind}: default-source confidence is 'low' (not a grounded 'med'/'high')`, lt.confidence === 'low', `got ${lt.confidence}`);
}

// ── spec-seeded magnitudes are in the right ballpark ──
ok('permit_review is the longest lead (~30d)', getLeadTime('permit_review').days >= 21);
ok('rfi_response is a short lead (~7d)', getLeadTime('rfi_response').days <= 10);
ok('submittal_review ~14d', getLeadTime('submittal_review').days >= 10 && getLeadTime('submittal_review').days <= 21);
ok('dob_inspection ~7-10d', getLeadTime('dob_inspection').days >= 7 && getLeadTime('dob_inspection').days <= 10);

// ── jurisdiction: unknown falls back to default (no fabricated value) ──
const unknown = getLeadTime('permit_review', 'Nowhere, ZZ');
ok('unknown jurisdiction → source default', unknown.source === 'default', `got ${unknown.source}`);
ok('unknown jurisdiction → same days as default',
  unknown.days === getLeadTime('permit_review').days);

// ── purity: same inputs → identical output ──
ok('pure: repeated call is identical',
  JSON.stringify(getLeadTime('dob_inspection', 'New York, NY')) ===
  JSON.stringify(getLeadTime('dob_inspection', 'New York, NY')));

// ── every seeded default is individually positive (guards a bad edit) ──
ok('ALL kinds strictly positive', LEAD_TIME_KINDS.every((k) => getLeadTime(k).days > 0));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

// validate-handover-waivers.ts — pins the "Lien waivers collected" row on
// app/handover.tsx (audit round 2, #22; wave 5, #49).
//
// Before #22: coverage keyed a set on waiver.subCompanyId ?? subName and looked
// up Commitment.companyId (no such field) or vendorName (a name, never the id),
// so no waiver the app creates — sub-portal CTA or invoice prefill, both of
// which store the sub's id and the commitment id — could ever count.
//
// Before #49: once matching worked, ANY signed waiver covered its commitment —
// a conditional PROGRESS waiver from pay app #1 included — so the row ticked
// and "Ready to hand over" was reachable while every sub could still lien for
// the final payment and retainage. Only an unconditional FINAL now covers; a
// conditional final is 'partial'; partials and untyped rows cover nothing.
//
// Run: bun run scripts/validate-handover-waivers.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lienWaiverCoverage, commitmentHasWaiver, commitmentWaiverGrade, lienWaiverDetail } from '../utils/handoverWaivers';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, detail); }
}

// Three subcontracts as job-costing saves them: subcontractorId + vendorName = company name.
const commits = [
  { id: 'c1', status: 'active', subcontractorId: 'sub-1', vendorName: 'Ace Plumbing' },
  { id: 'c2', status: 'active', subcontractorId: 'sub-2', vendorName: 'Bolt Electric' },
  { id: 'c3', status: 'active', subcontractorId: 'sub-3', vendorName: 'Crown Drywall' },
  { id: 'c4', status: 'draft', subcontractorId: 'sub-4', vendorName: 'Draft Co' },
];

// Sub-portal "Collect lien waiver": prefillSubCompanyId = sub.id + commitmentId.
const UF = 'unconditional_final';
const fromSubPortal = commits.slice(0, 3).map(c => ({ status: 'signed', subCompanyId: c.subcontractorId, commitmentId: c.id, subName: c.vendorName, waiverType: UF }));
const r1 = lienWaiverCoverage(commits, fromSubPortal);
ok('3 app-made unconditional finals cover 3 of 3 (draft excluded)', r1.total === 3 && r1.final === 3 && r1.status === 'done', JSON.stringify(r1));

// Invoice prefill: subCompanyId = subcontractorId, commitmentId set, subName maybe blank.
ok('invoice-prefill waiver (id only, no name) covers its commitment',
  commitmentHasWaiver(commits[0], [{ status: 'received', subCompanyId: 'sub-1', subName: '' }]));
ok('commitmentId alone is an exact match',
  commitmentHasWaiver(commits[1], [{ status: 'signed', commitmentId: 'c2', subName: 'someone else' }]));
ok('hand-typed name matches trimmed and case-insensitively',
  commitmentHasWaiver(commits[2], [{ status: 'signed', subName: '  crown DRYWALL ' }]));
ok('a requested (unsigned) waiver does not count',
  !commitmentHasWaiver(commits[0], [{ status: 'requested', commitmentId: 'c1' }]));
ok('a waiver for another sub does not count',
  !commitmentHasWaiver(commits[0], [{ status: 'signed', subCompanyId: 'sub-2', commitmentId: 'c2', subName: 'Bolt Electric' }]));

// Two waivers from the same sub must not count as two commitments.
const r2 = lienWaiverCoverage(commits, [
  { status: 'signed', commitmentId: 'c1', subCompanyId: 'sub-1', waiverType: UF },
  { status: 'signed', commitmentId: 'c1', subCompanyId: 'sub-1', waiverType: UF },
]);
ok('the detail counts covered commitments, not waivers', r2.final === 1 && r2.status === 'partial', JSON.stringify(r2));
// Integration round 1: one sub, two POs, one waiver tied to the first PO. The
// sub-id match used to let that waiver cover the second PO too.
const twoPos = [
  { id: 'p1', status: 'active', subcontractorId: 'sub-9', vendorName: 'Echo Framing' },
  { id: 'p2', status: 'active', subcontractorId: 'sub-9', vendorName: 'Echo Framing' },
];
const r3 = lienWaiverCoverage(twoPos, [{ status: 'signed', commitmentId: 'p1', subCompanyId: 'sub-9', subName: 'Echo Framing', waiverType: UF }]);
ok('a waiver tied to PO 1 does not also cover the same sub\'s PO 2', r3.final === 1 && r3.total === 2 && r3.status === 'partial', JSON.stringify(r3));
ok('…while a waiver with no commitment still matches on the sub id',
  lienWaiverCoverage(twoPos, [{ status: 'signed', subCompanyId: 'sub-9', waiverType: UF }]).final === 2);
ok('no commitments → open', lienWaiverCoverage([], fromSubPortal).status === 'open');

// ── #49: only a FINAL waiver covers a commitment at handover ─────────────────
const each = (type: string | undefined, status = 'signed') =>
  commits.slice(0, 3).map(c => ({ status, commitmentId: c.id, subCompanyId: c.subcontractorId, subName: c.vendorName, waiverType: type }));
const partialsOnly = lienWaiverCoverage(commits, each('conditional_partial'));
ok('#49 a signed conditional_partial on every commitment is NOT covered (open, never done)',
  partialsOnly.status === 'open' && partialsOnly.final === 0 && partialsOnly.conditional === 0 && partialsOnly.progressOnly === 3,
  JSON.stringify(partialsOnly));
ok('#49 an unconditional_partial does not cover either',
  commitmentWaiverGrade(commits[0], [{ status: 'received', commitmentId: 'c1', waiverType: 'unconditional_partial' }]) === 'none');
ok('#49 a waiver with no saved type counts as not final (fails closed)',
  lienWaiverCoverage(commits, each(undefined)).status === 'open');
const condFinals = lienWaiverCoverage(commits, each('conditional_final'));
ok('#49 conditional_final on all → partial (awaiting payment), not done',
  condFinals.status === 'partial' && condFinals.conditional === 3 && condFinals.final === 0, JSON.stringify(condFinals));
ok('#49 unconditional_final on all → done', lienWaiverCoverage(commits, each(UF)).status === 'done');
ok('#49 an unconditional final outranks a conditional one for the same commitment',
  commitmentWaiverGrade(commits[0], [
    { status: 'signed', commitmentId: 'c1', waiverType: 'conditional_final' },
    { status: 'signed', commitmentId: 'c1', waiverType: UF },
  ]) === 'final');
ok('#49 a VOIDED unconditional_final is not covered',
  commitmentWaiverGrade(commits[0], [{ status: 'void', commitmentId: 'c1', waiverType: UF }]) === 'none'
  && lienWaiverCoverage(commits, each(UF, 'void')).status === 'open');
ok('#49 a requested (unsigned) unconditional_final is not covered',
  commitmentWaiverGrade(commits[0], [{ status: 'requested', commitmentId: 'c1', waiverType: UF }]) === 'none');
ok('#49 commitment-scoped: PO 1\'s final does not cover PO 2',
  commitmentWaiverGrade(twoPos[1], [{ status: 'signed', commitmentId: 'p1', subCompanyId: 'sub-9', waiverType: UF }]) === 'none');
const mixed = lienWaiverCoverage(commits, [
  { status: 'signed', commitmentId: 'c1', waiverType: UF },
  { status: 'signed', commitmentId: 'c2', waiverType: 'conditional_final' },
  { status: 'signed', commitmentId: 'c3', waiverType: 'conditional_partial' },
]);
ok('#49 mixed job: 1 final, 1 conditional, 1 progress-only → partial',
  mixed.status === 'partial' && mixed.final === 1 && mixed.conditional === 1 && mixed.progressOnly === 1, JSON.stringify(mixed));
ok('#49 detail: all final → "Unconditional final waiver from every sub (3)"',
  lienWaiverDetail(lienWaiverCoverage(commits, each(UF))) === 'Unconditional final waiver from every sub (3)');
const mixedDetail = lienWaiverDetail(mixed);
ok('#49 detail: "2 of 3 subs have a final waiver (1 conditional, awaiting payment)"',
  mixedDetail.startsWith('2 of 3 subs have a final waiver (1 conditional, awaiting payment)'), mixedDetail);
ok('#49 detail says progress waivers don\'t cover final payment or retainage',
  /progress waivers don't cover final payment or retainage/.test(mixedDetail), mixedDetail);
ok('#49 detail never says "signed waiver for every commitment" any more',
  !/Signed waiver for every commitment/.test(lienWaiverDetail(partialsOnly)));

const src = read('app/handover.tsx').replace(/^\s*\/\/.*$/gm, '');
ok('handover uses lienWaiverCoverage', /lienWaiverCoverage\(projectCommitments, waivers\)/.test(src));
ok('handover no longer reads Commitment.companyId', !/c\.companyId|\.companyId\)/.test(src));
ok('the row status and detail come from the graded coverage',
  /status:\s*waiverCov\.status/.test(src) && /detail:\s*lienWaiverDetail\(waiverCov\)/.test(src));
ok('handover no longer prints the any-waiver "Signed waiver for every commitment" line',
  !/Signed waiver for every commitment/.test(src));
const lw = read('app/lien-waivers.tsx').replace(/^\s*\/\/.*$/gm, '');
ok('invoice prefill no longer reads commit.companyId', !/commit\.companyId/.test(lw));

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `\nALL PASS (${pass})`);
if (fail) process.exit(1);

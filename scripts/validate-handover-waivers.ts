// validate-handover-waivers.ts — pins the "Lien waivers collected" row on
// app/handover.tsx (audit round 2, #22).
//
// Before: coverage keyed a set on waiver.subCompanyId ?? subName and looked up
// Commitment.companyId (no such field) or vendorName (a name, never the id), so
// no waiver the app creates — sub-portal CTA or invoice prefill, both of which
// store the sub's id and the commitment id — could ever count.
//
// Run: bun run scripts/validate-handover-waivers.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lienWaiverCoverage, commitmentHasWaiver } from '../utils/handoverWaivers';

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
const fromSubPortal = commits.slice(0, 3).map(c => ({ status: 'signed', subCompanyId: c.subcontractorId, commitmentId: c.id, subName: c.vendorName }));
const r1 = lienWaiverCoverage(commits, fromSubPortal);
ok('3 app-made signed waivers cover 3 of 3 (draft excluded)', r1.total === 3 && r1.covered === 3 && r1.status === 'done', JSON.stringify(r1));

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
  { status: 'signed', commitmentId: 'c1', subCompanyId: 'sub-1' },
  { status: 'signed', commitmentId: 'c1', subCompanyId: 'sub-1' },
]);
ok('the detail counts covered commitments, not waivers', r2.covered === 1 && r2.status === 'partial', JSON.stringify(r2));
// Integration round 1: one sub, two POs, one waiver tied to the first PO. The
// sub-id match used to let that waiver cover the second PO too.
const twoPos = [
  { id: 'p1', status: 'active', subcontractorId: 'sub-9', vendorName: 'Echo Framing' },
  { id: 'p2', status: 'active', subcontractorId: 'sub-9', vendorName: 'Echo Framing' },
];
const r3 = lienWaiverCoverage(twoPos, [{ status: 'signed', commitmentId: 'p1', subCompanyId: 'sub-9', subName: 'Echo Framing' }]);
ok('a waiver tied to PO 1 does not also cover the same sub\'s PO 2', r3.covered === 1 && r3.total === 2 && r3.status === 'partial', JSON.stringify(r3));
ok('…while a waiver with no commitment still matches on the sub id',
  lienWaiverCoverage(twoPos, [{ status: 'signed', subCompanyId: 'sub-9' }]).covered === 2);
ok('no commitments → open', lienWaiverCoverage([], fromSubPortal).status === 'open');

const src = read('app/handover.tsx').replace(/^\s*\/\/.*$/gm, '');
ok('handover uses lienWaiverCoverage', /lienWaiverCoverage\(projectCommitments, waivers\)/.test(src));
ok('handover no longer reads Commitment.companyId', !/c\.companyId|\.companyId\)/.test(src));
ok('the detail line reports covered of total', /\$\{waiverCov\.covered\} of \$\{waiverCov\.total\}/.test(src));
const lw = read('app/lien-waivers.tsx').replace(/^\s*\/\/.*$/gm, '');
ok('invoice prefill no longer reads commit.companyId', !/commit\.companyId/.test(lw));

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `\nALL PASS (${pass})`);
if (fail) process.exit(1);

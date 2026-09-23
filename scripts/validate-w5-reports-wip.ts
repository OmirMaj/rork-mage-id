// scripts/validate-w5-reports-wip.ts — whose contracts go on the bank-ready
// schedules (audit wave 5, 2026-09-22):
//   #18 another company's job, shared with this account, is not this GC's
//       contract — off the WIP schedule, the Profit report and the A/R aging;
//   #19 an unsigned bid ('draft' / 'estimated' with no evidence of signed work)
//       is pipeline, not backlog — off both WIP schedules and the Profit report,
//       and off the pipeline horizon's backlog.
// The cross-engine parity cases live in scripts/validate-wip-parity.ts; this
// file pins the predicate itself, the horizon, and the /reports wiring.
//
// Run via: bun run scripts/validate-w5-reports-wip.ts

import {
  isWipReportableProject, isOwnCompanyProject, isSignedOwnWork, wipEvidenceFor, wipExclusionReason,
  type WipEvidence,
} from '../utils/wip';
import { buildPipelineHorizon } from '../utils/portfolio/pipelineHorizon';
import type { Project, Invoice } from '../types';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function eq<T>(n: string, got: T, want: T) {
  const good = JSON.stringify(got) === JSON.stringify(want);
  if (good) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n, '\n   got ', JSON.stringify(got), '\n   want', JSON.stringify(want)); }
}

const NONE: WipEvidence = { issuedInvoice: false, billablePayApp: false, approvedChangeOrder: false, signedCommitment: false, costToDate: false };
const SOME: WipEvidence = { ...NONE, issuedInvoice: true };

console.log('\nthe predicate — one argument keeps its meaning:');
eq('one-arg: every status but closed is on (today’s rule)',
  (['draft', 'estimated', 'in_progress', 'completed', 'closed'] as const).map(status => isWipReportableProject({ status })),
  [true, true, true, true, false]);
eq('a context with NO evidence is the one-arg rule too (ownership is not tested without evidence)',
  isWipReportableProject({ status: 'estimated', ownerUserId: 'them' }, { userId: 'me' }), true);
eq('an array index as the second argument reads as no context',
  isWipReportableProject({ status: 'estimated' }, 3 as never), true);

console.log('\nwith evidence (#19):');
eq('draft / estimated with no evidence → off', [
  isWipReportableProject({ status: 'draft' }, { evidence: NONE }),
  isWipReportableProject({ status: 'estimated' }, { evidence: NONE }),
], [false, false]);
eq('draft / estimated with evidence → on', [
  isWipReportableProject({ status: 'draft' }, { evidence: SOME }),
  isWipReportableProject({ status: 'estimated' }, { evidence: SOME }),
], [true, true]);
eq('each of the five signals alone is enough',
  (['issuedInvoice', 'billablePayApp', 'approvedChangeOrder', 'signedCommitment', 'costToDate'] as const)
    .map(k => isWipReportableProject({ status: 'estimated' }, { evidence: { ...NONE, [k]: true } })),
  [true, true, true, true, true]);
eq('in_progress / completed need no evidence; closed is off regardless', [
  isWipReportableProject({ status: 'in_progress' }, { evidence: NONE }),
  isWipReportableProject({ status: 'completed' }, { evidence: NONE }),
  isWipReportableProject({ status: 'closed' }, { evidence: SOME }),
], [true, true, false]);

console.log('\nownership (#18):');
eq('ownerUserId decides first', [
  isOwnCompanyProject({ ownerUserId: 'me' }, 'me'),
  isOwnCompanyProject({ ownerUserId: 'them' }, 'me'),
  isOwnCompanyProject({ ownerUserId: 'them', myRole: 'owner' }, 'me'),
], [true, false, false]);
eq('no ownerUserId → no role or role owner is ours; any other role is not', [
  isOwnCompanyProject({}, 'me'),
  isOwnCompanyProject({ myRole: 'owner' }, 'me'),
  isOwnCompanyProject({ myRole: 'editor' }, 'me'),
  isOwnCompanyProject({ myRole: 'viewer' }, 'me'),
], [true, true, false, false]);
eq('an unknown user owns nothing', [isOwnCompanyProject({}, null), isOwnCompanyProject({ ownerUserId: 'x' }, undefined)], [false, false]);
eq('with evidence AND a userId, a shared in_progress job is off',
  isWipReportableProject({ status: 'in_progress', ownerUserId: 'them' }, { userId: 'me', evidence: SOME }), false);
eq('the exclusion reason names it', [
  wipExclusionReason({ status: 'in_progress', ownerUserId: 'them' }, { userId: 'me', evidence: SOME }),
  wipExclusionReason({ status: 'estimated', ownerUserId: 'me' }, { userId: 'me', evidence: NONE }),
  wipExclusionReason({ status: 'closed', ownerUserId: 'them' }, { userId: 'me', evidence: SOME }),
  wipExclusionReason({ status: 'estimated', ownerUserId: 'me' }, { userId: 'me', evidence: SOME }),
], ['shared', 'unsigned', 'closed', null]);
eq('isSignedOwnWork keeps a closed own job (the Profit report’s rule)',
  isSignedOwnWork({ status: 'closed', ownerUserId: 'me' }, { userId: 'me', evidence: NONE }), true);

console.log('\nthe evidence builder:');
{
  const inv = (status: Invoice['status'], projectId = 'p1') => ({ projectId, status }) as Pick<Invoice, 'projectId' | 'status'>;
  const e = (over: Partial<Parameters<typeof wipEvidenceFor>[1]> = {}) => wipEvidenceFor({ id: 'p1' }, {
    invoices: [], payApps: [], changeOrders: [], commitments: [], costToDate: 0, ...over,
  });
  eq('nothing → no evidence', e(), NONE);
  eq('a draft invoice is not evidence; a sent one is', [e({ invoices: [inv('draft')] }).issuedInvoice, e({ invoices: [inv('sent')] }).issuedInvoice], [false, true]);
  eq('another project’s invoice is not this project’s evidence', e({ invoices: [inv('sent', 'p2')] }).issuedInvoice, false);
  eq('a pending CO is not evidence; an approved one is', [
    e({ changeOrders: [{ projectId: 'p1', status: 'submitted' } as never] }).approvedChangeOrder,
    e({ changeOrders: [{ projectId: 'p1', status: 'approved' } as never] }).approvedChangeOrder,
  ], [false, true]);
  eq('a draft commitment is not evidence; a signed one is', [
    e({ commitments: [{ projectId: 'p1', status: 'draft' } as never] }).signedCommitment,
    e({ commitments: [{ projectId: 'p1', status: 'active' } as never] }).signedCommitment,
  ], [false, true]);
  eq('cost to date > 0 is evidence; 0 / NaN are not', [e({ costToDate: 1 }).costToDate, e({ costToDate: 0 }).costToDate, e({ costToDate: NaN }).costToDate], [true, false, false]);
  eq('a sent pay app is evidence', e({ payApps: [{ projectId: 'p1', portalState: { status: 'sent' } } as never] }).billablePayApp, true);
}

console.log('\nthe pipeline horizon (#19 — unsigned bids are pipeline, not backlog):');
{
  const NOW = new Date('2026-07-25T12:00:00Z');
  const p = (id: string, status: Project['status'], over: Partial<Project> = {}): Project => ({
    id, name: id, status, estimate: null, ownerUserId: 'me',
    linkedEstimate: { id: `e-${id}`, items: [], globalMarkup: 0, baseTotal: 100_000, markupTotal: 0, grandTotal: 100_000, createdAt: '2026-01-01' },
    createdAt: '2026-01-01', updatedAt: '2026-01-01', ...over,
  } as unknown as Project);
  const sent = { id: 'i1', projectId: 'billed-draft', status: 'sent', totalDue: 10_000, subtotal: 10_000, amountPaid: 0, lineItems: [] } as unknown as Invoice;
  const base = { leads: [], invoices: [sent], changeOrders: [], commitments: [], bidResponses: [], now: NOW };
  const r = buildPipelineHorizon({
    ...base,
    projects: [p('live', 'in_progress'), p('bid', 'estimated'), p('billed-draft', 'draft')],
  });
  // live: 100,000 remaining; bid: excluded; billed-draft: 100,000 − 10,000 billed.
  eq('backlog = the live job + the INVOICED draft job; the unsigned bid is not in it', r.backlog.remainingToBill$, 190_000);
  const shared = buildPipelineHorizon({
    ...base, userId: 'me',
    projects: [p('live', 'in_progress'), p('theirs', 'in_progress', { ownerUserId: 'them', myRole: 'editor' } as Partial<Project>)],
  });
  eq('with a userId, a partner’s shared job is not this company’s backlog', shared.backlog.remainingToBill$, 100_000);
  const noUser = buildPipelineHorizon({
    ...base,
    projects: [p('live', 'in_progress'), p('theirs', 'in_progress', { ownerUserId: 'them', myRole: 'editor' } as Partial<Project>)],
  });
  eq('…a caller with no userId gets the old ownership-blind sum (handed off to wire it)', noUser.backlog.remainingToBill$, 200_000);
}

console.log('\n/reports narrows to its own book once, and feeds all three reports:');
{
  const src = readFileSync(join(ROOT, 'app', 'reports.tsx'), 'utf8');
  eq('ownProjects is built with the shared predicate',
    /const ownProjects = useMemo\(\s*\(\) => projects\.filter\(p => isOwnCompanyProject\(p, userId\)\),/.test(src), true);
  eq('the screen’s `invoices` is the narrowed list (the context’s is renamed allInvoices)',
    /projects, invoices: allInvoices, changeOrders/.test(src) && /const invoices = useMemo\(\(\) => \{/.test(src), true);
  eq('…which drops only a KNOWN other-company job’s invoices',
    /const theirs = new Set\(projects\.filter\(p => !isOwnCompanyProject\(p, userId\)\)\.map\(p => p\.id\)\);\s*return allInvoices\.filter\(inv => !theirs\.has\(inv\.projectId\)\);/.test(src), true);
  eq('WIP gets them', /computeWIPReport\(ownProjects, invoices, changeOrders, commitments, costSources, aiaPayApps, etcEntries\)/.test(src), true);
  eq('Profit gets them', /computeProfitReport\(ownProjects, invoices, changeOrders, commitments, costSources, aiaPayApps, etcEntries\)/.test(src), true);
  eq('A/R aging gets them', /computeARAgingReport\(invoices, ownProjects\)/.test(src), true);
  eq('…and no report is fed the unfiltered list',
    /compute(?:WIP|Profit)Report\(projects,/.test(src) || /computeARAgingReport\([^)]*\bprojects\)/.test(src)
    || /\ballInvoices, changeOrders\b/.test(src.replace(/projects, invoices: allInvoices, changeOrders/, '')), false);
  eq('the aging empty-state count reads the same own invoices', /const issuedInvoices = invoices\.filter\(isWipBilling\)\.length;/.test(src), true);
  eq('both WIP and Profit say what was left out',
    /testID="wip-excluded"/.test(src) && /testID="profit-excluded"/.test(src) && /function reportExclusionLine\(/.test(src), true);
  const wip = readFileSync(join(ROOT, 'app', 'wip-report.tsx'), 'utf8');
  eq('/wip-report discloses closed, shared and unsigned beside each other',
    /testID="wip-excluded"/.test(wip) && /shared with you \(another company's contract\)/.test(wip)
    && /pipeline, not backlog/.test(wip), true);
}

console.log(`\nvalidate-w5-reports-wip: ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);

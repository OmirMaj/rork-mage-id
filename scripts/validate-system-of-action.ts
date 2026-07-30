// validate-system-of-action.ts — pins utils/systemOfAction.ts (the chase engine).
// Run: bun run scripts/validate-system-of-action.ts
import { buildChaseList, chaseSummary } from '../utils/systemOfAction';
import type { RFI, Submittal, ChangeOrder, Project } from '../types';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got: ', JSON.stringify(got), '\n      want:', JSON.stringify(want)); }
}
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

const NOW = Date.parse('2026-02-15T00:00:00');
const projects = [{ id: 'p1', name: 'Oak Kitchen' }] as unknown as Project[];

const rfi = (o: Partial<RFI>): RFI => ({
  id: 'r1', projectId: 'p1', number: 12, subject: 'Beam conflict', question: 'q',
  submittedBy: 'GC', assignedTo: 'Jane the Architect', ballInCourt: 'architect',
  dateSubmitted: '2026-02-01', dateRequired: '2026-02-05', status: 'open',
  priority: 'high', attachments: [], ...o,
} as unknown as RFI);

const sub = (o: Partial<Submittal>): Submittal => ({
  id: 's1', projectId: 'p1', number: 3, title: 'Window schedule', specSection: '08 50 00',
  submittedBy: 'GC', submittedDate: '2026-02-01', requiredDate: '2026-02-10',
  reviewCycles: [], currentStatus: 'pending', attachments: [],
  createdAt: '2026-02-01', updatedAt: '2026-02-01', ...o,
} as unknown as Submittal);

const co = (o: Partial<ChangeOrder>): ChangeOrder => ({
  id: 'c1', number: 4, projectId: 'p1', date: '2026-02-01', description: 'Extra framing',
  status: 'submitted', changeAmount: 5000, lineItems: [], ...o,
} as unknown as ChangeOrder);

console.log('\nsystem of action (chase engine):');

// ── RFI chasing ──
const rfiList = buildChaseList({ rfis: [rfi({})], submittals: [], changeOrders: [], projects, nowMs: NOW });
expect('overdue RFI produces one chase item', rfiList.length, 1);
expect('days overdue computed (Feb 5 → Feb 15 = 9)', rfiList[0].daysOverdue, 9);
expect('waiting-on names the assignee', rfiList[0].waitingOn, 'Jane the Architect');
expect('severity critical at >=7d overdue', rfiList[0].severity, 'critical');
ok('nudge is a real draftable message', rfiList[0].nudge.includes('RFI #12') && rfiList[0].nudge.length > 60, rfiList[0].nudge);
expect('route opens the RFI', rfiList[0].route.params.rfiId, 'r1');
expect('project name resolved', rfiList[0].projectName, 'Oak Kitchen');

// ── things NOT to chase ──
expect('answered RFI not chased',
  buildChaseList({ rfis: [rfi({ dateResponded: '2026-02-06' })], submittals: [], changeOrders: [], projects, nowMs: NOW }).length, 0);
expect('closed RFI not chased',
  buildChaseList({ rfis: [rfi({ status: 'closed' as RFI['status'] })], submittals: [], changeOrders: [], projects, nowMs: NOW }).length, 0);
expect('RFI in OUR court not chased (chasing yourself is noise)',
  buildChaseList({ rfis: [rfi({ ballInCourt: 'gc' })], submittals: [], changeOrders: [], projects, nowMs: NOW }).length, 0);
expect('not-yet-due RFI excluded by default',
  buildChaseList({ rfis: [rfi({ dateRequired: '2026-03-01' })], submittals: [], changeOrders: [], projects, nowMs: NOW }).length, 0);
expect('not-yet-due included when includeUpcoming',
  buildChaseList({ rfis: [rfi({ dateRequired: '2026-03-01' })], submittals: [], changeOrders: [], projects, nowMs: NOW, includeUpcoming: true }).length, 1);

// ── submittals ──
const subList = buildChaseList({ rfis: [], submittals: [sub({})], changeOrders: [], projects, nowMs: NOW });
expect('overdue submittal chased', subList.length, 1);
expect('submittal overdue days (Feb 10 → Feb 15 = 4)', subList[0].daysOverdue, 4);
expect('submittal severity high at 4d', subList[0].severity, 'high');
expect('approved submittal not chased',
  buildChaseList({ rfis: [], submittals: [sub({ currentStatus: 'approved' as Submittal['currentStatus'] })], changeOrders: [], projects, nowMs: NOW }).length, 0);

// ── change orders with the owner (3-day grace) ──
const coList = buildChaseList({ rfis: [], submittals: [], changeOrders: [co({})], projects, nowMs: NOW });
expect('CO with owner chased past the grace period', coList.length, 1);
// Date-only anchors at noon: Feb 1 12:00 → Feb 15 00:00 floors to 13d age, −3 grace = 10.
expect('CO overdue = age − 3 grace (13 − 3 = 10)', coList[0].daysOverdue, 10);
expect('draft CO not chased (never sent)',
  buildChaseList({ rfis: [], submittals: [], changeOrders: [co({ status: 'draft' as ChangeOrder['status'] })], projects, nowMs: NOW }).length, 0);
expect('approved CO not chased',
  buildChaseList({ rfis: [], submittals: [], changeOrders: [co({ status: 'approved' as ChangeOrder['status'] })], projects, nowMs: NOW }).length, 0);
expect('CO inside the 3-day grace not chased',
  buildChaseList({ rfis: [], submittals: [], changeOrders: [co({ date: '2026-02-14' })], projects, nowMs: NOW }).length, 0);

// ── ordering + summary ──
const all = buildChaseList({ rfis: [rfi({})], submittals: [sub({})], changeOrders: [co({})], projects, nowMs: NOW });
ok('sorted most-overdue first', all[0].daysOverdue >= all[1].daysOverdue && all[1].daysOverdue >= all[2].daysOverdue,
  all.map(a => a.daysOverdue).join(','));
const sum = chaseSummary(all);
expect('summary total + byKind', [sum.total, sum.byKind.rfi, sum.byKind.submittal, sum.byKind.co_approval], [3, 1, 1, 1]);
ok('summary counts criticals', sum.critical >= 1, `critical=${sum.critical}`);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

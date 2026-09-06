// scripts/validate-brain-watch.ts — pure-fn validator for utils/brainWatch.ts
import {
  scheduleAttention,
  invoiceAttention,
  permitAttention,
  certAttention,
  closeoutAttention,
  punchAttention,
  changeOrderAttention,
  groupReadyPunchItems,
  rankAttention,
  summarize,
  type AttentionItem,
} from '../utils/brainWatch';
import type { Project, Invoice, Permit, Certification, PunchItem, ChangeOrder } from '../types';

let pass = 0, fail = 0;
function ok(n: string, cond: boolean) { if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } }

// ─── Helpers ────────────────────────────────────────────────────────────────

function mkProject(over: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Lakewood Residence',
    type: 'residential',
    location: '123 Main St',
    squareFootage: 2000,
    quality: 'standard',
    description: '',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    estimate: null,
    status: 'in_progress',
    ...over,
  } as Project;
}

function mkSchedule(healthScore?: number, taskCount = 3, riskCount = 0): NonNullable<Project['schedule']> {
  return {
    id: 's1',
    name: 'Lakewood Schedule',
    projectId: 'p1',
    workingDaysPerWeek: 5,
    bufferDays: 0,
    tasks: Array.from({ length: taskCount }, (_, i) => ({
      id: `t${i}`,
      title: `Task ${i}`,
      phase: 'Phase 1',
      durationDays: 5,
      startDay: i * 5 + 1,
      progress: 0,
      crew: '',
      dependencies: [],
      notes: '',
      status: 'not_started' as const,
    })),
    totalDurationDays: taskCount * 5,
    criticalPathDays: taskCount * 5,
    laborAlignmentScore: 80,
    riskItems: Array.from({ length: riskCount }, (_, i) => ({
      id: `r${i}`,
      type: 'overload' as const,
      description: 'Risk',
      severity: 'medium' as const,
      affectedTaskIds: [],
    })),
    healthScore,
  } as unknown as NonNullable<Project['schedule']>;
}

function mkInvoice(over: Partial<Invoice> = {}): Invoice {
  return {
    id: 'inv1',
    number: 1,
    projectId: 'p1',
    type: 'full',
    issueDate: '2025-01-01',
    dueDate: '2025-01-15',
    paymentTerms: 'net30',
    notes: '',
    lineItems: [],
    subtotal: 1000,
    taxRate: 0,
    taxAmount: 0,
    totalDue: 1000,
    amountPaid: 0,
    status: 'sent',
    payments: [],
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...over,
  } as Invoice;
}

function mkPermit(over: Partial<Permit> = {}): Permit {
  return {
    id: 'perm1',
    projectId: 'p1',
    projectName: 'Lakewood Residence',
    type: 'building',
    jurisdiction: 'City',
    status: 'inspection_scheduled',
    appliedDate: '2025-01-01',
    fee: 500,
    ...over,
  } as Permit;
}

function mkCert(over: Partial<Certification & { status: 'expiring' | 'expired' }> = {}): Certification & { status: 'expiring' | 'expired' } {
  return {
    id: 'cert1',
    holderName: 'John Smith',
    type: 'OSHA 30',
    expiresDate: '2025-02-01',
    status: 'expiring' as 'expiring' | 'expired',
    createdAt: '2025-01-01T00:00:00Z',
    createdBy: 'user1',
    ...over,
  } as Certification & { status: 'expiring' | 'expired' };
}

const NOW_MS = Date.parse('2025-01-20T00:00:00Z'); // fixed reference

// ─── scheduleAttention ───────────────────────────────────────────────────────

console.log('\nscheduleAttention:');

// No schedule → empty
{
  const p = mkProject();
  const items = scheduleAttention(p);
  ok('no schedule → empty', items.length === 0);
}

// Good health (>= 70) → empty
{
  const p = mkProject({ schedule: mkSchedule(75) });
  ok('health 75 → empty', scheduleAttention(p).length === 0);
}

// health < 40 → critical
{
  const p = mkProject({ schedule: mkSchedule(35) });
  const items = scheduleAttention(p);
  ok('health 35 → 1 item', items.length === 1);
  ok('health 35 → critical', items[0].severity === 'critical');
  ok('health 35 → message contains score', items[0].message.includes('35'));
  ok('health 35 → schedule kind', items[0].kind === 'schedule');
  ok('health 35 → route /schedule-pro', items[0].route.pathname === '/schedule-pro');
  ok('health 35 → route has projectId', items[0].route.params?.projectId === 'p1');
}

// health 45 → high
{
  const p = mkProject({ schedule: mkSchedule(45) });
  const items = scheduleAttention(p);
  ok('health 45 → high', items.length === 1 && items[0].severity === 'high');
}

// health 65 → medium (< 70)
{
  const p = mkProject({ schedule: mkSchedule(65) });
  const items = scheduleAttention(p);
  ok('health 65 → medium', items.length === 1 && items[0].severity === 'medium');
}

// missing healthScore, no riskItems → empty (not enough signal)
{
  const p = mkProject({ schedule: mkSchedule(undefined, 3, 0) });
  ok('missing score + no risk → empty', scheduleAttention(p).length === 0);
}

// missing healthScore + has riskItems → fires (medium, score shows '?')
{
  const p = mkProject({ schedule: mkSchedule(undefined, 3, 2) });
  const items = scheduleAttention(p);
  ok('missing score + riskItems → 1 item', items.length === 1);
  ok('missing score → message has ?', items[0].message.includes('?'));
}

// schedule with no tasks → empty
{
  const p = mkProject({ schedule: mkSchedule(30, 0) });
  ok('no tasks → empty', scheduleAttention(p).length === 0);
}

// ─── invoiceAttention ────────────────────────────────────────────────────────

console.log('\ninvoiceAttention:');

// Not overdue (within grace window) → empty
{
  const p = mkProject();
  const inv = mkInvoice({ dueDate: '2025-01-14' }); // 6 days overdue from Jan 20
  ok('6d overdue → empty (grace)', invoiceAttention(p, [inv], NOW_MS).length === 0);
}

// 8 days overdue → medium
{
  const p = mkProject();
  const inv = mkInvoice({ dueDate: '2025-01-12' }); // 8d overdue
  const items = invoiceAttention(p, [inv], NOW_MS);
  ok('8d overdue → 1 item', items.length === 1);
  ok('8d overdue → medium', items[0].severity === 'medium');
  ok('8d overdue → invoice kind', items[0].kind === 'invoice');
  ok('8d overdue → message has invoice #', items[0].message.includes('#1'));
  ok('8d overdue → message has days', items[0].message.includes('8d'));
  ok('8d overdue → route /invoice', items[0].route.pathname === '/invoice');
  ok('8d overdue → route has projectId', items[0].route.params?.projectId === 'p1');
  ok('8d overdue → route has invoiceId', items[0].route.params?.invoiceId === 'inv1');
}

// 15 days overdue → high
{
  const p = mkProject();
  const inv = mkInvoice({ dueDate: '2025-01-05' }); // 15d overdue
  ok('15d overdue → high', invoiceAttention(p, [inv], NOW_MS)[0].severity === 'high');
}

// 31 days overdue → critical
{
  const p = mkProject();
  const inv = mkInvoice({ dueDate: '2024-12-20' }); // 31d overdue
  ok('31d overdue → critical', invoiceAttention(p, [inv], NOW_MS)[0].severity === 'critical');
}

// paid invoice → empty
{
  const p = mkProject();
  const inv = mkInvoice({ dueDate: '2025-01-05', status: 'paid' });
  ok('paid invoice → empty', invoiceAttention(p, [inv], NOW_MS).length === 0);
}

// draft invoice → empty
{
  const p = mkProject();
  const inv = mkInvoice({ dueDate: '2025-01-05', status: 'draft' });
  ok('draft invoice → empty', invoiceAttention(p, [inv], NOW_MS).length === 0);
}

// wrong projectId → empty
{
  const p = mkProject({ id: 'p2' });
  const inv = mkInvoice({ dueDate: '2025-01-05' }); // belongs to p1
  ok('wrong projectId → empty', invoiceAttention(p, [inv], NOW_MS).length === 0);
}

// multiple overdue → multiple items
{
  const p = mkProject();
  const inv1 = mkInvoice({ id: 'inv1', number: 1, dueDate: '2025-01-05' });
  const inv2 = mkInvoice({ id: 'inv2', number: 2, dueDate: '2025-01-01' });
  const items = invoiceAttention(p, [inv1, inv2], NOW_MS);
  ok('two overdue → 2 items', items.length === 2);
}

// ─── permitAttention ─────────────────────────────────────────────────────────

console.log('\npermitAttention:');

// inspectionDate is a CALENDAR DAY (bare 'YYYY-MM-DD'), so permitAttention counts
// whole LOCAL days (daysUntilCalendarDay) — B4 review A3 replaced a UTC-midnight
// Date.parse + floored-millisecond count that read a day short every morning
// west of Greenwich. The fixture clock is therefore LOCAL noon on Jan 20, not
// the UTC-midnight NOW_MS the instant-based sections use: that instant is still
// Jan 19 in Denver, and a local-day count from it is one day longer.
const PERMIT_NOW_MS = new Date(2025, 0, 20, 12).getTime();

// inspection in 5 days → high
{
  const p = mkProject();
  const perm = mkPermit({ inspectionDate: '2025-01-25' }); // 5d from Jan 20
  const items = permitAttention(p, [perm], PERMIT_NOW_MS);
  ok('5d inspection → 1 item', items.length === 1);
  ok('5d inspection → high', items[0].severity === 'high');
  ok('5d inspection → permit kind', items[0].kind === 'permit');
  ok('5d inspection → message has days', items[0].message.includes('5d'));
  ok('5d inspection → route /permits', items[0].route.pathname === '/permits');
  ok('5d inspection → route has projectId', items[0].route.params?.projectId === 'p1');
}

// inspection in 1 day → critical
{
  const p = mkProject();
  const perm = mkPermit({ inspectionDate: '2025-01-21' }); // 1d
  ok('1d inspection → critical', permitAttention(p, [perm], PERMIT_NOW_MS)[0].severity === 'critical');
}

// inspection in 2 days → critical (≤ 2)
{
  const p = mkProject();
  const perm = mkPermit({ inspectionDate: '2025-01-22' }); // 2d
  ok('2d inspection → critical', permitAttention(p, [perm], PERMIT_NOW_MS)[0].severity === 'critical');
}

// inspection in 8 days → empty (> 7)
{
  const p = mkProject();
  const perm = mkPermit({ inspectionDate: '2025-01-28' }); // 8d
  ok('8d inspection → empty', permitAttention(p, [perm], PERMIT_NOW_MS).length === 0);
}

// inspection in past → empty
{
  const p = mkProject();
  const perm = mkPermit({ inspectionDate: '2025-01-18' }); // 2d ago
  ok('past inspection → empty', permitAttention(p, [perm], PERMIT_NOW_MS).length === 0);
}

// no inspectionDate → empty
{
  const p = mkProject();
  const perm = mkPermit();
  ok('no inspectionDate → empty', permitAttention(p, [perm], PERMIT_NOW_MS).length === 0);
}

// wrong projectId → empty
{
  const p = mkProject({ id: 'p2' });
  const perm = mkPermit({ inspectionDate: '2025-01-25' }); // belongs to p1
  ok('wrong projectId → empty', permitAttention(p, [perm], PERMIT_NOW_MS).length === 0);
}

// ─── certAttention ───────────────────────────────────────────────────────────

console.log('\ncertAttention:');

// expired → critical
{
  const cert = mkCert({ status: 'expired', expiresDate: '2025-01-10' });
  const items = certAttention([cert], NOW_MS);
  ok('expired cert → 1 item', items.length === 1);
  ok('expired cert → critical', items[0].severity === 'critical');
  ok('expired cert → cert kind', items[0].kind === 'cert');
  ok('expired cert → message has worker name', items[0].message.includes('John Smith'));
  ok('expired cert → message has cert type', items[0].message.includes('OSHA 30'));
  ok('expired cert → message has expired', items[0].message.includes('expired'));
  ok('expired cert → route /crew', items[0].route.pathname === '/crew');
}

// expiring in 10 days → high (< 14)
{
  const cert = mkCert({ status: 'expiring', expiresDate: '2025-01-30' }); // 10d from Jan 20
  const items = certAttention([cert], NOW_MS);
  ok('expiring 10d → high', items[0].severity === 'high');
  ok('expiring 10d → message has days', items[0].message.includes('10d'));
}

// expiring in 20 days → medium (>= 14)
{
  const cert = mkCert({ status: 'expiring', expiresDate: '2025-02-09' }); // 20d from Jan 20
  const items = certAttention([cert], NOW_MS);
  ok('expiring 20d → medium', items[0].severity === 'medium');
}

// empty list → empty
{
  ok('empty certs → empty', certAttention([], NOW_MS).length === 0);
}

// holderName fallback to workerId
{
  const cert = mkCert({ holderName: undefined, workerId: 'worker-abc', status: 'expired' });
  const items = certAttention([cert], NOW_MS);
  ok('no holderName → uses workerId', items[0].message.includes('worker-abc'));
}

// dedupe by (person, cert): duplicate records collapse to ONE line
// (sim-audit fix #3 — "Dana Cole — First Aid / CPR expired" x3 verbatim).
{
  const dupes = [
    mkCert({ id: 'c1', status: 'expired' as const, expiresDate: '2025-01-10' }),
    mkCert({ id: 'c2', status: 'expired' as const, expiresDate: '2025-01-10' }),
    mkCert({ id: 'c3', status: 'expired' as const, expiresDate: '2025-01-10' }),
  ];
  const items = certAttention(dupes, NOW_MS);
  ok('3 duplicate (person,cert) records → 1 item', items.length === 1);
  ok('deduped item keeps severity', items[0]?.severity === 'critical');
}

// dedupe keeps the MOST urgent record (expired beats expiring)
{
  const mixed = [
    mkCert({ id: 'c1', status: 'expiring' as const, expiresDate: '2025-02-09' }),
    mkCert({ id: 'c2', status: 'expired' as const, expiresDate: '2025-01-10' }),
  ];
  const items = certAttention(mixed, NOW_MS);
  ok('expiring + expired same (person,cert) → 1 item', items.length === 1);
  ok('most urgent (expired/critical) wins', items[0]?.severity === 'critical' && items[0].message.includes('expired'));
}

// different people / different certs do NOT collapse
{
  const distinct = [
    mkCert({ id: 'c1', status: 'expired' as const }),
    mkCert({ id: 'c2', status: 'expired' as const, holderName: 'Dana Cole' }),
    mkCert({ id: 'c3', status: 'expired' as const, type: 'First Aid / CPR' }),
  ];
  ok('distinct person/cert stay separate', certAttention(distinct, NOW_MS).length === 3);
}

// PIN (finding #3): two DISTINCT certs with BOTH holderName and workerId absent
// and the SAME type must NOT merge — they are different people. The dedupe key
// falls back to cert.id when no real person identifier is present, so the
// canonical count can't under-count bulk-imported / hand-entered certs.
{
  const nullHolders = [
    mkCert({ id: 'c1', status: 'expired' as const, holderName: undefined, workerId: undefined, type: 'OSHA 30' }),
    mkCert({ id: 'c2', status: 'expired' as const, holderName: undefined, workerId: undefined, type: 'OSHA 30' }),
  ];
  const items = certAttention(nullHolders, NOW_MS);
  ok('two null-holder distinct certs stay separate', items.length === 2);
  ok('both null-holder certs keep their own id', items.some(i => i.id === 'cert-c1') && items.some(i => i.id === 'cert-c2'));
}

// A real person identifier still dedupes: two records that DO share a
// holderName + type collapse to one (dedupe is preserved for real people).
{
  const named = [
    mkCert({ id: 'c1', status: 'expired' as const, holderName: 'Sam Reyes', type: 'OSHA 30' }),
    mkCert({ id: 'c2', status: 'expired' as const, holderName: 'Sam Reyes', type: 'OSHA 30' }),
  ];
  ok('same named person + cert still collapses to 1', certAttention(named, NOW_MS).length === 1);
}

// ─── groupReadyPunchItems ────────────────────────────────────────────────────

console.log('\ngroupReadyPunchItems:');

const mkPunch = (id: string, projectId: string, description: string, priority: 'high' | 'medium' | 'low' = 'medium') => ({
  id, projectId, description, priority, updatedAt: '2025-01-19T12:00:00Z',
});

// identical description across 3 projects → 1 group, xN projects
{
  const groups = groupReadyPunchItems([
    mkPunch('a', 'p1', 'Window flashing lap reversed, guest-house south'),
    mkPunch('b', 'p2', 'Window flashing lap reversed, guest-house south'),
    mkPunch('c', 'p3', 'Window flashing lap reversed, guest-house south'),
  ]);
  ok('3 identical items → 1 group', groups.length === 1);
  ok('group spans 3 projects', groups[0]?.projectCount === 3);
  ok('group carries all member ids', groups[0]?.ids.length === 3);
  ok('primary is the first item', groups[0]?.primary.id === 'a');
}

// whitespace/case-insensitive description matching
{
  const groups = groupReadyPunchItems([
    mkPunch('a', 'p1', 'Touch up paint  hallway'),
    mkPunch('b', 'p2', 'touch up paint hallway'),
  ]);
  ok('normalized description matches', groups.length === 1 && groups[0]?.projectCount === 2);
}

// highest member priority wins
{
  const groups = groupReadyPunchItems([
    mkPunch('a', 'p1', 'Same item', 'low'),
    mkPunch('b', 'p2', 'Same item', 'high'),
  ]);
  ok('group priority = highest member', groups[0]?.priority === 'high');
}

// distinct descriptions stay separate; same project twice counts ONE project
{
  const groups = groupReadyPunchItems([
    mkPunch('a', 'p1', 'Item one'),
    mkPunch('b', 'p1', 'Item one'),
    mkPunch('c', 'p1', 'Item two'),
  ]);
  ok('distinct descriptions → 2 groups', groups.length === 2);
  const g1 = groups.find(g => g.primary.id === 'a');
  ok('same-project dupes count 1 project', g1?.projectCount === 1 && g1?.ids.length === 2);
}

// PIN (finding #4): a GENERIC description ("touch up paint") on two UNRELATED
// projects must NOT false-merge into one "x2 projects" row — they are
// different work. Generic stop-list phrases key per-item, so they stay two
// distinct rows.
{
  const groups = groupReadyPunchItems([
    mkPunch('a', 'p1', 'Touch up paint'),
    mkPunch('b', 'p2', 'touch up paint'),
  ]);
  ok('generic "touch up paint" across projects → 2 groups (no false merge)', groups.length === 2);
  ok('each generic group counts 1 project', groups.every(g => g.projectCount === 1 && g.ids.length === 1));
}

// Other generic phrases likewise stay separate.
{
  const groups = groupReadyPunchItems([
    mkPunch('a', 'p1', 'Clean up'),
    mkPunch('b', 'p2', 'clean up'),
    mkPunch('c', 'p3', 'Final walkthrough'),
    mkPunch('d', 'p4', 'final walkthrough'),
  ]);
  ok('generic "clean up"/"final walkthrough" never merge', groups.length === 4);
}

// A DISTINCTIVE description still merges across projects (the real re-seeded
// dupe case is preserved — this is NOT weakened).
{
  const groups = groupReadyPunchItems([
    mkPunch('a', 'p1', 'Window flashing lap reversed, guest-house south'),
    mkPunch('b', 'p2', 'Window flashing lap reversed, guest-house south'),
  ]);
  ok('distinctive description still merges across projects', groups.length === 1 && groups[0]?.projectCount === 2);
}

// empty input → empty
{
  ok('empty punch input → empty', groupReadyPunchItems([]).length === 0);
}

// ─── closeoutAttention ───────────────────────────────────────────────────────

console.log('\ncloseoutAttention:');

// in_progress + schedule 100% → fires
{
  const p = mkProject({ status: 'in_progress', schedule: mkSchedule(80, 3, 0) });
  // Override tasks so all have progress 100
  if (p.schedule) {
    p.schedule.tasks = p.schedule.tasks.map((t) => ({ ...t, progress: 100 }));
  }
  const items = closeoutAttention(p);
  ok('100% progress → 1 item', items.length === 1);
  ok('100% progress → medium', items[0].severity === 'medium');
  ok('100% progress → closeout kind', items[0].kind === 'closeout');
  ok('100% progress → route /closeout-binder', items[0].route.pathname === '/closeout-binder');
  ok('100% progress → route has projectId', items[0].route.params?.projectId === 'p1');
}

// in_progress + schedule 80% → no fire
{
  const p = mkProject({ status: 'in_progress', schedule: mkSchedule(80, 3, 0) });
  ok('80% progress → empty', closeoutAttention(p).length === 0);
}

// no schedule → no fire
{
  const p = mkProject({ status: 'in_progress' });
  ok('no schedule → empty', closeoutAttention(p).length === 0);
}

// completed → no fire (already past the gate)
{
  const p = mkProject({ status: 'completed', schedule: mkSchedule(80, 3, 0) });
  if (p.schedule) p.schedule.tasks = p.schedule.tasks.map((t) => ({ ...t, progress: 100 }));
  ok('completed → empty', closeoutAttention(p).length === 0);
}

// closed → no fire
{
  const p = mkProject({ status: 'closed', schedule: mkSchedule(80, 3, 0) });
  if (p.schedule) p.schedule.tasks = p.schedule.tasks.map((t) => ({ ...t, progress: 100 }));
  ok('closed → empty', closeoutAttention(p).length === 0);
}

// ─── rankAttention ───────────────────────────────────────────────────────────

console.log('\nrankAttention:');

{
  const items: AttentionItem[] = [
    { id: 'a', projectId: '', projectName: '', kind: 'schedule' as const, severity: 'medium' as const, message: 'A', route: { pathname: '/schedule-pro' } },
    { id: 'b', projectId: '', projectName: '', kind: 'invoice' as const, severity: 'critical' as const, message: 'B', route: { pathname: '/invoice' } },
    { id: 'c', projectId: '', projectName: '', kind: 'cert' as const, severity: 'high' as const, message: 'C', route: { pathname: '/crew' } },
    { id: 'd', projectId: '', projectName: '', kind: 'permit' as const, severity: 'medium' as const, message: 'D', route: { pathname: '/permits' } },
  ];
  const ranked = rankAttention(items);
  ok('critical first', ranked[0].id === 'b');
  ok('high second', ranked[1].id === 'c');
  ok('mediums after high', ranked[2].severity === 'medium' && ranked[3].severity === 'medium');
  // Stable: A comes before D (same severity, original order preserved)
  ok('stable for medium (A before D)', ranked[2].id === 'a' && ranked[3].id === 'd');
}

// Empty list → empty
{
  ok('rank empty → empty', rankAttention([]).length === 0);
}

// ─── summarize ───────────────────────────────────────────────────────────────

console.log('\nsummarize:');

{
  const items: AttentionItem[] = [
    { id: '1', projectId: '', projectName: '', kind: 'schedule' as const, severity: 'critical' as const, message: '', route: { pathname: '/schedule-pro' } },
    { id: '2', projectId: '', projectName: '', kind: 'schedule' as const, severity: 'high' as const, message: '', route: { pathname: '/schedule-pro' } },
    { id: '3', projectId: '', projectName: '', kind: 'invoice' as const, severity: 'medium' as const, message: '', route: { pathname: '/invoice' } },
    { id: '4', projectId: '', projectName: '', kind: 'cert' as const, severity: 'critical' as const, message: '', route: { pathname: '/crew' } },
    { id: '5', projectId: 'p1', projectName: 'Test', kind: 'closeout' as const, severity: 'medium' as const, message: '', route: { pathname: '/closeout-binder', params: { projectId: 'p1' } } },
  ];
  const s = summarize(items);
  ok('total = 5', s.total === 5);
  ok('schedule = 2', s.byKind.schedule === 2);
  ok('invoice = 1', s.byKind.invoice === 1);
  ok('permit = 0', s.byKind.permit === 0);
  ok('cert = 1', s.byKind.cert === 1);
  ok('closeout = 1', s.byKind.closeout === 1);
}

{
  const s = summarize([]);
  ok('empty total = 0', s.total === 0);
  ok('empty schedule = 0', s.byKind.schedule === 0);
  ok('empty closeout = 0', s.byKind.closeout === 0);
  ok('empty punch = 0', s.byKind.punch === 0);
  ok('empty changeOrder = 0', s.byKind.changeOrder === 0);
}

// ─── punchAttention ──────────────────────────────────────────────────────────

console.log('\npunchAttention:');

function mkPunchItem(over: Partial<PunchItem> = {}): PunchItem {
  return {
    id: 'pi1',
    projectId: 'p1',
    description: 'Window flashing lap reversed',
    priority: 'high',
    status: 'open',
    updatedAt: '2025-01-10T00:00:00Z',
    createdAt: '2025-01-10T00:00:00Z',
    ...over,
  } as PunchItem;
}

// No punch items → empty
{
  ok('no punch → empty', punchAttention([]).length === 0);
}

// Only low/medium priority → empty
{
  const items = punchAttention([mkPunchItem({ priority: 'medium' }), mkPunchItem({ id: 'pi2', priority: 'low' })]);
  ok('no high priority → empty', items.length === 0);
}

// Closed high-priority → empty
{
  ok('closed high → empty', punchAttention([mkPunchItem({ status: 'closed' })]).length === 0);
}

// Rollup: 3 open high across projects → ONE item with the count
{
  const items = punchAttention([
    mkPunchItem(),
    mkPunchItem({ id: 'pi2', projectId: 'p2' }),
    mkPunchItem({ id: 'pi3', projectId: 'p3', status: 'ready_for_review' }),
  ]);
  ok('3 open high → 1 rollup item', items.length === 1);
  ok('rollup counts 3', items[0].message.includes('3 high-priority punch items'));
  ok('rollup kind punch', items[0].kind === 'punch');
  ok('rollup severity high', items[0].severity === 'high');
  ok('rollup routes to first project', items[0].route.pathname === '/project-detail' && items[0].route.params?.id === 'p1');
}

// Singular message
{
  const items = punchAttention([mkPunchItem()]);
  ok('1 open high → singular message', items[0].message.includes('1 high-priority punch item open'));
}

// ─── changeOrderAttention ────────────────────────────────────────────────────

console.log('\nchangeOrderAttention:');

function mkCO(over: Partial<ChangeOrder> = {}): ChangeOrder {
  return {
    id: 'co1',
    projectId: 'p1',
    number: 1,
    title: 'Extra footing',
    status: 'submitted',
    changeAmount: 1200,
    createdAt: '2025-01-10T00:00:00Z',
    updatedAt: '2025-01-10T00:00:00Z',
    ...over,
  } as ChangeOrder;
}

// No pending COs → empty
{
  ok('no COs → empty', changeOrderAttention([]).length === 0);
  ok('approved CO → empty', changeOrderAttention([mkCO({ status: 'approved' as ChangeOrder['status'] })]).length === 0);
}

// submitted + under_review roll up to ONE item
{
  const items = changeOrderAttention([
    mkCO(),
    mkCO({ id: 'co2', status: 'under_review' as ChangeOrder['status'], projectId: 'p2' }),
  ]);
  ok('2 pending → 1 rollup item', items.length === 1);
  ok('rollup counts 2', items[0].message.includes('2 change orders awaiting approval'));
  ok('rollup kind changeOrder', items[0].kind === 'changeOrder');
  ok('rollup severity medium', items[0].severity === 'medium');
  ok('rollup routes to first project', items[0].route.params?.id === 'p1');
}

// Singular message
{
  ok('1 pending → singular message', changeOrderAttention([mkCO()])[0].message.includes('1 change order awaiting'));
}

// ─── Footer ──────────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

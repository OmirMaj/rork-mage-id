// validate-proposal-chase.ts — pins the 'proposal' chase kind
// (utils/systemOfAction.ts), its read (utils/contractEngine.fetchOpenProposals)
// and its Waiting On row (app/waiting-on.tsx).
// Run: bun run scripts/validate-proposal-chase.ts
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  buildChaseList,
  chaseSummary,
  proposalNudge,
  PROPOSAL_GRACE_DAYS,
  type ProposalChaseInput,
} from '../utils/systemOfAction';
import type { RFI, Submittal, ChangeOrder, Project } from '../types';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, detail ? `\n        ${detail}` : ''); }
}
const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

console.log('\nproposal chase:');

const NOW = Date.parse('2026-02-15T00:00:00');
const DAY = 86400000;
const projects = [
  { id: 'p1', name: 'Oak Kitchen', status: 'estimated', primaryContact: { name: 'Dana Ruiz' } },
  { id: 'p2', name: 'Elm Bath', status: 'in_progress' },
  { id: 'p3', name: 'Pine Deck', status: 'draft' },
] as unknown as Project[];

/** sentAt n days before NOW, as an instant (floor(n) days past). */
const sentDaysAgo = (n: number) => new Date(NOW - n * DAY - 3600000).toISOString();

const prop = (o: Partial<ProposalChaseInput> = {}): ProposalChaseInput => ({
  id: 'k1', projectId: 'p1', title: 'Kitchen remodel', contractValue: 48250, status: 'sent',
  kind: 'proposal', sentAt: sentDaysAgo(6), ...o,
});
const run = (proposals: ProposalChaseInput[], includeUpcoming = false) =>
  buildChaseList({ rfis: [], submittals: [], changeOrders: [], projects, nowMs: NOW, includeUpcoming, proposals });

ok('grace is two days', PROPOSAL_GRACE_DAYS === 2);

// ── The one item ────────────────────────────────────────────────────────────
const six = run([prop()]);
ok('a proposal sent 6 days ago and unsigned → one proposal item', six.length === 1 && six[0].kind === 'proposal', JSON.stringify(six));
const it = six[0];
ok('daysOverdue = 6 − 2 = 4', it?.daysOverdue === 4, String(it?.daysOverdue));
ok('severity follows the overdue days', it?.severity === 'high');
ok('id is proposal:<id>', it?.id === 'proposal:k1');
ok('title names the proposal and its value', it?.title === 'Proposal: Kitchen remodel ($48,250)', it?.title);
ok('waiting on the primary contact', it?.waitingOn === 'Dana Ruiz');
ok("note says MAGE can't see opens", it?.note === 'Sent 6 day(s) ago. MAGE can’t see whether they opened it.', it?.note);
ok('never claims opened or unopened', !/\b(opened it|unopened|has opened|viewed)\b/i.test(it?.nudge ?? '') && !/\bopened\b(?! it\.)/.test(it?.note ?? ''));
ok('route opens the contract screen', it?.route.pathname === '/contract' && it.route.params.projectId === 'p1');
ok('project name resolved', it?.projectName === 'Oak Kitchen');
const noContact = run([prop({ projectId: 'p3' })]);
ok("no contact → 'the client'", noContact[0]?.waitingOn === 'the client');
ok("no contact → the nudge says 'Hi there'", noContact[0]?.nudge.startsWith('Hi there,'), noContact[0]?.nudge);

// ── Exclusions ──────────────────────────────────────────────────────────────
ok('signed is excluded', run([prop({ signedAt: sentDaysAgo(1) })]).length === 0);
ok('voided is excluded', run([prop({ voidedAt: sentDaysAgo(1) })]).length === 0);
ok('superseded is excluded', run([prop({ supersededBy: 'k2' })]).length === 0);
ok("kind 'contract' is excluded", run([prop({ kind: 'contract' })]).length === 0);
ok('a missing kind is excluded', run([prop({ kind: undefined })]).length === 0);
ok("status other than 'sent' is excluded", run([prop({ status: 'signed' })]).length === 0 && run([prop({ status: 'draft' })]).length === 0);
ok('no sentAt is excluded', run([prop({ sentAt: undefined })]).length === 0);
ok('a project that is in_progress is excluded', run([prop({ projectId: 'p2' })]).length === 0);
ok('completed / closed projects are excluded',
  buildChaseList({ rfis: [], submittals: [], changeOrders: [], nowMs: NOW, proposals: [prop()],
    projects: [{ id: 'p1', name: 'x', status: 'completed' }] as unknown as Project[] }).length === 0
  && buildChaseList({ rfis: [], submittals: [], changeOrders: [], nowMs: NOW, proposals: [prop()],
    projects: [{ id: 'p1', name: 'x', status: 'closed' }] as unknown as Project[] }).length === 0);
ok('a proposal on an unknown project is excluded', run([prop({ projectId: 'nope' })]).length === 0);

// ── Grace ───────────────────────────────────────────────────────────────────
ok('a 1-day-old proposal is excluded by default', run([prop({ sentAt: sentDaysAgo(1) })]).length === 0);
const up = run([prop({ sentAt: sentDaysAgo(1) })], true);
ok('…and included with includeUpcoming (daysOverdue 0)', up.length === 1 && up[0].daysOverdue === 0, JSON.stringify(up));
ok('a 2-day-old proposal is still inside the grace', run([prop({ sentAt: sentDaysAgo(2) })]).length === 0);

// ── Nudge stages ────────────────────────────────────────────────────────────
const n3 = run([prop({ sentAt: sentDaysAgo(3) })])[0]?.nudge ?? '';
ok('d = 3 → the received check',
  n3 === 'Hi Dana Ruiz, just checking you received the proposal for Kitchen remodel. Happy to walk through it or answer any questions.', n3);
const n6 = it?.nudge ?? '';
ok('d = 6 → the adjust-it follow-up',
  /^Hi Dana Ruiz, following up on the Kitchen remodel proposal I sent on [A-Z][a-z]{2} \d{1,2}\. Is there anything you'd like changed \(scope, timing or price\)\? I can adjust it this week\.$/.test(n6), n6);
const n12 = run([prop({ sentAt: sentDaysAgo(12) })])[0]?.nudge ?? '';
ok('d = 12 → the close-it-out message',
  n12 === "Hi Dana Ruiz, I don't want to keep filling your inbox about Kitchen remodel. If the timing isn't right, just let me know and I'll close it out for now. If you'd like to go ahead, I can hold a start date for you.", n12);
ok('boundaries: 4 → stage 1, 5 → stage 2, 9 → stage 2, 10 → stage 3',
  proposalNudge({ clientName: 'A', title: 'T', daysSinceSent: 4, sentLabel: 'x' }).includes('just checking')
  && proposalNudge({ clientName: 'A', title: 'T', daysSinceSent: 5, sentLabel: 'x' }).includes('following up')
  && proposalNudge({ clientName: 'A', title: 'T', daysSinceSent: 9, sentLabel: 'x' }).includes('following up')
  && proposalNudge({ clientName: 'A', title: 'T', daysSinceSent: 10, sentLabel: 'x' }).includes('filling your inbox'));
ok("blank client name → 'there'", proposalNudge({ clientName: '  ', title: 'T', daysSinceSent: 3, sentLabel: 'x' }).startsWith('Hi there,'));

// ── Omitted proposals: byte-identical to today's output ─────────────────────
// Fixtures shaped like scripts/validate-system-of-action.ts.
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
const world = {
  rfis: [rfi({}), rfi({ id: 'r2', dateSubmitted: '', number: 13 }), rfi({ id: 'r3', dateRequired: '2026-03-01' })],
  submittals: [sub({}), sub({ id: 's2', reviewCycles: [{ cycleNumber: 1 }] as unknown as Submittal['reviewCycles'], currentStatus: 'in_review' as Submittal['currentStatus'] })],
  changeOrders: [co({}), co({ id: 'c2', date: '2026-02-14' })],
  projects,
  nowMs: NOW,
};
for (const includeUpcoming of [false, true]) {
  const before = JSON.stringify(buildChaseList({ ...world, includeUpcoming }));
  ok(`omitted proposals → identical output (includeUpcoming ${includeUpcoming})`,
    before === JSON.stringify(buildChaseList({ ...world, includeUpcoming, proposals: undefined })));
  ok(`empty proposals → identical output (includeUpcoming ${includeUpcoming})`,
    before === JSON.stringify(buildChaseList({ ...world, includeUpcoming, proposals: [] })));
}
const mixed = buildChaseList({ ...world, proposals: [prop()] });
ok('proposals join the list without disturbing the others',
  JSON.stringify(mixed.filter(i => i.kind !== 'proposal')) === JSON.stringify(buildChaseList(world)));
ok('the joined list stays sorted by days overdue', mixed.every((x, i) => i === 0 || mixed[i - 1].daysOverdue >= x.daysOverdue));

// ── Summary ─────────────────────────────────────────────────────────────────
const sum = chaseSummary(mixed);
ok('chaseSummary byKind.proposal counts', sum.byKind.proposal === 1, JSON.stringify(sum.byKind));
ok('chaseSummary byKind.proposal is 0 without proposals', chaseSummary(buildChaseList(world)).byKind.proposal === 0);

// ── Source checks ───────────────────────────────────────────────────────────
const waiting = code('app/waiting-on.tsx');
ok("waiting-on's KIND_ICON has proposal", /const KIND_ICON[\s\S]*?proposal:\s*FileText,[\s\S]*?\};/.test(waiting));
ok('waiting-on feeds proposals only when the read succeeded',
  /proposals:\s*openProposals\.status === 'ok' \? openProposals\.rows : undefined/.test(waiting));
ok('waiting-on says so when the read failed',
  /testID="proposalchase-failed"/.test(waiting) && read('app/waiting-on.tsx').includes('Couldn’t check your sent proposals, so none are listed here.'));
ok('waiting-on renders item.note', /\{item\.note \? \(/.test(waiting));
const engine = code('utils/contractEngine.ts');
const fn = engine.slice(engine.indexOf('export async function fetchOpenProposals'));
ok('fetchOpenProposals reads project_contracts', /\.from\('project_contracts'\)/.test(fn));
ok("fetchOpenProposals filters kind='proposal' and status='sent'",
  /\.eq\('kind',\s*'proposal'\)/.test(fn) && /\.eq\('status',\s*'sent'\)/.test(fn));
ok('fetchOpenProposals keeps a failed read a failure', /if \(error\) return \{ ok: false, error: error\.message \}/.test(fn));
ok("fetchOpenProposals says 'Not connected' when unconfigured", /!isSupabaseConfigured\) return \{ ok: false, error: 'Not connected' \}/.test(fn));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

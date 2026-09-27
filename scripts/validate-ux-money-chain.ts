// validate-ux-money-chain — the money chain hands him the next step (UX wave, Lane C).
//
// WHAT IT PROVES.
//  1. utils/nextBillableMilestone: the deposit a SIGNED contract says is due
//     is offered with the contract's own amount and the exact params the
//     contract screen's "Create invoice" row sends; every refusal the contract
//     screen gives (unsigned, already invoiced, a draft carrying it, contract
//     full, zero) is a null; the final row only when asked.
//  2. The NextStepHero chain states: "estimate not sent" only when the
//     contract was FETCHED (undefined never reads as none); an approved CO is
//     offered only while dollars are unbilled and no draft already carries it.
//  3. Overdue rows + the ONE "Remind all" confirm name the count and the
//     clients, and never invent a recipient.
//  4. The waiver "From this job's subs" picker: subcontracts only, the
//     roster sub's email or none, and the amount only from recorded payments.
//  5. Estimate → proposal: the revision "Send proposal" names; the wizard's
//     one-tap landing.
//  6. The screens call these, and the honesty rules hold in the source
//     (C1 pre-send check, C8 label, C9 labels, C7 no typed dates).
//
// Run: bun run scripts/validate-ux-money-chain.ts

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  proposalLockedCopy,
  nextBillableMilestone, estimateNotSent, approvedUnbilledChangeOrders, subPaymentsMissingWaiver,
  overdueRemindRows, remindAllConfirm, overdueCardLine, waiverSubOptions, waiverAmountSeed,
  remindGate, remindAllRows, remindLockedCopy,
  proposalFromCurrentEstimate, sendProposalHref, wizardLandingStep, moneyLabel,
} from '../utils/nextBillableMilestone';
import { stepCanAdvance, TOTAL_SCOPE_STEPS, INITIAL_SCOPE } from '../utils/scopeQuestions';
import { SAMPLE_PROJECT_PREFIX } from '../utils/sampleGuard';
import type { Invoice, Project, ProjectContract, PaymentMilestone } from '../types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  PASS  ' + name); return; }
  fail++;
  console.error('  FAIL  ' + name + (detail ? `\n        ${detail}` : ''));
}
function eq<T>(name: string, actual: T, expected: T) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(name, a === e, `expected ${e}\n        got      ${a}`);
}

// ── fixtures ─────────────────────────────────────────────────────────────────
const ms = (id: string, trigger: PaymentMilestone['trigger'], extra: Partial<PaymentMilestone> = {}): PaymentMilestone => ({
  id, label: id, trigger, status: 'pending', ...extra,
});
const contract = (over: Partial<ProjectContract> = {}) => ({
  id: 'c1', projectId: 'p1', status: 'signed', contractValue: 18000, title: 'Kitchen',
  paymentSchedule: [
    ms('dep', 'on_signing', { percent: 25 }),
    ms('prog', 'on_invoice', { percent: 65 }),
    ms('fin', 'on_final', { percent: 10 }),
  ],
  ...over,
}) as unknown as ProjectContract;
const inv = (id: string, over: Partial<Invoice> = {}) => ({
  id, number: 1, projectId: 'p1', status: 'sent', lineItems: [], type: 'full', ...over,
}) as unknown as Invoice;

console.log('\n1. nextBillableMilestone');
{
  const n = nextBillableMilestone({ contract: contract(), invoices: [] });
  ok('a signed contract with an unbilled deposit offers the deposit', n?.kind === 'deposit' && n.milestone.id === 'dep');
  eq('…at the contract\'s number (25% of $18,000)', n?.amount, 4500);
  eq('…labelled "Bill deposit · $4,500"', n?.label, 'Bill deposit · $4,500');
  ok('…opening /invoice with the milestone, the contract and quick type', n?.href.pathname === '/invoice'
    && n.href.params.milestoneId === 'dep' && n.href.params.contractId === 'c1' && n.href.params.type === 'quick' && n.href.params.projectId === 'p1');
  ok('…with the contract\'s terms and no retainage on a deposit', n?.href.params.contractTerms === 'due_on_receipt'
    && n.href.params.milestoneTrigger === 'on_signing' && n.href.params.depositNoRetainage === '1');
  const line = n ? JSON.parse(n.href.params.prefillLines)[0] : null;
  ok('…and one prefilled line whose total is the contract\'s amount', line?.total === 4500 && String(line?.sourceEstimateItemId).startsWith('milestone:'));

  eq('an unsigned (sent) contract offers nothing', nextBillableMilestone({ contract: contract({ status: 'sent' } as Partial<ProjectContract>), invoices: [] }), null);
  eq('no contract offers nothing', nextBillableMilestone({ contract: null, invoices: [] }), null);
  eq('an unsaved contract (no id) offers nothing', nextBillableMilestone({ contract: contract({ id: '' } as Partial<ProjectContract>), invoices: [] }), null);
  eq('a deposit already invoiced (status) offers nothing',
    nextBillableMilestone({ contract: contract({ paymentSchedule: [ms('dep', 'on_signing', { percent: 25, status: 'invoiced', invoiceId: 'i9' })] } as Partial<ProjectContract>), invoices: [] }), null);
  eq('a DRAFT invoice already carrying the deposit blocks it (no second invoice)',
    nextBillableMilestone({ contract: contract(), invoices: [inv('i1', { status: 'draft', sourceMilestoneId: 'dep' } as Partial<Invoice>)] }), null);
  eq('a $0 deposit offers nothing',
    nextBillableMilestone({ contract: contract({ paymentSchedule: [ms('dep', 'on_signing', { percent: 0 })] } as Partial<ProjectContract>), invoices: [] }), null);
  const full = inv('i2', { status: 'sent', type: 'progress', progressPercent: 100, lineItems: [{ id: 'l', name: 'x', description: '', quantity: 1, unit: 'ls', unitPrice: 18000, total: 18000, sourceEstimateItemId: 'est-1' }] } as unknown as Partial<Invoice>);
  eq('a contract already billed in full refuses the deposit (the ceiling)', nextBillableMilestone({ contract: contract(), invoices: [full] }), null);

  const depBilled = contract({ paymentSchedule: [ms('dep', 'on_signing', { percent: 25, status: 'invoiced', invoiceId: 'i9' }), ms('fin', 'on_final', { percent: 10 })] } as Partial<ProjectContract>);
  eq('the final is NOT offered unless the caller says the job is done', nextBillableMilestone({ contract: depBilled, invoices: [] }), null);
  const fin = nextBillableMilestone({ contract: depBilled, invoices: [], includeFinal: true });
  ok('…and is offered when it is, at the contract\'s number', fin?.kind === 'final' && fin.amount === 1800 && fin.label === 'Bill final · $1,800' && !fin.href.params.depositNoRetainage);
  eq('a progress row is never a lump invoice', nextBillableMilestone({ contract: contract({ paymentSchedule: [ms('prog', 'on_invoice', { percent: 65 })] } as Partial<ProjectContract>), invoices: [], includeFinal: true }), null);
  eq('moneyLabel keeps cents when there are cents', moneyLabel(4500.5), '$4,500.50');
  eq('moneyLabel drops them when whole', moneyLabel(4500), '$4,500');
}

console.log('\n2. chain states');
{
  const withEst = { linkedEstimate: { items: [{ id: 'x' }] } } as unknown as Project;
  const noEst = { linkedEstimate: { items: [] } } as unknown as Project;
  eq('estimate + contract NOT FETCHED → says nothing', estimateNotSent(withEst, undefined), false);
  eq('estimate + fetched, none on file → not sent', estimateNotSent(withEst, null), true);
  eq('estimate + a draft contract → not sent', estimateNotSent(withEst, { status: 'draft' }), true);
  eq('estimate + a sent contract → sent', estimateNotSent(withEst, { status: 'sent' }), false);
  eq('no estimate → nothing to send', estimateNotSent(noEst, null), false);

  const co = (id: string, number: number, status: string, changeAmount: number) => ({ id, number, projectId: 'p1', status, changeAmount }) as never;
  const coLine = (coId: string, total: number) => ({ id: 'l' + coId, name: 'CO', description: '', quantity: 1, unit: 'ls', unitPrice: total, total, sourceEstimateItemId: `co:${coId}` });
  const unb = approvedUnbilledChangeOrders([co('a', 2, 'approved', 1200), co('b', 1, 'approved', 800), co('c', 3, 'submitted', 500)], []);
  eq('approved COs with money nobody billed, oldest first; a submitted CO is not offered', unb.map(u => [u.co.id, u.remaining]), [['b', 800], ['a', 1200]]);
  eq('a CO a sent invoice covers is not offered',
    approvedUnbilledChangeOrders([co('a', 2, 'approved', 1200)], [inv('i', { status: 'sent', lineItems: [coLine('a', 1200)] } as unknown as Partial<Invoice>)]).length, 0);
  eq('a CO an unsent DRAFT already carries is not offered (no second invoice)',
    approvedUnbilledChangeOrders([co('a', 2, 'approved', 1200)], [inv('i', { status: 'draft', lineItems: [coLine('a', 1200)] } as unknown as Partial<Invoice>)]).length, 0);
  eq('a credit CO is not a bill', approvedUnbilledChangeOrders([co('a', 2, 'approved', -300)], []).length, 0);
  eq('sub payments need a name and money that moved', subPaymentsMissingWaiver([{ subName: ' ', amount: 5 }, { subName: 'Volt', amount: 0 }, { subName: 'Volt', amount: 900 }]).length, 1);
  eq('no rows → none', subPaymentsMissingWaiver(undefined).length, 0);
}

console.log('\n3. overdue rows and Remind all');
{
  const now = new Date('2026-08-15T15:00:00Z').getTime();
  const projects = [
    { id: 'p1', name: 'Harlow', primaryContact: { name: 'Meredith Harlow', email: 'm@x.test' }, clientPortal: { invites: [] } },
    { id: 'p2', name: 'Ortiz', primaryContact: { name: 'Sam', phone: '5035550100' }, clientPortal: { invites: [{ id: 'i', name: 'Pat Ortiz', email: 'pat@x.test' }] } },
    { id: 'p3', name: 'Nobody', clientPortal: { invites: [] } },
  ] as unknown as Project[];
  const rowsSeedA = { id: 'a', number: 21, projectId: 'p1', dueDate: '2026-07-10T12:00:00Z', billToEmail: 'm@x.test' };
  const rows = overdueRemindRows([
    rowsSeedA,
    { id: 'b', number: 22, projectId: 'p1', dueDate: '2026-07-20T12:00:00Z', billToEmail: 'M@X.test' },
    { id: 'c', number: 23, projectId: 'p2', dueDate: '2026-08-01T12:00:00Z', dunningStage: 2, dunningLastSentAt: '2026-08-10T12:00:00Z' },
    { id: 'd', number: 24, projectId: 'p3', dueDate: '2026-08-05T12:00:00Z' },
    { id: 'e', number: 25, projectId: 'gone', dueDate: '2026-08-05T12:00:00Z' },
  ], projects, now);
  eq('most days late first; an invoice on no known job is dropped', rows.map(r => r.invoiceId), ['a', 'b', 'c', 'd']);
  eq('days late is floored from the due date', rows[0].daysLate, 36);
  eq('the recipient is the dunning order: bill-to first', rows[0].recipient, 'm@x.test');
  eq('…then the first portal invitee (never primaryContact\'s phone)', rows[2].recipient, 'pat@x.test');
  eq('…and none is invented', rows[3].recipient, null);
  eq('the client label is the resolved name', rows[0].clientLabel, 'Meredith Harlow');
  ok('a row with no address says so', rows[3].clientLabel.startsWith('no email on file'));
  ok('the sent label comes from reminderSentLabel', /^Reminder sent · Stage 2 · /.test(rows[2].sentLabel ?? ''));
  const ask = remindAllConfirm(rows);
  eq('one confirm names the count and the distinct clients', ask.title, 'Send 4 reminders to 2 clients?');
  ok('…lists the clients', ask.message.includes('Meredith Harlow') && ask.message.includes('Pat Ortiz'));
  ok('…and names the invoice that will not go out', ask.message.includes('No client email on file for invoice #24'));
  eq('…confirm label carries the count', ask.confirmLabel, 'Send 4');
  eq('one reminder reads singular', remindAllConfirm(rows.slice(0, 1)).title, 'Send 1 reminder to 1 client?');
  eq('no reachable client', remindAllConfirm(rows.slice(3)).title, 'Send 1 reminder?');
  // The server's dunning never reads primary_contact: an OLD invoice with no
  // bill-to on a job whose client is only the job contact has nobody to chase
  // (new invoices seed billToEmail from it instead — see invoice.tsx).
  const onlyContact = overdueRemindRows(
    [{ id: 'f', number: 26, projectId: 'p4', dueDate: '2026-08-01T12:00:00Z' }],
    [{ id: 'p4', name: 'Contact only', primaryContact: { name: 'Lee', email: 'lee@x.test', phone: '5035550199' }, clientPortal: { invites: [] } }] as unknown as Project[],
    now,
  );
  eq('a job contact alone is not a reminder recipient (never borrowed)', onlyContact[0].recipient, null);
  const sampleRows = overdueRemindRows(
    [{ id: 'g', number: 27, projectId: 'ps', dueDate: '2026-08-01T12:00:00Z', billToEmail: 'me@x.test' }, rowsSeedA],
    [{ id: 'ps', name: `${SAMPLE_PROJECT_PREFIX}Kitchen remodel`, clientPortal: { invites: [] } }, ...projects] as unknown as Project[],
    now,
  );
  eq('an invoice on a sample job is never counted in "Remind all"', sampleRows.map(r => r.invoiceId), ['a']);
  // Integration fix: /payments' Remind carries the dock's gates.
  const sharedRows = overdueRemindRows(
    [
      rowsSeedA,
      { id: 'h', number: 28, projectId: 'pe', dueDate: '2026-07-01T12:00:00Z', billToEmail: 'x@x.test' },
      { id: 'i', number: 29, projectId: 'pv', dueDate: '2026-07-02T12:00:00Z', billToEmail: 'y@x.test' },
      { id: 'j', number: 30, projectId: 'pf', dueDate: '2026-07-03T12:00:00Z', billToEmail: 'z@x.test' },
      { id: 'k', number: 31, projectId: 'po', dueDate: '2026-07-04T12:00:00Z', billToEmail: 'w@x.test' },
    ],
    [
      ...projects,
      { id: 'pe', name: 'Shared E', myRole: 'editor', clientPortal: { invites: [] } },
      { id: 'pv', name: 'Shared V', myRole: 'viewer', clientPortal: { invites: [] } },
      { id: 'pf', name: 'Shared F', myRole: 'field', clientPortal: { invites: [] } },
      { id: 'po', name: 'Own O', myRole: 'owner', clientPortal: { invites: [] } },
    ] as unknown as Project[],
    now,
  );
  eq('a job shared WITH him (editor / viewer / field) is marked sharedJob; his own jobs are not',
    sharedRows.map(r => `${r.invoiceId}:${r.sharedJob}`), ['h:true', 'i:true', 'j:true', 'k:false', 'a:false']);
  eq('Remind all counts, confirms and loops only his own jobs\' rows', remindAllRows(sharedRows).map(r => r.invoiceId), ['k', 'a']);
  eq('…so the ONE confirm names only those', remindAllConfirm(remindAllRows(sharedRows)).confirmLabel, 'Send 2');
  eq('a shared job\'s row has no Remind, whatever the plan', [remindGate(sharedRows[0], true), remindGate(sharedRows[0], false)], ['hidden', 'hidden']);
  eq('without the invoicing plan his own row shows Remind locked', remindGate(sharedRows[3], false), 'locked');
  eq('with it, Remind sends', remindGate(sharedRows[3], true), 'send');
  eq('the lock names the plan', remindLockedCopy('pro').title, 'Sending invoice reminders is on the Pro plan');
  eq('card line with no reminder', overdueCardLine(21, null), '21 days late · not reminded yet');
  ok('card line with a reminder', /^1 day late · last reminded /.test(overdueCardLine(1, new Date('2026-08-10T12:00:00Z').getTime())));
}

console.log('\n4. waiver sub picker');
{
  const opts = waiverSubOptions([
    { id: 'c1', type: 'subcontract', number: 'SC-01', description: 'Electrical', vendorName: 'Northline Electric', subcontractorId: 's1', paidToDate: 8250.5 },
    { id: 'c2', type: 'subcontract', number: 'SC-02', description: 'Plumbing', vendorName: 'Alder Mechanical' },
    { id: 'c3', type: 'purchase_order', number: 'PO-1', description: 'Cabinets', vendorName: 'Cascade' },
    { id: 'c4', type: 'subcontract', number: 'SC-03', description: '', vendorName: '  ' },
  ] as never, [{ id: 's1', companyName: 'Northline Electric LLC', email: 'office@northline.test' }] as never);
  eq('subcontracts only, and only with a name', opts.map(o => o.commitmentId), ['c1', 'c2']);
  eq('the roster sub names it and gives its email', [opts[0].name, opts[0].email, opts[0].subCompanyId], ['Northline Electric LLC', 'office@northline.test', 's1']);
  eq('no roster sub → the vendor name and NO email', [opts[1].name, opts[1].email], ['Alder Mechanical', undefined]);
  // The amount box is never filled from a pick, for ANY type: every printed
  // form treats it as the check this release is for (CA "Amount of Check",
  // FL "final payment in the amount of"), and the job records only a total.
  const TYPES = ['conditional_partial', 'unconditional_partial', 'conditional_final', 'unconditional_final'] as const;
  for (const t of TYPES) {
    eq(`${t}: the amount box is never seeded (recorded payment on file)`, waiverAmountSeed(opts[0], t).amount, null);
    eq(`${t}: the amount box is never seeded (no payment on file)`, waiverAmountSeed(opts[1], t).amount, null);
  }
  const s1 = waiverAmountSeed(opts[0], 'unconditional_final');
  ok('the final note names the recorded total as a total across every payment, and asks for the check',
    s1.note.includes('$8,250.50') && s1.note.includes('recorded as paid') && s1.note.includes('across every payment') && s1.note.includes('final check this lien waiver is for'));
  const sp = waiverAmountSeed(opts[0], 'conditional_partial');
  ok('the progress note names the recorded total and asks for the check', sp.note.includes('$8,250.50') && sp.note.endsWith('Enter the amount of the check this lien waiver is for.'));
  const s2 = waiverAmountSeed(opts[1], 'conditional_final');
  ok('no recorded payment → says so, and asks for the final check (never "the total paid through this date")',
    s2.note.startsWith('No payment is recorded') && s2.note.includes('final check this lien waiver is for') && !/total paid/i.test(s2.note));
  ok('no note ever asks for a total', TYPES.every(t => ![opts[0], opts[1]].some(o => /total paid through|enter the total/i.test(waiverAmountSeed(o, t).note))));
  const lw = read('app/lien-waivers.tsx');
  const pickBody = (lw.match(/const pickSub = \(o: WaiverSubOption\) => \{([\s\S]*?)\n  \};/) ?? [])[1] ?? '';
  const typeBody = (lw.match(/const pickType = \(t: LienWaiverType\) => \{([\s\S]*?)\n  \};/) ?? [])[1] ?? '';
  ok('picking a sub or a type never writes the amount box (only the note)',
    !!pickBody && !!typeBody && !/setAmount\(/.test(pickBody + typeBody) && /waiverAmountSeed\(o, type\)\.note/.test(pickBody) && /waiverAmountSeed\(picked, t\)\.note/.test(typeBody));
  ok('a type change re-reads the note', /onPress=\{\(\) => pickType\(t\)\}/.test(lw));
}

console.log('\n5. estimate → proposal, wizard landing');
{
  const est = { items: [{ id: 'x', total: 10 }], grandTotal: 10 };
  const p = { id: 'p1', linkedEstimate: est, estimateVersions: [] } as unknown as Project;
  const r = proposalFromCurrentEstimate(p);
  ok('a job with an estimate is snapshotted and the new revision is named', !!r.patch.estimateVersions && r.fromRevision === r.patch.estimateVersions![0].id);
  const dupP = { ...p, estimateVersions: r.patch.estimateVersions } as unknown as Project;
  const dup = proposalFromCurrentEstimate(dupP);
  ok('an estimate that duplicates the latest revision writes nothing and names that revision', Object.keys(dup.patch).length === 0 && dup.fromRevision === r.fromRevision);
  eq('no estimate → no revision', proposalFromCurrentEstimate({ id: 'p2' } as unknown as Project).fromRevision, null);
  eq('the href carries fromRevision', sendProposalHref('p1', 'rev1'), { pathname: '/contract', params: { projectId: 'p1', fromRevision: 'rev1' } });
  eq('…or only the job', sendProposalHref('p1', null), { pathname: '/contract', params: { projectId: 'p1' } });

  const full = { ...INITIAL_SCOPE, projectType: 'Kitchen remodel', sizeSqft: '220', location: 'Hoboken, NJ', scope: 'Gut kitchen, new cabinets' };
  eq('every required answer known → the summary (null)', wizardLandingStep(full, TOTAL_SCOPE_STEPS, stepCanAdvance), null);
  eq('a missing location → that step', wizardLandingStep({ ...full, location: '' }, TOTAL_SCOPE_STEPS, stepCanAdvance), 2);
  eq('a missing type → the first step', wizardLandingStep({ ...full, projectType: '' }, TOTAL_SCOPE_STEPS, stepCanAdvance), 0);
  eq('optional steps never block', wizardLandingStep({ ...full, timelineWeeks: '', targetBudget: '' }, TOTAL_SCOPE_STEPS, stepCanAdvance), null);
}

console.log('\n6. the screens');
{
  const contractSrc = read('app/contract.tsx');
  const signStart = contractSrc.indexOf('const handleSignPress = useCallback(');
  const signBody = contractSrc.slice(signStart, contractSrc.indexOf('}, [askContractTerms]);', signStart));
  const stateAt = signBody.indexOf('portalDeliveryState(p, userIdRef.current)');
  const padAt = signBody.lastIndexOf('setSignatureModal(true)');
  ok('C1: Sign & send asks portalDeliveryState BEFORE the pad opens', stateAt > 0 && padAt > stateAt);
  ok('C1: anything but ready opens the ask and returns', /if \(state !== 'ready'\) \{[\s\S]{0,300}setDeliveryAsk\([\s\S]{0,200}return;/.test(signBody));
  ok('C1: a collaborator is told and nothing happens', /state === 'collaborator'[\s\S]{0,400}return;/.test(signBody));
  ok('C1: the portal is switched on only inside the confirmed ask', /portalExists && !portal!\.enabled/.test(contractSrc) && (contractSrc.match(/enabled: true/g) ?? []).length === 1);
  ok('C1: "Sent to the homeowner" only with this device\'s delivered marker',
    /contract\.status === 'sent' && contractDelivery\?\.state === 'delivered' && \([\s\S]{0,300}Sent to the homeowner/.test(contractSrc)
    && (contractSrc.match(/>Sent to the homeowner</g) ?? []).length === 1);
  ok('C1: not delivered shows Retry and Copy link', /Signed by you, not delivered/.test(contractSrc) && /contract-delivery-retry/.test(contractSrc) && /contract-delivery-copy/.test(contractSrc));
  ok('C1: Sign together returns BEFORE any email and opens the record modal', (() => {
    const t = contractSrc.indexOf("if (activeSignModeRef.current === 'together') {");
    const e = contractSrc.indexOf('let emailNote = \'\';');
    return t > 0 && e > t && contractSrc.slice(t, e).includes('setRecordModal(true)') && contractSrc.slice(t, e).includes('return;');
  })());
  ok('C1: the record after Sign together says "Signed by both of you"', /Signed by both of you/.test(contractSrc));
  ok('C1: the marker key goes through the swept mageid_ helper', /contractDeliveryKey\(saved\.id\)/.test(contractSrc));

  const pay = read('app/payments.tsx');
  ok('C2: payments reminds through remindInvoice with the QuickBooks confirm', /remindInvoice\(/.test(pay) && /confirm: confirmViaAlert\(showAlert\)/.test(pay));
  ok('C2: Remind all asks ONE confirm built by remindAllConfirm', /const ask = remindAllConfirm\(rows\);/.test(pay));
  ok('C2: the "collect the rest from each project" copy is gone', !/collect the rest from each project/.test(pay));
  ok('C2 gate: each row reads its job\'s access (useProjectAccess, the dock\'s gate) through remindGate',
    /function OverdueRemindLine\([\s\S]{0,600}const access = useProjectAccess\(row\.projectId\);\s*const gate = remindGate\(row, access\.canAccess\('change_orders_invoicing'\)\);/.test(pay));
  ok('C2 gate: a shared row has no button; a locked one explains the plan', /\{gate !== 'hidden' && \(\s*<Button\s+label="Remind"/.test(pay)
    && /if \(gate === 'locked'\) \{ explainRemindLocked\(\); return; \}/.test(pay) && /<OverdueRemindLine\s/.test(pay));
  ok('C2 gate: Remind all runs over remindAllRows (his own jobs), not every overdue row', /const sendableRows = useMemo\(\(\) => remindAllRows\(overdueRows\)/.test(pay)
    && /const rows = sendableRows;/.test(pay) && /Remind all \$\{sendableRows\.length\}/.test(pay) && !/Remind all \$\{overdueRows\.length\}/.test(pay));
  ok('C2 gate: Remind all explains the lock before any confirm', /const canRemindAll = canAccess\('change_orders_invoicing'\);/.test(pay)
    && /if \(!canRemindAll\) \{ explainRemindLocked\(\); return; \}\s*const rows = sendableRows;/.test(pay));
  const invSrc = read('app/invoice.tsx');
  ok('C2: an overdue invoice opens on the late card', /effectiveStatus === 'overdue' && \(\s*<Card[\s\S]{0,80}invoice-overdue-card/.test(invSrc));
  ok('C2: new invoices seed billToEmail from resolveClientContact (email only)', /resolveClientContact\(project, \{ need: 'email' \}\)/.test(invSrc) && /\.\.\.clientBillTo,/.test(invSrc));

  const hero = read('components/NextStepHero.tsx');
  ok('C3: the hero reads nextBillableMilestone only when scoped and the contract was passed',
    /if \(scopedProject\) \{\s*if \(contract !== undefined\) \{/.test(hero) && /nextBillableMilestone\(\{ contract, invoices: invScope/.test(hero));

  const wiz = read('app/estimate-wizard.tsx');
  ok('C4: generating over an existing estimate asks first', /Replace this project\\'s estimate\?|Replace this project's estimate\?/.test(wiz) && /the current one is kept in Revisions/.test(wiz));
  ok('C4: the result offers Send proposal', /testID="wizard-send-proposal"/.test(wiz) && /proposalFromCurrentEstimate\(p\)/.test(wiz));
  const tko = read('app/takeoff-estimate.tsx');
  ok('C4: the takeoff save alert offers Open estimate / Send proposal / Stay here', /'Stay here'/.test(tko) && /'Open estimate'/.test(tko) && /'Send proposal'/.test(tko) && !/'Estimate saved',[\s\S]{0,200}text: 'OK'/.test(tko));

  const co = read('app/change-order.tsx');
  ok('C5: one "Client approved without signing" action with the warning', /Client approved without signing/.test(co) && /the weakest proof in a dispute/.test(co));
  ok('C5: it keeps the #76 refusal, the #131 freeze, the reflow preview and the #79 confirm', (() => {
    const at = co.indexOf('const approveWithoutSigning = useCallback(');
    const body = co.slice(at, co.indexOf('\n  }, [', at));
    return /coUnconfirmedPriceBlocker/.test(body) && /coTaxFreeze/.test(body) && /setReflowPreviewCO\(co\)/.test(body) && /coApproveConfirmCopy/.test(body);
  })());
  ok('C5: the approver comes from resolveClientContact, never invented', /resolveClientContact\(project, \{\s*need: 'email',/.test(co) && /NO_CLIENT_ON_FILE/.test(co));

  for (const f of ['components/RecordPaymentModal.tsx', 'app/lien-waivers.tsx']) {
    ok(`C7: no typed YYYY-MM-DD field in ${f}`, !/placeholder="YYYY-MM-DD"/.test(read(f)) && /<DatePickerModal/.test(read(f)));
  }
  ok('C7: "Date paid" refuses a future day in the modal (the picker alone only caps the year)', (() => {
    const rpm = read('components/RecordPaymentModal.tsx');
    const m = rpm.match(/<DatePickerModal[\s\S]*?\/>/);
    const at = rpm.indexOf('const pickPaidOn = ');
    const body = at < 0 ? '' : rpm.slice(at, rpm.indexOf('\n  };', at));
    const guard = body.indexOf('if (isFuturePaidOn(day, todayLocalISO())) { setFutureRefused(true); return; }');
    return !!m && !/allowFuture/.test(m[0]) && /onChange=\{pickPaidOn\}/.test(m[0])
      && /return day > todayISO;/.test(rpm)
      && guard >= 0 && guard < body.indexOf('setPaidOn(day)');
  })());
  const card = read('components/ProjectCard.tsx');
  ok('C8: the pill reads "Bid GP" and says it is not profit', /`Bid GP \$\{marginPct\}%`/.test(card) && /not actual profit/.test(card) && !/`GP \$\{marginPct\}%`/.test(card));
  ok('C9: Smart Proposal says "Client said yes (not signed)"', /Client said yes \(not signed\)/.test(read('app/smart-proposal.tsx')) && !/>Mark accepted</.test(read('app/smart-proposal.tsx')));
  ok('C9: Quick Quote says the same, and neither claims a signature', /Client said yes \(not signed\)/.test(read('app/quick-quote.tsx')) && !/>Accepted</.test(read('app/quick-quote.tsx')));
  ok('C9: both point to the contract', /To lock it in, send the contract/.test(read('app/smart-proposal.tsx')) && /To lock it in, send the contract/.test(read('app/quick-quote.tsx')));
  const helper = read('utils/nextBillableMilestone.ts').replace(/\/\/.*$/gm, '');
  ok('the helper is pure', !/from 'react(-native)?'|AsyncStorage|supabase/.test(helper));
}

// C4 door lock: "Send proposal" opens the contract, a client-portal feature.
// Locked, both doors say why BEFORE the revision snapshot, so a tap that goes
// nowhere writes nothing (the plan's rule: a door checks its destination's gate).
{
  console.log('\nC4 — the Send proposal door checks client_portal first:');
  const lock = proposalLockedCopy('pro');
  ok('the lock names the plan', lock.title === 'Sending proposals is on the Pro plan' && /See plans/.test(lock.message));
  const wiz = read('app/estimate-wizard.tsx');
  const sp = wiz.slice(wiz.indexOf('const sendProposal = useCallback('), wiz.indexOf('}, [proposalOpen, requiredTierFor, getProject, updateProject, router]);'));
  ok('wizard: proposalOpen reads canAccess(\'client_portal\')', /const proposalOpen = canAccess\('client_portal'\);/.test(wiz));
  ok('wizard: a locked tap returns before the snapshot', sp.length > 0 && sp.indexOf('if (!proposalOpen)') > -1
    && sp.indexOf('if (!proposalOpen)') < sp.indexOf('proposalFromCurrentEstimate(') && /router\.push\('\/paywall'\)/.test(sp));
  ok('wizard: the locked button shows the Lock icon', /proposalOpen\s*\?\s*<Send size=\{18\}[\s\S]{0,120}:\s*<Lock size=\{18\}/.test(wiz));
  const tk = read('app/takeoff-estimate.tsx');
  const after = tk.slice(tk.indexOf('const afterSaveButtons = useCallback('), tk.indexOf('], [router, updateProject, canAccess, requiredTierFor]);'));
  ok('takeoff: the after-save Send proposal checks client_portal before the snapshot', after.length > 0
    && after.indexOf("if (!canAccess('client_portal'))") > -1
    && after.indexOf("if (!canAccess('client_portal'))") < after.indexOf('proposalFromCurrentEstimate('));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
console.log('ALL PASS');

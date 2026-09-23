// validate-w5-closeout-handover.ts — wave 5, lane closeout: the Handover
// checklist (app/handover.tsx) and its pure rows (utils/handoverWaivers.ts).
//
//   #139 "Final invoice paid" read only the highest-numbered invoice: #5 paid
//        and #4 overdue with $18,400 open → a green tick. Now the whole job,
//        through utils/invoiceBilling, and held retention keeps it 'partial'.
//   #50  No permit was read: a failed final inspection or a missing CO still
//        reached "Ready to hand over". Now a Permits row (zero permits → a
//        manual confirm, never a hard block).
//   #52  Offline, the three Supabase reads answered []/null and the rows read
//        "No allowance categories yet" / "Compile and deliver the binder"; and
//        nothing re-read on return. Now failure-aware reads + useFocusEffect +
//        a request counter, and a failed row is neutral and never counted done.
//   #53  (carry) For an invitee, the owner-only lists read EMPTY: the rows say
//        "Managed by the project owner" with no Add / Compile CTA.
//
// Run: bun run scripts/validate-w5-closeout-handover.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  jobInvoiceHandoverState, permitsHandoverState, type HandoverInvoiceLike,
} from '../utils/handoverWaivers';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, detail); }
}

const TODAY = '2026-09-23';
const inv = (p: Partial<HandoverInvoiceLike> & { number: number; status: string }): HandoverInvoiceLike => ({
  id: `inv-${p.number}`, totalDue: 10_000, amountPaid: 0, ...p,
});

// ── #139 the whole job's invoices ─────────────────────────────────────────────
console.log('\n#139 final invoice row reads the whole job:');
{
  const repro = [
    inv({ number: 1, status: 'paid', amountPaid: 10_000 }),
    inv({ number: 4, status: 'overdue', totalDue: 18_400, amountPaid: 0, dueDate: '2026-08-01' }),
    inv({ number: 5, status: 'paid', totalDue: 12_000, amountPaid: 12_000 }),
  ];
  const r = jobInvoiceHandoverState(repro, TODAY);
  ok('#4 overdue with #5 paid → partial, not done', r.status === 'partial', JSON.stringify(r));
  ok('the detail names the open invoice to the cent', r.detail === 'Invoice #4 has $18,400.00 open (overdue)', r.detail);
  ok('the CTA opens the OPEN invoice, not the top one', r.targetInvoiceId === 'inv-4', String(r.targetInvoiceId));

  const two = jobInvoiceHandoverState([
    inv({ number: 2, status: 'sent', totalDue: 1_000.5, amountPaid: 0, dueDate: '2026-12-01' }),
    inv({ number: 3, status: 'partially_paid', totalDue: 2_000, amountPaid: 499.75, dueDate: '2026-12-01' }),
  ], TODAY);
  ok('the oldest open invoice leads, "+N more, $X total" in exact cents',
    two.detail === 'Invoice #2 has $1,000.50 open (+1 more, $2,500.75 total)', two.detail);
  ok('a not-yet-due invoice is not called overdue', !/overdue/.test(two.detail));

  const pastDue = jobInvoiceHandoverState([inv({ number: 7, status: 'sent', dueDate: '2026-09-01' })], TODAY);
  ok('a sent invoice past its due day reads (overdue)', /\(overdue\)$/.test(pastDue.detail), pastDue.detail);

  const retention = jobInvoiceHandoverState([
    inv({ number: 1, status: 'paid', totalDue: 100_000, subtotal: 100_000, retentionPercent: 10, amountPaid: 90_000 }),
  ], TODAY);
  ok('every invoice paid but retention held → partial, never done', retention.status === 'partial', JSON.stringify(retention));
  ok('…with the held amount and "bill the release before handover"',
    retention.detail === 'All invoices paid — $10,000.00 retention still held; bill the release before handover', retention.detail);
  ok('…and never "paid in full"', !/paid in full/.test(retention.detail));

  const released = jobInvoiceHandoverState([
    inv({ number: 1, status: 'paid', totalDue: 100_000, subtotal: 100_000, retentionPercent: 10, retentionReleased: 10_000, amountPaid: 100_000 }),
  ], TODAY);
  ok('retention released and paid → done', released.status === 'done' && released.detail === 'Invoice #1 paid in full', JSON.stringify(released));

  const allPaid = jobInvoiceHandoverState([
    inv({ number: 1, status: 'paid', amountPaid: 10_000 }), inv({ number: 2, status: 'paid', amountPaid: 10_000 }),
  ], TODAY);
  ok('all paid, nothing held → done "All 2 invoices paid in full"', allPaid.status === 'done' && allPaid.detail === 'All 2 invoices paid in full', allPaid.detail);

  ok('no invoices → open, the existing wording',
    jobInvoiceHandoverState([], TODAY).status === 'open'
    && jobInvoiceHandoverState([], TODAY).detail.startsWith('No invoices yet'));
  const topDraft = jobInvoiceHandoverState([inv({ number: 1, status: 'paid', amountPaid: 10_000 }), inv({ number: 2, status: 'draft' })], TODAY);
  ok('newest invoice still a draft → open "…is still a draft — send it"',
    topDraft.status === 'open' && topDraft.detail === 'Invoice #2 is still a draft — send it' && topDraft.targetInvoiceId === 'inv-2', JSON.stringify(topDraft));
  const oldDraft = jobInvoiceHandoverState([inv({ number: 1, status: 'draft' }), inv({ number: 2, status: 'paid', amountPaid: 10_000 })], TODAY);
  ok('an earlier unsent draft keeps it partial, not done', oldDraft.status === 'partial' && /#1 is still a draft/.test(oldDraft.detail), JSON.stringify(oldDraft));
  ok('a draft is never counted as open money',
    jobInvoiceHandoverState([inv({ number: 1, status: 'draft', totalDue: 5_000 })], TODAY).detail.indexOf('open') < 0);
}

// ── #50 permits ───────────────────────────────────────────────────────────────
console.log('\n#50 permits & final inspection:');
{
  const failed = permitsHandoverState([
    { type: 'building', status: 'inspection_passed' },
    { type: 'electrical', status: 'inspection_failed' },
    { type: 'occupancy', status: 'approved' },
  ], TODAY);
  ok('a failed inspection → open, naming it', failed.status === 'open' && failed.detail === 'Electrical: inspection failed', JSON.stringify(failed));
  ok('denied → open', permitsHandoverState([{ type: 'plumbing', status: 'denied' }], TODAY).detail === 'Plumbing: denied');
  ok('expired → open', permitsHandoverState([{ type: 'mechanical', status: 'expired' }], TODAY).status === 'open');
  const lapsed = permitsHandoverState([{ type: 'building', status: 'approved', expiresDate: '2026-09-01' }], TODAY);
  ok('an unclosed permit past its expiry day → open, dated', lapsed.status === 'open' && /Building: expired Sep 1, 2026/.test(lapsed.detail), lapsed.detail);
  ok('a passed permit past its expiry day is still closed out',
    permitsHandoverState([{ type: 'plumbing', status: 'inspection_passed', expiresDate: '2026-01-01' }], TODAY).status === 'done');
  const noCO = permitsHandoverState([{ type: 'building', status: 'inspection_passed' }], TODAY);
  ok('a building permit with no CO → partial "No Certificate of Occupancy logged"',
    noCO.status === 'partial' && noCO.detail === 'No Certificate of Occupancy logged', JSON.stringify(noCO));
  ok('a CO only APPLIED for does not count',
    permitsHandoverState([{ type: 'building', status: 'inspection_passed' }, { type: 'occupancy', status: 'applied' }], TODAY).status === 'partial');
  ok('scheduled inspection → partial', permitsHandoverState([{ type: 'electrical', status: 'inspection_scheduled' }], TODAY).detail === 'Electrical: inspection scheduled');
  ok('applied / under review → partial',
    permitsHandoverState([{ type: 'plumbing', status: 'applied' }, { type: 'fire', status: 'under_review' }], TODAY).detail === 'Plumbing: applied; Fire: under review');
  ok('an approved permit with no inspection passed → partial',
    permitsHandoverState([{ type: 'electrical', status: 'approved' }], TODAY).detail === 'Electrical: approved, no inspection passed yet');
  ok('approved is enough for a type with no inspection (hot work, landlord approval)',
    permitsHandoverState([{ type: 'hot_work', status: 'approved' }, { type: 'landlord_approval', status: 'approved' }], TODAY).status === 'done');
  // A time-boxed approval lapses by nature once its work window closes — it is
  // not a blocker (PermitStatus has no "closed" the GC could set instead).
  const lapsedWindows = permitsHandoverState([
    { type: 'building', status: 'inspection_passed' }, { type: 'occupancy', status: 'approved' },
    { type: 'hot_work', status: 'approved', expiresDate: '2026-08-01' },
    { type: 'after_hours', status: 'approved', expiresDate: '2026-08-15' },
  ], TODAY);
  ok('an approved hot-work / after-hours approval past its expiry → done, not a blocker',
    lapsedWindows.status === 'done', JSON.stringify(lapsedWindows));
  ok('every time-boxed approval type (shutdown, landlord, elevator/dock) past expiry → done',
    permitsHandoverState([
      { type: 'shutdown', status: 'approved', expiresDate: '2026-01-01' },
      { type: 'landlord_approval', status: 'approved', expiresDate: '2026-01-01' },
      { type: 'elevator_dock', status: 'approved', expiresDate: '2026-01-01' },
    ], TODAY).status === 'done');
  ok('a hot-work request still only APPLIED past its expiry stays open',
    permitsHandoverState([{ type: 'hot_work', status: 'applied', expiresDate: '2026-08-01' }], TODAY).status === 'open');
  const lapsedCO = permitsHandoverState([
    { type: 'building', status: 'inspection_passed' }, { type: 'occupancy', status: 'approved', expiresDate: '2026-09-01' },
  ], TODAY);
  ok('a lapsed temporary CO (approved occupancy past expiry) still blocks',
    lapsedCO.status === 'open' && /Occupancy: expired Sep 1, 2026/.test(lapsedCO.detail), JSON.stringify(lapsedCO));
  ok('an approved building permit past its expiry with no inspection still blocks',
    permitsHandoverState([
      { type: 'building', status: 'approved', expiresDate: '2026-09-01' },
      { type: 'hot_work', status: 'approved', expiresDate: '2026-08-01' },
    ], TODAY).status === 'open');
  const allDone = permitsHandoverState([
    { type: 'building', status: 'inspection_passed' }, { type: 'occupancy', status: 'approved' },
    { type: 'electrical', status: 'inspection_passed' },
  ], TODAY);
  ok('every permit passed + CO approved → done', allDone.status === 'done' && allDone.detail === 'All 3 permits closed out', JSON.stringify(allDone));
  ok('zero permits → "none" (a manual confirm), never a hard open', permitsHandoverState([], TODAY).status === 'none');
  ok('more than two items are summarised "+N more"',
    /; \+1 more$/.test(permitsHandoverState([
      { type: 'building', status: 'denied' }, { type: 'plumbing', status: 'denied' }, { type: 'fire', status: 'denied' },
    ], TODAY).detail));
}

// ── the screen ────────────────────────────────────────────────────────────────
console.log('\napp/handover.tsx:');
const src = strip(read('app/handover.tsx'));
ok('#139 the row renders jobInvoiceHandoverState over the whole job',
  /jobInvoiceHandoverState\(projectInvoices, today\)/.test(src));
ok('#139 no longer picks the top invoice (sortedInvoices[0]) for the row', !/sortedInvoices\[0\]/.test(src) && !/finalInvoiceState\(finalInv\)/.test(src));
ok('#139 the CTA opens targetInvoiceId', /inv\.targetInvoiceId \? \{ invoiceId: inv\.targetInvoiceId \}/.test(src));
ok('#139 finalInvoiceState stays exported (the smoke suite pins it)', /export function finalInvoiceState\(/.test(src));
ok('#50 a permits row from getPermitsForProject', /ctx\.getPermitsForProject\(projectId\)/.test(src) && /permitsHandoverState\(projectPermits, today\)/.test(src));
ok('#50 the permits row links /permits with the projectId', /cta: '\/permits',\s*ctaParams: \{ projectId: project\.id \}/.test(src));
ok('#50 the permits row is actually in the rendered list',
  /return \[\s*selectionsRow,[\s\S]*?\bpermitsRow,[\s\S]*?key: 'walkthrough'/.test(src));
ok('#50 zero permits is a manual permits_na confirm', /'permits_na'/.test(src) && /permitState\.status === 'none'/.test(src) && /No permits required on this job/.test(src));
ok('#52 the three reads are the failure-aware ones',
  /loadSelectionsChecked\(projectId\)/.test(src) && /loadCloseoutBinderChecked\(projectId\)/.test(src) && /loadLienWaiversChecked\(projectId\)/.test(src));
ok('#52 the swallowing fetchers are gone from the screen',
  !/fetchSelectionsForProject|fetchCloseoutBinder\(|fetchLienWaiversForProject/.test(src));
ok('#52 reads re-run on focus (useFocusEffect), not only on [projectId]', /useFocusEffect\(load\)/.test(src) && !/useEffect\(/.test(src));
ok('#52 out-of-order responses are dropped by a request counter', /req !== requestRef\.current/.test(src));
ok('#52 the spinner is only for a new project, not a re-focus', /shownForRef\.current !== projectId/.test(src));
ok("#52 a failed read renders the neutral \"Couldn't load\" row", /HANDOVER_LOAD_FAILED = "Couldn't load — check your signal\. Tap to retry\."/.test(read('app/handover.tsx')));
ok('#52 failed rows for selections, binder and waivers', (src.match(/failedRow\('/g) ?? []).length === 3);
ok("#52 a failed row's status is 'unknown' (neutral), never done / open",
  /key, label, icon, status: 'unknown', detail: HANDOVER_LOAD_FAILED/.test(src));
ok("#53 a managed row's status is 'managed', never done / open",
  /key, label, icon, status: 'managed', detail: HANDOVER_MANAGED_BY_OWNER/.test(src));
ok('#52 a failed row retries on tap', /item\.status === 'unknown'\) \{ load\(\); return; \}/.test(src));
ok('#52 "Ready to hand over" needs every row DONE (unknown/managed never count)', /const allDone = doneCount === total && total > 0;/.test(src));
ok('#52 no CTA on an unknown or managed row', /item\.status !== 'unknown' && item\.status !== 'managed'/.test(src));
ok('#53 the role comes from useProjectRoleState', /useProjectRoleState\(/.test(src));
ok('#53 a non-owner is anyone whose resolved role is not owner (the ownerUserId stamp only while unresolved)',
  /const isOwnerView = roleState\.role \? roleState\.role === 'owner' : ownedByStamp;/.test(src)
  && /const ownedByStamp = !project\?\.ownerUserId \|\| project\.ownerUserId === user\?\.id;/.test(src));
ok('#53 Selections, Warranties and Binder rows are managed for a non-owner',
  /managedRow\('selections'/.test(src) && /managedRow\('warranties'/.test(src) && /managedRow\('binder'/.test(src));
ok('#53 invoice and waiver rows (owner-only RLS) are managed too', /managedRow\('invoice'/.test(src) && /managedRow\('waivers'/.test(src));
ok('#53 the non-owner branch is decided BEFORE the empty-list copy',
  src.indexOf("if (!isOwnerView) selectionsRow") >= 0
  && src.indexOf("if (!isOwnerView) selectionsRow") < src.indexOf('No allowance categories yet'));
ok('the header comment no longer claims "Eight items, six"', !/Eight items, six/.test(read('app/handover.tsx')));

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `\nALL PASS (${pass})`);
if (fail) process.exit(1);

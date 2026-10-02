// validate-job-facts.ts — the job facts builder emits recorded facts only, and
// nothing private (lane FACTS, M2).
//
// Imports the REAL utils/jobFacts/buildJobFacts.ts and feeds it a job full of
// planted secrets: a change order with line items, a contract value, a margin
// and approver emails; an inspection with the inspector's correction notes; a
// permit with a fee, notes and an attachment_uri bucket path. Then asserts:
//   A. the serialized payload contains NONE of the planted secret strings,
//      emails, user ids or /<uuid>/<uuid>/ storage paths;
//   B. drafts, portal-recalled rows and undated rows are absent AND counted
//      in leftOut;
//   C. every fact has a non-empty source and a 'YYYY-MM-DD' date;
//   D. change-order amounts are absent unless the toggle is on, and then an
//      integer in cents (1234.565 → 123457);
//   E. a picked-photo list over 30 is truncated (and counted).
//
// PLANTED MUTATIONS (MUTATE=1..3 rewrites a copy of the builder and imports
// it; each must turn this red):
//   1 emit the inspection's notes   2 drop the draft filter   3 emit a float amount
//
// Run: bun run scripts/validate-job-facts.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { BuildJobFactsInput } from '../utils/jobFacts/buildJobFacts';
import type { JobFactsPayload } from '../utils/jobFacts/types';

process.env.TZ = 'America/New_York';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'utils', 'jobFacts', 'buildJobFacts.ts');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

async function loadBuilder(): Promise<typeof import('../utils/jobFacts/buildJobFacts')> {
  const MUTATE = Number(process.env.MUTATE || 0);
  if (!MUTATE) return import('../utils/jobFacts/buildJobFacts');
  let src = readFileSync(SRC, 'utf8');
  const rep = (from: string, to: string) => {
    if (!src.includes(from)) { console.error(`MUTATE=${MUTATE}: anchor not found: ${from}`); process.exit(3); }
    src = src.replace(from, to);
  };
  if (MUTATE === 1) rep("detail: permitTitle(p),\n", "detail: `${permitTitle(p)} ${i.notes ?? ''}`,\n");
  else if (MUTATE === 2) rep("if (co.status === 'draft') { leave('change_order', 'draft'); continue; }", '');
  else if (MUTATE === 3) rep('fact.amountCents = dollarsToFactCents(co.changeAmount);', 'fact.amountCents = co.changeAmount;');
  else { console.error('unknown MUTATE'); process.exit(2); }
  // Next to the original so '@/' and './types' resolve exactly as they do for it.
  const file = join(ROOT, 'utils', 'jobFacts', `.mut-buildJobFacts-${process.pid}.ts`);
  writeFileSync(file, src);
  try { return await import(file); } finally { try { (await import('node:fs')).unlinkSync(file); } catch { /* gone */ } }
}

const PID = '2f31d28f-dd61-4396-bd41-1203e533a1cc';
const UID = '291a590e-c15b-4561-b00a-db1bf54177c8';
const pid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// Planted secrets: none of these may appear anywhere in the payload.
const SECRETS = [
  'SECRET_LINE_ITEM_DRYWALL', 'SECRET_PERMIT_NOTE', 'SECRET_INSPECTOR_CORRECTION', 'Inspector Ivan Secret',
  'approver.jane@example.com', 'gc.owner@example.com', 'SECRET_INTERNAL_NOTE_DETAIL', 'SECRET_WARRANTY_COVERAGE',
  'SECRET_DOC_URI', '987654', '4321.99', UID,
];

const inspectionNotes =
  'SECRET_PERMIT_NOTE\n\n[[mage:inspections]]' +
  JSON.stringify([
    { id: 'i1', name: 'Footing', scheduledFor: '2026-08-03', result: 'passed', recordedAt: '2026-08-03T15:00:00Z' },
    { id: 'i2', name: 'Framing', scheduledFor: '2026-09-10', result: 'failed', notes: 'SECRET_INSPECTOR_CORRECTION', inspectorName: 'Inspector Ivan Secret', recordedAt: '2026-09-10T15:00:00Z' },
    { id: 'i3', name: 'Rough electrical', scheduledFor: 'not-a-day', result: 'scheduled', recordedAt: '2026-09-11T15:00:00Z' },
  ]) + '[[/mage:inspections]]';

const photos = Array.from({ length: 34 }, (_, i) => ({
  id: pid(i + 1), projectId: PID, timestamp: `2026-09-0${(i % 9) + 1}T15:00:00.000Z`, tag: i === 0 ? 'Framing' : undefined,
  storagePath: `${UID}/${PID}/${pid(i + 1)}.jpg`, uri: `file:///var/mobile/${i}.jpg`,
  portalState: undefined as undefined | { status: 'draft' | 'sent' | 'recalled' },
}));
photos[1].portalState = { status: 'recalled' };          // withdrawn
photos[2].storagePath = undefined as unknown as string;  // never uploaded

function input(over: Partial<BuildJobFactsInput> = {}): BuildJobFactsInput {
  return {
    project: {
      id: PID, name: '  Maple   Ave  ',
      schedule: { tasks: [
        { id: 't1', title: 'Foundation complete', status: 'done', isMilestone: true, actualEndDate: '2026-08-20T21:00:00.000Z', startDay: 3, durationDays: 0 } as never,
        { id: 't2', title: 'Framing complete', status: 'done', isMilestone: true } as never,          // done, no finish date
        { id: 't3', title: 'Dry-in', status: 'in_progress', isMilestone: true, actualEndDate: '2026-09-01' } as never,
        { id: 't4', title: 'Pour slab', status: 'done', isMilestone: false, actualEndDate: '2026-08-10' } as never,
      ] },
    },
    businessName: 'Northwind Builders',
    permits: [
      { id: 'p1', type: 'building', permitNumber: 'B-1234', jurisdiction: 'NYC DOB', status: 'approved', appliedDate: '2026-07-01', approvedDate: '2026-07-20T00:00:00.000Z', expiresDate: '2027-07-20', inspectionNotes, fee: 987654, notes: 'SECRET_PERMIT_NOTE', attachmentUri: `${UID}/${PID}/permit.pdf` } as never,
      { id: 'p2', type: 'electrical', jurisdiction: 'NYC DOB', status: 'applied', appliedDate: '', fee: 1 } as never,   // no date at all
    ],
    changeOrders: [
      { id: 'c1', number: 4, description: 'Add kitchen island outlet', status: 'approved', date: '2026-09-02T14:00:00.000Z', changeAmount: 1234.565,
        lineItems: [{ name: 'SECRET_LINE_ITEM_DRYWALL', total: 4321.99 }], originalContractValue: 4321.99, newContractTotal: 9999, overheadProfit: 4321.99,
        approvers: [{ name: 'Jane', email: 'approver.jane@example.com', role: 'Client' }],
        auditTrail: [
          { id: 'a1', action: 'client_signed_via_portal', actor: 'gc.owner@example.com', timestamp: '2026-09-05T02:30:00.000Z', detail: 'gc.owner@example.com' },
          { id: 'a2', action: 'internal_note', actor: 'MAGE', timestamp: '2026-09-05T03:00:00.000Z', detail: 'SECRET_INTERNAL_NOTE_DETAIL' },
        ] } as never,
      { id: 'c2', number: 5, description: 'DRAFT_CO_SHOULD_NOT_SHOW', status: 'draft', date: '2026-09-03', changeAmount: 50 } as never,
      { id: 'c3', number: 6, description: 'Upgrade tile', status: 'submitted', date: '2026-09-04', changeAmount: 10 } as never,
    ],
    photos: photos as never,
    warranties: [
      { id: 'w1', title: 'Roof', provider: 'GAF', category: 'roofing', startDate: '2026-09-15', endDate: '2046-09-15', status: 'active', coverageDetails: 'SECRET_WARRANTY_COVERAGE', documentUri: 'SECRET_DOC_URI' } as never,
      { id: 'w2', title: 'RECALLED_WARRANTY', provider: 'X', category: 'hvac', startDate: '2026-09-15', endDate: '2027-09-15', status: 'active', portalState: { status: 'recalled' } } as never,
      { id: 'w3', title: 'Undated', provider: 'Y', category: 'other', startDate: '', endDate: '', status: 'active' } as never,
    ],
    binder: { status: 'sent', finalizedAt: '2026-09-20T16:00:00.000Z', sentAt: '2026-09-21T16:00:00.000Z' },
    sections: ['closeout', 'permits', 'inspections', 'changeOrders', 'milestones', 'photos'],
    photoIds: photos.map((p) => p.id),
    includeCoAmounts: false,
    ...over,
  };
}

const UUID_PATH = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\//i;
const EMAIL = /[^\s"@]+@[^\s"@]+\.[a-z]{2,}/i;
const left = (p: JobFactsPayload, kind: string, reason: string) => p.leftOut.find((l) => l.kind === kind && l.reason === reason)?.count ?? 0;

const { buildJobFacts, dollarsToFactCents, JOB_FACTS_PHOTO_MAX } = await loadBuilder();
const off = buildJobFacts(input());
const on = buildJobFacts(input({ includeCoAmounts: true }));
const json = JSON.stringify(off) + JSON.stringify(on);

console.log('\nA. nothing private leaves:');
for (const s of SECRETS) ok(`no "${s}" in the payload`, !json.includes(s));
ok('no email address in the payload', !EMAIL.test(json), json.match(EMAIL)?.[0]);
ok('no /<uuid>/<uuid>/ storage path in the payload', !UUID_PATH.test(json), json.match(UUID_PATH)?.[0]);
ok('no URL of any kind in the payload', !/https?:|file:/.test(json));
ok('no project id in the payload', !json.includes(PID));
const factKeys = new Set(off.facts.flatMap((f) => Object.keys(f)));
ok('facts carry only allowlisted keys', [...factKeys].every((k) => ['kind', 'section', 'label', 'value', 'detail', 'source', 'date', 'term', 'amountCents', 'photo'].includes(k)), [...factKeys].join(','));
ok('the job name is cleaned, the business carried', off.job.name === 'Maple Ave' && off.job.business === 'Northwind Builders', JSON.stringify(off.job));

console.log('\nB. drafts, recalled and undated rows are left out and counted:');
ok('the draft change order is absent', !json.includes('DRAFT_CO_SHOULD_NOT_SHOW') && !off.facts.some((f) => f.source.ref === '5'));
ok('… and counted', left(off, 'change_order', 'draft') === 1, JSON.stringify(off.leftOut));
ok('the recalled warranty is absent and counted', !json.includes('RECALLED_WARRANTY') && left(off, 'warranty', 'recalled') === 1);
ok('the undated warranty is absent and counted', !off.facts.some((f) => f.label === 'Undated') && left(off, 'warranty', 'no_date') === 1);
ok('the done milestone with no finish date is absent and counted', !off.facts.some((f) => f.label === 'Framing complete') && left(off, 'milestone', 'no_date') === 1);
ok('only done milestones with a finish date show', JSON.stringify(off.facts.filter((f) => f.kind === 'milestone_done').map((f) => [f.label, f.date])) === JSON.stringify([['Foundation complete', '2026-08-20']]));
ok('the permit with no date is absent and counted', !off.facts.some((f) => f.label.startsWith('Electrical permit')) && left(off, 'permit', 'no_date') === 1);
ok('the undated inspection is absent and counted', left(off, 'inspection', 'no_date') === 1);
ok('the internal audit entry is absent and counted', left(off, 'change_order_event', 'internal') === 1);
ok('the recalled photo is absent and counted', !off.facts.some((f) => f.photo?.id === pid(2)) && left(off, 'photo', 'recalled') === 1);
ok('the unstored photo is absent and counted', !off.facts.some((f) => f.photo?.id === pid(3)) && left(off, 'photo', 'not_synced') === 1);
ok('a section that is off emits nothing', buildJobFacts(input({ sections: ['permits'] })).facts.every((f) => f.section === 'permits'));
ok('all sections off → no facts, no leftOut', (() => { const p = buildJobFacts(input({ sections: [] })); return p.facts.length === 0 && p.leftOut.length === 0; })());

console.log('\nC. every fact has a source and a day:');
ok('every fact has a non-empty source record and ref', off.facts.every((f) => !!f.source?.record && typeof f.source.ref === 'string' && f.source.ref.trim().length > 0));
ok('every fact has a YYYY-MM-DD date', off.facts.every((f) => /^\d{4}-\d{2}-\d{2}$/.test(f.date)), off.facts.find((f) => !/^\d{4}-\d{2}-\d{2}$/.test(f.date))?.date);
ok('a stored timestamp on a calendar-day field keeps its day (no time-zone shift)', off.facts.some((f) => f.kind === 'permit_approved' && f.date === '2026-07-20'));
ok('an instant lands on the GC\'s local day (02:30Z = the evening before in New York)', off.facts.some((f) => f.kind === 'change_order_event' && f.date === '2026-09-04'));
ok('the decoded inspections show name + result', off.facts.some((f) => f.kind === 'inspection' && f.label === 'Framing inspection' && f.value === 'Failed'));
ok('sections come in the fixed order', JSON.stringify([...new Set(off.facts.map((f) => f.section))]) === JSON.stringify(['permits', 'inspections', 'changeOrders', 'milestones', 'photos', 'closeout']));
ok('the payload records the sections in the fixed order', JSON.stringify(off.sections) === JSON.stringify(['permits', 'inspections', 'changeOrders', 'milestones', 'photos', 'closeout']));
ok('the binder\'s finalized and delivered days are facts', off.facts.some((f) => f.kind === 'binder_finalized' && f.date === '2026-09-20') && off.facts.some((f) => f.kind === 'binder_sent' && f.date === '2026-09-21'));

ok('expiry and warranty days are marked as terms, events are not', off.facts.filter((f) => f.term).every((f) => ['permit_expires', 'warranty_start', 'warranty_end'].includes(f.kind))
  && off.facts.some((f) => f.kind === 'permit_expires' && f.term === true) && !off.facts.some((f) => f.kind === 'permit_applied' && f.term));

console.log('\nD. money only behind the toggle, in integer cents:');
ok('toggle off → no amountCents anywhere', off.facts.every((f) => !('amountCents' in f)));
const cents = on.facts.filter((f) => f.kind === 'change_order').map((f) => f.amountCents);
ok('toggle on → every change order carries amountCents', cents.length === 2 && cents.every((c) => typeof c === 'number'));
ok('every amount is an integer', cents.every((c) => Number.isInteger(c)), JSON.stringify(cents));
ok('1234.565 dollars → 123457 cents', cents[0] === 123457, JSON.stringify(cents));
ok('dollarsToFactCents(0.1 + 0.2) === 30', dollarsToFactCents(0.1 + 0.2) === 30);

console.log('\nE. photos are capped at 30:');
const shown = off.facts.filter((f) => f.kind === 'photo');
ok('the cap is the photo-timeline cap (30)', JOB_FACTS_PHOTO_MAX === 30);
ok('34 picked (2 refused) → 30 shown', shown.length === 30, String(shown.length));
ok('… and the extra counted as over_cap', left(off, 'photo', 'over_cap') === 2, JSON.stringify(off.leftOut));
ok('photos run oldest first, the GC\'s order within a day', shown.every((f, i) => i === 0 || shown[i - 1].date <= f.date)
  && shown[0]?.photo?.id === pid(1) && shown[1]?.photo?.id === pid(10));
ok('a photo carries id, ts and tag only', shown.every((f) => JSON.stringify(Object.keys(f.photo ?? {})) === '["id","ts","tag"]'));

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILED'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

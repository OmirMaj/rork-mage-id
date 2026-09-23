// validate-property-mirror.ts — pins the Property Manager portfolio's server
// mirror and the honest work-order bridges (audit round 2, #20).
//
// Before: properties and work orders lived only in AsyncStorage under
// `mageid_*`, the tenant sweep erased them on every sign-out, "Dispatch to
// contractor" set 'assigned' and told nobody, and "Post for bids" marked the
// order 'Out for bids' before anything was posted.
//
// Phase 0 (PM two-device fix): the server was read only at sign-in and every
// edit upserted the whole row, newest whole row winning, so a laptop left open
// put a work order the phone had marked Done back to Open and nulled the
// assignee an RFP award had written. The '── two devices ──' block below runs
// that exact case against a model of the server, through the real patch
// builder and the real merge: a stale second device must never change a column
// it did not edit. The '── refresh ──' block pins the foreground / focus /
// pull re-reads.
//
// Run: bun run scripts/validate-property-mirror.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mergeMirror, propertyToRow, propertyFromRow, workOrderToRow, workOrderFromRow,
  propertyCacheKeys, composeDispatchMessage, buildDispatchSmsUrl, buildDispatchMailtoUrl,
  PROPERTY_TABLES, workOrdersAssignedByAward, workOrderPatch, propertyPatch, type WorkOrderRecord,
  queuedRecordIds, propertyEditForm, propertyEditUpdates,
} from '../utils/propertyMirror';
import { isAppStorageKey, selectTenantKeysToWipe } from '../utils/localCacheKeys';
import type { ManagedProperty } from '../types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail); }
}

const U = '11111111-1111-1111-1111-111111111111';
const prop = (id: string, updatedAt: string, name = id): ManagedProperty =>
  ({ id, name, createdAt: '2026-01-01T00:00:00.000Z', updatedAt });
const wo = (id: string, updatedAt: string, extra: Partial<WorkOrderRecord> = {}): WorkOrderRecord => ({
  id, propertyId: 'p1', title: `WO ${id}`, priority: 'normal', status: 'open',
  createdAt: '2026-01-02T00:00:00.000Z', updatedAt, ...extra,
});

console.log('\n── merge ──');
{
  // Fresh device after a sign-out: nothing local, server has the portfolio.
  const server = [propertyToRow(prop('a', '2026-02-01T00:00:00.000Z', 'Maple'), U),
    propertyToRow(prop('b', '2026-02-01T00:00:00.000Z'), U)];
  const r = mergeMirror<ManagedProperty>([], server, propertyFromRow);
  ok('sign-out then sign-in restores every property from the server', r.merged.length === 2 && r.merged.some(p => p.name === 'Maple'));
  ok('restoring pushes nothing back', r.push.length === 0);
}
{
  // Upgrade path: v1 portfolio only on the device → uploaded on first load.
  const r = mergeMirror([prop('a', '2026-02-01T00:00:00.000Z')], [], propertyFromRow);
  ok('device-only records are kept', r.merged.length === 1);
  ok('device-only records are pushed (the pre-mirror portfolio uploads)', r.push.length === 1 && r.push[0].id === 'a');
}
{
  const local = [prop('a', '2026-03-01T00:00:00.000Z', 'local newer'), prop('b', '2026-01-01T00:00:00.000Z', 'local older')];
  const server = [propertyToRow(prop('a', '2026-02-01T00:00:00.000Z', 'server older'), U),
    propertyToRow(prop('b', '2026-02-01T00:00:00.000Z', 'server newer'), U)];
  // Phase 0 review round 1: the server copy wins whatever the clocks say.
  // Only a record with a write from this device still pending keeps the
  // device copy (its edit has not reached the server yet); it is still never
  // pushed whole — that push is what overwrote other devices.
  const r = mergeMirror(local, server, propertyFromRow);
  ok('no pending write: the server copy wins even when the device clock says newer',
    r.merged.find(p => p.id === 'a')?.name === 'server older', String(r.merged.find(p => p.id === 'a')?.name));
  const rp = mergeMirror(local, server, propertyFromRow, new Set(['a']));
  ok('a record with a pending write keeps the device copy', rp.merged.find(p => p.id === 'a')?.name === 'local newer');
  ok('...but a record the server has is NEVER pushed whole (its edit travels as a patch)', !rp.push.some(p => p.id === 'a') && !r.push.some(p => p.id === 'a'));
  ok('newer server copy wins and is not pushed', r.merged.find(p => p.id === 'b')?.name === 'server newer' && !r.push.some(p => p.id === 'b'));
  const rOld = mergeMirror([prop('c', '2026-01-01T00:00:00.000Z', 'dev pending')], [propertyToRow(prop('c', '2026-05-01T00:00:00.000Z', 'srv'), U)], propertyFromRow, new Set(['c']));
  ok('a pending write keeps the device copy even when its clock is BEHIND the server\'s', rOld.merged[0]?.name === 'dev pending');
}
{
  const q = [
    { table: PROPERTY_TABLES.workOrders, data: { id: 'w1', status: 'done' } },
    { table: PROPERTY_TABLES.properties, data: { id: 'p1' } },
    { table: PROPERTY_TABLES.workOrders, data: {} },
    { table: 'projects', data: { id: 'w2' } },
  ];
  const ids = queuedRecordIds(PROPERTY_TABLES.workOrders, q);
  ok('queuedRecordIds: only this table\'s record ids', [...ids].join(',') === 'w1', [...ids].join(','));
}
{
  // Timestamps from Postgres come back as +00:00, not Z — same instant.
  const row = { ...propertyToRow(prop('a', '2026-02-01T00:00:00.000Z', 'srv'), U), updated_at: '2026-02-01T00:00:00+00:00' };
  const r = mergeMirror([prop('a', '2026-02-01T00:00:00.000Z', 'dev')], [row], propertyFromRow);
  ok('equal instants in different formats tie to the server, no push', r.merged[0].name === 'srv' && r.push.length === 0);
}
{
  const tomb = workOrderToRow(wo('w1', '2026-03-01T00:00:00.000Z'), U, '2026-03-01T00:00:00.000Z');
  const r1 = mergeMirror([wo('w1', '2026-02-01T00:00:00.000Z')], [tomb], workOrderFromRow);
  ok('a delete on another device removes the stale device copy', r1.merged.length === 0 && r1.push.length === 0);
  // Phase 0: delete wins. Resurrecting meant pushing the stale device's whole
  // row (every column it held, stale or not) — the push this fix removed.
  const r2 = mergeMirror([wo('w1', '2026-04-01T00:00:00.000Z')], [tomb], workOrderFromRow);
  ok('delete wins: a later edit on a device that had not heard of it does not resurrect it', r2.merged.length === 0 && r2.push.length === 0);
  const r3 = mergeMirror([], [tomb], workOrderFromRow);
  ok('a tombstone never appears on a fresh device', r3.merged.length === 0);
}

{
  // Review round 2: a delete on THIS device whose tombstone has not landed.
  // The device no longer holds the record, the server row is still live, and
  // the tombstone is queued or on the wire (so its id is pending). The focus
  // refresh that follows work-order.tsx's delete-then-back must not put it
  // back on screen, nor push it.
  const live = workOrderToRow(wo('w1', '2026-03-01T00:00:00.000Z'), U);
  const other = workOrderToRow(wo('w2', '2026-03-01T00:00:00.000Z'), U);
  const r = mergeMirror<WorkOrderRecord>([wo('w2', '2026-03-01T00:00:00.000Z')], [live, other], workOrderFromRow, new Set(['w1']));
  ok('a work order deleted here, tombstone still pending: refresh does not bring it back',
    !r.merged.some(w => w.id === 'w1') && r.merged.some(w => w.id === 'w2') && r.push.length === 0,
    r.merged.map(w => w.id).join(','));
  // Deleting a property cascades tombstones to its work orders: all pending.
  const pRow = propertyToRow(prop('p1', '2026-03-01T00:00:00.000Z'), U);
  const wRows = [workOrderToRow(wo('wa', '2026-03-01T00:00:00.000Z'), U), workOrderToRow(wo('wb', '2026-03-01T00:00:00.000Z'), U)];
  const rp = mergeMirror<ManagedProperty>([], [pRow], propertyFromRow, new Set(['p1']));
  const rw = mergeMirror<WorkOrderRecord>([], wRows, workOrderFromRow, new Set(['wa', 'wb']));
  ok('a property deleted here (with its cascaded work orders) stays gone until the tombstones land',
    rp.merged.length === 0 && rw.merged.length === 0 && rp.push.length === 0 && rw.push.length === 0);
  // ...and once nothing is pending for it, a live server row is shown again
  // (it was never deleted: a fresh device restores it).
  ok('without a pending write, a live server row the device lacks is restored',
    mergeMirror<WorkOrderRecord>([], [live], workOrderFromRow).merged.length === 1);
}
{
  // Review round 2: a create already queued or on the wire is not re-sent by
  // every focus / foreground refresh (a late duplicate would overwrite another
  // device's edit, or park again and again).
  const created = wo('wnew', '2026-06-01T00:00:00.000Z');
  const r = mergeMirror<WorkOrderRecord>([created], [], workOrderFromRow, new Set(['wnew']));
  ok('a pending create is kept on screen but NOT pushed again', r.merged.length === 1 && r.push.length === 0, String(r.push.length));
  const r2 = mergeMirror<WorkOrderRecord>([created], [], workOrderFromRow, new Set());
  ok('a device-only record with nothing pending IS pushed (the create that never went)', r2.push.length === 1);
}

console.log('\n── rows ──');
{
  const w = wo('w9', '2026-02-01T00:00:00.000Z', {
    budget: 1234.567, priority: 'emergency', status: 'assigned',
    assignedContactId: 'c1', assignedContactName: 'Joe Plumber', assignedAt: '2026-02-01T10:00:00.000Z',
    rfpId: '22222222-2222-2222-2222-222222222222', description: 'Leak under sink',
  });
  const row = workOrderToRow(w, U);
  ok('budget is stored to the cent', row.budget === 1234.57, String(row.budget));
  ok('row carries the owner', row.user_id === U && row.deleted_at === null);
  const back = workOrderFromRow({ ...row, budget: '1234.57' });
  ok('numeric budget string round-trips as a number', back.budget === 1234.57);
  ok('rfpId round-trips', back.rfpId === w.rfpId);
  ok('assignment round-trips', back.assignedContactName === 'Joe Plumber' && back.status === 'assigned' && back.priority === 'emergency');
  ok('a malformed rfp id is not sent to the uuid column', workOrderToRow({ ...w, rfpId: 'nope' }, U).rfp_id === null);
  const p = prop('p', '2026-02-01T00:00:00.000Z');
  const pr = propertyFromRow(propertyToRow({ ...p, units: 12, ownerPhone: '555' }, U));
  ok('property round-trips', pr.units === 12 && pr.ownerPhone === '555' && pr.updatedAt === p.updatedAt);
  // Review round 2: the three fields the edit sheet gained must survive the
  // server round trip, or what one device saves never reaches the other.
  const full = propertyFromRow(propertyToRow({ ...p, ownerEmail: 'o@x.com', units: 40, notes: 'Gate 1234' }, U));
  ok('owner email, units and notes round-trip through the server row',
    full.ownerEmail === 'o@x.com' && full.units === 40 && full.notes === 'Gate 1234', JSON.stringify(full));
}

console.log('\n── patches ──');
{
  const base = wo('w1', '2026-05-01T00:00:00.000Z', { description: 'Leak', budget: 100 });
  ok('no change -> no patch (no write, no fresh updated_at to outrank the server)',
    workOrderPatch(base, { ...base, updatedAt: '2026-05-02T00:00:00.000Z' }, U) === null);
  const p1 = workOrderPatch(base, { ...base, description: 'Leak under sink', updatedAt: '2026-05-02T00:00:00.000Z' }, U);
  ok('an edit sends only the column it changed, plus id and updated_at',
    !!p1 && Object.keys(p1).sort().join(',') === 'description,id,updated_at' && p1.updated_at === '2026-05-02T00:00:00.000Z',
    JSON.stringify(p1));
  const p2 = workOrderPatch(base, { ...base, budget: undefined, updatedAt: '2026-05-02T00:00:00.000Z' }, U);
  ok('clearing a field sends it as null', !!p2 && 'budget' in p2 && p2.budget === null);
  const p3 = workOrderPatch(base, { ...base, status: 'done', completedAt: '2026-05-02T00:00:00.000Z', updatedAt: '2026-05-02T00:00:00.000Z' }, U);
  ok('a patch never carries user_id, created_at or deleted_at',
    !!p3 && !('user_id' in p3) && !('created_at' in p3) && !('deleted_at' in p3));
  const pp = prop('p9', '2026-05-01T00:00:00.000Z', 'Maple');
  const pPatch = propertyPatch(pp, { ...pp, ownerEmail: 'o@x.com', units: 12, updatedAt: '2026-05-02T00:00:00.000Z' }, U);
  ok('property edits patch too (owner email + units, nothing else)',
    !!pPatch && Object.keys(pPatch).sort().join(',') === 'id,owner_email,units,updated_at', JSON.stringify(pPatch));
  // completed_at travels with status (review round 1): a stale copy that never
  // saw Done still clears the completion date when it moves the status.
  const stale = wo('w2', '2026-05-01T00:00:00.000Z', { status: 'open' });
  const pS = workOrderPatch(stale, { ...stale, status: 'in_progress', completedAt: undefined, updatedAt: '2026-05-02T00:00:00.000Z' }, U);
  ok('a status change always sends completed_at with it (null when not Done)',
    !!pS && 'completed_at' in pS && pS.completed_at === null && pS.status === 'in_progress', JSON.stringify(pS));
  const pD = workOrderPatch(stale, { ...stale, description: 'x', updatedAt: '2026-05-02T00:00:00.000Z' }, U);
  ok('...but an edit that leaves status alone does not send completed_at', !!pD && !('completed_at' in pD) && !('status' in pD));
}

console.log('\n── edit sheet: only what he changed since it opened ──');
{
  const opened = propertyEditForm(prop('p1', '2026-05-01T00:00:00.000Z', 'Maple'));
  ok('an untouched sheet sends nothing', Object.keys(propertyEditUpdates(opened, { ...opened })).length === 0);
  // While the sheet is open a refresh brings in the other device's owner
  // phone. He changes only the notes. The save must not carry the sheet's old
  // (empty) owner phone back over it.
  const upd = propertyEditUpdates(opened, { ...opened, notes: 'Gate code 1234' });
  ok('a save sends only the fields changed since the sheet opened', Object.keys(upd).join(',') === 'notes' && upd.notes === 'Gate code 1234',
    JSON.stringify(upd));
  const cleared = propertyEditUpdates(propertyEditForm({ name: 'Maple', ownerPhone: '555' }), { ...propertyEditForm({ name: 'Maple', ownerPhone: '555' }), ownerPhone: '  ' });
  ok('clearing a field sends it as cleared', 'ownerPhone' in cleared && cleared.ownerPhone === undefined);
  const units = propertyEditUpdates(opened, { ...opened, units: '12', ownerEmail: ' o@x.com ' });
  ok('units and owner email are cleaned on the way out', units.units === 12 && units.ownerEmail === 'o@x.com');
  const ms = read('app/managed-property.tsx').replace(/^\s*\/\/.*$/gm, '');
  ok('managed-property snapshots the form on open and saves only propertyEditUpdates',
    /editOpenedRef\.current = f;/.test(ms) && /const f = propertyEditForm\(property\);/.test(ms)
    && /propertyEditUpdates\(editOpenedRef\.current, \{/.test(ms) && /updateProperty\(propertyId, updates\)/.test(ms));
}

console.log('\n── two devices: a stale second device cannot undo the first ──');
{
  // A model of PostgREST: upsert replaces the row, update merges columns.
  type R = Record<string, unknown>;
  const server = new Map<string, R>();
  const upsert = (row: R) => { server.set(String(row.id), { ...row }); };
  const update = (patch: R | null) => {
    if (!patch) return;
    const cur = server.get(String(patch.id));
    if (cur) server.set(String(patch.id), { ...cur, ...patch });
  };
  const rows = () => [...server.values()];
  const T0 = '2026-09-20T09:00:00.000Z', T1 = '2026-09-20T10:00:00.000Z', T2 = '2026-09-20T11:00:00.000Z', T3 = '2026-09-20T12:00:00.000Z';

  // Both devices load the same open order.
  const w0 = wo('w-leak', T0, { description: 'Leak', rfpId: '33333333-3333-3333-3333-333333333333', status: 'posted_for_bids' });
  upsert(workOrderToRow(w0, U));
  const laptop: WorkOrderRecord = { ...w0 };

  // award-rfp PATCHes the assignee in (server side), then the phone, which
  // has refreshed, marks it Done — as a patch.
  update({ id: w0.id, status: 'assigned', assigned_contact_name: 'ABC Electric', assigned_at: T1, updated_at: T1 });
  const phoneBefore = workOrderFromRow(server.get(w0.id)!);
  update(workOrderPatch(phoneBefore, { ...phoneBefore, status: 'done', completedAt: T2, updatedAt: T2 }, U));

  // The laptop, still holding the T0 row, fixes a typo in the description.
  const laptopAfter: WorkOrderRecord = { ...laptop, description: 'Leak under the kitchen sink', updatedAt: T3 };
  const laptopPatch = workOrderPatch(laptop, laptopAfter, U);

  // Offline first: the patch is still queued when the laptop refreshes.
  const offline = mergeMirror([laptopAfter], rows(), workOrderFromRow, new Set([w0.id]));
  ok('stale device refreshing with its patch still queued pushes NOTHING whole', offline.push.length === 0,
    JSON.stringify(offline.push.map(x => x.id)));
  ok('...and keeps showing its own unsent edit meanwhile', offline.merged[0]?.description === 'Leak under the kitchen sink');

  update(laptopPatch); // the queue drains
  const after = server.get(w0.id)!;
  ok('the stale device\'s edit landed', after.description === 'Leak under the kitchen sink');
  ok('...and did NOT put the status back (Done stays Done)', after.status === 'done' && after.completed_at === T2, String(after.status));
  ok('...and did NOT null the assignee the award wrote', after.assigned_contact_name === 'ABC Electric' && after.assigned_at === T1,
    String(after.assigned_contact_name));
  ok('...and kept the RFP link', after.rfp_id === w0.rfpId);

  // The laptop's next refresh shows the phone's Done and the award.
  const online = mergeMirror([laptopAfter], rows(), workOrderFromRow);
  const shown = online.merged.find(x => x.id === w0.id);
  ok('after its patch lands, the stale device\'s refresh shows Done + the assignee', shown?.status === 'done'
    && shown?.assignedContactName === 'ABC Electric' && shown?.description === 'Leak under the kitchen sink' && online.push.length === 0,
    JSON.stringify(shown));

  // Proof the model catches the old bug: the old path upserted the whole row.
  const replay = new Map(server);
  replay.set(w0.id, workOrderToRow(laptopAfter, U));
  ok('(model check) the old whole-row upsert WOULD have reverted Done and nulled the assignee',
    replay.get(w0.id)!.status === 'posted_for_bids' && replay.get(w0.id)!.assigned_contact_name === null);
}
{
  // OUT OF ORDER (review round 1): an offline patch carries the time it was
  // MADE. The phone marks the order Done offline at T1; the laptop, online,
  // edits the description at T2; THEN the phone's queue drains. The server
  // ends up Done, stamped T1 — older than the laptop's own T2 copy.
  type R = Record<string, unknown>;
  const server = new Map<string, R>();
  const update = (patch: R | null) => { if (patch) server.set(String(patch.id), { ...server.get(String(patch.id)), ...patch }); };
  const T0 = '2026-09-20T09:00:00.000Z', T1 = '2026-09-20T10:00:00.000Z', T2 = '2026-09-20T11:00:00.000Z';
  const w0 = wo('w-ooo', T0, { description: 'Leak', status: 'in_progress', assignedContactName: 'ABC Electric' });
  server.set(w0.id, workOrderToRow(w0, U));
  const phone = { ...w0 }, laptop = { ...w0 };
  const phoneAfter = { ...phone, status: 'done' as const, completedAt: T1, updatedAt: T1 };
  const phoneQueued = workOrderPatch(phone, phoneAfter, U); // offline: queued
  const laptopAfter = { ...laptop, description: 'Leak under sink', updatedAt: T2 };
  update(workOrderPatch(laptop, laptopAfter, U)); // online: lands now
  update(phoneQueued); // the phone comes back online: its queue drains
  ok('(setup) server holds Done + the laptop description, stamped with the phone\'s EARLIER T1',
    server.get(w0.id)!.status === 'done' && server.get(w0.id)!.description === 'Leak under sink' && server.get(w0.id)!.updated_at === T1);
  // Both refresh; neither has a write pending.
  const lap = mergeMirror([laptopAfter], [...server.values()], workOrderFromRow, new Set()).merged[0];
  const ph = mergeMirror([phoneAfter], [...server.values()], workOrderFromRow, new Set()).merged[0];
  ok('the laptop\'s refresh shows Done although its own copy is stamped later', lap?.status === 'done' && lap?.description === 'Leak under sink',
    `${lap?.status} ${lap?.description}`);
  ok('the phone\'s refresh shows the laptop\'s description', ph?.status === 'done' && ph?.description === 'Leak under sink');
  // Clock skew: a laptop whose clock runs a day fast still converges.
  const skewed = { ...laptopAfter, updatedAt: '2026-09-21T11:00:00.000Z' };
  const sk = mergeMirror([skewed], [...server.values()], workOrderFromRow, new Set()).merged[0];
  ok('a device whose clock runs fast still takes the server copy on refresh', sk?.status === 'done');
}
{
  // completed_at goes with the status (review round 1). The phone marks Done
  // at T1; the stale laptop (still showing Open) moves it to In progress.
  type R = Record<string, unknown>;
  const server = new Map<string, R>();
  const update = (patch: R | null) => { if (patch) server.set(String(patch.id), { ...server.get(String(patch.id)), ...patch }); };
  const T0 = '2026-09-20T09:00:00.000Z', T1 = '2026-09-20T10:00:00.000Z', T2 = '2026-09-20T11:00:00.000Z';
  const w0 = wo('w-cmp', T0, { status: 'open' });
  server.set(w0.id, workOrderToRow(w0, U));
  update(workOrderPatch(w0, { ...w0, status: 'done', completedAt: T1, updatedAt: T1 }, U));
  update(workOrderPatch(w0, { ...w0, status: 'in_progress', completedAt: undefined, updatedAt: T2 }, U));
  ok('a stale device moving an order out of Done clears the completion date on the server',
    server.get(w0.id)!.status === 'in_progress' && server.get(w0.id)!.completed_at === null,
    `${server.get(w0.id)!.status} ${server.get(w0.id)!.completed_at}`);
}

console.log('\n── device cache ──');
{
  const a = propertyCacheKeys('user-a'), b = propertyCacheKeys('user-b');
  ok('cache is keyed per user', a.properties !== b.properties && a.workOrders !== b.workOrders);
  ok('cache keys are app keys (swept on tenant switch, test:storage-hygiene)',
    isAppStorageKey(a.properties) && isAppStorageKey(a.workOrders));
  ok('the sweep removes them (a cache, not the record)',
    selectTenantKeysToWipe([a.properties, a.workOrders]).length === 2);
}

console.log('\n── dispatch message ──');
{
  const msg = composeDispatchMessage({
    workOrder: { title: 'Kitchen sink leak', description: 'Water under the cabinet', priority: 'emergency', category: 'Plumbing', budget: 450 },
    propertyName: 'Maple Court', propertyAddress: '12 Maple St', contactFirstName: 'Joe', senderName: 'Pat PM',
  });
  ok('subject flags an emergency and names the property', msg.subject === 'EMERGENCY: Kitchen sink leak at Maple Court, 12 Maple St', msg.subject);
  for (const needle of ['Hi Joe', 'Kitchen sink leak', 'EMERGENCY', '12 Maple St', 'Trade: Plumbing', 'Budget: $450.00', 'Water under the cabinet', 'Pat PM']) {
    ok(`body carries "${needle}"`, msg.body.includes(needle));
  }
  const sms = buildDispatchSmsUrl('(555) 123-4567', msg, 'ios');
  ok('iOS sms url has the number and &body=', sms.startsWith('sms:5551234567&body='), sms.slice(0, 40));
  ok('android sms url uses ?body=', buildDispatchSmsUrl('555', msg, 'android').startsWith('sms:555?body='));
  const mail = buildDispatchMailtoUrl('joe@x.com', msg);
  ok('mailto carries subject and body', mail.startsWith('mailto:joe%40x.com?subject=') && mail.includes('&body='));
}

console.log('\n── wiring ──');
{
  const ctx = read('contexts/PropertyContext.tsx').replace(/^\s*\/\/.*$/gm, '');
  ok('PropertyContext writes through the offline queue (one tracked sender)',
    /void supabaseWrite\(table, op, row\)/.test(ctx) && (ctx.match(/supabaseWrite\(/g) ?? []).length === 1
    && /send\(PROPERTY_TABLES\.properties, 'upsert'/.test(ctx) && /send\(PROPERTY_TABLES\.workOrders, 'upsert'/.test(ctx));
  // Review round 1: the merge keeps a device copy only for a pending write,
  // so every write must be tracked from send to landed-or-queued.
  const ctxSend = ctx.slice(ctx.indexOf('const send = useCallback'), ctx.indexOf('const pushProperty'));
  ok('every write is tracked on the wire and stamped with a sequence number',
    /lastWriteRef\.current\.set\(key, writeSeqRef\.current\)/.test(ctxSend)
    && /inFlightRef\.current\.set\(key, \(inFlightRef\.current\.get\(key\) \?\? 0\) \+ 1\)/.test(ctxSend)
    && /\.finally\(\(\) => \{[\s\S]*inFlightRef\.current\.delete\(key\)/.test(ctxSend));
  const pullFn = ctx.slice(ctx.indexOf('const pullServer'), ctx.indexOf('const refresh = useCallback'));
  const qb = pullFn.indexOf('const queuedBefore = await readQueue();');
  const sel = pullFn.indexOf('.from(PROPERTY_TABLES.properties).select');
  const qa = pullFn.indexOf('const queuedAfter = await readQueue();');
  ok('the offline queue is read before AND after the server read', qb > -1 && sel > qb && qa > sel);
  ok('the read notes where the write sequence stood before it began', /const seq0 = writeSeqRef\.current;/.test(pullFn)
    && pullFn.indexOf('const seq0 = writeSeqRef.current;') < qb && /seq > seq0/.test(pullFn));
  // Review round 2: a write on the wire when the read began can commit after
  // the SELECT's snapshot and resolve before the merge; the snapshot of the
  // in-flight keys taken at the start keeps it pending.
  const snap = pullFn.indexOf('const onWireAtStart = [...inFlightRef.current.keys()];');
  ok('the in-flight writes are snapshotted when the read begins, and count as pending',
    snap > -1 && snap < qb && snap < sel
    && /for \(const key of onWireAtStart\) if \(key\.startsWith\(prefix\)\) ids\.add\(key\.slice\(prefix\.length\)\);/.test(pullFn));
  ok('pending = queued (before + after) + on the wire + sent since the read began',
    /queuedRecordIds\(table, queuedBefore\)/.test(pullFn) && /queuedRecordIds\(table, queuedAfter\)/.test(pullFn)
    && /for \(const key of inFlightRef\.current\.keys\(\)\) if \(key\.startsWith\(prefix\)\) ids\.add\(/.test(pullFn)
    && /for \(const \[key, seq\] of lastWriteRef\.current\) if \(seq > seq0 && key\.startsWith\(prefix\)\) ids\.add\(/.test(pullFn));
  ok('an unreadable queue keeps every device copy (never drops an unsent edit)',
    /const ids = !queuedBefore \|\| !queuedAfter\s*\? new Set\(local\.map\(x => x\.id\)\)\s*: new Set\(\[/.test(pullFn));
  ok('both merges get their pending set',
    /propertyFromRow,\s*pendingFor\(PROPERTY_TABLES\.properties, propsRef\.current\)\)/.test(pullFn)
    && /workOrderFromRow,\s*pendingFor\(PROPERTY_TABLES\.workOrders, wosRef\.current\)\)/.test(pullFn));
  // Phase 0: edits are per-field 'update' ops built by the patch builders;
  // 'upsert' stays only in the create/tombstone/merge-create pushers.
  const updW = ctx.slice(ctx.indexOf('const updateWorkOrder'), ctx.indexOf('const deleteWorkOrder'));
  const updP = ctx.slice(ctx.indexOf('const updateProperty'), ctx.indexOf('const deleteProperty'));
  ok('updateWorkOrder sends workOrderPatch through the queue\'s update op, never a whole-row upsert',
    /workOrderPatch\(before, after,/.test(updW) && /send\(PROPERTY_TABLES\.workOrders, 'update', patch\)/.test(updW)
    && !/upsert|pushWorkOrder\(/.test(updW));
  ok('updateProperty sends propertyPatch through the queue\'s update op, never a whole-row upsert',
    /propertyPatch\(before, after,/.test(updP) && /send\(PROPERTY_TABLES\.properties, 'update', patch\)/.test(updP)
    && !/upsert|pushProperty\(/.test(updP));
  ok('an edit that changes nothing writes nothing', /if \(!patch\) return;/.test(updW) && /if \(!patch\) return;/.test(updP));
  ok('exactly two upsert call sites (the create/tombstone pushers)', (ctx.match(/send\(PROPERTY_TABLES\.\w+, 'upsert'/g) ?? []).length === 2
    && (ctx.match(/, 'upsert'/g) ?? []).length === 2);
  ok('PropertyContext reads the server copy and merges it', /\.from\(PROPERTY_TABLES\.properties\)\.select/.test(ctx)
    && /mergeMirror\(/.test(ctx));
  ok('PropertyContext no longer writes the bare v1 keys', !/saveLocal\(LEGACY_/.test(ctx));
  ok('deletes are tombstones, not local-only', /pushWorkOrder\(\{ \.\.\.gone, updatedAt: now \}, now\)/.test(ctx)
    && /pushProperty\(\{ \.\.\.gone, updatedAt: now \}, now\)/.test(ctx));
  ok('hydrate re-runs per user', /\[userId, authLoading, commit, pushProperty, pushWorkOrder, pullServer\]/.test(ctx));
  ok('hydrate and refresh share one server read (pullServer), keyed by user',
    /const pullServer = useCallback\(\(uid: string\)/.test(ctx) && /pullRef\.current\?\.userId === uid/.test(ctx)
    && /await pullServer\(userId\)/.test(ctx) && /return \(await pullServer\(uid\)\) === 'merged';/.test(ctx));
  ok('a read that returns after a sign-out / account switch is dropped',
    /if \(ownerRef\.current\?\.userId !== uid\) return 'stale';/.test(ctx));
  // Integration round 1: an add made before the device copy landed was kept
  // in memory only, then overwritten by commit(props, wos) — silently lost.
  ok('hydrate folds pre-hydrate adds into the device copy, then persists + pushes them',
    /const earlyProps = propsRef\.current;/.test(ctx) && /const earlyWos = wosRef\.current;/.test(ctx)
    && /commit\(\[\.\.\.earlyProps, \.\.\.props\.filter\(p => !earlyP\.has\(p\.id\)\)\], \[\.\.\.earlyWos, \.\.\.wos\.filter\(w => !earlyW\.has\(w\.id\)\)\]\);/.test(ctx)
    && /for \(const x of earlyProps\) pushProperty\(x\);/.test(ctx) && /for \(const x of earlyWos\) pushWorkOrder\(x\);/.test(ctx)
    && !/ownerRef\.current = \{ userId \};\s*commit\(props, wos\);/.test(ctx));

  const woSrc = read('app/work-order.tsx');
  const code = woSrc.replace(/^\s*\/\/.*$/gm, '');
  const postFn = code.slice(code.indexOf('const postForBids'), code.indexOf('const handleDelete'));
  // Integration round 1 (a): on web openURL resolves with no sms:/mailto:
  // handler, so the order must not be marked assigned on "it opened" alone.
  const sendFn = code.slice(code.indexOf('const sendVia'), code.indexOf('const chooseContact'));
  const webAsk = sendFn.indexOf("if (Platform.OS === 'web') {");
  ok('web: after the composer opens, he confirms it was sent before it is marked assigned',
    webAsk > sendFn.indexOf('await Linking.openURL(url);') && /'Did you send it\?'/.test(sendFn)
    && /\{ text: 'Sent — mark assigned', onPress: \(\) => markAssigned\(c\) \}/.test(sendFn)
    && /return;\s*\}\s*markAssigned\(c\);/.test(sendFn));
  // (b) Android's Alert (and the web AlertHost) show at most 3 buttons.
  const chooseFn = code.slice(code.indexOf('const chooseContact'), code.indexOf('const postForBids'));
  ok('a contact with phone AND email gets "Send it…" (≤3 buttons), never Text+Email+Mark+Cancel together',
    /text: 'Send it…'/.test(chooseFn) && /hasPhone && hasEmail/.test(chooseFn)
    && !/\.\.\.\(hasPhone \? \[\{ text: `Text \$\{c\.phone\}`[^\n]*\n\s*\.\.\.\(hasEmail \?/.test(chooseFn));
  ok('Post for bids does not mark the order out-for-bids before anything is posted',
    postFn.length > 0 && !/posted_for_bids/.test(postFn));
  ok('Post for bids hands post-rfp the work order id', /workOrderId: wo\.id/.test(postFn));
  // …and post-rfp marks it only AFTER the public_bids insert has landed.
  const rfpCode = read('app/post-rfp.tsx').replace(/^\s*\/\/.*$/gm, '');
  const insAt = rfpCode.indexOf('if (insertErr) throw insertErr;');
  const markAt = rfpCode.indexOf("updateWorkOrder(woId, { status: 'posted_for_bids', rfpId })");
  ok('post-rfp marks the work order out-for-bids with its rfpId after the insert', insAt > 0 && markAt > insAt);
  // award-rfp moves that order to assigned, scoped to this homeowner's live,
  // unassigned rows, and never fails the award over it.
  const award = read('supabase/functions/award-rfp/index.ts');
  ok('award-rfp assigns the work order posted as this RFP (owner + live + unassigned only)',
    /work_orders\?rfp_id=eq\.\$\{encodeURIComponent\(body\.bidId\)\}/.test(award)
    && /user_id=eq\.\$\{encodeURIComponent\(homeownerId\)\}/.test(award)
    && /deleted_at=is\.null&status=in\.\(open,posted_for_bids\)/.test(award)
    && /work order assign skipped/.test(award));
  ok('no "Dispatch to contractor" / "Dispatched to" copy that implies a message went out',
    !/Dispatch to contractor|Dispatched to/.test(code));
  ok('sending opens the composer BEFORE marking assigned',
    sendFn.indexOf('Linking.openURL') > -1 && sendFn.indexOf('Linking.openURL') < sendFn.indexOf('markAssigned(c)'));
  ok('the sheet says MAGE does not message the contractor', /MAGE does not (contact them|message contractors) for you/.test(code));

  const mig = read('supabase/migrations/20260918180000_property_manager_mirror.sql');
  ok('migration creates both tables', /CREATE TABLE IF NOT EXISTS public\.managed_properties/.test(mig)
    && /CREATE TABLE IF NOT EXISTS public\.work_orders/.test(mig));
  ok('migration enables RLS on both', /ENABLE ROW LEVEL SECURITY/.test(mig) && /auth\.uid\(\) = user_id/.test(mig));
  ok('table names agree with the client', mig.includes(PROPERTY_TABLES.properties) && mig.includes(PROPERTY_TABLES.workOrders));
  ok('no trigger rewrites the client updated_at', !/BEFORE UPDATE ON public\.(managed_properties|work_orders)/.test(mig));
}


console.log('\nan RFP award reaches the PM\'s work order on THIS device (round-2 integration):');
{
  const base = { propertyId: 'p', priority: 'normal', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' } as const;
  const wos = [
    { ...base, id: 'w-out', title: 'Leak', status: 'posted_for_bids', rfpId: 'bid-1' },
    { ...base, id: 'w-open', title: 'Paint', status: 'open', rfpId: 'bid-1' },
    { ...base, id: 'w-done', title: 'Old', status: 'done', rfpId: 'bid-1' },
    { ...base, id: 'w-other', title: 'Roof', status: 'posted_for_bids', rfpId: 'bid-2' },
    { ...base, id: 'w-none', title: 'HVAC', status: 'open' },
  ] as unknown as WorkOrderRecord[];
  const now = '2026-09-18T12:00:00.000Z';
  const got = workOrdersAssignedByAward(wos, 'bid-1', 'ABC Electric', now);
  ok('only this RFP\'s open / out-for-bids orders move (same filter as the server PATCH)',
    got.map(g => g.id).join(',') === 'w-out,w-open', got.map(g => g.id).join(','));
  ok('each becomes assigned to the awarded company, stamped now',
    got.every(g => g.updates.status === 'assigned' && g.updates.assignedContactName === 'ABC Electric' && g.updates.assignedAt === now));
  ok('an unnamed winner leaves the name unset (the server writes null)',
    workOrdersAssignedByAward(wos, 'bid-1', null, now).every(g => g.updates.assignedContactName === undefined));
  ok('no bid id moves nothing', workOrdersAssignedByAward(wos, '', 'X', now).length === 0);
  const screen = read('app/rfp-responses-review.tsx');
  const award = screen.slice(screen.indexOf('const runAward'), screen.indexOf('const handleAward'));
  ok('runAward applies the award to the device copy through updateWorkOrder',
    /workOrdersAssignedByAward\(workOrders, bidId \?\? '', awardedCompany, nowIso\)/.test(award) && /updateWorkOrder\(id, updates\)/.test(award));
  ok('...only after the award succeeded', award.indexOf('data?.success') > -1 && award.indexOf('data?.success') < award.indexOf('workOrdersAssignedByAward'));
}

console.log('\n── refresh: foreground, focus, pull ──');
{
  const ctx = read('contexts/PropertyContext.tsx').replace(/^\s*\/\/.*$/gm, '');
  ok('PropertyContext exposes refresh()', /const refresh = useCallback\(/.test(ctx) && /^\s*refresh,$/m.test(ctx));
  ok('refresh runs when the app comes to the foreground',
    /AppState\.addEventListener\('change', state => \{\s*if \(state === 'active'\) void refresh\(\);/.test(ctx)
    && /return \(\) => sub\.remove\(\);/.test(ctx));
  const focus = /useFocusEffect\(useCallback\(\(\) => \{ void refresh\(\); \}, \[refresh\]\)\);/;
  for (const f of ['components/PropertyManagerHome.tsx', 'app/managed-property.tsx', 'app/work-order.tsx']) {
    const src = read(f).replace(/^\s*\/\/.*$/gm, '');
    ok(`${f} re-reads the server copy on focus`, focus.test(src) && /refresh\b[^\n]*\} = useProperties\(\)|refresh,?\s*\} = useProperties\(\)/.test(src));
  }
  const home = read('components/PropertyManagerHome.tsx').replace(/^\s*\/\/.*$/gm, '');
  ok('PM home has pull-to-refresh wired to refresh()',
    /refreshControl=\{<RefreshControl refreshing=\{pulling\} onRefresh=\{onPull\}/.test(home)
    && /try \{ await refresh\(\); \} finally \{ setPulling\(false\); \}/.test(home));
}

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `\nALL PASS (${pass})`);
if (fail) process.exit(1);

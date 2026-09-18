// validate-property-mirror.ts — pins the Property Manager portfolio's server
// mirror and the honest work-order bridges (audit round 2, #20).
//
// Before: properties and work orders lived only in AsyncStorage under
// `mageid_*`, the tenant sweep erased them on every sign-out, "Dispatch to
// contractor" set 'assigned' and told nobody, and "Post for bids" marked the
// order 'Out for bids' before anything was posted.
//
// Run: bun run scripts/validate-property-mirror.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mergeMirror, propertyToRow, propertyFromRow, workOrderToRow, workOrderFromRow,
  propertyCacheKeys, composeDispatchMessage, buildDispatchSmsUrl, buildDispatchMailtoUrl,
  PROPERTY_TABLES, workOrdersAssignedByAward, type WorkOrderRecord,
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
  const r = mergeMirror(local, server, propertyFromRow);
  ok('newer device edit wins and is pushed', r.merged.find(p => p.id === 'a')?.name === 'local newer' && r.push.some(p => p.id === 'a'));
  ok('newer server copy wins and is not pushed', r.merged.find(p => p.id === 'b')?.name === 'server newer' && !r.push.some(p => p.id === 'b'));
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
  const r2 = mergeMirror([wo('w1', '2026-04-01T00:00:00.000Z')], [tomb], workOrderFromRow);
  ok('an edit made after the delete survives and is pushed', r2.merged.length === 1 && r2.push.length === 1);
  const r3 = mergeMirror([], [tomb], workOrderFromRow);
  ok('a tombstone never appears on a fresh device', r3.merged.length === 0);
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
  ok('PropertyContext writes through the offline queue', /supabaseWrite\(PROPERTY_TABLES\.properties, 'upsert'/.test(ctx)
    && /supabaseWrite\(PROPERTY_TABLES\.workOrders, 'upsert'/.test(ctx));
  ok('PropertyContext reads the server copy and merges it', /\.from\(PROPERTY_TABLES\.properties\)\.select/.test(ctx)
    && /mergeMirror\(/.test(ctx));
  ok('PropertyContext no longer writes the bare v1 keys', !/saveLocal\(LEGACY_/.test(ctx));
  ok('deletes are tombstones, not local-only', /pushWorkOrder\(\{ \.\.\.gone, updatedAt: now \}, now\)/.test(ctx)
    && /pushProperty\(\{ \.\.\.gone, updatedAt: now \}, now\)/.test(ctx));
  ok('hydrate re-runs per user', /\[userId, authLoading, commit, pushProperty, pushWorkOrder\]/.test(ctx));
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
  ok('no trigger rewrites the client updated_at (the merge compares it)', !/BEFORE UPDATE ON public\.(managed_properties|work_orders)/.test(mig));
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

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `\nALL PASS (${pass})`);
if (fail) process.exit(1);

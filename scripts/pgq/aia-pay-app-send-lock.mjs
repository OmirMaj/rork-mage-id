// aia-pay-app-send-lock.mjs — PGlite proof of 20261014090000_aia_pay_app_send_lock.sql (lane PAYAPP-1c):
// a pay application certified and sent with NO Stripe pay link is stamped by the server and frozen by the database,
// a pay link can still be added to it once, and nothing that was writable on a frozen row stops being writable.
// Usage: [MUTATE=<n>] node scripts/pgq/aia-pay-app-send-lock.mjs <worktree>   |   ... <worktree> --all
//
// REAL: this migration; 20260728120000_lock_certified_aia_pay_apps.sql and
// 20260911090000_aia_certificate_response_writable.sql, applied first exactly as on disk.
// PGlite is PostgreSQL 17/18, production is 15+: nothing used here differs between them.
// STUBS: the roles, auth.users, auth.uid(); public.aia_pay_apps itself (no repo migration creates it: the columns,
// types and defaults are production's, read from information_schema on 2026-10-10) with its one owner policy from
// 20260518120000_rls_baseline.sql. NOT HERE: aia_pay_apps_pending_guard (20260920020000), which reads other tables.
import { BASE_SQL, loadPGlite, makeKit, readMigration, replacer, runAll, worktreeArg } from './_harness.mjs';

const ROOT = worktreeArg('scripts/pgq/aia-pay-app-send-lock.mjs');
const FILE = '20261014090000_aia_pay_app_send_lock.sql';

if (process.argv[3] === '--all') {
  runAll(import.meta.url, ROOT, {
    1: ['6', '6b'],   // the freeze ignores the send stamp
    2: ['8'],         // the stamp is not kept: every later write moves it
    3: ['3'],         // the stamp is the app's clock, not the server's
    4: ['9b', '10'],  // certified_at can be cleared or moved
    5: ['9'],         // a pay link can never be added after the send
    6: ['5'],         // the stamp is set on insert only
    7: ['4', '11'],   // an unstamped row keeps a client-sent stamp
    8: ['7b'],        // the architect's amount certified is frozen too
    9: ['6'],         // the lines are not frozen
    10: ['12'],       // a blank sidecar stamp locks the row
    11: ['6b'],       // the snapshot (totals and sidecar) is not frozen
    12: ['17'],       // a certify sent twice is refused (the first sidecar time is not kept)
    13: ['18'],       // '' and NULL are different values again: the app's own re-save is refused
    14: ['2'],        // rows that already carry the app's stamp are left open
    15: ['19'],       // a frozen row can be moved to another job
    16: ['12'],       // a sidecar stamp that is not a string locks the row
  });
}

let MIG = readMigration(ROOT, FILE);
const MUTATE = Number(process.env.MUTATE || 0);
const rep = replacer(() => MIG, (v) => { MIG = v; }, MUTATE);
const noSelfCheck = () => rep("raise exception '[aia_pay_app_send_lock] verify:", "raise notice '[aia_pay_app_send_lock] verify:", true);
switch (MUTATE) {
  case 0: break;
  case 1: rep('  if old.certified_at is not null or old.sent_locked_at is not null then', '  if old.certified_at is not null then'); noSelfCheck(); break;
  case 2: rep('    new.sent_locked_at := old.sent_locked_at;\n', ''); break;
  case 3: rep('  new.sent_locked_at := case when v_sidecar is not null then now() else null end;', '  new.sent_locked_at := case when v_sidecar is not null then v_sidecar::timestamptz else null end;'); break;
  case 4: rep('      or (old.certified_at is not null and new.certified_at is distinct from old.certified_at)', '      or false'); break;
  case 5: rep('      or (old.certified_at is not null and new.certified_at is distinct from old.certified_at)', '      or new.certified_at is distinct from old.certified_at'); break;
  case 6: rep('  before insert or update on public.aia_pay_apps\n  for each row execute function public.aia_pay_app_stamp_send_lock();', '  before insert on public.aia_pay_apps\n  for each row execute function public.aia_pay_app_stamp_send_lock();'); break;
  case 7: rep('  new.sent_locked_at := case when v_sidecar is not null then now() else null end;', '  new.sent_locked_at := case when v_sidecar is not null then now() else new.sent_locked_at end;'); break;
  case 8: rep("                     #- '{__mageCertificate,amountCertified}'\n", '', true); break;
  case 9: rep('      or new.lines                      is distinct from old.lines\n', ''); break;
  case 10: rep("      then nullif(btrim(new.snapshot_totals #>> v_path), '')", '      then new.snapshot_totals #>> v_path'); break;
  case 11: rep('      or new_frozen                     is distinct from old_frozen\n', ''); break;
  case 12: rep("      new.snapshot_totals := jsonb_set(new.snapshot_totals, v_path, old.snapshot_totals #> v_path);", '      null;'); break;
  case 13: rep("      or coalesce(new.architect_name, '') is distinct from coalesce(old.architect_name, '')", '      or new.architect_name is distinct from old.architect_name'); break;
  case 14: rep('update public.aia_pay_apps\n   set updated_at = updated_at\n where sent_locked_at is null', 'update public.aia_pay_apps\n   set updated_at = updated_at\n where false and sent_locked_at is null'); break;
  case 15: rep('      or new.project_id                 is distinct from old.project_id\n', ''); break;
  case 16: rep(" and jsonb_typeof(new.snapshot_totals #> v_path) = 'string'\n", '\n'); break;
  default: console.error('unknown MUTATE'); process.exit(2);
}
if (MUTATE) console.log(`(planted mutation M${MUTATE} applied)`);

const OWNER = '00000000-0000-4000-8000-0000000000a1';
const P1 = '10000000-0000-4000-8000-000000000001';
const R = (n) => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const APP_CLOCK = '2020-01-02T03:04:05.000Z'; // what a phone with a wrong clock would write into the sidecar

const PGlite = await loadPGlite();
const db = new PGlite();
await db.exec(BASE_SQL);
await db.exec(`
insert into auth.users (id, email) values ('${OWNER}', 'owner@x.test');
create table public.aia_pay_apps (
  id uuid primary key, user_id uuid not null, project_id uuid not null, invoice_id text,
  application_number integer not null default 1, application_date date, period_to date, contract_date date,
  owner_name text, contractor_name text, architect_name text, project_name text, project_location text, contract_for_description text,
  original_contract_sum numeric not null default 0, net_change_by_co numeric not null default 0, contract_sum_to_date numeric not null default 0,
  retainage_percent numeric not null default 10, less_previous_certificates numeric not null default 0,
  lines jsonb not null default '[]'::jsonb, notes text, snapshot_totals jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  portal_state jsonb, paid_at timestamptz, payment_intent_id text,
  pay_link_url text, pay_link_id text, pay_link_amount numeric,
  pay_pending_at timestamptz, pay_pending_amount numeric(12,2), pay_pending_session text
);
alter table public.aia_pay_apps enable row level security;
create policy aia_pay_apps_owner_all on public.aia_pay_apps as permissive for all to authenticated using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));
`);
await db.exec(readMigration(ROOT, '20260728120000_lock_certified_aia_pay_apps.sql'));
await db.exec(readMigration(ROOT, '20260911090000_aia_certificate_response_writable.sql'));
const { ok, rows, tryRun, done } = makeKit(db);

const LINES = JSON.stringify([{ id: 'l1', description: 'Framing', scheduledValue: 10000, thisPeriod: 2500 }]);
const TOTALS = { totalScheduledValue: 10000, totalCompletedAndStored: 2500, currentPaymentDue: 2250 };
const snap = (extras) => JSON.stringify(extras ? { ...TOTALS, __mageCertificate: extras } : TOTALS);
const SENT = { periodFrom: '2026-10-01', sentLockedAt: APP_CLOCK };
const ins = (n, snapshot, role = 'authenticated', extraCols = '', extraVals = '') => tryRun(role,
  `insert into public.aia_pay_apps (id, user_id, project_id, application_number, application_date, original_contract_sum, contract_sum_to_date, lines, snapshot_totals, owner_name${extraCols})
   values ('${R(n)}', '${OWNER}', '${P1}', ${n}, '2026-10-10', 10000, 10000, $1::jsonb, $2::jsonb, 'Sample Owner'${extraVals})`, OWNER, [LINES, snapshot]);
const upd = (n, set, params = [], role = 'authenticated') => tryRun(role, `update public.aia_pay_apps set ${set} where id = '${R(n)}'`, OWNER, params);
const one = async (n) => (await rows(`select *, (now() - sent_locked_at) < interval '1 minute' as stamped_now from public.aia_pay_apps where id = '${R(n)}'`))[0];
const refused = (r) => !r.ok && /financial fields are immutable/.test(r.err ?? '');

// Rows from before this migration: a draft, a row frozen by a pay link, and a row that already carries the app's
// sidecar stamp (certified in the owner preview before the server knew about it).
for (const [n, s] of [[1, snap(null)], [2, snap({ periodFrom: '2026-09-01' })], [3, snap(SENT)]]) {
  const r = await ins(n, s);
  if (!r.ok) { console.error('fixture not written: ' + r.err); process.exit(3); }
}
await db.exec(`update public.aia_pay_apps set certified_at = '2026-09-05T10:00:00Z', pay_link_url = 'https://pay.test/x' where id = '${R(2)}'`);
const before = JSON.stringify(await rows(`select * from public.aia_pay_apps order by id`));

let applyErr = null;
try { await db.exec(MIG); await db.exec(MIG); } catch (e) { applyErr = e; }
ok('1 the migration applies cleanly, twice (idempotent)', applyErr === null, applyErr ? String(applyErr.message) : '');
if (applyErr) done();

const after = await rows(`select * from public.aia_pay_apps order by id`);
const stripped = JSON.stringify(after.map(({ sent_locked_at: _s, ...rest }) => rest));
const stampedIds = after.filter((r) => r.sent_locked_at !== null).map((r) => r.id);
ok('2 every row from before is byte-identical in every other column, and the ONE row that already carried the app\'s stamp is stamped (the draft and the pay-link row are not)', stripped === before && stampedIds.length === 1 && stampedIds[0] === R(3), JSON.stringify(stampedIds));

const a = await ins(10, snap(SENT));
const r10 = await one(10);
ok('3 an application first written with the sent stamp is stamped by the server, on the SERVER clock (not the phone\'s)', a.ok && r10.stamped_now === true && new Date(r10.sent_locked_at).getUTCFullYear() !== 2020, JSON.stringify(r10?.sent_locked_at));

const b = await ins(11, snap({ periodFrom: '2026-10-01' }), 'authenticated', ', sent_locked_at', `, '2026-01-01T00:00:00Z'`);
ok('4 a draft is not stamped, and a stamp a client sends in the column on insert is thrown away', b.ok && (await one(11)).sent_locked_at === null);

const NEW_LINES = JSON.stringify([{ id: 'l1', description: 'Framing', scheduledValue: 10000, thisPeriod: 4000 }]);
const c = await upd(1, `lines = $1::jsonb, snapshot_totals = $2::jsonb`, [NEW_LINES, snap(SENT)]);
const r1 = await one(1);
ok('5 certifying a saved draft (an update that changes figures and adds the sent stamp) is taken and stamps the row', c.ok && c.affected === 1 && r1.stamped_now === true && r1.lines[0].thisPeriod === 4000, c.err ?? '');

const FROZEN = {
  application_number: '99', application_date: `'2027-01-01'`, period_to: `'2027-01-31'`, contract_date: `'2025-01-01'`,
  original_contract_sum: '1', net_change_by_co: '5', contract_sum_to_date: '2', retainage_percent: '0', less_previous_certificates: '7',
  owner_name: `'Someone Else'`, contractor_name: `'X'`, architect_name: `'Y'`, project_name: `'Z'`, project_location: `'Elsewhere'`,
  contract_for_description: `'Other'`, invoice_id: `'inv-9'`,
};
const linesChange = await upd(10, `lines = '[]'::jsonb`);
const colResults = [];
for (const [col, val] of Object.entries(FROZEN)) colResults.push([col, refused(await upd(10, `${col} = ${val}`))]);
const still = await one(10);
ok('6 a row frozen by the send alone refuses a change to its lines and to every other financial or party field', refused(linesChange) && colResults.every(([, x]) => x) && still.lines.length === 1 && still.lines[0].thisPeriod === 2500 && still.owner_name === 'Sample Owner' && still.application_number === 10, colResults.filter(([, x]) => !x).map(([k]) => k).join(','));

const totalsChange = await upd(10, `snapshot_totals = $1::jsonb`, [JSON.stringify({ ...TOTALS, currentPaymentDue: 1, __mageCertificate: SENT })]);
const dropStamp = await upd(10, `snapshot_totals = $1::jsonb`, [snap({ periodFrom: '2026-10-01' })]);
const otherExtra = await upd(10, `snapshot_totals = $1::jsonb`, [snap({ ...SENT, periodFrom: '2026-08-01' })]);
ok('6b it also refuses a change to the saved totals, taking the sent stamp back out of the record, and a change to the period start', refused(totalsChange) && refused(dropStamp) && refused(otherExtra), [totalsChange, dropStamp, otherExtra].map((x) => x.err ?? 'TAKEN').join(' | '));

const same = await upd(10, `lines = $1::jsonb, snapshot_totals = $2::jsonb, owner_name = 'Sample Owner', updated_at = now(), notes = 'Left at the site office'`, [LINES, snap(SENT)]);
const open = await upd(10, `portal_state = '{"viewed": true}'::jsonb, pay_link_url = 'https://pay.test/later', pay_link_id = 'plink_1', pay_link_amount = 2250, paid_at = now(), payment_intent_id = 'pi_1'`, [], 'service_role');
ok('7 a re-save of the same figures passes (the app\'s background sync), and notes, the portal state, the pay link and the payment stay writable', same.ok && same.affected === 1 && open.ok && open.affected === 1, (same.err ?? '') + (open.err ?? ''));

const cert = await upd(10, `snapshot_totals = $1::jsonb`, [snap({ ...SENT, amountCertified: 2000, certifiedDate: '2026-10-12', certifiedExplanation: 'Line 3 held' })]);
ok('7b the architect\'s certificate (amount certified, date, explanation) can still be recorded on it', cert.ok && cert.affected === 1 && (await one(10)).snapshot_totals.__mageCertificate.amountCertified === 2000, cert.err ?? '');

const stampBefore = (await one(10)).sent_locked_at;
await new Promise((r) => setTimeout(r, 25)); // so a stamp that is re-taken from the clock is a different time
const move = await upd(10, `sent_locked_at = '2030-01-01T00:00:00Z'`);
const clear = await upd(10, `sent_locked_at = null`);
const clearSvc = await upd(10, `sent_locked_at = null`, [], 'service_role');
const stampAfter = (await one(10)).sent_locked_at;
ok('8 the stamp is set once: the owner cannot move it or clear it, and neither can the service role', move.ok && clear.ok && clearSvc.ok && stampAfter !== null && new Date(stampAfter).getTime() === new Date(stampBefore).getTime(), `${new Date(stampBefore).toISOString()} -> ${stampAfter && new Date(stampAfter).toISOString()}`);

const link = await upd(1, `certified_at = now(), pay_link_url = 'https://pay.test/added'`, [], 'service_role');
ok('9 a pay link can be added later: certified_at goes from empty to a time on a row frozen by the send', link.ok && link.affected === 1 && (await one(1)).certified_at !== null, link.err ?? '');
const unCert = await upd(1, `certified_at = null`, [], 'service_role');
const reCert = await upd(1, `certified_at = now() + interval '1 day'`, [], 'service_role');
ok('9b once set, certified_at cannot be cleared or moved on that row', refused(unCert) && refused(reCert), (unCert.err ?? 'TAKEN') + ' | ' + (reCert.err ?? 'TAKEN'));

const old1 = await upd(2, `lines = '[]'::jsonb`);
const old2 = await upd(2, `certified_at = null`, [], 'service_role');
const old3 = await upd(2, `snapshot_totals = $1::jsonb, notes = 'ok'`, [snap({ periodFrom: '2026-09-01', amountCertified: 5 })]);
ok('10 a row frozen by a pay link behaves as before: figures refused, certified_at cannot be cleared, the certificate response is taken, and it is not given a send stamp', refused(old1) && refused(old2) && old3.ok && (await one(2)).sent_locked_at === null, [old1, old2, old3].map((x) => x.err ?? 'TAKEN').join(' | '));

const fake = await upd(11, `sent_locked_at = now()`);
const edit = await upd(11, `lines = '[]'::jsonb, retainage_percent = 5`);
ok('11 a draft cannot be frozen through the column: a client-sent stamp on update is thrown away and the draft stays editable', fake.ok && edit.ok && edit.affected === 1 && (await one(11)).sent_locked_at === null, (fake.err ?? '') + (edit.err ?? ''));

const shapes = [snap({ sentLockedAt: '' }), snap({ sentLockedAt: '   ' }), snap({ sentLockedAt: null }), JSON.stringify({ __mageCertificate: 'sentLockedAt' }), JSON.stringify(['sentLockedAt']), JSON.stringify('sentLockedAt'), '7', null, snap({ sentLockedAt: false }), snap({ sentLockedAt: 0 }), snap({ sentLockedAt: true }), snap({ sentLockedAt: {} }), snap({ sentLockedAt: ['x'] })];
const shapeResults = [];
for (let i = 0; i < shapes.length; i++) {
  const r = await ins(20 + i, shapes[i]);
  const u = r.ok ? await upd(20 + i, `notes = 'again'`) : r;
  shapeResults.push(r.ok && u.ok && (await one(20 + i)).sent_locked_at === null);
}
ok('12 a blank, missing or non-text sidecar stamp, or a snapshot that is not an object, never stamps and never errors', shapeResults.every(Boolean), JSON.stringify(shapeResults));

const staleDraft = await upd(3, `lines = '[]'::jsonb, snapshot_totals = $1::jsonb`, [snap(null)]);
const lateNote = await upd(3, `notes = 'synced again'`);
ok('13 a row that carried the app\'s stamp before this migration is frozen straight away: a stale copy with no stamp and new figures is refused as its FIRST write', refused(staleDraft) && lateNote.ok && (await one(3)).lines.length === 1, staleDraft.err ?? 'TAKEN');

const priv = await rows(`select has_function_privilege('anon', 'public.aia_pay_app_stamp_send_lock()', 'execute') as a, has_function_privilege('authenticated', 'public.aia_pay_app_stamp_send_lock()', 'execute') as b,
  (select prosecdef from pg_proc where oid = 'public.aia_pay_app_stamp_send_lock()'::regprocedure) as definer,
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'aia_pay_apps') as policies`);
ok('14 the stamp function is not SECURITY DEFINER and not callable by a client, and the table still has its one policy', priv[0].a === false && priv[0].b === false && priv[0].definer === false && priv[0].policies === 1, JSON.stringify(priv[0]));

const del = await tryRun('authenticated', `delete from public.aia_pay_apps where id = '${R(11)}'`, OWNER);
ok('15 a draft can still be deleted', del.ok && del.affected === 1, del.err ?? '');

// The app's own write: one PostgREST upsert of every column it maps (never sent_locked_at).
const COLS = ['id', 'user_id', 'project_id', 'application_number', 'application_date', 'original_contract_sum', 'contract_sum_to_date', 'lines', 'snapshot_totals', 'owner_name', 'architect_name', 'project_location', 'notes'];
const upsert = (n, o) => tryRun('authenticated',
  `insert into public.aia_pay_apps (${COLS.join(', ')}) values ('${R(n)}', '${OWNER}', '${P1}', ${n}, '2026-10-10', 10000, 10000, $1::jsonb, $2::jsonb, 'Sample Owner', $3, $4, $5)
   on conflict (id) do update set ${COLS.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ')}`, OWNER, [o.lines ?? LINES, o.snap, o.architect ?? null, o.location ?? null, o.notes ?? null]);

const d1 = await upsert(40, { snap: snap({ periodFrom: '2026-10-01' }), architect: '', location: '' });
const d2 = await upsert(40, { snap: snap(SENT), lines: NEW_LINES, architect: '', location: '' });
const r40 = await one(40);
ok('16 by the app\'s own upsert: a draft is saved, then certified with new figures and the stamp, and the row is stamped once', d1.ok && d2.ok && r40.stamped_now === true && r40.lines[0].thisPeriod === 4000, (d1.err ?? '') + (d2.err ?? ''));

const LATER = { ...SENT, sentLockedAt: '2026-10-10T12:00:25.000Z' };
const retry = await upsert(40, { snap: snap(LATER), lines: NEW_LINES, architect: '', location: '' });
const r40b = await one(40);
const retryEdited = await upsert(40, { snap: snap(LATER), lines: LINES, architect: '', location: '' });
const noStamp = await upsert(40, { snap: snap({ periodFrom: '2026-10-01' }), lines: NEW_LINES, architect: '', location: '' });
ok('17 a certify sent twice (same figures, a later time in the sidecar) is taken and the FIRST time is kept; with a changed figure, or with the stamp left off, it is refused', retry.ok && r40b.snapshot_totals.__mageCertificate.sentLockedAt === APP_CLOCK && new Date(r40b.sent_locked_at).getTime() === new Date(r40.sent_locked_at).getTime() && refused(retryEdited) && refused(noStamp), [retry, retryEdited, noStamp].map((x) => x.err ?? 'TAKEN').join(' | '));

const reread = await upsert(40, { snap: snap({ ...SENT, amountCertified: 3600, certifiedDate: '2026-10-12' }), lines: NEW_LINES, architect: null, location: null, notes: 'Certified in full' });
const realChange = await upsert(40, { snap: snap(SENT), lines: NEW_LINES, architect: 'Someone Else', location: null });
ok('18 the app re-reads an empty text box as "not set" and writes NULL: that re-save, carrying the architect\'s response, is taken; a real change of the architect\'s name is refused', reread.ok && (await one(40)).snapshot_totals.__mageCertificate.amountCertified === 3600 && refused(realChange), (reread.err ?? 'TAKEN') + ' | ' + (realChange.err ?? 'TAKEN'));

const moveJob = await upd(40, `project_id = '10000000-0000-4000-8000-000000000002'`);
const moveId = await upd(40, `id = '${R(99)}'`);
const draftMove = await upd(21, `project_id = '10000000-0000-4000-8000-000000000002'`);
ok('19 a frozen row cannot be moved to another job or given another id; a draft still can', refused(moveJob) && refused(moveId) && draftMove.ok && draftMove.affected === 1, [moveJob, moveId].map((x) => x.err ?? 'TAKEN').join(' | '));

const delLocked = await tryRun('authenticated', `delete from public.aia_pay_apps where id = '${R(40)}'`, OWNER);
ok('20 KNOWN LIMIT, stated in the migration: the owner can still delete a frozen row (as he can one with a pay link); this file does not guard DELETE', delLocked.ok && delLocked.affected === 1);

done();

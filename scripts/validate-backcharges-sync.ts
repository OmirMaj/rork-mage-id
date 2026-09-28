// validate-backcharges-sync.ts — backcharges saved to the account (lane HEALTH, H1).
//
// Pins:
//   §1 utils/backchargeRows.ts toRow / fromRow: integer cents, basis, hours ×
//      rate and status survive the round trip; toRow takes NO userId and never
//      puts user_id (or the device photo path) on the wire; fromRow drops a row
//      exactly when parseBackcharges would.
//   §2 mergeBackcharges: the server wins; an id pending or refused on this
//      device keeps its device copy; a device row the account does not return
//      is never deleted, and is sent up once only when it is neither pending,
//      refused nor already sent; another account's device rows are dropped,
//      never sent up; a server row keeps the device photo.
//   §3 saveStateOf precedence and the words each state shows
//      (utils/backchargeCopy.ts), in docs/VOICE.md terms. The back-online line
//      only for a write the queue reports; anything else not confirmed reads
//      "Not yet confirmed on your account." (integration round 2).
//   §3b completeness (integration round 2): signed in, the list counts only
//      once the account's read came back for THIS user this session; a list
//      that is not complete reaches the scorecard as undefined ("Backcharges
//      not counted on this screen"), never [] ("No backcharges on N projects").
//   §4 sources: every write in hooks/useBackcharges.ts goes through the offline
//      queue (supabaseWriteDetailed 'upsert' of toRow); no `supabase.from(` in
//      the hook or components/backcharge/*; the hook uses only the offline
//      queue exports this lane may use; the section and the deduction card show
//      backchargeStorageLine; the scorecard callers pass the backcharges.
//   §5 the migration (20260928160000_backcharges.sql): RLS on, no delete
//      policy, the insert WITH CHECK carries auth.uid() = user_id AND
//      can_access_project, the BEFORE UPDATE trigger pins
//      id/user_id/project_id/created_at, the amount check, the grants, nothing
//      granted to anon, the trigger function is not security definer.
//
// Run: bun run scripts/validate-backcharges-sync.ts

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseBackcharges, type Backcharge } from '../utils/backcharges';
import {
  BACKCHARGES_ACCOUNT_KEY, BACKCHARGES_TABLE, fromRow, fromRows, mergeBackcharges, parseAccountMeta,
  saveStateOf, toRow, backchargesComplete, backchargesForScorecard, type BackchargeSaveState,
} from '../utils/backchargeRows';
import { computeSubScorecards } from '../utils/subScorecard';
import type { Commitment, Subcontractor } from '../types';
import {
  BACKCHARGE_LINE_DEVICE, BACKCHARGE_LINE_NOT_SAVED, BACKCHARGE_LINE_SAVED, BACKCHARGE_LINE_UNCONFIRMED, BACKCHARGE_LINE_WAITING,
  BACKCHARGE_RETRY_HINT, BACKCHARGE_SHEET_NOTHING_SENT, backchargeSheetSubtitle, backchargeStorageLine,
} from '../utils/backchargeCopy';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
/** Comments stripped, so prose that NAMES a call can never satisfy a check. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/[^\n'"`]*$/gm, '');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`); }
}

function canon(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(canon);
  if (x && typeof x === 'object') {
    const o = x as Record<string, unknown>;
    return Object.keys(o).sort().reduce<Record<string, unknown>>((acc, k) => { acc[k] = canon(o[k]); return acc; }, {});
  }
  return x;
}
const same = (a: unknown, b: unknown) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

function bc(p: Partial<Backcharge> & { id: string }): Backcharge {
  return {
    projectId: '11111111-1111-1111-1111-111111111111', subId: 'sub-vega', subName: 'Vega Painting', commitmentId: null,
    reason: `Reason ${p.id}`, amountCents: 45000, basis: 'typed', hours: null, rateCents: null,
    photoUri: null, photoId: null, punchItemId: null, status: 'open',
    appliedInvoiceId: null, appliedAt: null, createdAt: '2026-09-28T10:00:00.000Z', ...p,
  };
}

const FIXTURES: Backcharge[] = [
  bc({ id: 'typed', amountCents: 12345 }),
  bc({ id: 'hours', basis: 'hours_x_rate', hours: 3.5, rateCents: 6250, amountCents: 21875, commitmentId: 'c-1' }),
  bc({ id: 'applied', status: 'applied', appliedInvoiceId: 'inv7', appliedAt: '2026-09-28T13:00:00.000Z' }),
  bc({ id: 'void', status: 'void', photoId: 'photo-1', punchItemId: 'punch-1' }),
  bc({ id: 'withuri', photoUri: 'file:///var/mobile/Containers/Data/tmp/IMG_0001.jpg', photoId: 'photo-2' }),
];

console.log('\n§1 toRow / fromRow');
{
  for (const b of FIXTURES) {
    const row = toRow(b);
    const back = fromRow(JSON.parse(JSON.stringify(row)));
    ok(`${b.id}: round trip keeps every field (photoUri excepted)`, same(back, { ...b, photoUri: null }), { back, b });
    ok(`${b.id}: amount_cents is the same integer`, row.amount_cents === b.amountCents && Number.isInteger(row.amount_cents));
    ok(`${b.id}: no user_id key on the wire`, !('user_id' in row) && !Object.keys(row).some(k => /user/i.test(k)), Object.keys(row));
    ok(`${b.id}: the device photo path never travels`, !Object.keys(row).some(k => /uri/i.test(k)) && (!b.photoUri || !JSON.stringify(row).includes(b.photoUri)));
  }
  ok('toRow takes exactly one argument (no userId parameter)', toRow.length === 1);
  const rowsSrc = code(read('utils/backchargeRows.ts'));
  const toRowSrc = rowsSrc.slice(rowsSrc.indexOf('export function toRow('), rowsSrc.indexOf('\n}\n', rowsSrc.indexOf('export function toRow(')));
  ok("toRow's signature is (b: Backcharge) and its body never names a user", /export function toRow\(b: Backcharge\): BackchargeRow \{/.test(toRowSrc) && !/user/i.test(toRowSrc), toRowSrc.slice(0, 80));
  ok('typed rows send hours and rate as null', toRow(bc({ id: 'x', hours: 2, rateCents: 100 })).hours === null && toRow(bc({ id: 'x', hours: 2, rateCents: 100 })).rate_cents === null);
  ok('a stringified bigint ("45000") still reads as 45000 cents', fromRow({ ...toRow(bc({ id: 's' })), amount_cents: '45000' })?.amountCents === 45000);
  const bad = [
    { ...toRow(bc({ id: 'st' })), status: 'paid' },
    { ...toRow(bc({ id: 'z' })), amount_cents: 0 },
    { ...toRow(bc({ id: 'n' })), amount_cents: -5 },
    { ...toRow(bc({ id: 'f' })), amount_cents: 12.5 },
    { ...toRow(bc({ id: 'x' })), id: '' },
    { ...toRow(bc({ id: 'p' })), project_id: null },
    null, 7, 'x',
  ];
  ok('fromRows drops unknown status, ≤0 / fractional cents, missing ids — like parseBackcharges', fromRows(bad).length === 0, fromRows(bad));
  const camel = bad.filter(r => r && typeof r === 'object').map(r => {
    const o = r as Record<string, unknown>;
    return { id: o.id, projectId: o.project_id, subId: o.sub_id, reason: o.reason, amountCents: o.amount_cents, status: o.status, createdAt: o.created_at };
  });
  ok('…and parseBackcharges drops the same rows', parseBackcharges(JSON.stringify(camel)).length === 0);
  ok('fromRow reads user_id without carrying it', !('userId' in (fromRow({ ...toRow(bc({ id: 'u' })), user_id: 'someone' }) ?? {})));
  ok('the account key is a swept mageid_ key', BACKCHARGES_ACCOUNT_KEY.startsWith('mageid_') && BACKCHARGES_TABLE === 'backcharges');
  ok('account meta parse never throws and keeps only strings',
    JSON.stringify(parseAccountMeta('{nope')) === JSON.stringify({ userId: null, savedIds: [] })
    && JSON.stringify(parseAccountMeta('{"userId":"u1","savedIds":["a",3,""]}')) === JSON.stringify({ userId: 'u1', savedIds: ['a'] }));
}

console.log('\n§2 merge');
{
  const none = new Set<string>();
  const dev = (id: string, o: Partial<Backcharge> = {}) => bc({ id, reason: `device ${id}`, ...o });
  const srv = (id: string, o: Partial<Backcharge> = {}) => bc({ id, reason: `server ${id}`, ...o });

  const r1 = mergeBackcharges({ device: [dev('a')], server: [srv('a')], pendingIds: none, unsavedIds: none, adoptedIds: none, deviceIsThisUsers: true });
  ok('server wins for an id both hold', r1.merged.length === 1 && r1.merged[0].reason === 'server a' && r1.toAdopt.length === 0);
  const r2 = mergeBackcharges({ device: [dev('a')], server: [srv('a')], pendingIds: new Set(['a']), unsavedIds: none, adoptedIds: none, deviceIsThisUsers: true });
  ok('a pending id keeps the device copy', r2.merged[0].reason === 'device a' && r2.toAdopt.length === 0);
  const r3 = mergeBackcharges({ device: [dev('a')], server: [srv('a')], pendingIds: none, unsavedIds: new Set(['a']), adoptedIds: none, deviceIsThisUsers: true });
  ok('a refused id keeps the device copy', r3.merged[0].reason === 'device a');
  const r4 = mergeBackcharges({ device: [dev('old')], server: [], pendingIds: none, unsavedIds: none, adoptedIds: none, deviceIsThisUsers: true });
  ok('a device-only row (made before this update) is kept AND adopted', r4.merged.length === 1 && r4.toAdopt.map(b => b.id).join() === 'old');
  const r5 = mergeBackcharges({ device: [dev('p')], server: [], pendingIds: new Set(['p']), unsavedIds: none, adoptedIds: none, deviceIsThisUsers: true });
  ok('a device-only row with a pending write is kept, not adopted (the queue sends it)', r5.merged.length === 1 && r5.toAdopt.length === 0);
  const r6 = mergeBackcharges({ device: [dev('r')], server: [], pendingIds: none, unsavedIds: new Set(['r']), adoptedIds: none, deviceIsThisUsers: true });
  ok('a refused device-only row is NOT deleted and not re-sent', r6.merged.map(b => b.id).join() === 'r' && r6.toAdopt.length === 0);
  const r7 = mergeBackcharges({ device: [dev('d')], server: [], pendingIds: none, unsavedIds: none, adoptedIds: new Set(['d']), deviceIsThisUsers: true });
  ok('a row already adopted this session is kept and not sent twice', r7.merged.length === 1 && r7.toAdopt.length === 0);
  const r8 = mergeBackcharges({ device: [dev('f')], server: [srv('s')], pendingIds: none, unsavedIds: none, adoptedIds: none, deviceIsThisUsers: false });
  ok("another account's device rows are dropped and never sent up", r8.merged.map(b => b.id).join() === 's' && r8.toAdopt.length === 0);
  const r9 = mergeBackcharges({ device: [dev('ph', { photoUri: 'file:///x.jpg' })], server: [srv('ph')], pendingIds: none, unsavedIds: none, adoptedIds: none, deviceIsThisUsers: true });
  ok('a server row keeps the device photo of the same id', r9.merged[0].photoUri === 'file:///x.jpg' && r9.merged[0].reason === 'server ph');
  const r10 = mergeBackcharges({
    device: [dev('b'), dev('a')],
    server: [srv('z', { createdAt: '2026-09-02T00:00:00Z' }), srv('y', { createdAt: '2026-09-01T00:00:00Z' }), srv('a')],
    pendingIds: none, unsavedIds: none, adoptedIds: none, deviceIsThisUsers: true,
  });
  ok('order: device order first, then account-only rows oldest first', r10.merged.map(b => b.id).join() === 'b,a,y,z', r10.merged.map(b => b.id));
  ok('serverIds lists exactly what the account returned', [...r10.serverIds].sort().join() === 'a,y,z');
  const r11 = mergeBackcharges({ device: [dev('a'), dev('a')], server: [], pendingIds: none, unsavedIds: none, adoptedIds: none, deviceIsThisUsers: true });
  ok('a duplicated device id is merged once', r11.merged.length === 1 && r11.toAdopt.length === 1);
  const r12 = mergeBackcharges({ device: [dev('keep')], server: [srv('other')], pendingIds: none, unsavedIds: none, adoptedIds: new Set(['keep']), deviceIsThisUsers: true });
  ok('a row the account stopped returning is never deleted by a merge', r12.merged.some(b => b.id === 'keep'));
}

console.log('\n§3 states and words');
{
  const s = (o: Partial<{ signedIn: boolean; unsaved: string[]; pending: string[]; saved: string[]; unreadable: boolean }>) => ({
    signedIn: o.signedIn ?? true, unsavedIds: new Set(o.unsaved ?? []), pendingIds: new Set(o.pending ?? []), savedIds: new Set(o.saved ?? []),
    queueUnreadable: o.unreadable ?? false,
  });
  ok('signed out → device, whatever else is true', saveStateOf('a', s({ signedIn: false, unsaved: ['a'], saved: ['a'] })) === 'device');
  ok('refused beats pending and saved', saveStateOf('a', s({ unsaved: ['a'], pending: ['a'], saved: ['a'] })) === 'not_saved');
  ok('pending beats saved (an edit not yet on the account)', saveStateOf('a', s({ pending: ['a'], saved: ['a'] })) === 'waiting');
  ok('saved only when the account confirmed it', saveStateOf('a', s({ saved: ['a'] })) === 'saved');
  ok('unknown (not confirmed, not queued) reads unconfirmed — never saved, never the back-online line', saveStateOf('a', s({})) === 'unconfirmed');
  ok('an unreadable queue: nothing reads saved or waiting (unconfirmed), a refusal still wins',
    saveStateOf('a', s({ unreadable: true, saved: ['a'] })) === 'unconfirmed' && saveStateOf('a', s({ unreadable: true, pending: ['a'] })) === 'unconfirmed'
    && saveStateOf('a', s({ unreadable: true, unsaved: ['a'] })) === 'not_saved');

  const line = (st: BackchargeSaveState[], signedIn = true) => backchargeStorageLine(st, signedIn);
  ok('saved → "Saved to your account."', line(['saved', 'saved'])?.text === 'Saved to your account.' && BACKCHARGE_LINE_SAVED === 'Saved to your account.');
  ok('waiting → the back-online line', line(['saved', 'waiting'])?.text === "Saved on this device. It goes to your account when you're back online." && BACKCHARGE_LINE_WAITING === line(['waiting'])?.text);
  ok('not saved → "Not saved to your account. Tap to retry." and it retries', line(['saved', 'waiting', 'not_saved'])?.text === 'Not saved to your account. Tap to retry.' && line(['not_saved'])?.retry === true
    && BACKCHARGE_LINE_NOT_SAVED === 'Not saved to your account.' && BACKCHARGE_RETRY_HINT === 'Tap to retry.');
  ok('unconfirmed → "Saved on this device. Not yet confirmed on your account." (no offline claim)',
    line(['saved', 'unconfirmed'])?.text === 'Saved on this device. Not yet confirmed on your account.' && BACKCHARGE_LINE_UNCONFIRMED === line(['unconfirmed'])?.text
    && !/online/i.test(BACKCHARGE_LINE_UNCONFIRMED));
  ok('precedence: not saved → waiting → unconfirmed → saved',
    line(['unconfirmed', 'waiting'])?.text === BACKCHARGE_LINE_WAITING && line(['unconfirmed', 'not_saved'])?.retry === true && line(['saved', 'unconfirmed'])?.text === BACKCHARGE_LINE_UNCONFIRMED);
  ok("signed out → today's line", line([], false)?.text === 'Saved on this device until you sign out.' && line(['saved'], false)?.text === BACKCHARGE_LINE_DEVICE && line(['device'])?.text === BACKCHARGE_LINE_DEVICE);
  ok('signed in with nothing on screen claims nothing', line([]) === null);
  ok('only the not-saved line is tappable', [line(['saved']), line(['waiting']), line([], false)].every(l => l?.retry === false));
  ok('the sheet keeps "Nothing is sent to the sub." in both states', backchargeSheetSubtitle(true) === BACKCHARGE_SHEET_NOTHING_SENT
    && backchargeSheetSubtitle(false) === 'Saved on this device until you sign out. Nothing is sent to the sub.');
  const words = [BACKCHARGE_LINE_DEVICE, BACKCHARGE_LINE_SAVED, BACKCHARGE_LINE_WAITING, BACKCHARGE_LINE_UNCONFIRMED, BACKCHARGE_LINE_NOT_SAVED, BACKCHARGE_RETRY_HINT, BACKCHARGE_SHEET_NOTHING_SENT];
  ok('VOICE: no exclamation marks, no developer words, no he/his, "device" not "phone"',
    words.every(w => !/!/.test(w) && !/\b(sync|synced|queue|server|cache|tenant)\b/i.test(w) && !/\b(he|his|him|she|her)\b/i.test(w) && !/\bphone\b/i.test(w)), words);
}

console.log('\n§3b a list that is not complete is never a clean record');
{
  const c = (o: Partial<Parameters<typeof backchargesComplete>[0]>) => backchargesComplete({
    signedIn: true, userId: 'u1', deviceLoaded: true, listOwner: 'u1', accountReadFor: 'u1', ...o,
  });
  ok('signed out: complete once the device copy is read', c({ signedIn: false, userId: null, accountReadFor: null, listOwner: null }) && !c({ signedIn: false, userId: null, deviceLoaded: false }));
  ok('signed in, account read still pending: NOT complete (the device copy alone does not count)', !c({ accountReadFor: null }));
  ok('signed in, a read that came back for ANOTHER user: not complete', !c({ accountReadFor: 'u2' }));
  ok('signed in, the list is still under another account: not complete', !c({ listOwner: 'u2' }) && !c({ listOwner: null }));
  ok('signed in, this user\'s read came back and the list is theirs: complete', c({}));
  ok('backchargesForScorecard: complete → the list, not complete → undefined', backchargesForScorecard([], true)?.length === 0 && backchargesForScorecard([bc({ id: 'x' })], false) === undefined);

  // The founder's case: a sub on 4 projects with $12,000 of backcharges on the account.
  const SUB = { id: 'sub-vega', companyName: 'Vega Painting', trade: 'Painting' } as unknown as Subcontractor;
  const commitments = [1, 2, 3, 4].map(i => ({
    id: `c${i}`, projectId: `p${i}`, subcontractorId: 'sub-vega', vendorName: 'Vega Painting', amount: 50000, changeAmount: 0,
    status: 'signed', type: 'subcontract', createdAt: '2026-01-01T00:00:00.000Z',
  })) as unknown as Commitment[];
  const onAccount = [bc({ id: 'k1', projectId: 'p1', amountCents: 800000 }), bc({ id: 'k2', projectId: 'p2', amountCents: 400000 })];
  const card = (backcharges: ReturnType<typeof backchargesForScorecard>) => computeSubScorecards({
    subcontractors: [SUB], commitments, changeOrders: [], punchItems: [], projects: [], rfis: [], backcharges,
  }).cards[0];
  const factor = (x: ReturnType<typeof card>) => x?.factors.find(f => f.key === 'backcharges');
  const unread = card(backchargesForScorecard([], false));
  const omitted = card(undefined);
  const real = card(backchargesForScorecard(onAccount, true));
  ok('account read pending: the factor is NOT applicable — the same card as leaving the input out',
    factor(unread)?.applicable === false && JSON.stringify(unread) === JSON.stringify(omitted), factor(unread));
  ok('…and never says "No backcharges"', !/No backcharges/.test(JSON.stringify(unread)));
  ok('once read, the real list counts (applicable, names the backcharges)', factor(real)?.applicable === true && /2 backcharges/.test(String(factor(real)?.detail ?? JSON.stringify(factor(real)))), factor(real));
}

console.log('\n§4 sources');
{
  const hookRaw = read('hooks/useBackcharges.ts');
  const hook = code(hookRaw);
  const dir = join(ROOT, 'components', 'backcharge');
  const comps = readdirSync(dir).filter(f => f.endsWith('.tsx')).map(f => [f, code(readFileSync(join(dir, f), 'utf8'))] as const);
  ok('no supabase.from( in the hook', !/supabase\s*\.\s*from\(/.test(hook));
  ok('no supabase.from( in components/backcharge/*', comps.length >= 3 && comps.every(([, s]) => !/supabase\s*\.\s*from\(/.test(s)), comps.map(([f]) => f));
  ok('no direct .from(…).insert/update/upsert/delete anywhere in the hook or components',
    ![hook, ...comps.map(([, s]) => s)].some(s => /\.from\([^)]*\)\s*\.\s*(insert|update|upsert|delete)\(/.test(s)));
  ok("the hook's one write is supabaseWriteDetailed(BACKCHARGES_TABLE, 'upsert', toRow(b)",
    (hook.match(/supabaseWriteDetailed\(/g) ?? []).length === 1 && /supabaseWriteDetailed\(BACKCHARGES_TABLE, 'upsert', toRow\(b\)/.test(hook));
  const imp = hookRaw.match(/import \{([^}]*)\} from '@\/utils\/offlineQueue';/);
  const names = imp ? imp[1].split(',').map(s => s.trim().replace(/^type\s+/, '')).filter(Boolean) : [];
  const ALLOWED = new Set(['supabaseWriteDetailed', 'WriteOutcome', 'supabaseWrite', 'getOwnOfflineQueue', 'getOwnOfflineQueueDetailed', 'OwnQueueRead', 'recordIdOf', 'onQueueChanged', 'onQueueFlushed', 'onQueueDropped', 'DroppedListener']);
  ok('the hook imports only the sanctioned offline-queue exports', names.length > 0 && names.every(n => ALLOWED.has(n)), names);
  ok('pending ids come from the own queue read + recordIdOf (no invented queue reader)', /getOwnOfflineQueueDetailed\(\)/.test(hook) && /recordIdOf\(m\.table, m\.data\)/.test(hook));
  // Every mutator changes the device list AND sends the row.
  for (const fn of ['add', 'update', 'applyToInvoice', 'voidOne']) {
    const at = hook.indexOf(`const ${fn} = useCallback(`);
    const body = at === -1 ? '' : hook.slice(at, hook.indexOf('}, [owner]);', at));
    ok(`${fn} commits the device list and sends through the queue`, /commit\(/.test(body) && /send\(/.test(body), body.slice(0, 60));
  }
  ok("the account read is react-query ['backcharges', userId], only when signed in", /queryKey: \['backcharges', userId\]/.test(hook) && /enabled: signedIn/.test(hook) && /fetchAccountBackcharges\(\)/.test(hook));
  ok('signed in means a user AND a configured client', /const signedIn = !!userId && isSupabaseConfigured;/.test(hook));
  ok('the device list is still read and written under BACKCHARGES_KEY in try/catch', hook.includes('BACKCHARGES_KEY') && (hook.match(/try \{/g) ?? []).length >= 4);
  ok('the hook never removes a row because the account did not return it (no filter on serverIds)', !/serverIds\.has\([^)]*\)\s*\)?\s*\?/.test(hook) && !/filter\([^)]*serverIds/.test(hook));
  const section = code(read('components/backcharge/BackchargeSection.tsx'));
  const card = code(read('components/backcharge/BackchargeDeductionCard.tsx'));
  const sheet = code(read('components/backcharge/BackchargeSheet.tsx'));
  ok('the section shows backchargeStorageLine(states, signedIn)', /backchargeStorageLine\(states, signedIn\)/.test(section) && /statusOf\(b\.id\)/.test(section));
  ok('the deduction card shows backchargeStorageLine(states, signedIn)', /backchargeStorageLine\(states, signedIn\)/.test(card) && /statusOf\(b\.id\)/.test(card));
  ok('the not-saved line resends through retryNotSaved (the ledger Retry)', /onPress=\{\(\) => retryNotSaved\(notSavedIds\)\}/.test(section) && /onPress=\{\(\) => retryNotSaved\(notSavedIds\)\}/.test(card)
    && /retryUnsavedWrite\(f\.id\)/.test(hook));
  ok('no hard-coded storage sentence left in the section, card or sheet', ![section, card, sheet].some(s => /Saved on this device until you sign out/.test(s)));
  ok('the sheet subtitle comes from backchargeSheetSubtitle(signedIn)', /subtitle=\{backchargeSheetSubtitle\(signedIn\)\}/.test(sheet));
  const scorecard = code(read('app/sub-scorecard.tsx'));
  const register = code(read('components/registers/SubsRegister.tsx'));
  ok('/sub-scorecard passes the backcharges to computeSubScorecards', /useBackcharges\(\)/.test(scorecard) && /computeSubScorecards\(\{[^}]*backcharges \}\)/.test(scorecard));
  ok('SubsRegister passes the backcharges to computeSubScorecards', /useBackcharges\(\)/.test(register) && /computeSubScorecards\(\{[^}]*backcharges \}\)/.test(register));
  // Round 2: both pass the list ONLY when it is complete — never the raw list.
  for (const [name, src] of [['/sub-scorecard', scorecard], ['SubsRegister', register]] as const) {
    ok(`${name} gates the list on complete (backchargesForScorecard), never the raw list`,
      /const \{ list: backchargeList, complete: backchargesRead \} = useBackcharges\(\);/.test(src)
      && /const backcharges = backchargesForScorecard\(backchargeList, backchargesRead\);/.test(src)
      && !/const \{ list: backcharges \} = useBackcharges\(\)/.test(src));
  }
  ok('the hook exposes complete from backchargesComplete, marks the read before its commit, and clears it on any other publish',
    /const complete = backchargesComplete\(\{\s*signedIn, userId: owner, deviceLoaded: sharedLoaded, listOwner: sharedOwner, accountReadFor,\s*\}\);/.test(hook)
    && /accountReadFor = userId;\s*commit\(merged, userId\);/.test(hook)
    && /if \(owner !== accountReadFor\) accountReadFor = null;/.test(hook)
    && (hook.match(/accountReadFor = userId/g) ?? []).length === 1);
  ok("statusOf reads only the queue's own ids as waiting (not in-flight writes)",
    /const stateInput = \{ signedIn, unsavedIds, pendingIds: queuedIds, savedIds, queueUnreadable \};/.test(hook));
}

console.log('\n§5 migration');
{
  const migDir = join(ROOT, 'supabase', 'migrations');
  const file = readdirSync(migDir).find(f => /^\d{14}_backcharges\.sql$/.test(f));
  ok('one <ts>_backcharges.sql migration exists', !!file, file);
  const sql = file ? readFileSync(join(migDir, file), 'utf8') : '';
  const q = sql.replace(/--[^\n]*/g, '');
  ok('creates public.backcharges idempotently', /create table if not exists public\.backcharges \(/.test(q));
  ok('row level security is enabled', /alter table public\.backcharges enable row level security;/.test(q));
  ok('no delete policy', !/create policy[^;]*on public\.backcharges\s+for (delete|all)\b/i.test(q), q.match(/create policy[^;]*;/g));
  const ins = q.match(/create policy (\w+) on public\.backcharges\s+for insert[^;]*;/i)?.[0] ?? '';
  ok('the insert WITH CHECK carries auth.uid() = user_id AND can_access_project', /with check \(auth\.uid\(\) = user_id and public\.can_access_project\(project_id, '(editor|owner)'\)\)/.test(ins), ins);
  const sel = q.match(/create policy (\w+) on public\.backcharges\s+for select[^;]*;/i)?.[0] ?? '';
  ok("select needs editor access (field and viewer do not read money)", /using \(public\.can_access_project\(project_id, 'editor'\)\)/.test(sel), sel);
  const upd = q.match(/create policy (\w+) on public\.backcharges\s+for update[^;]*;/i)?.[0] ?? '';
  ok('update USING and WITH CHECK both need editor access', /using\s+\(public\.can_access_project\(project_id, 'editor'\)\)\s+with check \(public\.can_access_project\(project_id, 'editor'\)\)/.test(upd), upd);
  ok('user_id defaults to auth.uid()', /user_id\s+uuid default auth\.uid\(\)/.test(q));
  const fn = q.slice(q.indexOf('create or replace function public.backcharges_guard()'), q.indexOf('$fn$;', q.indexOf('create or replace function public.backcharges_guard()')));
  ok('the guard pins id, user_id, project_id and created_at',
    ['new.id         := old.id;', 'new.user_id    := old.user_id;', 'new.project_id := old.project_id;', 'new.created_at := old.created_at;'].every(l => fn.includes(l)), fn.slice(0, 200));
  ok('the guard keeps an applied/void row settled', /if old\.status <> 'open' and new\.status is distinct from old\.status then\s+raise exception/.test(fn));
  ok('the guard is security invoker with a pinned search_path', !/security definer/i.test(fn) && /set search_path = public/.test(fn));
  ok('the guard runs BEFORE UPDATE for each row, recreated idempotently',
    /drop trigger if exists backcharges_guard on public\.backcharges;\s*create trigger backcharges_guard\s+before update on public\.backcharges\s+for each row execute function public\.backcharges_guard\(\);/.test(q));
  ok('amount_cents is a bigint that must be > 0', /amount_cents\s+bigint not null/.test(q) && /check \(amount_cents > 0\)/.test(q));
  ok('hours × rate rows carry both, and an applied row names its bill',
    /check \(basis <> 'hours_x_rate' or \(hours is not null and rate_cents is not null\)\)/.test(q) && /check \(status <> 'applied' or applied_invoice_id is not null\)/.test(q));
  ok('grants: revoke all from anon, grant select, insert, update to authenticated',
    /revoke all on public\.backcharges from anon, public;/.test(q) && /grant select, insert, update on public\.backcharges to authenticated;/.test(q)
    && /revoke delete, truncate, trigger, references on public\.backcharges from authenticated;/.test(q));
  ok('nothing is granted to anon', !/grant [^;]* to [^;]*\banon\b/i.test(q));
  ok('the trigger function is not executable by client roles', /revoke execute on function public\.backcharges_guard\(\) from public, anon, authenticated;/.test(q));
  ok('the project cascade removes rows; the author delete only clears user_id',
    /project_id\s+uuid not null references public\.projects\(id\) on delete cascade/.test(q) && /references auth\.users\(id\) on delete set null/.test(q));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

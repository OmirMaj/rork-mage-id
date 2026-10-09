// scripts/validate-living-model-sync.ts — the Living Model saved to the account
// (lane LIVINGSYNC). Run: bun run test:living-model-sync
//
// WHAT THIS HOLDS
//   A  the decision (syncCore.reconcile): a table of named cases and a sweep of
//      every combination, with the one rule that matters most: when the device
//      and the account have BOTH changed the answer is `conflict`, never a pick.
//   B  a database without the table means device-only, quietly, nothing queued.
//   C  the sentences the screen says, word for word, and which state says which.
//   D  scans: a scanned room is never sent before the person says yes, and
//      nothing of a scan but the placed room's sizes is in what is sent.
//   E  the one write goes through the offline queue; nothing else writes.
//   F  a both-changed choice keeps the other model BEFORE anything is replaced.
//   G  the keys are the app's own, per person and per project.
//   H  the migration's text, its proof, and this check's place in the gate.
//
// Every rule has at least one PLANTED MUTATION: the rule is run again on a copy
// of the world with one guard removed and must go red. A rule that stays green
// with its guard removed proves nothing, so that fails the run.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EN as EN_SHARD } from '../i18n/catalog/en/office.living-model.generated';
import { ES_OFFICE_LIVING_MODEL } from '../i18n/catalog/es/office/livingModel';
import { addRoom, emptyJobModel, makeRectRoom, roomFromScan, setRoomTaskLink } from '../utils/livingModel/modelCore';
import {
  LIVING_MODEL_BACKUP_PREFIX, LIVING_MODEL_KEPT_PREFIX, LIVING_MODEL_KEY_PREFIX, LIVING_MODEL_SYNC_PREFIX, MAX_MODEL_CHARS,
  livingModelBackupKey, livingModelKeptKey, livingModelKey, livingModelSyncKey,
} from '../utils/livingModel/storeCore';
import {
  EMPTY_SYNC_META, LIVING_MODELS_TABLE, LIVING_MODEL_SAVE_FN, LIVING_MODEL_SCHEMA_VERSION, deviceChanged, isMissingTable, isThisDevice,
  metaAfterMatch, metaAfterSend, modelFingerprint, modelForAccount, modelHasContent, parseServerHead, parseSyncMeta, reconcile, saveArgs,
  scanGate, scanRoomIds, unsentScanRoomIds,
  type ModelSyncMeta, type ReconcileAction, type ReconcileInput,
} from '../utils/livingModel/syncCore';
import type { JobModel } from '../utils/livingModel/types';
import { isAppStorageKey } from '../utils/localCacheKeys';
import type { RoomScan } from '../utils/roomScan/types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

const MIGRATION = 'supabase/migrations/20261011090000_living_models.sql';
const PROOF = 'scripts/pgq/living-models.mjs';
const HOOK = 'hooks/useLivingModelSync.ts';
const IO = 'utils/livingModel/syncIo.ts';
const STORE = 'utils/livingModel/syncStore.ts';
const CORE = 'utils/livingModel/syncCore.ts';
const STATUS = 'components/livingModel/SyncStatus.tsx';
const SCREEN = 'components/livingModel/LivingModelScreen.tsx';
const EDITOR = 'components/livingModel/RoomEditor.tsx';
const NOTES = 'docs/living-model-sync-notes.md';
const FILES = [MIGRATION, PROOF, HOOK, IO, STORE, CORE, STATUS, SCREEN, EDITOR, NOTES, 'utils/livingModel/store.ts', 'utils/livingModel/storeCore.ts', 'app.json', 'package.json', '.github/workflows/ship-gate.yml', 'scripts/pgq/README.md', 'utils/syncLedger.ts'];

const impl = { reconcile, deviceChanged, isMissingTable, scanGate, modelForAccount, parseSyncMeta, livingModelSyncKey, livingModelKeptKey };
type Impl = typeof impl;
type Catalog = Record<string, unknown>;
interface World { files: Record<string, string>; EN: Catalog; ES: Catalog; impl: Impl }

const files: Record<string, string> = {};
for (const f of FILES) files[f] = existsSync(join(ROOT, f)) ? read(f) : '';
const esPlain: Catalog = {};
for (const [k, v] of Object.entries(ES_OFFICE_LIVING_MODEL as Record<string, { s: unknown }>)) esPlain[k] = v.s;
const WORLD: World = { files, EN: EN_SHARD as Catalog, ES: esPlain, impl };

const K = 'office.livingModel.';
/** Source with comments removed, so a rule reads code and not prose about code. */
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).map((l) => l.replace(/\s\/\/ .*$/, '')).join('\n');
/** SQL with `--` comments removed. */
const sql = (src: string): string => src.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
const count = (s: string, needle: string): number => s.split(needle).length - 1;

interface Rule { id: string; what: string; run: (w: World) => string[] }
const RULES: Rule[] = [];
const rule = (id: string, what: string, run: (w: World) => string[]): void => { RULES.push({ id, what, run }); };

// ── fixtures ─────────────────────────────────────────────────────────────────
const P = '10000000-0000-4000-8000-000000000001';
const meta = (over: Partial<ModelSyncMeta> = {}): ModelSyncMeta => ({ ...EMPTY_SYNC_META, ownWriteIds: [], accountScanRoomIds: [], ...over });
const synced = (rev: number, fp: string, over: Partial<ModelSyncMeta> = {}): ModelSyncMeta => meta({ accountSeen: true, baseRevision: rev, baseFingerprint: fp, ...over });
const pend = (writeId: string, base: number, fingerprint = 'B') => ({ writeId, base, fingerprint, scanRoomIds: [] as string[] });
const srv = (revision: number, fingerprint?: string | null, writeId: string | null = 'w-other', schemaVersion = 1) => ({ revision, writeId, schemaVersion, fingerprint });
const loc = (fingerprint: string, hasContent = true) => ({ fingerprint, hasContent });

const POISON = ['RAW-SCAN-JSON-POISON', 'iPhone15,3-POISON', 'sha256-POISON', 'tape-POISON', 'edit-POISON', 'warning-POISON', '2026-01-02T03:04:05.000Z-POISON'];
function aScan(id: string): RoomScan {
  const scan = {
    id, projectId: P, name: 'Hall Bathroom', version: 1, capturedAt: POISON[6], device: { model: POISON[1], os: '18.0' },
    roomType: 'bathroom', suggestedRoomType: null,
    walls: [
      { id: 'w1', label: 'Wall 1', a: { x: 0, y: 0 }, b: { x: 3, y: 0 }, lengthM: 3, scanLengthM: 3.01, lengthSource: 'scan', heightM: 2.4, confidence: 'high', curved: false, onOutline: true, polygon: [{ u: 0, v: 0 }, { u: 3, v: 0 }, { u: 3, v: 2.4 }] },
      { id: 'w2', label: 'Wall 2', a: { x: 3, y: 0 }, b: { x: 3, y: 2 }, lengthM: 2, scanLengthM: 2, lengthSource: 'typed', heightM: 2.4, confidence: 'medium', curved: false, onOutline: true },
      { id: 'w3', label: 'Wall 3', a: { x: 3, y: 2 }, b: { x: 0, y: 2 }, lengthM: 3, scanLengthM: 3, lengthSource: 'scan', heightM: 2.4, confidence: 'high', curved: false, onOutline: true },
      { id: 'w4', label: 'Wall 4', a: { x: 0, y: 2 }, b: { x: 0, y: 0 }, lengthM: 2, scanLengthM: 2, lengthSource: 'adjusted', heightM: 2.4, confidence: 'low', curved: false, onOutline: true },
    ],
    openings: [{ id: 'o1', kind: 'door', wallId: 'w1', offsetM: 0.5, widthM: 0.8, heightM: 2, sillM: 0, confidence: 'high', widthSource: 'scan', heightSource: 'scan' }],
    objects: [{ id: 'f1', category: 'toilet', center: { x: 1, y: 1 }, widthM: 0.4, depthM: 0.7, heightM: 0.8, rotationRad: 0.5, confidence: 'high' }],
    floor: [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 2 }, { x: 0, y: 2 }],
    closure: { closed: true, gapM: 0, gaps: 0, gapWallIds: [], cause: 'scan' },
    ceilingHeightM: { known: true, min: 2.4, max: 2.4, typical: 2.4, source: 'scan' },
    warnings: [POISON[5]], tapeChecks: [{ wallId: 'w1', scanM: 3.01, tapeM: 3, at: POISON[3] }],
    edits: [{ at: POISON[4], target: 'wall:w2', field: 'lengthM', from: 2.02, to: 2, by: 'typed' }],
    rawSha256: POISON[2],
  };
  return scan as unknown as RoomScan;
}
const typedModel = (): JobModel => {
  let m = emptyJobModel(P);
  m = addRoom(m, makeRectRoom({ id: 'r-typed', name: 'Kitchen', kind: 'kitchen', level: 0, widthM: 4, lengthM: 3, heightM: 2.5, xM: 0, yM: 0 } as never));
  return setRoomTaskLink(m, 'r-typed', 'task-1', true);
};
const scanModel = (): JobModel => addRoom(typedModel(), roomFromScan(aScan('scan-1'), { id: 'r-scan', placement: { xM: 6, yM: 0 } }));

// ── A. the decision ──────────────────────────────────────────────────────────
type Case = [string, ReconcileInput, ReconcileAction['kind'], number?];
const CASES: Case[] = [
  ['neither side has a model', { local: loc('E', false), meta: meta(), server: null, pendingQueued: false }, 'nothing'],
  ['no account row, a model on the device that was never sent', { local: loc('A'), meta: meta({ accountSeen: true }), server: null, pendingQueued: false }, 'push', 0],
  ['the account row is gone, the device has a model', { local: loc('A'), meta: synced(3, 'A'), server: null, pendingQueued: false }, 'push', 0],
  ['an account model and an empty device that never matched it', { local: loc('E', false), meta: meta(), server: srv(2), pendingQueued: false }, 'take_server'],
  ['same revision, nothing changed here', { local: loc('A'), meta: synced(2, 'A'), server: srv(2), pendingQueued: false }, 'in_sync'],
  ['the account is ahead and this device has no changes', { local: loc('A'), meta: synced(2, 'A'), server: srv(5), pendingQueued: false }, 'take_server'],
  ['this device changed and the account is where it was', { local: loc('B'), meta: synced(2, 'A'), server: srv(2), pendingQueued: false }, 'push', 2],
  ['this device emptied the model and the account is where it was', { local: loc('E', false), meta: synced(2, 'A'), server: srv(2), pendingQueued: false }, 'push', 2],
  ['BOTH changed, the account model not fetched yet', { local: loc('B'), meta: synced(2, 'A'), server: srv(5), pendingQueued: false }, 'need_model'],
  ['BOTH changed, to different models', { local: loc('B'), meta: synced(2, 'A'), server: srv(5, 'C'), pendingQueued: false }, 'conflict'],
  ['BOTH changed, to the same model', { local: loc('B'), meta: synced(2, 'A'), server: srv(5, 'B'), pendingQueued: false }, 'in_sync'],
  ['two models made apart (never matched), different', { local: loc('B'), meta: meta(), server: srv(1, 'C'), pendingQueued: false }, 'conflict'],
  ['two models made apart, the account one not fetched yet', { local: loc('B'), meta: meta(), server: srv(1), pendingQueued: false }, 'need_model'],
  ['two models made apart that are the same model', { local: loc('B'), meta: meta(), server: srv(1, 'B'), pendingQueued: false }, 'in_sync'],
  ['a save of this device is still queued', { local: loc('B'), meta: synced(2, 'A', { pending: pend('w1', 2) }), server: srv(5, 'C'), pendingQueued: true }, 'wait'],
  ['the pending save is the account row', { local: loc('B'), meta: synced(2, 'A', { pending: pend('w1', 2) }), server: srv(3, undefined, 'w1'), pendingQueued: false }, 'landed'],
  ['the pending save was refused as stale: someone else saved', { local: loc('B'), meta: synced(2, 'A', { pending: pend('w1', 2) }), server: srv(3, 'C', 'w9'), pendingQueued: false }, 'conflict'],
  ['the pending save never landed and the account is where it was', { local: loc('B'), meta: synced(2, 'A', { pending: pend('w1', 2) }), server: srv(2, undefined, 'w0'), pendingQueued: false }, 'push', 2],
  ['the account model is from a newer build (schema)', { local: loc('A'), meta: synced(2, 'A'), server: srv(5, undefined, 'w9', LIVING_MODEL_SCHEMA_VERSION + 1), pendingQueued: false }, 'account_unreadable'],
  ['the account model cannot be read by this build', { local: loc('B'), meta: synced(2, 'A'), server: srv(5, null), pendingQueued: false }, 'account_unreadable'],
  ['the account row was made again (a lower revision), nothing changed here', { local: loc('A'), meta: synced(4, 'A'), server: srv(1, 'C'), pendingQueued: false }, 'take_server'],
  ['the account row was made again, and this device changed', { local: loc('B'), meta: synced(4, 'A'), server: srv(1, 'C'), pendingQueued: false }, 'conflict'],
];

rule('A1', 'reconcile answers every named case, and both-changed is always the question', (w) => {
  const out: string[] = [];
  for (const [name, input, want, base] of CASES) {
    const got = w.impl.reconcile(input);
    if (got.kind !== want) out.push(`${name}: ${got.kind}, want ${want}`);
    else if (got.kind === 'push' && got.base !== base) out.push(`${name}: push based on ${got.base}, want ${base}`);
  }
  return out;
});

rule('A2', 'over every combination: never a send on a stale base, never a take over changes made here, never a silent pick', (w) => {
  const out: string[] = [];
  let n = 0;
  const metas: ModelSyncMeta[] = [meta(), synced(2, 'A')];
  const servers: ReconcileInput['server'][] = [null];
  for (const rev of [1, 2, 3]) for (const fp of ['A', 'B', 'C', undefined, null]) for (const wid of ['w1', 'w9']) for (const sv of [1, 2]) servers.push(srv(rev, fp, wid, sv));
  for (const m0 of metas) for (const pending of [null, pend('w1', m0.baseRevision)]) for (const queued of [false, true]) {
    for (const l of [loc('A'), loc('B'), loc('E', false)]) for (const server of servers) {
      const m = { ...m0, pending };
      const input: ReconcileInput = { local: l, meta: m, server, pendingQueued: queued };
      const a = w.impl.reconcile(input);
      n += 1;
      const tag = `base ${m.baseRevision}, local ${l.fingerprint}${l.hasContent ? '' : ' (empty)'}, server ${server ? `${server.revision}/${String(server.fingerprint)}/${server.writeId}/v${server.schemaVersion}` : 'none'}, pending ${pending ? 'yes' : 'no'}${queued ? ' queued' : ''}`;
      const changed = deviceChanged(m, l);
      if ((a.kind === 'wait') !== (!!pending && queued)) { out.push(`${tag}: wait is ${a.kind === 'wait'}`); continue; }
      if (a.kind === 'wait') continue;
      if (a.kind === 'push' && server && !(m.baseRevision > 0 && server.revision === m.baseRevision && a.base === server.revision)) out.push(`${tag}: sends on a base that is not the account's revision`);
      if (a.kind === 'push' && !server && a.base !== 0) out.push(`${tag}: first save not based on 0`);
      if (a.kind === 'push' && server && (server.schemaVersion > LIVING_MODEL_SCHEMA_VERSION || server.fingerprint === null)) out.push(`${tag}: sends over a model this build cannot read`);
      if (a.kind === 'take_server' && changed) out.push(`${tag}: takes the account's over changes made here`);
      if (a.kind === 'take_server' && server && (server.schemaVersion > LIVING_MODEL_SCHEMA_VERSION || server.fingerprint === null)) out.push(`${tag}: takes a model this build cannot read`);
      const landed = !!pending && !!server && server.writeId === pending.writeId;
      const readable = !!server && server.schemaVersion <= LIVING_MODEL_SCHEMA_VERSION && server.fingerprint !== null;
      const bothChanged = changed && readable && !landed && !(m.baseRevision > 0 && server!.revision === m.baseRevision);
      if (bothChanged && typeof server!.fingerprint === 'string' && server!.fingerprint !== l.fingerprint && a.kind !== 'conflict') out.push(`${tag}: both changed and the answer is ${a.kind}`);
      if (bothChanged && server!.fingerprint === undefined && a.kind !== 'need_model') out.push(`${tag}: decided without the account's model (${a.kind})`);
      if (a.kind === 'conflict' && !bothChanged) out.push(`${tag}: asks when only one side changed`);
    }
  }
  if (n < 1000) out.push(`only ${n} combinations were tried`);
  return out;
});

rule('A3', 'changes on the device are read from the model itself, and unreadable notes mean "never matched"', (w) => {
  const out: string[] = [];
  const D = w.impl.deviceChanged;
  if (!D(meta(), loc('A'))) out.push('a model that was never sent does not count as a change');
  if (D(meta(), loc('E', false))) out.push('an empty model that was never sent counts as a change');
  if (D(synced(2, 'A'), loc('A'))) out.push('the same model counts as a change');
  if (!D(synced(2, 'A'), loc('B'))) out.push('a different model does not count as a change');
  if (!D(synced(2, 'A'), loc('E', false))) out.push('emptying a model that was saved does not count as a change');
  for (const raw of [null, '', 'not json', '[]', '{"baseRevision":3}', '{"baseRevision":"3","baseFingerprint":"A"}', '{"baseRevision":-1,"baseFingerprint":"A"}', '{"baseRevision":2.5,"baseFingerprint":"A"}']) {
    const m = w.impl.parseSyncMeta(raw);
    if (m.baseRevision !== 0 || m.baseFingerprint !== null) out.push(`notes ${String(raw)} read as matched at revision ${m.baseRevision}`);
    if (m.scanChoice !== 'unasked') out.push(`notes ${String(raw)} read as a scan answer`);
    if (m.accountSeen) out.push(`notes ${String(raw)} read as "the table was seen"`);
  }
  const round = w.impl.parseSyncMeta(JSON.stringify(metaAfterSend(synced(4, 'A', { scanChoice: 'device', accountScanRoomIds: ['r1'] }), pend('w7', 4))));
  if (round.baseRevision !== 4 || round.baseFingerprint !== 'A' || round.pending?.writeId !== 'w7' || round.scanChoice !== 'device' || round.accountScanRoomIds.join() !== 'r1' || !round.ownWriteIds.includes('w7')) out.push('sound notes do not read back as written');
  if (w.impl.parseSyncMeta('{"scanChoice":"yes"}').scanChoice !== 'unasked') out.push('an unknown scan answer reads as an answer');
  const head = parseServerHead({ revision: 5, last_write_id: 'w7', schema_version: 1, updated_at: '2026-10-09T12:00:00+00:00', updated_by: 'u1' });
  if (!head || !isThisDevice(round, head) || isThisDevice(round, { writeId: 'w8' }) || isThisDevice(round, { writeId: null })) out.push('"this device" is not read from the write id');
  if (parseServerHead({ revision: 0, updated_at: 'x' }) !== null || parseServerHead({ revision: 2 }) !== null || parseServerHead(null) !== null) out.push('a row with no revision or no time is read as a row');
  const after = head ? metaAfterMatch(round, head, 'Z', ['r9']) : null;
  if (!after || after.baseRevision !== 5 || after.baseFingerprint !== 'Z' || after.pending !== null || after.savedAt !== head?.updatedAt || after.accountScanRoomIds.join() !== 'r9' || after.scanChoice !== 'device') out.push('the notes after a match are wrong');
  return out;
});

// ── B. a database without the table ──────────────────────────────────────────
rule('B1', 'a database without the table is "missing", and nothing else is', (w) => {
  const out: string[] = [];
  const M = w.impl.isMissingTable;
  for (const e of [{ code: '42P01', message: 'relation "public.living_models" does not exist' }, { code: 'PGRST205', message: "Could not find the table 'public.living_models' in the schema cache" }, { code: 'PGRST202', message: 'Could not find the function public.living_model_save' }, { message: 'relation "public.living_models" does not exist' }]) {
    if (!M(e)) out.push(`not read as missing: ${e.code ?? e.message}`);
  }
  for (const e of [null, undefined, {}, { code: '42501', message: 'permission denied for table living_models' }, { code: 'PGRST301', message: 'JWT expired' }, { message: 'Network request failed' }, { code: '23514', message: 'violates check constraint' }, { message: 'relation "public.projects" does not exist' }]) {
    if (M(e as never)) out.push(`read as missing: ${JSON.stringify(e)}`);
  }
  return out;
});

rule('B2', 'missing means device-only with no error shown, and nothing is queued before the table has been seen', (w) => {
  const out: string[] = [];
  const hook = code(w.files[HOOK]);
  const io = code(w.files[IO]);
  if (!/if \(isMissingTable\(res\.error\)\) return \{ kind: 'missing' \};/.test(io)) out.push('the read does not answer "missing" for a database without the table');
  const pass = /const pass = useCallback\(async \(my: number\) => \{([\s\S]*?)\n {2}\}, \[/.exec(hook)?.[1] ?? '';
  if (!pass) { out.push('the run could not be found in the hook'); return out; }
  const missingAt = pass.indexOf("if (first.kind === 'missing') { setStatus('device'); return; }");
  if (missingAt < 0) out.push('a missing table is not shown as the device-only line');
  for (const call of ['commit(', 'send(', 'saveJobModel(', 'fetchAccountModel(']) {
    const at = pass.indexOf(call);
    if (missingAt >= 0 && at >= 0 && at < missingAt) out.push(`${call} runs before the missing-table check`);
  }
  if (!/if \(full\.kind === 'missing'\) \{ setStatus\('device'\); return; \}/.test(pass)) out.push('a table that goes missing between two reads is not the device-only line');
  const seenAt = pass.indexOf("if (!meta.accountSeen) { setStatus('device'); return; }");
  const offlineSend = pass.indexOf('await send(my, m, meta, local.fingerprint, meta.baseRevision, holds);');
  if (seenAt < 0 || offlineSend < 0 || seenAt > offlineSend) out.push('a save can be queued before the table has ever been seen');
  if (/accountSeen: true/.test(pass.slice(0, Math.max(0, missingAt)))) out.push('the table is marked as seen before the read answered');
  return out;
});

// ── C. the sentences ─────────────────────────────────────────────────────────
const SENTENCES: Record<string, string> = {
  'honesty.savedLocalBody': 'Saved on this device only for now.',
  'honesty.otherDevicesBody': 'It will not appear on your other devices.',
  'sync.savedBody': 'Saved to your account.',
  'sync.savedAtBody': 'Last saved at {time}.',
  'sync.changedByYouBody': 'Last changed by you at {time}.',
  'sync.changedByNameBody': 'Last changed by {name} at {time}.',
  'sync.waitingBody': 'Waiting to send. It is saved on this device.',
  'sync.failedBody': 'Could not save to your account. It is saved on this device.',
  'sync.scanAskTitleBody': 'This model includes a room you scanned.',
  'sync.scanAskBody': 'Saving it to your account sends that room’s sizes (walls, doors, windows and fixtures) to MAGE ID’s servers so your other devices and your team on this project can see it. No photo or video is sent.',
  'sync.saveToAccountLabel': 'Save to My Account',
  'sync.keepOnPhoneLabel': 'Keep on This Phone',
  'sync.conflictTitleBody': 'This device has changes that are not in your account.',
  'sync.keepDeviceLabel': 'Keep This Device’s Model',
  'sync.useAccountLabel': 'Use the One in Your Account',
  'scan.noneWebBody': 'Scans stay on the phone that made them. Add the room on that phone, save the model to your account, and it will appear here.',
};

rule('C1', 'the sentences are the ones agreed, in English, and every one has Spanish', (w) => {
  const out: string[] = [];
  for (const [k, want] of Object.entries(SENTENCES)) if (w.EN[`${K}${k}`] !== want) out.push(`${k} reads ${JSON.stringify(w.EN[`${K}${k}`])}`);
  for (const k of Object.keys(w.EN).filter((x) => x.startsWith(`${K}sync.`) || x === `${K}scan.noneWebBody`)) {
    const s = w.ES[k];
    if (s === undefined || (typeof s === 'string' && s.trim() === '')) out.push(`no Spanish for ${k}`);
  }
  for (const [k, v] of Object.entries(w.EN).filter(([x]) => x.startsWith(`${K}sync.`))) {
    const text = typeof v === 'string' ? v : Object.values(v as Record<string, string>).join(' ');
    if (/—|&| e\.g\.|→|\bsynced?\b|\bcloud\b/i.test(text)) out.push(`${k} uses a word or mark the voice rules keep out: ${text}`);
  }
  return out;
});

const STATE_LINES: [string, RegExp][] = [
  ['device', /\{status === 'device' \? \(\s*<Text[^>]*testID="lm-saved-local">\{`\$\{copy\.savedLocalBody\} \$\{copy\.otherDevicesBody\}`\}<\/Text>\s*\) : null\}/],
  ['checking', /\{status === 'checking' \? <Text[^>]*>\{copy\.syncCheckingBody\}<\/Text> : null\}/],
  ['saved', /\{status === 'saved' \? <Text[^>]*>\{detail \? `\$\{copy\.savedAccountBody\} \$\{detail\}` : copy\.savedAccountBody\}<\/Text> : null\}/],
  ['waiting', /\{status === 'waiting' \? <Text[^>]*>\{copy\.syncWaitingBody\}<\/Text> : null\}/],
  ['failed', /\{status === 'failed' \? <Text[^>]*>\{copy\.syncFailedBody\}<\/Text> : null\}/],
  ['account_newer', /\{status === 'account_newer' \? <Text[^>]*>\{copy\.accountNewerBody\}<\/Text> : null\}/],
];

rule('C2', 'each state says its own sentence, and "Saved to your account." is said only after the account was read', (w) => {
  const out: string[] = [];
  const status = w.files[STATUS];
  for (const [state, re] of STATE_LINES) if (!re.test(status)) out.push(`the ${state} state does not say its sentence`);
  for (const key of ['savedAccountBody', 'syncWaitingBody', 'syncFailedBody', 'syncCheckingBody', 'accountNewerBody']) {
    if (count(code(status), `copy.${key}`) !== (key === 'savedAccountBody' ? 2 : 1)) out.push(`copy.${key} is used somewhere other than its own state`);
  }
  if (!/const t = whenText\(sync\.savedAt\);\s*return t \? copy\.savedAtBody\(t\) : '';/.test(status)) out.push('the saved line does not carry the time');
  if (!/if \(c\.byMe\) return copy\.changedByYouBody\(t\);/.test(status) || !/return name \? copy\.changedByNameBody\(name, t\) : copy\.changedByTeammateBody\(t\);/.test(status)) out.push('the saved line does not say who changed the account copy');
  // In the hook, every "saved" follows a match with the account's row in the same branch.
  const hook = code(w.files[HOOK]);
  const parts = hook.split("setStatus('saved')");
  for (let i = 0; i < parts.length - 1; i++) {
    const before = parts[i].slice(-900);
    const offlineKnown = /setStatus\(meta\.baseRevision > 0 \? 'saved' : 'empty'\)$/.test(parts[i] + "setStatus('saved')") || before.trimEnd().endsWith("meta.baseRevision > 0 ? 'saved' : 'empty'");
    if (!offlineKnown && !/metaAfterMatch\(|case 'in_sync':/.test(before)) out.push(`"saved" number ${i + 1} is set without a match against the account's row`);
  }
  if (!/setStatus\(meta\.baseRevision > 0 \? 'saved' : 'empty'\)/.test(hook)) out.push('with the account out of reach and nothing to send, the line is not the last known one');
  if (!/const shown: SyncStatus = status === 'saved' && fingerprintNow !== null && fingerprintNow !== matched \? 'waiting' : status;\s+return \{ status: shown,/.test(hook)) out.push('a change that has not been sent yet still reads "Saved to your account."');
  if (!/if \(outcome === 'queued'\) \{ setStatus\('waiting'\); return; \}/.test(hook)) out.push('a queued save is not shown as waiting');
  if (!/if \(outcome === 'failed'\) \{[\s\S]{0,200}setStatus\('failed'\)/.test(hook)) out.push('a refused save is not shown as failed');
  if (!/<SyncStatus sync=\{sync\} deviceRooms=\{model\.rooms\.length\} hasScanRoom=\{hasScanRoom\} nameOf=\{nameOf\} \/>/.test(w.files[SCREEN])) out.push('the screen does not draw the status line');
  if (/lm-saved-local/.test(w.files[EDITOR])) out.push('the Room Editor still says the device-only line by itself');
  if (!/Platform\.OS === 'web' \? copy\.noScansWebBody : copy\.noScansBody/.test(w.files[EDITOR])) out.push('Add from Scan on the web does not say how a scanned room gets there');
  return out;
});

/** One `{<condition> ? ( ... ) : null}` block of a component, and nothing after it. */
const panel = (src: string, condition: string): string => {
  const at = src.indexOf(`{${condition} ? (`);
  if (at < 0) return '';
  const end = src.indexOf(') : null}', at);
  return end < 0 ? '' : src.slice(at, end);
};

// ── D. scans ─────────────────────────────────────────────────────────────────
rule('D1', 'a scanned room that is not in the account yet is never sent before the person says yes', (w) => {
  const out: string[] = [];
  const G = w.impl.scanGate;
  const typed = typedModel();
  const scan = scanModel();
  const none = { scanChoice: 'unasked' as const, accountScanRoomIds: [] as string[] };
  if (G(typed, none) !== 'send') out.push('a model of typed rooms is held back');
  if (G(scan, none) !== 'ask') out.push('a scanned room is sent without asking');
  if (G(scan, { scanChoice: 'account', accountScanRoomIds: [] }) !== 'send') out.push('after Save to My Account the model is still held');
  if (G(scan, { scanChoice: 'device', accountScanRoomIds: [] }) !== 'device') out.push('after Keep on This Phone the model is sent');
  if (G(typed, { scanChoice: 'device', accountScanRoomIds: [] }) !== 'device') out.push('Keep on This Phone does not keep the WHOLE model on the phone');
  if (G(scan, { scanChoice: 'unasked', accountScanRoomIds: ['r-scan'] }) !== 'send') out.push('a scanned room that is already in the account is asked about again');
  const two = addRoom(scan, roomFromScan(aScan('scan-2'), { id: 'r-scan-2', placement: { xM: 12, yM: 0 } }));
  if (G(two, { scanChoice: 'unasked', accountScanRoomIds: ['r-scan'] }) !== 'ask') out.push('a second scanned room is sent on the strength of the first');
  const relabelled: JobModel = { ...scan, rooms: scan.rooms.map((r) => (r.id === 'r-scan' ? { ...r, source: 'typed' as const } : r)) };
  if (G(relabelled, none) !== 'ask') out.push('a room that still names its scan is sent when its label says typed');
  if (scanRoomIds(scan).join() !== 'r-scan' || unsentScanRoomIds(two, { accountScanRoomIds: ['r-scan'] }).join() !== 'r-scan-2') out.push('the scanned rooms are not found');
  // The hook: the question is asked before the ONE call that sends.
  const hook = code(w.files[HOOK]);
  const send = /const send = useCallback\(async \(([\s\S]*?)\n {2}\}, \[/.exec(hook)?.[1] ?? '';
  const gateAt = send.indexOf('const gate = scanGate(m, meta);');
  const askAt = send.indexOf("if (gate === 'ask') { setStatus('scan_ask'); return; }");
  const deviceAt = send.indexOf("if (gate === 'device') { setStatus('kept_on_device'); return; }");
  const pushAt = send.indexOf('pushAccountModel(');
  if (gateAt < 0 || askAt < gateAt || deviceAt < gateAt || pushAt < askAt || pushAt < deviceAt) out.push('the hook does not ask before it sends');
  if (count(hook, 'pushAccountModel(') !== 1) out.push('the hook sends from more than one place');
  if (!/if \(meta\.scanChoice === 'device'\) \{ setStatus\('kept_on_device'\); return; \}/.test(hook)) out.push('after Keep on This Phone the hook still reads the account');
  const keptAt = hook.indexOf("if (meta.scanChoice === 'device') { setStatus('kept_on_device'); return; }");
  const firstNet = Math.min(...['accountSessionUserId(', 'fetchAccountHead(', 'accountQueueHolds('].map((c) => { const at = hook.indexOf(c, hook.indexOf('const pass = useCallback')); return at < 0 ? Infinity : at; }));
  if (keptAt < 0 || keptAt > firstNet) out.push('Keep on This Phone is checked after the account was already asked');
  const status = w.files[STATUS];
  const ask = panel(status, "status === 'scan_ask'");
  if (!['copy.scanAskTitleBody', 'copy.scanAskBody', "sync.answerScan('account')", "sync.answerScan('device')"].every((x) => ask.includes(x))) out.push('the question is not shown with both answers');
  const keptPanel = panel(status, "status === 'kept_on_device'");
  if (!['copy.keptOnPhoneBody', 'copy.scanAskBody', "sync.answerScan('account')"].every((x) => keptPanel.includes(x))) out.push('Keep on This Phone cannot be changed on the screen, or changes without the explanation');
  if (!/sync\.scanChoice === 'account' && hasScanRoom[^?]*\? \(\s*<Button label=\{copy\.keepOnPhoneLabel\}[^>]*onPress=\{\(\) => sync\.answerScan\('device'\)\}/.test(status)) out.push('Save to My Account cannot be changed on the screen');
  return out;
});

const MODEL_KEYS = ['links', 'projectId', 'rooms', 'stages', 'updatedAt', 'version'];
const ROOM_KEYS = ['id', 'kind', 'level', 'name', 'placement', 'room', 'scanId', 'source'];
const SHAPE_KEYS = ['ceilingHeightM', 'floor', 'objects', 'openings', 'walls'];
const WALL_KEYS = ['a', 'b', 'confidence', 'curved', 'heightM', 'id', 'label', 'lengthM', 'lengthSource', 'onOutline', 'polygon', 'scanLengthM'];
const OPENING_KEYS = ['confidence', 'heightM', 'heightSource', 'id', 'kind', 'offsetM', 'sillM', 'wallId', 'widthM', 'widthSource'];
const OBJECT_KEYS = ['category', 'center', 'confidence', 'depthM', 'heightM', 'id', 'rotationRad', 'widthM'];
const within = (o: object, allowed: string[]): string[] => Object.keys(o).filter((k) => !allowed.includes(k));

rule('D2', 'what is sent is the placed room and its sizes: no raw scan data, no scan list, nothing that is not named', (w) => {
  const out: string[] = [];
  const clean = scanModel();
  const sentClean = w.impl.modelForAccount(clean);
  if (JSON.stringify(sentClean) !== JSON.stringify(JSON.parse(JSON.stringify(clean)))) {
    // Key order may differ: compare by fingerprint, which is order-free.
    if (modelFingerprint(sentClean) !== modelFingerprint(clean)) out.push('a sound model loses something on the way to the account');
  }
  const round = JSON.parse(JSON.stringify(sentClean)) as JobModel;
  if (modelFingerprint(round) !== modelFingerprint(clean)) out.push('the model that comes back from the account is not the model that was sent');
  for (const p of POISON) if (JSON.stringify(clean).includes(p)) out.push(`the placed room itself carries scan data it should not: ${p}`);
  // Now a model something has stuffed with the rest of the scan.
  const scan = aScan('scan-1');
  const dirty = JSON.parse(JSON.stringify(clean)) as Record<string, unknown> & { rooms: Record<string, unknown>[] };
  dirty.scans = [{ scan, raw: POISON[0] }];
  dirty.raw = POISON[0];
  const r = dirty.rooms.find((x) => x.id === 'r-scan') as Record<string, unknown> & { room: Record<string, unknown> & { walls: Record<string, unknown>[]; openings: Record<string, unknown>[]; objects: Record<string, unknown>[] } };
  Object.assign(r, { raw: POISON[0], rawSha256: POISON[2], device: scan.device, capturedAt: scan.capturedAt, edits: scan.edits, tapeChecks: scan.tapeChecks, warnings: scan.warnings, scan });
  Object.assign(r.room, { raw: POISON[0], closure: scan.closure, rawSha256: POISON[2], tapeChecks: scan.tapeChecks });
  Object.assign(r.room.walls[0], { raw: POISON[0], tape: POISON[3] });
  Object.assign(r.room.openings[0], { raw: POISON[0] });
  Object.assign(r.room.objects[0], { raw: POISON[0], device: POISON[1] });
  const args = saveArgs(P, { ...(dirty as unknown as JobModel) }, 3, 'w1');
  const argsMutant = { ...args, p_model: w.impl.modelForAccount(dirty as unknown as JobModel) };
  const text = JSON.stringify(argsMutant);
  for (const p of POISON) if (text.includes(p)) out.push(`sent: ${p}`);
  if (Object.keys(args).sort().join() !== 'p_base_revision,p_model,p_project_id,p_schema_version,p_write_id') out.push(`the call sends ${Object.keys(args).sort().join()}`);
  if (args.p_base_revision !== 3 || args.p_write_id !== 'w1' || args.p_project_id !== P || args.p_schema_version !== LIVING_MODEL_SCHEMA_VERSION) out.push('the call does not carry the base revision, the write id, the project and the schema version');
  const sent = argsMutant.p_model as JobModel;
  const extra = [
    ...within(sent, MODEL_KEYS),
    ...sent.rooms.flatMap((x) => [...within(x, ROOM_KEYS), ...within(x.room, SHAPE_KEYS), ...x.room.walls.flatMap((y) => within(y, WALL_KEYS)), ...x.room.openings.flatMap((y) => within(y, OPENING_KEYS)), ...x.room.objects.flatMap((y) => within(y, OBJECT_KEYS))]),
  ];
  if (extra.length) out.push(`fields that are not named are sent: ${[...new Set(extra)].join(', ')}`);
  if (!modelHasContent(sent) || sent.rooms.length !== 2 || sent.links['r-typed']?.join() !== 'task-1') out.push('the rooms and the ticks are not sent');
  // The scan list and the raw scan are not read by anything that sends.
  for (const f of [HOOK, IO, STORE, CORE]) {
    const m = /roomScan\/store|roomScan\/rawKeep|roomScansKey|roomScanRawKey|loadProjectScans|loadSavedScans|parseSavedScans/.exec(code(w.files[f]));
    if (m) out.push(`${f} reaches the saved scans (${m[0]})`);
  }
  if (!/p_model: modelForAccount\(model\),/.test(w.files[CORE])) out.push('the call does not send the cut-down model');
  if (MAX_MODEL_CHARS * 2 > 3145728) out.push('a model the device accepts could be over the account cap');
  return out;
});

// ── E. the queue ─────────────────────────────────────────────────────────────
rule('E1', 'the one write is living_model_save through the offline queue, and nothing writes the table directly', (w) => {
  const out: string[] = [];
  const io = code(w.files[IO]);
  if (count(io, 'cloud.queue.supabaseRpcDetailed(') !== 1) out.push('the save does not go through the offline queue exactly once');
  if (!/cloud\.queue\.supabaseRpcDetailed\(\s*LIVING_MODELS_TABLE, projectId, LIVING_MODEL_SAVE_FN, saveArgs\(projectId, model, base, writeId\),\s*\{ callerOwnsRefusal: true \},\s*\)/.test(io)) out.push('the queued call is not living_model_save, keyed on the project');
  const bad = /\.(insert|update|upsert|delete)\(|supabase\.rpc\(|\.rpc\(|supabaseWriteOnline|supabaseRpcOnline|\bfetch\(/.exec(io);
  if (bad) out.push(`the server file writes around the queue (${bad[0]})`);
  if (count(io, '.from(') !== 1 || !/\.from\(LIVING_MODELS_TABLE\)\.select\(columns\)\.eq\('project_id', projectId\)\.maybeSingle\(\)/.test(io)) out.push('the server file reads something other than this job\'s row');
  if (LIVING_MODELS_TABLE !== 'living_models' || LIVING_MODEL_SAVE_FN !== 'living_model_save') out.push('the table or the function is misnamed');
  if (!/living_models: '[A-Z][A-Za-z ]+'/.test(w.files['utils/syncLedger.ts'])) out.push('a save the queue had to drop would be listed under a table name, not in words');
  const hook = code(w.files[HOOK]);
  if (!/if \(holds === null \|\| holds\.modelSave \|\| holds\.projectInsert\) \{ setStatus\('waiting'\); kickAccountQueueDrain\(\); return; \}/.test(hook)) out.push('a second save is queued behind one that is still waiting, or before the project has reached the server');
  const sendBody = /const send = useCallback\(async \(([\s\S]*?)\n {2}\}, \[/.exec(hook)?.[1] ?? '';
  if (sendBody.indexOf('await commit(sending);') < 0 || sendBody.indexOf('await commit(sending);') > sendBody.indexOf('pushAccountModel(')) out.push('the write id is not kept before the save is sent');
  if (!/const back = await fetchAccountHead\(projectId\);[\s\S]*?back\.head\.writeId === writeId/.test(sendBody)) out.push('a save is called landed without reading the row back');
  return out;
});

// ── F. the both-changed choice ───────────────────────────────────────────────
const body = (hook: string, name: string): string => new RegExp(`const ${name} = useCallback\\(\\(\\) => choose\\(async \\(\\) => \\{([\\s\\S]*?)\\n {2}\\}\\), \\[`).exec(hook)?.[1] ?? '';

rule('F1', 'when both changed nothing is replaced until he chooses, and the model he does not keep is kept first', (w) => {
  const out: string[] = [];
  const hook = code(w.files[HOOK]);
  const conflictCase = /case 'conflict': \{([\s\S]*?)\n {6}\}/.exec(hook)?.[1] ?? '';
  if (!conflictCase) out.push('the both-changed branch could not be found');
  const acts = /saveJobModel\(|send\(|pushAccountModel\(|commit\(|onAdoptRef|writeKeptModel\(|removeKeptModel\(/.exec(conflictCase);
  if (acts) out.push(`the both-changed branch acts by itself (${acts[0]})`);
  if (!/setStatus\('conflict'\)/.test(conflictCase)) out.push('the both-changed branch does not ask');
  if (!/if \(conflictRef\.current\) \{ setStatus\('conflict'\); return; \}/.test(hook)) out.push('a later run does not wait for the answer');
  const take = body(hook, 'takeAccountModel');
  const keep = body(hook, 'keepThisDevice');
  const back = body(hook, 'bringBackKept');
  const remove = body(hook, 'removeKept');
  for (const [name, b, replace] of [['Use the One in Your Account', take, 'saveJobModel('], ['Keep This Device’s Model', keep, 'commit('], ['Use the Kept Model Instead', back, 'saveJobModel(']] as const) {
    const keptAt = b.indexOf('if (!(await writeKeptModel(userId, projectId,');
    const replaceAt = b.indexOf(replace);
    if (keptAt < 0 || !/if \(!\(await writeKeptModel\(userId, projectId, [a-z]+\)\)\) return false;/.test(b)) out.push(`${name}: goes ahead when the other model could not be kept`);
    else if (replaceAt < 0 || replaceAt < keptAt) out.push(`${name}: replaces before the other model is kept`);
  }
  if (!/from: 'device', model: mine/.test(take)) out.push('Use the One in Your Account does not keep this device\'s model');
  if (!/from: 'account', model: c\.account/.test(keep)) out.push('Keep This Device’s Model does not keep the account\'s model');
  if (!/keptRef\.current\) return false;/.test(take) || !/keptRef\.current\) return false;/.test(keep)) out.push('a new choice can write over a model that is still set aside');
  if (count(hook, 'removeKeptModel(') !== 1 || !remove.includes('removeKeptModel(')) out.push('the kept model is removed somewhere other than Remove the Kept Model');
  const status = w.files[STATUS];
  if (count(status, 'sync.removeKept') !== 1 || !/<Button label=\{copy\.removeKeptLabel\}[^>]*onPress=\{sync\.removeKept\}/.test(status)) out.push('the kept model can be removed by something other than its own button');
  const question = panel(status, 'conflict && !kept');
  if (!['copy.conflictTitleBody', 'copy.conflictBody', 'onPress={sync.keepThisDevice}', 'onPress={sync.takeAccountModel}'].every((x) => question.includes(x))) out.push('the question is not shown with both answers');
  if (!/\{sync\.choiceFailed \? <Text[^>]*>\{copy\.choiceFailedBody\}<\/Text> : null\}/.test(status)) out.push('a choice that could not be carried out is not said');
  const store = code(w.files[STORE]);
  if (count(store, 'AsyncStorage.removeItem(') !== 1 || /AsyncStorage\.(clear|multiRemove)\(/.test(store)) out.push('the sync notes file removes more than the one kept model');
  return out;
});

// ── G. the keys ──────────────────────────────────────────────────────────────
rule('G1', 'the sync notes and the kept model are under the app\'s own prefix, per person and per project', (w) => {
  const out: string[] = [];
  for (const [name, fn] of [['sync notes', w.impl.livingModelSyncKey], ['kept model', w.impl.livingModelKeptKey]] as const) {
    const k = fn('user-1', 'proj-9');
    if (!k || !k.startsWith('mageid_') || !isAppStorageKey(k)) out.push(`the ${name} key ${k} is not under an app-owned prefix: the tenant sweep would miss it`);
    if (k && (!k.includes('user-1') || !k.includes('proj-9'))) out.push(`the ${name} key does not carry both the person and the project`);
    if (fn(null, 'p') !== null || fn('u', '') !== null || fn(undefined, undefined) !== null) out.push(`a ${name} key is made with no person or no project`);
    if (fn('a', 'p') === fn('b', 'p') || fn('a', 'p') === fn('a', 'q')) out.push(`two people or two projects share one ${name} key`);
  }
  const keys = [livingModelKey('u', 'p'), livingModelBackupKey('u', 'p'), w.impl.livingModelSyncKey('u', 'p'), w.impl.livingModelKeptKey('u', 'p')];
  if (new Set(keys).size !== 4) out.push('two of the four keys are the same key');
  const prefixes = [LIVING_MODEL_KEY_PREFIX, LIVING_MODEL_BACKUP_PREFIX, LIVING_MODEL_SYNC_PREFIX, LIVING_MODEL_KEPT_PREFIX];
  for (const a of prefixes) for (const b of prefixes) if (a !== b && a.startsWith(b)) out.push(`the prefix ${a} begins with ${b}: one read could take the other's keys`);
  const store = code(w.files[STORE]);
  const sets = (store.match(/AsyncStorage\.setItem\([^)]*\)/g) ?? []).sort().join(' ');
  if (sets !== 'AsyncStorage.setItem(key, JSON.stringify(kept) AsyncStorage.setItem(key, JSON.stringify(meta)') out.push(`the sync notes file writes ${sets || 'nothing'}`);
  if (!/const key = livingModelSyncKey\(userId, projectId\);/.test(store) || !/const key = livingModelKeptKey\(userId, projectId\);/.test(store)) out.push('the sync notes file makes a key of its own');
  if (/AsyncStorage/.test(code(w.files[HOOK])) || /AsyncStorage/.test(code(w.files[IO])) || /AsyncStorage/.test(code(w.files[CORE]))) out.push('storage is touched outside the two store files');
  return out;
});

// ── H. the migration, its proof, the gate, the notes ─────────────────────────
rule('H1', 'the migration: one row per project, read by the job, written only by the function, with the edit-schedule check, the stale check and the cap', (w) => {
  const out: string[] = [];
  const m = sql(w.files[MIGRATION]);
  if (!m.trim()) return ['the migration is missing'];
  const need: [string, RegExp][] = [
    ['one row per project, gone with the project', /project_id\s+uuid primary key references public\.projects\(id\) on delete cascade/],
    ['the owner id', /owner_id\s+uuid not null references auth\.users\(id\) on delete cascade/],
    ['updated_by set to NULL when that account goes', /updated_by\s+uuid references auth\.users\(id\) on delete set null/],
    ['the size cap', /check \(octet_length\(model::text\) <= 3145728\)/],
    ['the model is this project\'s', /check \(\(model ->> 'projectId'\) = project_id::text\)/],
    ['row level security', /alter table public\.living_models enable row level security;/],
    ['no client privilege but SELECT', /revoke all on public\.living_models from public, anon, authenticated;\s*grant select on public\.living_models to authenticated;/],
    ['read by everyone on the job', /create policy living_models_read on public\.living_models\s+for select to authenticated\s+using \(public\.can_access_project\(project_id\)\);/],
    ['SECURITY DEFINER with an empty search_path', /returns jsonb\s+language plpgsql\s+security definer\s+set search_path to ''/],
    ['the caller is auth.uid()', /v_uid uuid := auth\.uid\(\);/],
    ['the right to edit the schedule', /if not public\.can_access_project\(p_project_id, 'editor'\) then\s+raise exception 'living_model_save: permission denied for this project' using errcode = '42501';/],
    ['the row is locked', /from public\.living_models m where m\.project_id = p_project_id for update;/],
    ['a stale save is refused with a code', /if v_row\.revision <> p_base_revision then\s+return pg_catalog\.jsonb_build_object\('saved', false, 'code', 'stale_revision'/],
    ['a replay answers saved', /if v_row\.last_write_id = p_write_id and v_row\.updated_by is not distinct from v_uid then/],
    ['the revision goes up by one', /revision = m\.revision \+ 1,/],
    ['the time is the server\'s', /updated_at = pg_catalog\.clock_timestamp\(\),\s+updated_by = v_uid/],
    ['an older build does not write over a newer model', /if p_schema_version < v_row\.schema_version then/],
    ['anon cannot call the function', /revoke all on function public\.living_model_save\(uuid, jsonb, integer, uuid, integer\) from public, anon;\s*grant execute on function public\.living_model_save\(uuid, jsonb, integer, uuid, integer\) to authenticated;/],
    ['the self-check', /raise exception '\[living_models\] verify: row level security is off'/],
  ];
  for (const [what, re] of need) if (!re.test(m)) out.push(`missing: ${what}`);
  if (count(m, 'create policy') !== 1) out.push('there is more than one policy');
  if (/grant[^;]*\bto\b[^;]*\banon\b/.test(m)) out.push('something is granted to anon');
  if (/grant[^;]*(insert|update|delete|all)[^;]*on public\.living_models/.test(m)) out.push('a client is granted a write on the table');
  if (/security definer/.test(m) && count(m, 'security definer') !== 1) out.push('there is more than one SECURITY DEFINER function');
  const args = Object.keys(saveArgs(P, emptyJobModel(P), 0, 'w')).sort();
  for (const a of args) if (!new RegExp(`\\b${a}\\b`).test(m)) out.push(`the app sends ${a} and the function does not take it`);
  for (const col of ['revision', 'last_write_id', 'schema_version', 'updated_at', 'updated_by', 'model']) if (!new RegExp(`\\n\\s+${col}\\s`).test(m)) out.push(`the app reads ${col} and the table does not have it`);
  const header = w.files[MIGRATION].slice(0, w.files[MIGRATION].indexOf('do $pre$'));
  for (const part of ['WHY.', 'WHO WRITES.', 'WHO READS.', 'DEPLOY ORDER.', 'VERIFY AFTER', 'UNDO', 'PROOF.']) if (!header.includes(part)) out.push(`the header has no ${part}`);
  return out;
});

rule('H2', 'the proof runs the cases with planted mutations, this check is in the gate, and the notes list what changes with the camera sentence', (w) => {
  const out: string[] = [];
  const proof = w.files[PROOF];
  if (!proof.includes("const FILE = '20261011090000_living_models.sql';")) out.push('the PGlite proof does not name the migration');
  const planted = (proof.match(/^\s+case \d+: /gm) ?? []).length;
  if (planted < 15) out.push(`the PGlite proof plants ${planted} mutations`);
  for (const c of ['an accepted editor reads and saves', 'a viewer', 'a field seat', 'a stranger reads nothing and cannot save', 'anon holds nothing', 'refused with code stale_revision', 'over 3 MiB', 'deleting the project deletes its model']) if (!proof.includes(c)) out.push(`the PGlite proof has no case for: ${c}`);
  if (!w.files['scripts/pgq/README.md'].includes('living-models.mjs')) out.push('the proofs README does not list this proof');
  const pkg = JSON.parse(w.files['package.json']) as { scripts: Record<string, string> };
  if (pkg.scripts['test:living-model-sync'] !== 'bun run scripts/validate-living-model-sync.ts') out.push('package.json does not run this check');
  if (!pkg.scripts['ship-check'].split(' && ').includes('bun run test:living-model-sync')) out.push('this check is not in the ship-check chain');
  const notes = w.files[NOTES];
  if (!notes.includes('## 3. Needs the next native build and the founder\'s yes')) out.push('the notes have no "Needs the next native build and the founder\'s yes" section');
  for (const place of ['NSCameraUsageDescription', 'SCAN_ACK_COPY', 'docs/legal/privacy-policy-versus-code.md', 'docs/legal/consent-texts-for-counsel.md', 'docs/scan-the-room-native-checklist.md', 'scripts/validate-scan-room.ts', 'hooks/useScanOrderCopy.ts', 'marketing/privacy.html', 'App Store']) if (!notes.includes(place)) out.push(`the notes do not list ${place}`);
  if (!notes.includes('on your phone unless you\n> choose to save a room to your account') && !notes.includes('on your phone unless you choose to save a room to your account')) out.push('the notes do not carry the proposed camera sentence');
  // This lane did not change the permission text: it still says the measurements are kept on the phone, which is why the question is asked in the app.
  const camera = (JSON.parse(w.files['app.json']) as { expo: { ios: { infoPlist: Record<string, string> } } }).expo.ios.infoPlist.NSCameraUsageDescription ?? '';
  if (!camera.includes("keeps the room's measurements (its walls, doors, windows and fixtures, and their sizes) on your phone;")) out.push('app.json no longer carries the sentence the notes are written against: read docs/living-model-sync-notes.md section 3 and change them together');
  return out;
});

// ── planted mutations ────────────────────────────────────────────────────────
interface Mutation { rule: string; name: string; plant: (w: World) => World }
const edit = (file: string, from: string | RegExp, to: string) => (w: World): World => {
  const s = w.files[file];
  if (s === undefined) throw new Error(`mutation file not found: ${file}`);
  const next = s.replace(from as string, to);
  if (next === s) throw new Error(`mutation anchor not found in ${file}: ${String(from)}`);
  return { ...w, files: { ...w.files, [file]: next } };
};
const swap = (over: Partial<Impl>) => (w: World): World => ({ ...w, impl: { ...w.impl, ...over } });
const en = (key: string, value: unknown) => (w: World): World => {
  if (!(`${K}${key}` in w.EN)) throw new Error(`mutation key not found: ${key}`);
  return { ...w, EN: { ...w.EN, [`${K}${key}`]: value } };
};
const es = (key: string) => (w: World): World => {
  if (!(`${K}${key}` in w.ES)) throw new Error(`mutation key not found: ${key}`);
  const next = { ...w.ES };
  delete next[`${K}${key}`];
  return { ...w, ES: next };
};
const onConflict = (pick: (i: ReconcileInput) => ReconcileAction) => swap({ reconcile: (i) => { const a = reconcile(i); return a.kind === 'conflict' ? pick(i) : a; } });

const MUTATIONS: Mutation[] = [
  { rule: 'A1', name: 'both changed: this device wins', plant: onConflict((i) => ({ kind: 'push', base: i.server?.revision ?? 0 })) },
  { rule: 'A1', name: 'both changed: the account wins', plant: onConflict(() => ({ kind: 'take_server' })) },
  { rule: 'A1', name: 'both changed: the higher revision wins', plant: onConflict((i) => ((i.server?.revision ?? 0) > i.meta.baseRevision ? { kind: 'take_server' } : { kind: 'push', base: i.server?.revision ?? 0 })) },
  { rule: 'A1', name: 'an empty device sends an empty model to an account with none', plant: swap({ reconcile: (i) => (i.server === null ? { kind: 'push', base: 0 } : reconcile(i)) }) },
  { rule: 'A1', name: 'a model from a newer build is taken', plant: swap({ reconcile: (i) => { const a = reconcile(i); return a.kind === 'account_unreadable' ? { kind: 'take_server' } : a; } }) },
  { rule: 'A1', name: 'the pending save is not recognised as landed', plant: swap({ reconcile: (i) => reconcile({ ...i, meta: { ...i.meta, pending: null } }) }) },
  { rule: 'A2', name: 'both changed: this device wins (sweep)', plant: onConflict((i) => ({ kind: 'push', base: i.server?.revision ?? 0 })) },
  { rule: 'A2', name: 'both changed: the account wins (sweep)', plant: onConflict(() => ({ kind: 'take_server' })) },
  { rule: 'A2', name: 'decided without the account model', plant: swap({ reconcile: (i) => { const a = reconcile(i); return a.kind === 'need_model' ? { kind: 'push', base: i.server?.revision ?? 0 } : a; } }) },
  { rule: 'A2', name: 'the queue is ignored', plant: swap({ reconcile: (i) => reconcile({ ...i, pendingQueued: false }) }) },
  { rule: 'A2', name: 'a changed device sends on whatever revision the account has', plant: swap({ reconcile: (i) => { const a = reconcile(i); return a.kind === 'need_model' || a.kind === 'conflict' ? { kind: 'push', base: i.server?.revision ?? 0 } : a; } }) },
  { rule: 'A2', name: 'the account is always taken when it is ahead', plant: swap({ reconcile: (i) => (i.server && i.server.revision > i.meta.baseRevision && !(i.meta.pending && i.pendingQueued) ? { kind: 'take_server' } : reconcile(i)) }) },
  { rule: 'A3', name: 'a model that was never sent is not a change', plant: swap({ deviceChanged: (m, l) => (m.baseRevision === 0 ? false : deviceChanged(m, l)) }) },
  { rule: 'A3', name: 'notes with a revision and no fingerprint are trusted', plant: swap({ parseSyncMeta: (raw) => { const m = parseSyncMeta(raw); try { const v = JSON.parse(raw ?? '{}') as { baseRevision?: number }; return typeof v.baseRevision === 'number' && v.baseRevision > 0 ? { ...m, baseRevision: v.baseRevision } : m; } catch { return m; } } }) },
  { rule: 'B1', name: 'a missing table is an error like any other', plant: swap({ isMissingTable: () => false }) },
  { rule: 'B1', name: 'every error is "missing"', plant: swap({ isMissingTable: (e) => !!e }) },
  { rule: 'B2', name: 'a missing table is shown as a failure', plant: edit(HOOK, "if (first.kind === 'missing') { setStatus('device'); return; }", "if (first.kind === 'missing') { setStatus('failed'); return; }") },
  { rule: 'B2', name: 'a save is queued before the table was ever seen', plant: edit(HOOK, "      if (!meta.accountSeen) { setStatus('device'); return; }\n", '') },
  { rule: 'B2', name: 'the read treats a missing table as an error', plant: edit(IO, "      if (isMissingTable(res.error)) return { kind: 'missing' };\n", '') },
  { rule: 'C1', name: 'the saved line promises more', plant: en('sync.savedBody', 'Synced to the cloud.') },
  { rule: 'C1', name: 'the scan question drops "No photo or video is sent."', plant: en('sync.scanAskBody', 'Saving it to your account sends that room’s sizes to MAGE ID’s servers.') },
  { rule: 'C1', name: 'the waiting line changes', plant: en('sync.waitingBody', 'Saving.') },
  { rule: 'C1', name: 'a sentence has no Spanish', plant: es('sync.scanAskBody') },
  { rule: 'C1', name: 'the web scan sheet says scans will appear', plant: en('scan.noneWebBody', 'Your scans will appear here soon.') },
  { rule: 'C2', name: 'a failed save is shown as waiting', plant: edit(STATUS, "{status === 'failed' ? <Text style={styles.warn} testID=\"lm-sync-failed\">{copy.syncFailedBody}</Text> : null}", "{status === 'failed' ? <Text style={styles.warn} testID=\"lm-sync-failed\">{copy.syncWaitingBody}</Text> : null}") },
  { rule: 'C2', name: 'a queued save is shown as saved', plant: edit(HOOK, "if (outcome === 'queued') { setStatus('waiting'); return; }", "if (outcome === 'queued') { setStatus('saved'); return; }") },
  { rule: 'C2', name: 'the saved line is shown while waiting', plant: edit(STATUS, "{status === 'waiting' ? <Text style={styles.note} testID=\"lm-sync-waiting\">{copy.syncWaitingBody}</Text> : null}", "{status === 'waiting' ? <Text style={styles.note} testID=\"lm-sync-waiting\">{copy.savedAccountBody}</Text> : null}") },
  { rule: 'C2', name: 'an unsent change still reads saved', plant: edit(HOOK, 'return { status: shown, savedAt,', 'return { status, savedAt,') },
  { rule: 'C2', name: 'the screen drops the status line', plant: edit(SCREEN, '<SyncStatus sync={sync} deviceRooms', '<NoStatus sync={sync} deviceRooms') },
  { rule: 'C2', name: 'the web scan sheet keeps the phone sentence', plant: edit(EDITOR, "Platform.OS === 'web' ? copy.noScansWebBody : copy.noScansBody", 'copy.noScansBody') },
  { rule: 'D1', name: 'the gate always sends', plant: swap({ scanGate: () => 'send' }) },
  { rule: 'D1', name: 'Keep on This Phone only holds scanned rooms', plant: swap({ scanGate: (m, meta) => (scanRoomIds(m).length === 0 ? 'send' : scanGate(m, meta)) }) },
  { rule: 'D1', name: 'one yes-in-the-account covers every scanned room', plant: swap({ scanGate: (m, meta) => (meta.accountScanRoomIds.length > 0 && meta.scanChoice === 'unasked' ? 'send' : scanGate(m, meta)) }) },
  { rule: 'D1', name: 'the hook sends without asking', plant: edit(HOOK, "    if (gate === 'ask') { setStatus('scan_ask'); return; }\n", '') },
  { rule: 'D1', name: 'the hook sends after Keep on This Phone', plant: edit(HOOK, "    if (gate === 'device') { setStatus('kept_on_device'); return; }\n", '') },
  { rule: 'D1', name: 'the question has one answer', plant: edit(STATUS, "          <Button label={copy.keepOnPhoneLabel} variant=\"secondary\" onPress={() => sync.answerScan('device')} testID=\"lm-scan-ask-device\" />\n", '') },
  { rule: 'D1', name: 'the answer cannot be changed back', plant: edit(STATUS, "sync.scanChoice === 'account' && hasScanRoom", 'false && hasScanRoom') },
  { rule: 'D2', name: 'the whole model object is sent as it is', plant: swap({ modelForAccount: (m) => m }) },
  { rule: 'D2', name: 'the walls are sent as they are', plant: swap({ modelForAccount: (m) => { const sent = modelForAccount(m); return { ...sent, rooms: sent.rooms.map((r, i) => ({ ...r, room: { ...r.room, walls: m.rooms[i].room.walls } })) }; } }) },
  { rule: 'D2', name: 'the hook reads the scan list', plant: edit(HOOK, "import { saveJobModel } from '@/utils/livingModel/store';", "import { loadProjectScans, saveJobModel } from '@/utils/livingModel/store';\nexport const scans = loadProjectScans;") },
  { rule: 'D2', name: 'the call sends the model uncut', plant: edit(CORE, 'p_model: modelForAccount(model),', 'p_model: model,') },
  { rule: 'E1', name: 'the save goes straight to the server', plant: edit(IO, 'return await cloud.queue.supabaseRpcDetailed(', 'return await (cloud.sb.supabase.rpc as never as typeof cloud.queue.supabaseRpcDetailed)(') },
  { rule: 'E1', name: 'the table is upserted directly', plant: edit(IO, "export interface QueueHolds {", "export const direct = (sb: SupabaseModule, row: Record<string, unknown>) => sb.supabase.from(LIVING_MODELS_TABLE).upsert(row);\nexport interface QueueHolds {") },
  { rule: 'E1', name: 'a second save is queued behind the first', plant: edit(HOOK, 'if (holds === null || holds.modelSave || holds.projectInsert) {', 'if (holds === null) {') },
  { rule: 'E1', name: 'a save is called landed without reading the row', plant: edit(HOOK, "if (back.kind === 'row' && back.head.writeId === writeId) {", "if (back.kind === 'row') {") },
  { rule: 'F1', name: 'the both-changed branch takes the account by itself', plant: edit(HOOK, "        setStatus('conflict');\n        return;\n      }\n      case 'account_unreadable':", "        onAdoptRef.current(accountModel);\n        setStatus('conflict');\n        return;\n      }\n      case 'account_unreadable':") },
  { rule: 'F1', name: 'Use the One in Your Account does not keep this device\'s model first', plant: edit(HOOK, "    const k: KeptModel = { from: 'device', model: mine, keptAt: new Date().toISOString() };\n    if (!(await writeKeptModel(userId, projectId, k))) return false;\n", "    const k: KeptModel = { from: 'device', model: mine, keptAt: new Date().toISOString() };\n") },
  { rule: 'F1', name: 'Keep This Device\'s Model goes ahead when the account copy could not be kept', plant: edit(HOOK, "    const k: KeptModel = { from: 'account', model: c.account, keptAt: new Date().toISOString() };\n    if (!(await writeKeptModel(userId, projectId, k))) return false;\n", "    const k: KeptModel = { from: 'account', model: c.account, keptAt: new Date().toISOString() };\n    await writeKeptModel(userId, projectId, k);\n") },
  { rule: 'F1', name: 'a new choice writes over a model still set aside', plant: edit(HOOK, 'if (!c || !meta || !mine || keptRef.current) return false;', 'if (!c || !meta || !mine) return false;') },
  { rule: 'F1', name: 'the kept model is removed after a choice', plant: edit(HOOK, "    conflictRef.current = null;\n    setConflict(null);\n    onAdoptRef.current(c.account);", "    conflictRef.current = null;\n    setConflict(null);\n    void removeKeptModel(userId, projectId);\n    onAdoptRef.current(c.account);") },
  { rule: 'F1', name: 'the question offers one model only', plant: edit(STATUS, "          <Button label={copy.keepDeviceLabel} variant=\"secondary\" onPress={sync.keepThisDevice} disabled={sync.busy} testID=\"lm-conflict-keep-device\" />\n", '') },
  { rule: 'F1', name: 'a later run does not wait for the answer', plant: edit(HOOK, "    if (conflictRef.current) { setStatus('conflict'); return; }\n", '') },
  { rule: 'G1', name: 'one sync-notes key for every person', plant: swap({ livingModelSyncKey: (u, p) => (u && p ? `mageid_living_model_sync::${p}` : null) }) },
  { rule: 'G1', name: 'the kept model under a prefix the sweep does not own', plant: swap({ livingModelKeptKey: (u, p) => (u && p ? `living_model_kept::${u}::${p}` : null) }) },
  { rule: 'G1', name: 'a kept-model key with no person', plant: swap({ livingModelKeptKey: (u, p) => `mageid_living_model_kept::${u ?? 'anon'}::${p ?? 'none'}` }) },
  { rule: 'G1', name: 'the notes file writes a key of its own', plant: edit(STORE, '    await AsyncStorage.setItem(key, JSON.stringify(meta));', "    await AsyncStorage.setItem('living_model_last', JSON.stringify(meta));\n    await AsyncStorage.setItem(key, JSON.stringify(meta));") },
  { rule: 'H1', name: 'the read policy is open', plant: edit(MIGRATION, 'using (public.can_access_project(project_id));', 'using (true);') },
  { rule: 'H1', name: 'any seat may save', plant: edit(MIGRATION, "if not public.can_access_project(p_project_id, 'editor') then", 'if not public.can_access_project(p_project_id) then') },
  { rule: 'H1', name: 'the stale check is gone', plant: edit(MIGRATION, 'if v_row.revision <> p_base_revision then', 'if false then') },
  { rule: 'H1', name: 'the cap is gone', plant: edit(MIGRATION, "  constraint living_models_model_size_check   check (octet_length(model::text) <= 3145728),\n", '') },
  { rule: 'H1', name: 'clients may write the table', plant: edit(MIGRATION, 'grant select on public.living_models to authenticated;', 'grant select, insert, update on public.living_models to authenticated;') },
  { rule: 'H1', name: 'anon may call the function', plant: edit(MIGRATION, 'revoke all on function public.living_model_save(uuid, jsonb, integer, uuid, integer) from public, anon;\n', '') },
  { rule: 'H1', name: 'the search path is public', plant: edit(MIGRATION, "security definer\nset search_path to ''", 'security definer\nset search_path to public') },
  { rule: 'H1', name: 'the project foreign key does not cascade', plant: edit(MIGRATION, 'uuid primary key references public.projects(id) on delete cascade,', 'uuid primary key references public.projects(id),') },
  { rule: 'H1', name: 'the time comes from the caller', plant: edit(MIGRATION, "         updated_at = pg_catalog.clock_timestamp(),\n         updated_by = v_uid", "         updated_at = (p_model ->> 'updatedAt')::timestamptz,\n         updated_by = v_uid") },
  { rule: 'H2', name: 'this check leaves the gate', plant: edit('package.json', ' && bun run test:living-model-sync', '') },
  { rule: 'H2', name: 'the notes lose the native-build section', plant: edit(NOTES, "## 3. Needs the next native build and the founder's yes", '## 3. Later') },
  { rule: 'H2', name: 'the camera sentence changes without the notes', plant: edit('app.json', 'and their sizes) on your phone;', 'and their sizes) on your phone or in your account;') },
  { rule: 'H2', name: 'the proof names another file', plant: edit(PROOF, "const FILE = '20261011090000_living_models.sql';", "const FILE = 'x.sql';") },
];

// ── run ──────────────────────────────────────────────────────────────────────
console.log('validate-living-model-sync: the Living Model saved to the account\n');
let pass = 0;
let fail = 0;
for (const r of RULES) {
  let problems: string[];
  try { problems = r.run(WORLD); } catch (e) { problems = [`threw: ${e instanceof Error ? e.message : String(e)}`]; }
  if (problems.length === 0) { pass += 1; console.log(`  ✓ ${r.id}  ${r.what}`); }
  else { fail += 1; console.log(`  ✗ ${r.id}  ${r.what}`); for (const p of problems.slice(0, 12)) console.log(`        ${p}`); }
}

console.log('\n── planted mutations (each must turn its own rule red)');
const caught = new Set<string>();
for (const m of MUTATIONS) {
  const r = RULES.find((x) => x.id === m.rule);
  let red = false;
  let how = '';
  try {
    const w = m.plant(WORLD);
    let problems: string[];
    try { problems = r ? r.run(w) : []; } catch (e) { problems = [`threw: ${e instanceof Error ? e.message : String(e)}`]; }
    red = problems.length > 0;
    how = red ? '' : 'the rule stayed green';
  } catch (e) {
    how = `mutation could not be planted: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (red) { pass += 1; caught.add(m.rule); } else { fail += 1; console.log(`  ✗ ${m.rule}  NOT CAUGHT: ${m.name} (${how})`); }
}
console.log(`  ${caught.size} of ${RULES.length} rules caught a planted mutation`);
const unproven = RULES.filter((r) => !caught.has(r.id)).map((r) => r.id);
if (unproven.length === 0) { pass += 1; console.log('  ✓ every rule has at least one planted mutation that it catches'); }
else { fail += 1; console.log(`  ✗ rules with no caught mutation: ${unproven.join(', ')}`); }

console.log(`\n${fail === 0 ? '✓' : '✗'} validate-living-model-sync: ${pass} checks (${MUTATIONS.length} planted mutations), ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

// scripts/validate-living-model-sync.ts — the Living Model saved to the account
// (lane LIVINGSYNC). Run: bun run test:living-model-sync
//
// WHAT THIS HOLDS
//   A  the decision (syncCore.reconcile): a table of named cases built from the
//      INTENDED rules (the header of syncCore.ts), and a sweep of every
//      combination. The rules that matter most: when the device and the
//      account have BOTH changed the answer is `conflict`, never a pick; and a
//      device with NOTHING on it never sends over an account copy that has
//      something (Start a New Model, a lost model key, an emptied model).
//   B  a database without the table means device-only, quietly, nothing queued.
//   C  the sentences the screen says, word for word, and which state says which.
//   D  scans: a scanned room is never sent before the person says yes, and
//      nothing of a scan but the placed room's sizes is in what is sent.
//   E  the one write goes through the offline queue; nothing else writes.
//   F  a both-changed choice keeps the other model BEFORE anything is replaced.
//   G  the keys are the app's own, per person and per project.
//   H  the migration's text, its proof, and this check's place in the gate.
//   I  the promises around the sends: Keep on This Phone takes a waiting save
//      back, the account copy can be removed (only by a confirmed tap), the
//      kept model survives a kill in the middle of a trade, a teammate's save
//      is not taken without a backup, and the status line never lies.
//   J  the yes to the scan question is recorded (kind, version, hash, archive).
//
// Every rule has at least one PLANTED MUTATION: the rule is run again on a copy
// of the world with one guard removed and must go red. A rule that stays green
// with its guard removed proves nothing, so that fails the run.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EN as EN_SHARD } from '../i18n/catalog/en/office.living-model.generated';
import { ES_OFFICE_LIVING_MODEL } from '../i18n/catalog/es/office/livingModel';
import { createHash } from 'node:crypto';
import { MAX_ROOMS, addRoom, emptyJobModel, makeRectRoom, roomFromScan, setRoomTaskLink } from '../utils/livingModel/modelCore';
import { SCAN_UPLOAD_COPY, SCAN_UPLOAD_TEXT_SHA256, SCAN_UPLOAD_TEXT_SHA256_ES, SCAN_UPLOAD_VERSION, legalNoticeText, scanRoomUploadItem } from '../utils/legalAcceptanceCore';
import {
  LIVING_MODEL_BACKUP_PREFIX, LIVING_MODEL_KEPT_PREFIX, LIVING_MODEL_KEY_PREFIX, LIVING_MODEL_SWAP_PREFIX, LIVING_MODEL_SYNC_PREFIX, MAX_MODEL_CHARS,
  livingModelBackupKey, livingModelKeptKey, livingModelKey, livingModelSwapKey, livingModelSyncKey,
} from '../utils/livingModel/storeCore';
import {
  ACCOUNT_LIMITS, EMPTY_SYNC_META, LIVING_MODELS_TABLE, LIVING_MODEL_REMOVE_FN, LIVING_MODEL_SAVE_FN, LIVING_MODEL_SCHEMA_VERSION,
  accountMayHoldCopy, accountModelRefusal, accountValueTooLarge, deviceChanged, hasSyncHistory, isMissingTable, isThisDevice,
  metaAfterKeepDevice, metaAfterMatch, metaAfterRemoval, metaAfterScanNo, metaAfterScanYes, metaAfterSend, modelFingerprint, modelForAccount,
  modelHasContent, parseServerHead, parseSyncMeta, reconcile, removeArgs, resetSyncBase, saveArgs, savedBySomeoneElse,
  scanGate, scanRoomIds, settleLandedPending, swapRecovery, unaskedScanRoomIds, unsentScanRoomIds,
  type ModelSyncMeta, type ReconcileAction, type ReconcileInput, type ReconcileServer,
} from '../utils/livingModel/syncCore';
import type { JobModel } from '../utils/livingModel/types';
import { isAppStorageKey } from '../utils/localCacheKeys';
import type { RoomScan } from '../utils/roomScan/types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

const MIGRATION = 'supabase/migrations/20261011090000_living_models.sql';
const KIND_MIGRATION = 'supabase/migrations/20261011091000_legal_acceptance_scan_room_upload.sql';
const KIND_PROOF = 'scripts/pgq/legal-acceptance-scan-room-upload.mjs';
const QUEUE = 'utils/offlineQueue.ts';
const LEGAL = 'utils/legalAcceptance.ts';
const ARCHIVE = 'scripts/archive-legal-text.ts';
const COUNSEL = 'docs/legal/consent-texts-for-counsel.md';
const ARCHIVE_EN = `docs/legal/versions/scan_room_upload-en-${SCAN_UPLOAD_VERSION}-${SCAN_UPLOAD_TEXT_SHA256.slice(0, 8)}.txt`;
const ARCHIVE_ES = `docs/legal/versions/scan_room_upload-es-${SCAN_UPLOAD_VERSION}-${SCAN_UPLOAD_TEXT_SHA256_ES.slice(0, 8)}.txt`;
const PROOF = 'scripts/pgq/living-models.mjs';
const HOOK = 'hooks/useLivingModelSync.ts';
const IO = 'utils/livingModel/syncIo.ts';
const STORE = 'utils/livingModel/syncStore.ts';
const CORE = 'utils/livingModel/syncCore.ts';
const STATUS = 'components/livingModel/SyncStatus.tsx';
const SCREEN = 'components/livingModel/LivingModelScreen.tsx';
const EDITOR = 'components/livingModel/RoomEditor.tsx';
const NOTES = 'docs/living-model-sync-notes.md';
const FILES = [MIGRATION, KIND_MIGRATION, KIND_PROOF, QUEUE, LEGAL, ARCHIVE, COUNSEL, ARCHIVE_EN, ARCHIVE_ES, PROOF, HOOK, IO, STORE, CORE, STATUS, SCREEN, EDITOR, NOTES, 'utils/livingModel/store.ts', 'utils/livingModel/storeCore.ts', 'app.json', 'package.json', '.github/workflows/ship-gate.yml', 'scripts/pgq/README.md', 'utils/syncLedger.ts'];

const impl = { reconcile, deviceChanged, isMissingTable, scanGate, modelForAccount, parseSyncMeta, livingModelSyncKey, livingModelKeptKey, livingModelSwapKey, resetSyncBase, settleLandedPending, accountModelRefusal, accountValueTooLarge, swapRecovery, accountMayHoldCopy, metaAfterScanYes, metaAfterRemoval };
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
const meta = (over: Partial<ModelSyncMeta> = {}): ModelSyncMeta => ({ ...EMPTY_SYNC_META, ownWriteIds: [], accountScanRoomIds: [], scanConsentRoomIds: [], ...over });
const synced = (rev: number, fp: string, over: Partial<ModelSyncMeta> = {}): ModelSyncMeta => meta({ accountSeen: true, baseRevision: rev, baseFingerprint: fp, ...over });
const pend = (writeId: string, base: number, fingerprint = 'B') => ({ writeId, base, fingerprint, scanRoomIds: [] as string[] });
/** An account row. The fingerprint 'E' stands for an EMPTY model (no room, tick or stage); any other string is a model with content. */
const srv = (revision: number, fingerprint?: string | null, writeId: string | null = 'w-other', schemaVersion = 1, extra: Partial<ReconcileServer> = {}): ReconcileServer =>
  ({ revision, writeId, schemaVersion, fingerprint, ...(typeof fingerprint === 'string' ? { hasContent: fingerprint !== 'E' } : {}), ...extra });
/** The notes after Start a New Model, and after the model key went missing, on a device that had matched revision 2. */
let resetNotes: typeof resetSyncBase = resetSyncBase;
const startedNew = (): ModelSyncMeta => resetNotes(synced(2, 'A'), { startedNew: true });
const keyLost = (): ModelSyncMeta => resetNotes(synced(2, 'A'), { startedNew: false });
/** The row remembers this device's save w1 as landed at `r`. */
const remembers = (r: number): Partial<ReconcileServer> => ({ recentWrites: [{ writeId: 'w1', revision: r }, { writeId: 'w9', revision: r + 1 }] });
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
const E = loc('E', false);
// THE INTENDED RULES, one named case each (the order of the header of utils/livingModel/syncCore.ts).
const casesFor = (reset: typeof resetSyncBase): Case[] => { resetNotes = reset; const table: Case[] = [
  // nothing on either side, and first saves
  ['neither side has a model', { local: E, meta: meta(), server: null, pendingQueued: false }, 'nothing'],
  ['no account row, a model on the device that was never sent', { local: loc('A'), meta: meta({ accountSeen: true }), server: null, pendingQueued: false }, 'push', 0],
  // the account copy was removed
  ['the account copy this device matched is gone (removed): nothing is sent', { local: loc('A'), meta: synced(3, 'A'), server: null, pendingQueued: false }, 'account_gone'],
  ['the account copy is gone and this device changed since: still nothing is sent', { local: loc('B'), meta: synced(3, 'A'), server: null, pendingQueued: false }, 'account_gone'],
  ['the account copy is gone and this device is empty', { local: E, meta: synced(3, 'A'), server: null, pendingQueued: false }, 'nothing'],
  // the ordinary rules
  ['same revision, nothing changed here', { local: loc('A'), meta: synced(2, 'A'), server: srv(2), pendingQueued: false }, 'in_sync'],
  ['the account is ahead and this device has no changes', { local: loc('A'), meta: synced(2, 'A'), server: srv(5), pendingQueued: false }, 'take_server'],
  ['this device changed and the account is where it was', { local: loc('B'), meta: synced(2, 'A'), server: srv(2), pendingQueued: false }, 'push', 2],
  // AN EMPTY DEVICE NEVER SENDS OVER AN ACCOUNT COPY THAT HAS CONTENT
  ['empty local with account content, never matched, the account model not fetched yet', { local: E, meta: meta(), server: srv(2), pendingQueued: false }, 'need_model'],
  ['empty local with account content, never matched: the account copy is taken', { local: E, meta: meta(), server: srv(2, 'A'), pendingQueued: false }, 'take_server'],
  ['this device emptied the model, the account is where it was, not fetched yet', { local: E, meta: synced(2, 'A'), server: srv(2), pendingQueued: false }, 'need_model'],
  ['this device emptied the model and the account copy has rooms: he is asked, nothing is sent', { local: E, meta: synced(2, 'A'), server: srv(2, 'A'), pendingQueued: false }, 'conflict'],
  ['this device emptied the model and the account moved on: he is asked', { local: E, meta: synced(2, 'A'), server: srv(5, 'C'), pendingQueued: false }, 'conflict'],
  ['STARTED NEW on a device that had matched the account, not fetched yet', { local: E, meta: startedNew(), server: srv(2), pendingQueued: false }, 'need_model'],
  ['STARTED NEW with an account copy: he is asked, with the account copy as one side', { local: E, meta: startedNew(), server: srv(2, 'A'), pendingQueued: false }, 'conflict'],
  ['STARTED NEW, then drew a room, with an account copy: he is asked', { local: loc('B'), meta: startedNew(), server: srv(2, 'A'), pendingQueued: false }, 'conflict'],
  ['STARTED NEW and the account copy is itself empty', { local: E, meta: startedNew(), server: srv(2, 'E'), pendingQueued: false }, 'take_server'],
  ['STARTED NEW and the account has no copy', { local: E, meta: startedNew(), server: null, pendingQueued: false }, 'nothing'],
  ['MODEL KEY LOST while the sync notes survive: the account copy is taken, not flattened', { local: E, meta: keyLost(), server: srv(2, 'A'), pendingQueued: false }, 'take_server'],
  ['MODEL KEY LOST and the account has moved on since', { local: E, meta: keyLost(), server: srv(5, 'C'), pendingQueued: false }, 'take_server'],
  ['his own answer (Keep This Device’s Model, empty) over THIS revision is sent', { local: E, meta: synced(2, 'A', { chosenOver: 2 }), server: srv(2), pendingQueued: false }, 'push', 2],
  ['his answer was over revision 2 and the account is at 3 now: asked again', { local: E, meta: synced(2, 'A', { chosenOver: 2 }), server: srv(3, 'C'), pendingQueued: false }, 'conflict'],
  ['both models are empty', { local: E, meta: synced(2, 'E'), server: srv(2, 'E'), pendingQueued: false }, 'in_sync'],
  // both changed
  ['BOTH changed, the account model not fetched yet', { local: loc('B'), meta: synced(2, 'A'), server: srv(5), pendingQueued: false }, 'need_model'],
  ['BOTH changed, to different models', { local: loc('B'), meta: synced(2, 'A'), server: srv(5, 'C'), pendingQueued: false }, 'conflict'],
  ['BOTH changed, to the same model', { local: loc('B'), meta: synced(2, 'A'), server: srv(5, 'B'), pendingQueued: false }, 'in_sync'],
  ['two models made apart (never matched), different', { local: loc('B'), meta: meta(), server: srv(1, 'C'), pendingQueued: false }, 'conflict'],
  ['two models made apart, the account one not fetched yet', { local: loc('B'), meta: meta(), server: srv(1), pendingQueued: false }, 'need_model'],
  ['two models made apart that are the same model', { local: loc('B'), meta: meta(), server: srv(1, 'B'), pendingQueued: false }, 'in_sync'],
  // a save of this device's on its way
  ['a save of this device is still queued', { local: loc('B'), meta: synced(2, 'A', { pending: pend('w1', 2) }), server: srv(5, 'C'), pendingQueued: true }, 'wait'],
  ['the pending save is the account row', { local: loc('B'), meta: synced(2, 'A', { pending: pend('w1', 2) }), server: srv(3, undefined, 'w1'), pendingQueued: false }, 'landed'],
  ['the pending save was refused as stale: someone else saved, and the row does not remember this save', { local: loc('B'), meta: synced(2, 'A', { pending: pend('w1', 2) }), server: srv(3, 'C', 'w9'), pendingQueued: false }, 'conflict'],
  ['the pending save never landed and the account is where it was', { local: loc('B'), meta: synced(2, 'A', { pending: pend('w1', 2) }), server: srv(2, undefined, 'w0'), pendingQueued: false }, 'push', 2],
  ['PENDING LANDED at 3, THEN A TEAMMATE SAVED at 4: the account is ahead, not "both changed"', { local: loc('B'), meta: synced(2, 'A', { pending: pend('w1', 2) }), server: srv(4, undefined, 'w9', 1, remembers(3)), pendingQueued: false }, 'take_server'],
  ['pending landed, a teammate saved on top, the account model fetched: still account ahead', { local: loc('B'), meta: synced(2, 'A', { pending: pend('w1', 2) }), server: srv(4, 'C', 'w9', 1, remembers(3)), pendingQueued: false }, 'take_server'],
  ['pending landed, a teammate saved on top, AND this device changed again: he is asked', { local: loc('D'), meta: synced(2, 'A', { pending: pend('w1', 2) }), server: srv(4, 'C', 'w9', 1, remembers(3)), pendingQueued: false }, 'conflict'],
  ['the row names this save at a revision that is not above its base: not believed', { local: loc('B'), meta: synced(2, 'A', { pending: pend('w1', 2) }), server: srv(4, 'C', 'w9', 1, remembers(2)), pendingQueued: false }, 'conflict'],
  // a teammate's save
  ['A TEAMMATE EMPTIED THE MODEL and this device has no changes: taken (the hook keeps this device’s copy first, rule I4)', { local: loc('A'), meta: synced(2, 'A'), server: srv(5, 'E', 'w9'), pendingQueued: false }, 'take_server'],
  ['a teammate emptied the model and this device changed: he is asked', { local: loc('B'), meta: synced(2, 'A'), server: srv(5, 'E', 'w9'), pendingQueued: false }, 'conflict'],
  // account copies this build will not open
  ['the account model is from a newer build (schema)', { local: loc('A'), meta: synced(2, 'A'), server: srv(5, undefined, 'w9', LIVING_MODEL_SCHEMA_VERSION + 1), pendingQueued: false }, 'account_unreadable'],
  ['the account model cannot be read by this build', { local: loc('B'), meta: synced(2, 'A'), server: srv(5, null), pendingQueued: false }, 'account_unreadable'],
  ['the account model is larger than the app allows, nothing changed here: refused, not taken', { local: loc('A'), meta: synced(2, 'A'), server: srv(5, 'C', 'w9', 1, { outOfBounds: true }), pendingQueued: false }, 'account_refused'],
  ['the account model is larger than the app allows and this device changed: refused, not offered', { local: loc('B'), meta: synced(2, 'A'), server: srv(5, 'C', 'w9', 1, { outOfBounds: true }), pendingQueued: false }, 'account_refused'],
  // the row was made again
  ['the account row was made again (a lower revision), nothing changed here', { local: loc('A'), meta: synced(4, 'A'), server: srv(1, 'C'), pendingQueued: false }, 'take_server'],
  ['the account row was made again, and this device changed', { local: loc('B'), meta: synced(4, 'A'), server: srv(1, 'C'), pendingQueued: false }, 'conflict'],
]; resetNotes = resetSyncBase; return table; };

rule('A1', 'reconcile answers every named case, and both-changed is always the question', (w) => {
  const out: string[] = [];
  // Start a New Model and a lost model key reach the decision through resetSyncBase: the cases are built with it.
  for (const [name, input, want, base] of casesFor(w.impl.resetSyncBase)) {
    const got = w.impl.reconcile(input);
    if (got.kind !== want) out.push(`${name}: ${got.kind}, want ${want}`);
    else if (got.kind === 'push' && got.base !== base) out.push(`${name}: push based on ${got.base}, want ${base}`);
  }
  return out;
});

rule('A2', 'over every combination: never a send on a stale base, never a send from an empty device over account content, never a take over changes made here, never a silent pick', (w) => {
  const out: string[] = [];
  let n = 0;
  const metas: ModelSyncMeta[] = [meta(), synced(2, 'A'), startedNew(), keyLost(), synced(2, 'A', { chosenOver: 2 })];
  const servers: ReconcileInput['server'][] = [null];
  for (const r of [1, 2, 3, 4]) for (const fp of ['A', 'B', 'C', 'E', undefined, null]) for (const wid of ['w1', 'w9']) for (const sv of [1, 2]) {
    servers.push(srv(r, fp, wid, sv));
    if (wid === 'w9' && sv === 1 && r >= 2) servers.push(srv(r, fp, wid, sv, { recentWrites: [{ writeId: 'w1', revision: r - 1 }] }));
    if (typeof fp === 'string' && sv === 1) servers.push(srv(r, fp, wid, sv, { outOfBounds: true }));
  }
  const say = (x: string[], tag: string, what: string): void => { if (x.length < 40) x.push(`${tag}: ${what}`); };
  for (const m0 of metas) for (const pending of [null, pend('w1', m0.baseRevision)]) for (const queued of [false, true]) {
    for (const l of [loc('A'), loc('B'), E]) for (const server of servers) {
      const m = { ...m0, pending };
      const a = w.impl.reconcile({ local: l, meta: m, server, pendingQueued: queued });
      n += 1;
      const tag = `base ${m.baseRevision}${m.startedNew ? ' started-new' : ''}${m.chosenOver ? ` chosen-over ${m.chosenOver}` : ''}, local ${l.fingerprint}${l.hasContent ? '' : ' (empty)'}, server ${server ? `${server.revision}/${String(server.fingerprint)}/${server.writeId}/v${server.schemaVersion}${server.recentWrites ? '/remembers' : ''}${server.outOfBounds ? '/too-large' : ''}` : 'none'}, pending ${pending ? 'yes' : 'no'}${queued ? ' queued' : ''}`;
      if ((a.kind === 'wait') !== (!!pending && queued)) { say(out, tag, `wait is ${a.kind === 'wait'}`); continue; }
      if (a.kind === 'wait') continue;
      if (!server) {
        if (a.kind === 'push' && (a.base !== 0 || m.baseRevision > 0 || !l.hasContent)) say(out, tag, 'a first save that is not a first save');
        if (l.hasContent && m.baseRevision > 0 && a.kind !== 'account_gone') say(out, tag, `the account copy is gone and the answer is ${a.kind}`);
        if (!l.hasContent && a.kind !== 'nothing') say(out, tag, `nothing on either side and the answer is ${a.kind}`);
        continue;
      }
      const readable = server.schemaVersion <= LIVING_MODEL_SCHEMA_VERSION && server.fingerprint !== null;
      const refusedSize = readable && server.outOfBounds === true;
      if (!readable && a.kind !== 'account_unreadable') say(out, tag, `a model this build cannot read gets ${a.kind}`);
      if (refusedSize && a.kind !== 'account_refused') say(out, tag, `a model over the limits gets ${a.kind}`);
      if (!readable || refusedSize) continue;
      const landed = !!pending && server.writeId === pending.writeId;
      if (landed) { if (a.kind !== 'landed') say(out, tag, `the pending save is the row and the answer is ${a.kind}`); continue; }
      // From here the notes are the ones the rules stand on: a save that landed and was saved over moves the base.
      const eff = settleLandedPending(m, server);
      const changed = deviceChanged(eff, l);
      const sameRev = eff.baseRevision > 0 && server.revision === eff.baseRevision;
      const chosen = eff.chosenOver === server.revision;
      const fp = server.fingerprint;
      if (a.kind === 'push' && !(sameRev && a.base === server.revision)) say(out, tag, 'sends on a base that is not the account revision');
      if (a.kind === 'push' && !changed) say(out, tag, 'sends a model that did not change');
      // THE RULE THE REVIEW FOUND MISSING.
      if (a.kind === 'push' && !l.hasContent && !chosen && server.hasContent !== false) say(out, tag, 'AN EMPTY DEVICE SENDS OVER AN ACCOUNT COPY');
      if (a.kind === 'take_server' && changed) say(out, tag, 'takes the account copy over changes made here');
      if (a.kind === 'take_server' && !l.hasContent && eff.startedNew && server.hasContent === true) say(out, tag, 'started new, and the account copy is taken without asking');
      const bothChanged = changed && !sameRev;
      const emptyOverContent = !l.hasContent && !chosen && !(!changed && sameRev && !eff.startedNew);
      const mustAsk = (bothChanged && !(emptyOverContent && server.hasContent === true && !changed && !eff.startedNew)) || (emptyOverContent && server.hasContent === true && (changed || eff.startedNew));
      if (fp === undefined && (bothChanged || emptyOverContent) && a.kind !== 'need_model') say(out, tag, `decided without the account model (${a.kind})`);
      if (typeof fp === 'string' && mustAsk && fp !== l.fingerprint && a.kind !== 'conflict') say(out, tag, `he must be asked and the answer is ${a.kind}`);
      if (a.kind === 'conflict' && !mustAsk) say(out, tag, 'asks when nothing here calls for it');
      if (eff !== m && l.fingerprint === pending?.fingerprint && a.kind !== 'take_server') say(out, tag, `this device’s save landed and was saved over, nothing changed here since, and the answer is ${a.kind}`);
    }
  }
  if (n < 5000) out.push(`only ${n} combinations were tried`);
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
  // Before the table is known to be there, the only thing written is the device's own notes forgetting an old match
  // (the model key was lost, or Start a New Model): notes that exist only where the table was seen before.
  const beforeMissing = (missingAt >= 0 ? pass.slice(0, missingAt) : pass)
    .replace("{ meta = resetSyncBase(meta, { startedNew: false }); await commit(meta); if (!live()) return; }", '')
    .replace("meta = resetSyncBase(meta, { startedNew: true });\n      await commit(meta);", '');
  for (const call of ['commit(', 'send(', 'saveJobModel(', 'fetchAccountModel(', 'writeKeptModel(', 'pushAccountModel(']) {
    if (beforeMissing.includes(call)) out.push(`${call} runs before the missing-table check`);
  }
  if (!/if \(!modelFoundRef\.current && meta\.baseRevision > 0 && hasSyncHistory\(meta\)\)/.test(pass)) out.push('the notes are reset for a device that never matched the account');
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
  'sync.scanAskBody': 'Saving it to your account sends the room’s name and its sizes: floor outline, ceiling height, walls, doors, windows and fixtures, and that the room came from a scan. They go to MAGE ID’s servers so your other devices and your team on this project can see them. No photo or video is sent. You are asked again for each scanned room you add later.',
  'sync.scanAskRoomsBody': 'Scanned rooms that would be sent: {names}.',
  'sync.accountScanRoomsBody': 'Rooms in your account that came from a scan: {names}.',
  'sync.keptOnPhoneBody': 'Kept on this phone only, as you chose. It will not appear on your other devices.',
  'sync.keptOnPhoneStoppedBody': 'Nothing more will be sent from this phone, as you chose.',
  'sync.keptOnPhoneMayBody': 'A copy may already be in your account.',
  'sync.removeFromAccountLabel': 'Remove It from My Account',
  'sync.removeConfirmLabel': 'Yes, Remove It',
  'sync.removedBody': 'Removed from your account. The model on this phone has not been changed.',
  'sync.viewOnlyBody': 'You can view this model. Only the owner and editors can change it.',
  'sync.teammateKeptBody': 'Your teammate changed this model. Your previous copy is kept.',
  'sync.retryingBody': 'Saved on this device. Your account could not be checked yet. MAGE ID will try again shortly.',
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
  ['retrying', /\{status === 'retrying' \? <Text[^>]*>\{copy\.retryingBody\}<\/Text> : null\}/],
  ['view_only', /\{status === 'view_only' \? <Text[^>]*>\{copy\.viewOnlyBody\}<\/Text> : null\}/],
  ['account_too_large', /\{status === 'account_too_large' \? <Text[^>]*>\{copy\.accountTooLargeBody\}<\/Text> : null\}/],
  ['account_newer', /\{status === 'account_newer' \? <Text[^>]*>\{copy\.accountNewerBody\}<\/Text> : null\}/],
];

rule('C2', 'each state says its own sentence, and "Saved to your account." is said only after the account was read', (w) => {
  const out: string[] = [];
  const status = w.files[STATUS];
  for (const [state, re] of STATE_LINES) if (!re.test(status)) out.push(`the ${state} state does not say its sentence`);
  for (const key of ['savedAccountBody', 'syncWaitingBody', 'syncFailedBody', 'syncCheckingBody', 'accountNewerBody', 'retryingBody', 'viewOnlyBody', 'accountTooLargeBody', 'accountRemovedBody']) {
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
  if (!/const unsent = status === 'saved' && fingerprintNow !== null && fingerprintNow !== matched;\s+const shown: SyncStatus = unsent \? \(viewOnly \? 'view_only' : 'waiting'\) : status;/.test(hook) || !/return \{\s+status: shown, savedAt,/.test(hook)) out.push('a change that has not been sent yet still reads "Saved to your account."');
  if (!/if \(outcome === 'queued'\) \{ setStatus\('waiting'\); return; \}/.test(hook)) out.push('a queued save is not shown as waiting');
  if (!/if \(outcome === 'failed'\) \{[\s\S]{0,200}setStatus\('failed'\)/.test(hook)) out.push('a refused save is not shown as failed');
  if (!/<SyncStatus sync=\{sync\} deviceRooms=\{model\.rooms\.length\} hasScanRoom=\{hasScanRoom\} nameOf=\{nameOf\} roomNameOf=\{roomNameOf\} \/>/.test(w.files[SCREEN])) out.push('the screen does not draw the status line');
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
  const notes = (over: Partial<Pick<ModelSyncMeta, 'scanChoice' | 'accountScanRoomIds' | 'scanConsentRoomIds'>> = {}) => ({ scanChoice: 'unasked' as ModelSyncMeta['scanChoice'], accountScanRoomIds: [] as string[], scanConsentRoomIds: [] as string[], ...over });
  if (G(typed, notes()) !== 'send') out.push('a model of typed rooms is held back');
  if (G(scan, notes()) !== 'ask') out.push('a scanned room is sent without asking');
  const yes = w.impl.metaAfterScanYes(meta(), scan);
  if (yes.scanChoice !== 'account' || yes.scanConsentRoomIds.join() !== 'r-scan' || G(scan, yes) !== 'send') out.push('after Save to My Account the model is still held, or the yes is not kept for that room');
  if (G(scan, notes({ scanChoice: 'device' })) !== 'device') out.push('after Keep on This Phone the model is sent');
  if (G(typed, notes({ scanChoice: 'device' })) !== 'device') out.push('Keep on This Phone does not keep the WHOLE model on the phone');
  if (G(scan, notes({ accountScanRoomIds: ['r-scan'] })) !== 'send') out.push('a scanned room that is already in the account is asked about again');
  // THE YES IS PER ROOM. A room scanned and added later is asked about, whatever was answered before.
  const two = addRoom(scan, roomFromScan(aScan('scan-2'), { id: 'r-scan-2', placement: { xM: 12, yM: 0 } }));
  if (G(two, yes) !== 'ask') out.push('a yes for one scanned room covers a room scanned and added later');
  if (G(two, notes({ scanChoice: 'account' })) !== 'ask') out.push('"Save to My Account" with no room on record is read as a yes to every scanned room');
  if (G(two, notes({ accountScanRoomIds: ['r-scan'] })) !== 'ask') out.push('a second scanned room is sent on the strength of the first');
  if (unaskedScanRoomIds(two, yes).join() !== 'r-scan-2') out.push('the rooms the question is about are not the ones with no yes');
  const yes2 = w.impl.metaAfterScanYes(yes, two);
  if (G(two, yes2) !== 'send' || yes2.scanConsentRoomIds.slice().sort().join() !== 'r-scan,r-scan-2') out.push('a second yes does not add the second room');
  const no = metaAfterScanNo({ ...yes2, accountScanRoomIds: ['r-scan'] });
  if (no.scanChoice !== 'device' || no.scanConsentRoomIds.join() !== 'r-scan') out.push('Keep on This Phone leaves a yes on record for a room that was never sent');
  const relabelled: JobModel = { ...scan, rooms: scan.rooms.map((r) => (r.id === 'r-scan' ? { ...r, source: 'typed' as const } : r)) };
  if (G(relabelled, notes()) !== 'ask') out.push('a room that still names its scan is sent when its label says typed');
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
  if (!['copy.scanAskTitleBody', 'copy.scanAskBody', 'copy.scanAskRoomsBody(askNames)', "sync.answerScan('account')", "sync.answerScan('device')"].every((x) => ask.includes(x))) out.push('the question is not shown with both answers and the rooms it is about');
  if (!/const scanAskRoomIds = useMemo\(\(\) => \(model && notes \? unaskedScanRoomIds\(model, notes\) : \[\]\), \[model, notes\]\);/.test(hook)) out.push('the rooms named in the question are not the rooms with no yes on record');
  if (!/void commit\(metaAfterScanYes\(meta, m\)\)/.test(hook)) out.push('Save to My Account is not kept as a yes for the scanned rooms in the model at that moment');
  if (!/\{accountScanNames && \(status === 'saved' \|\| status === 'waiting'\) \? <Text[^>]*>\{copy\.accountScanRoomsBody\(accountScanNames\)\}<\/Text> : null\}/.test(status)) out.push('the screen does not list which rooms in the account came from scans');
  const keptPanel = panel(status, "status === 'kept_on_device'");
  if (!['copy.keptOnPhoneBody', "sync.answerScan('account')"].every((x) => keptPanel.includes(x)) || !/\{sync\.scanAskRoomIds\.length > 0 \? <Text[^>]*>\{copy\.scanAskBody\}<\/Text> : null\}/.test(keptPanel)) out.push('Keep on This Phone cannot be changed on the screen, or changes without the explanation');
  if (!/sync\.scanChoice === 'account' && hasScanRoom[^?]*\? \(\s*<Button label=\{copy\.keepOnPhoneLabel\}[^>]*onPress=\{\(\) => sync\.answerScan\('device'\)\}/.test(status)) out.push('Save to My Account cannot be changed on the screen');
  return out;
});

// EXACTLY what the question says is sent: the room's name, where it sits, its sizes, and the word "scan".
// Not here, and so not sent: scanId, scanLengthM (Apple's own wall width), lengthSource / widthSource /
// heightSource (which single numbers were typed over), confidence, the ceiling's source.
const MODEL_KEYS = ['links', 'projectId', 'rooms', 'stages', 'updatedAt', 'version'];
const ROOM_KEYS = ['id', 'kind', 'level', 'name', 'placement', 'room', 'source'];
const SHAPE_KEYS = ['ceilingHeightM', 'floor', 'objects', 'openings', 'walls'];
const WALL_KEYS = ['a', 'b', 'curved', 'heightM', 'id', 'label', 'lengthM', 'onOutline', 'polygon'];
const OPENING_KEYS = ['heightM', 'id', 'kind', 'offsetM', 'sillM', 'wallId', 'widthM'];
const OBJECT_KEYS = ['category', 'center', 'depthM', 'heightM', 'id', 'rotationRad', 'widthM'];
const CEILING_KEYS = ['known', 'max', 'min', 'typical'];
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
    ...sent.rooms.flatMap((x) => [...within(x, ROOM_KEYS), ...within(x.room, SHAPE_KEYS), ...within(x.room.ceilingHeightM, CEILING_KEYS), ...x.room.walls.flatMap((y) => within(y, WALL_KEYS)), ...x.room.openings.flatMap((y) => within(y, OPENING_KEYS)), ...x.room.objects.flatMap((y) => within(y, OBJECT_KEYS))]),
  ];
  if (extra.length) out.push(`fields that are not named are sent: ${[...new Set(extra)].join(', ')}`);
  // What the question does not name is not sent: the scan's id, Apple's own wall width (3.01 in the fixture), the device's clock.
  if (/scanId|scan-1|scanLengthM|3\.01|lengthSource|widthSource|heightSource|confidence|adjusted/.test(JSON.stringify(sentClean))) out.push('something of the scan that the question does not name is sent (the scan id, Apple’s wall width, a per-number source or a confidence)');
  if (sent.updatedAt !== '' || sentClean.updatedAt !== '') out.push('the device’s clock is sent with the model');
  if (sent.rooms.find((x) => x.id === 'r-scan')?.source !== 'scan' || sent.rooms.find((x) => x.id === 'r-typed')?.source !== 'typed') out.push('the account copy does not say which room came from a scan');
  const relabelledSent = w.impl.modelForAccount({ ...clean, rooms: clean.rooms.map((x) => (x.id === 'r-scan' ? { ...x, source: 'typed' as const } : x)) });
  if (relabelledSent.rooms.find((x) => x.id === 'r-scan')?.source !== 'scan') out.push('a room that names its scan is sent as a typed room');
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
  if (count(io, 'cloud.queue.supabaseRpcDetailed(') !== 2 || count(io, 'LIVING_MODEL_SAVE_FN, saveArgs(') !== 1 || count(io, 'LIVING_MODEL_REMOVE_FN, removeArgs(') !== 1) out.push('the save and the removal do not each go through the offline queue exactly once');
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
  const acts = /saveJobModel\(|send\(|pushAccountModel\(|commit\(|onAdoptRef|adopt\(|writeKeptModel\(|removeKeptModel\(/.exec(conflictCase);
  if (acts) out.push(`the both-changed branch acts by itself (${acts[0]})`);
  if (!/setStatus\('conflict'\)/.test(conflictCase)) out.push('the both-changed branch does not ask');
  // Found by the smoke test: after a choice the next run read the model the screen had not redrawn yet and sent it over the account.
  if (count(hook, 'onAdoptRef.current(') !== 1 || !/const adopt = useCallback\(\(m: JobModel\) => \{\s+adopted\.current = \{ model: m, from: propRef\.current \};\s+modelRef\.current = m;\s+onAdoptRef\.current\(m\);/.test(hook)) out.push('a model the hook puts on the device is not the model its next run reads');
  if (!/modelRef\.current = adopted\.current \? adopted\.current\.model : model;/.test(hook)) out.push('a redraw with the old model undoes the model the hook just put on the device');
  if (!/if \(conflictRef\.current\) \{ setStatus\('conflict'\); return; \}/.test(hook)) out.push('a later run does not wait for the answer');
  const take = body(hook, 'takeAccountModel');
  const keep = body(hook, 'keepThisDevice');
  const back = body(hook, 'bringBackKept');
  const remove = body(hook, 'removeKept');
  for (const [name, b, replace] of [['Use the One in Your Account', take, 'saveJobModel('], ['Keep This Device’s Model', keep, 'commit(']] as const) {
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
  if (!/if \(modelHasContent\(mine\)\) \{\s+const k: KeptModel = \{ from: 'device', model: mine, keptAt: new Date\(\)\.toISOString\(\) \};\s+if \(!\(await writeKeptModel\(userId, projectId, k\)\)\) return false;/.test(take)) out.push('Use the One in Your Account sets aside nothing, or sets aside an empty model');
  if (!/await commit\(metaAfterKeepDevice\(meta, c\.head, modelFingerprint\(c\.account\), scanRoomIds\(c\.account\)\)\);/.test(keep)) out.push('Keep This Device’s Model is not remembered as his choice over that revision');
  if (!/const swapped = await swapKeptModel\(userId, projectId, mine, k, new Date\(\)\.toISOString\(\), loadStateRef\.current\);\s+if \(!swapped\) return false;/.test(back) || /saveJobModel\(|writeKeptModel\(/.test(back)) out.push('Use the Kept Model Instead does not go through the one trade that survives a kill');
  const removes = store.match(/AsyncStorage\.removeItem\(([a-zA-Z]+)\)/g) ?? [];
  if (removes.filter((x) => x === 'AsyncStorage.removeItem(key)').length !== 1 || removes.some((x) => x !== 'AsyncStorage.removeItem(key)' && x !== 'AsyncStorage.removeItem(swapKey)') || /AsyncStorage\.(clear|multiRemove)\(/.test(store)) out.push('the sync notes file removes more than the one kept model and its own swap note');
  return out;
});

// ── G. the keys ──────────────────────────────────────────────────────────────
rule('G1', 'the sync notes and the kept model are under the app\'s own prefix, per person and per project', (w) => {
  const out: string[] = [];
  for (const [name, fn] of [['sync notes', w.impl.livingModelSyncKey], ['kept model', w.impl.livingModelKeptKey], ['swap note', w.impl.livingModelSwapKey]] as const) {
    const k = fn('user-1', 'proj-9');
    if (!k || !k.startsWith('mageid_') || !isAppStorageKey(k)) out.push(`the ${name} key ${k} is not under an app-owned prefix: the tenant sweep would miss it`);
    if (k && (!k.includes('user-1') || !k.includes('proj-9'))) out.push(`the ${name} key does not carry both the person and the project`);
    if (fn(null, 'p') !== null || fn('u', '') !== null || fn(undefined, undefined) !== null) out.push(`a ${name} key is made with no person or no project`);
    if (fn('a', 'p') === fn('b', 'p') || fn('a', 'p') === fn('a', 'q')) out.push(`two people or two projects share one ${name} key`);
  }
  const keys = [livingModelKey('u', 'p'), livingModelBackupKey('u', 'p'), w.impl.livingModelSyncKey('u', 'p'), w.impl.livingModelKeptKey('u', 'p'), w.impl.livingModelSwapKey('u', 'p')];
  if (new Set(keys).size !== 5) out.push('two of the five keys are the same key');
  const prefixes = [LIVING_MODEL_KEY_PREFIX, LIVING_MODEL_BACKUP_PREFIX, LIVING_MODEL_SYNC_PREFIX, LIVING_MODEL_KEPT_PREFIX, LIVING_MODEL_SWAP_PREFIX];
  for (const a of prefixes) for (const b of prefixes) if (a !== b && a.startsWith(b)) out.push(`the prefix ${a} begins with ${b}: one read could take the other's keys`);
  const store = code(w.files[STORE]);
  const sets = (store.match(/AsyncStorage\.setItem\([^)]*\)/g) ?? []).sort().join(' ');
  if (sets !== 'AsyncStorage.setItem(key, JSON.stringify(meta) AsyncStorage.setItem(key, keptModelJson(kept) AsyncStorage.setItem(swapKey, JSON.stringify(note)') out.push(`the sync notes file writes ${sets || 'nothing'}`);
  if (!/const swapKey = livingModelSwapKey\(userId, projectId\);/.test(store)) out.push('the swap note is kept under a key of its own making');
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
    ['one row per project, gone with the project', /create table if not exists public\.living_models \(\s+project_id\s+uuid primary key references public\.projects\(id\) on delete cascade/],
    ['the owner id', /owner_id\s+uuid not null references auth\.users\(id\) on delete cascade/],
    ['updated_by set to NULL when that account goes', /updated_by\s+uuid references auth\.users\(id\) on delete set null/],
    ['the size cap', /check \(octet_length\(model::text\) <= 3145728\)/],
    ['the model is this project\'s, however the id is cased', /check \(lower\(model ->> 'projectId'\) = lower\(project_id::text\)\)/],
    ['the function compares the job id with lower() on both sides', /pg_catalog\.lower\(p_model ->> 'projectId'\) is distinct from pg_catalog\.lower\(p_project_id::text\)/],
    ['no more rooms than the app makes (the table)', /jsonb_array_length\(model -> 'rooms'\) <= 60\)/],
    ['no more rooms than the app makes (the function)', /if pg_catalog\.jsonb_array_length\(p_model -> 'rooms'\) > 60 then\s+return pg_catalog\.jsonb_build_object\('saved', false, 'code', 'out_of_bounds'/],
    ['no more walls, openings and fixtures in a room than the app allows', /-> 'walls'\) > 200 then[\s\S]*-> 'openings'\) > 400 then[\s\S]*-> 'objects'\) > 400 then/],
    ['the row remembers its recent saves', /recent_writes = v_recent,/],
    ['a save that landed and was saved over answers with the revision it landed at', /if v_hit is not null then\s+return pg_catalog\.jsonb_build_object\('saved', true, 'revision', \(v_hit ->> 'r'\)::integer/],
    ['the remove function asks for the right to edit the schedule', /if not public\.can_access_project\(p_project_id, 'editor'\) then\s+raise exception 'living_model_remove: permission denied for this project' using errcode = '42501';/],
    ['the remove function deletes this job\'s row only', /delete from public\.living_models m where m\.project_id = p_project_id returning m\.revision into v_rev;/],
    ['a removal leaves its line', /insert into public\.living_model_removals \(project_id, last_revision, removed_at, removed_by\)/],
    ['the next first save starts above the removed revision', /select coalesce\(\(select x\.last_revision from public\.living_model_removals x where x\.project_id = p_project_id\), 0\) \+ 1 into v_start;/],
    ['no client holds anything on the removals table', /alter table public\.living_model_removals enable row level security;\s*revoke all on public\.living_model_removals from public, anon, authenticated;/],
    ['anon cannot call the remove function', /revoke all on function public\.living_model_remove\(uuid\) from public, anon;\s*grant execute on function public\.living_model_remove\(uuid\) to authenticated;/],
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
  if (count(m, 'security definer') !== 2 || count(m, "security definer\nset search_path to ''") !== 2) out.push('the SECURITY DEFINER functions are not exactly the save and the remove, each with an empty search_path');
  if (count(m, 'delete from') !== 1) out.push('something other than the remove function deletes');
  if (ACCOUNT_LIMITS.rooms !== 60 || MAX_ROOMS !== 60 || ACCOUNT_LIMITS.wallsPerRoom !== 200 || ACCOUNT_LIMITS.openingsPerRoom !== 400 || ACCOUNT_LIMITS.objectsPerRoom !== 400) out.push('the app and the function do not keep the same limits');
  for (const a of Object.keys(removeArgs(P))) if (!new RegExp(`living_model_remove\\(${a} uuid\\)`).test(m)) out.push(`the app sends ${a} to the remove function and it does not take it`);
  if (LIVING_MODEL_REMOVE_FN !== 'living_model_remove') out.push('the remove function is misnamed');
  const args = Object.keys(saveArgs(P, emptyJobModel(P), 0, 'w')).sort();
  for (const a of args) if (!new RegExp(`\\b${a}\\b`).test(m)) out.push(`the app sends ${a} and the function does not take it`);
  for (const col of ['revision', 'last_write_id', 'recent_writes', 'schema_version', 'updated_at', 'updated_by', 'model']) if (!new RegExp(`\\n\\s+${col}\\s`).test(m)) out.push(`the app reads ${col} and the table does not have it`);
  const header = w.files[MIGRATION].slice(0, w.files[MIGRATION].indexOf('do $pre$'));
  for (const part of ['WHY.', 'WHO WRITES.', 'WHO READS.', 'DEPLOY ORDER.', 'VERIFY AFTER', 'UNDO', 'PROOF.']) if (!header.includes(part)) out.push(`the header has no ${part}`);
  return out;
});

rule('H2', 'the proof runs the cases with planted mutations, this check is in the gate, and the notes list what changes with the camera sentence', (w) => {
  const out: string[] = [];
  const proof = w.files[PROOF];
  if (!proof.includes("const FILE = '20261011090000_living_models.sql';")) out.push('the PGlite proof does not name the migration');
  const planted = (proof.match(/^\s+case \d+:/gm) ?? []).length;
  if (planted < 29) out.push(`the PGlite proof plants ${planted} mutations`);
  for (const c of ['an accepted editor reads and saves', 'a viewer', 'a field seat', 'a stranger reads nothing and cannot save', 'anon holds nothing', 'refused with code stale_revision', 'over 3 MiB', 'deleting the project deletes its model',
    'written in capitals', 'refused with code out_of_bounds', 'answers with the revision it landed at', 'only the owner and editors remove the account copy', 'starts ABOVE the old revision', 'no client reads or writes the removals table']) if (!proof.includes(c)) out.push(`the PGlite proof has no case for: ${c}`);
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

// ── I. the promises around the sends ─────────────────────────────────────────
const fnBody = (src: string, start: string, end: string): string => { const a = src.indexOf(start); const b = a < 0 ? -1 : src.indexOf(end, a + start.length); return a < 0 || b < 0 ? '' : src.slice(a, b); };

rule('I1', 'Keep on This Phone takes this job\'s waiting save back out of the queue, stops a run in flight, and the panel says a copy may be in the account when one may be', (w) => {
  const out: string[] = [];
  const hook = code(w.files[HOOK]);
  const io = code(w.files[IO]);
  const queue = code(w.files[QUEUE]);
  const answer = fnBody(hook, 'const answerScan = useCallback(', '}, [commit, run, projectId, userId]);');
  if (!answer.includes('void commit(metaAfterScanNo(meta)).then(() => cancelQueuedAccountSave(projectId, userId)).then(run, run);')) out.push('Keep on This Phone does not write the notes first and then take the waiting save out of the queue');
  if (/removeAccountModel\(|pushAccountModel\(/.test(answer)) out.push('answering the scan question sends or deletes by itself');
  const cancel = fnBody(io, 'export async function cancelQueuedAccountSave(', '\n}\n');
  if (!cancel.includes('await cloud.queue.cancelQueuedRpc(LIVING_MODELS_TABLE, projectId, LIVING_MODEL_SAVE_FN, userId);')) out.push('the cancel is not this account\'s living_model_save for this project');
  if (!cancel.includes("if (res.readFailed) return 'unknown';")) out.push('a queue that could not be read is reported as "nothing waiting"');
  const q = fnBody(queue, 'export async function cancelQueuedRpc(', '\n}\n');
  if (!q) out.push('utils/offlineQueue.ts has no cancelQueuedRpc');
  if (!q.includes("current.filter((m) => !(m.operation === 'rpc' && m.table === table && m.data?.id === recordId && m.rpc?.fn === fn && m.userId === userId));")) out.push('the queue cancel removes more than one record\'s one function for one account');
  if (!q.includes('await withQueueLock(async () => {')) out.push('the queue cancel does not run under the queue lock');
  if (/notifyDroppedWrites|recordDropsInLedger|oops\(|AsyncStorage\.clear/.test(q)) out.push('the queue cancel writes a Not-saved line or a toast for a save the person withdrew');
  if (!q.includes("if (!table || !recordId || !fn || !userId) return { removed: 0, readFailed: false };")) out.push('the queue cancel runs with a missing argument');
  // A run that was in flight when he tapped does not go on with notes that say "send".
  const send = fnBody(hook, 'const send = useCallback(', '}, [projectId, commit, scheduleRetry]);');
  if (count(send, 'if (metaRef.current !== sending) { again.current = true; return; }') < 3) out.push('a save in flight goes on after the notes changed under it (Keep on This Phone tapped mid-send)');
  const pushAt = send.indexOf('pushAccountModel(');
  if (pushAt < 0 || send.indexOf('if (metaRef.current !== sending) { again.current = true; return; }') > pushAt) out.push('the notes are not checked between writing them and sending');
  const pass = fnBody(hook, 'const pass = useCallback(', '}, [projectId, userId, commit, send, adopt, scheduleRetry, withAnswers]);');
  if (count(pass, 'if (metaRef.current !== meta) { again.current = true; return; }') < 2) out.push('a run that was reading the account goes on after the notes changed under it');
  if (!hook.includes('return cur ? { ...next, scanChoice: cur.scanChoice, scanConsentRoomIds: cur.scanConsentRoomIds } : next;') || count(pass, 'await commit(withAnswers(') < 5) out.push('a run that finishes after Keep on This Phone was tapped writes the old answer back');
  if (!/holds\.modelSave: entries|modelSave: entries\.some\(\(m\) => m\.table === LIVING_MODELS_TABLE && m\.data\?\.id === projectId && \(m\.operation !== 'rpc' \|\| m\.rpc\?\.fn === LIVING_MODEL_SAVE_FN\)\)/.test(io)) out.push('"a save is waiting" counts something that is not a save');
  // The sentence is keyed on what may have left the phone, never on the last saved time.
  const M = w.impl.accountMayHoldCopy;
  if (M(meta())) out.push('a device that never sent anything is told a copy may be in the account');
  if (M(meta({ savedAt: '2026-10-09T12:00:00Z', accountSeen: true }))) out.push('the sentence is keyed on the saved time');
  if (!M(metaAfterSend(meta({ accountSeen: true }), pend('w1', 0)))) out.push('after a save was handed to the queue the panel does not say a copy may be in the account');
  if (!M({ ...metaAfterSend(meta({ accountSeen: true }), pend('w1', 0)), pending: null })) out.push('a save that was sent and then forgotten no longer counts as "may be in the account"');
  if (!M(synced(2, 'A'))) out.push('a matched revision does not count as "may be in the account"');
  if (!M(parseSyncMeta(JSON.stringify(metaAfterSend(meta(), pend('w1', 0)))))) out.push('"a save was sent" does not survive a restart');
  if (M(w.impl.metaAfterRemoval(metaAfterSend(synced(2, 'A'), pend('w1', 2))))) out.push('after the account copy was removed the panel still says a copy may be there');
  if (!hook.includes('const accountMayHold = notes ? accountMayHoldCopy(notes) : false;')) out.push('the hook does not take the sentence from the notes');
  const kept = panel(w.files[STATUS], "status === 'kept_on_device'");
  if (!kept.includes('{sync.accountMayHold ? `${copy.keptOnPhoneStoppedBody} ${copy.keptOnPhoneMayBody}` : copy.keptOnPhoneBody}')) out.push('the panel does not say "A copy may already be in your account." exactly when one may be');
  if (/sync\.savedAt/.test(kept)) out.push('the panel reads the saved time');
  return out;
});

rule('I2', 'the account copy is removed only by a confirmed tap, now or not at all, and never touches the device', (w) => {
  const out: string[] = [];
  const hook = code(w.files[HOOK]);
  const io = code(w.files[IO]);
  const status = w.files[STATUS];
  const remove = fnBody(io, 'export async function removeAccountModel(', '\n}\n');
  if (!/cloud\.queue\.supabaseRpcDetailed\(\s*LIVING_MODELS_TABLE, projectId, LIVING_MODEL_REMOVE_FN, removeArgs\(projectId\),\s*\{ callerOwnsRefusal: true \},\s*\)/.test(remove)) out.push('the removal is not living_model_remove through the offline queue');
  if (!/if \(outcome !== 'synced'\) \{\s+await cloud\.queue\.cancelQueuedRpc\(LIVING_MODELS_TABLE, projectId, LIVING_MODEL_REMOVE_FN, userId\);\s+return 'not_removed';/.test(remove)) out.push('a removal that could not be sent now is left waiting in the queue');
  if (!/const back = await fetchAccountHead\(projectId\);\s+return back\.kind === 'none' \? 'removed' : 'not_removed';/.test(remove)) out.push('the copy is called removed without reading the account');
  if (count(hook, 'removeAccountModel(') !== 1) out.push('the hook deletes the account copy from more than one place');
  const body = fnBody(hook, 'const removeFromAccount = useCallback(', '}, [commit, projectId, userId]);');
  if (!body.includes('removeAccountModel(projectId, userId)')) out.push('Remove It from My Account does not remove');
  if (!body.includes("if (!meta || meta.scanChoice !== 'device') return;")) out.push('the account copy can be removed while the model is still being sent');
  if (/saveJobModel\(|adopt\(|writeKeptModel\(|removeKeptModel\(|swapKeptModel\(|onAdoptRef/.test(body)) out.push('removing the account copy touches the model on the device');
  if (!body.includes("if (out === 'removed' && metaRef.current) await commit(metaAfterRemoval(metaRef.current));")) out.push('the notes are cleared without the copy being seen gone');
  // The screen: one tap asks, the second removes.
  if (count(status, 'sync.removeFromAccount') !== 1) out.push('the account copy can be removed from more than one control');
  const confirm = panel(status, 'sync.accountMayHold && confirmRemove');
  if (!confirm.includes('{copy.removeConfirmBody}') || !confirm.includes('onPress={() => { setConfirmRemove(false); sync.removeFromAccount(); }}')) out.push('the removal is not behind a second, confirming tap that says what it does');
  const first = panel(status, 'sync.accountMayHold && !confirmRemove');
  if (!first.includes('label={copy.removeFromAccountLabel}') || !first.includes('onPress={() => setConfirmRemove(true)}') || first.includes('removeFromAccount()')) out.push('the first tap on Remove It from My Account removes at once');
  if (!panel(status, "status === 'kept_on_device'").includes('sync.accountMayHold && !confirmRemove')) out.push('the removal is offered somewhere other than the Keep on This Phone panel');
  if (!/\{sync\.removeState === 'removed' \? <Text[^>]*>\{copy\.removedBody\}<\/Text> : null\}/.test(status) || !/\{sync\.removeState === 'failed' \? <Text[^>]*>\{copy\.removeFailedBody\}<\/Text> : null\}/.test(status)) out.push('the screen does not say whether the copy was removed');
  // Other devices: no account copy is found, and nothing is sent until the person asks.
  const gone = /case 'account_gone':([\s\S]*?)return;/.exec(hook)?.[1] ?? '';
  if (!gone.includes("setStatus('account_removed');") || /send\(|commit\(|saveJobModel\(/.test(gone)) out.push('a device that finds the account copy removed sends its own again, or changes something, without being asked');
  const again = panel(status, "status === 'account_removed'");
  if (!again.includes('{copy.accountRemovedBody}') || !again.includes('onPress={sync.saveAgain}')) out.push('a device that finds the account copy removed does not say so with a way to save again');
  const cleared = w.impl.metaAfterRemoval(metaAfterSend(synced(4, 'A', { accountScanRoomIds: ['r1'], scanConsentRoomIds: ['r1'], scanChoice: 'device' }), pend('w1', 4)));
  if (cleared.baseRevision !== 0 || cleared.baseFingerprint !== null || cleared.pending !== null || cleared.savedAt !== null || cleared.accountScanRoomIds.length || cleared.scanConsentRoomIds.length || cleared.scanChoice !== 'device') out.push('the notes after a removal still speak of an account copy, or forget Keep on This Phone');
  return out;
});

rule('I3', 'Use the Kept Model Instead survives a kill between its writes: the kept model is copied under a third key first', (w) => {
  const out: string[] = [];
  const R = w.impl.swapRecovery;
  const note = { outgoingFingerprint: 'M' };
  if (R(note, { modelFingerprint: 'M', keptFingerprint: 'M' }) !== 'finish') out.push('killed after the model on screen was set aside and before the kept one took its place: the kept model is not put back');
  if (R(note, { modelFingerprint: 'M', keptFingerprint: 'K' }) !== 'discard') out.push('killed before anything was replaced: the trade is carried out anyway');
  if (R(note, { modelFingerprint: 'K', keptFingerprint: 'M' }) !== 'discard') out.push('a trade that finished is carried out again');
  if (R(note, { modelFingerprint: 'X', keptFingerprint: 'M' }) !== 'discard') out.push('a model changed since the trade is written over');
  if (R(note, { modelFingerprint: null, keptFingerprint: 'M' }) !== 'discard' || R(note, { modelFingerprint: 'M', keptFingerprint: null }) !== 'discard') out.push('a trade is finished over a model or a kept model that cannot be read');
  const store = code(w.files[STORE]);
  const swap = fnBody(store, 'export async function swapKeptModel(', '\n}\n');
  const at = ['await AsyncStorage.setItem(swapKey, JSON.stringify(note));', 'await writeKeptModel(userId, projectId, aside)', 'await saveJobModel(userId, kept.model, nowIso, state)'].map((x) => swap.indexOf(x));
  if (at.some((x) => x < 0) || !(at[0] < at[1] && at[1] < at[2])) out.push('the trade does not copy the kept model under the swap key BEFORE the model on screen is written over it');
  if (!swap.includes('const note: SwapNote = { incoming: kept.model, outgoingFingerprint: modelFingerprint(onScreen) };')) out.push('the swap note does not hold the kept model and the fingerprint of the one it replaces');
  if (!/if \(!\(await saveJobModel\(userId, kept\.model, nowIso, state\)\)\) \{\s+await writeKeptModel\(userId, projectId, kept\);/.test(swap)) out.push('a trade that failed part way does not put the kept model back');
  const rec = fnBody(store, 'export async function recoverKeptSwap(', '\n}\n');
  if (!rec.includes("if (todo === 'finish' && !(await saveJobModel(userId, note.incoming, nowIso, 'ready'))) return;") || rec.indexOf('await AsyncStorage.removeItem(swapKey);') < rec.indexOf("if (todo === 'finish'")) out.push('the swap note is thrown away before the kept model is back under the model key');
  if (/AsyncStorage\.setItem\((?!swapKey)/.test(swap + rec)) out.push('the trade writes a key other than its own note directly');
  const screen = code(w.files[SCREEN]);
  if (!screen.includes('void recoverKeptSwap(userId, projectId, new Date().toISOString()).then(() => loadJobModel(userId, projectId)).then((loaded) => {')) out.push('the screen reads the model before a trade cut short is finished');
  const hook = code(w.files[HOOK]);
  const back = body(hook, 'bringBackKept');
  if (!back.includes('const swapped = await swapKeptModel(userId, projectId, mine, k, new Date().toISOString(), loadStateRef.current);') || /writeKeptModel\(|saveJobModel\(/.test(back)) out.push('Use the Kept Model Instead writes the two keys by itself, one after the other');
  if (hook.indexOf('await recoverKeptSwap(userId, projectId, new Date().toISOString());') < 0 || hook.indexOf('await recoverKeptSwap(') > hook.indexOf('readKeptModel(userId, projectId)')) out.push('the hook reads the kept model before a trade cut short is finished');
  return out;
});

const bigRoom = (id: string, parts: { walls?: number; openings?: number; objects?: number; wallM?: number; heightM?: number } = {}) => {
  const base = makeRectRoom({ id, name: id, kind: 'other', level: 0, widthM: 4, lengthM: 3, heightM: 2.5, xM: 0, yM: 0 } as never);
  const w0 = base.room.walls[0];
  const walls = parts.walls ? Array.from({ length: parts.walls }, (_, i) => ({ ...w0, id: `w${i}` })) : base.room.walls.map((x, i) => (i === 0 && parts.wallM ? { ...x, b: { x: x.a.x + parts.wallM, y: x.a.y } } : i === 0 && parts.heightM ? { ...x, heightM: parts.heightM } : x));
  const openings = Array.from({ length: parts.openings ?? 0 }, (_, i) => ({ id: `o${i}`, kind: 'door' as const, wallId: w0.id, offsetM: 0.1, widthM: 0.8, heightM: 2, sillM: 0, confidence: 'high' as const, widthSource: 'typed' as const, heightSource: 'typed' as const }));
  const objects = Array.from({ length: parts.objects ?? 0 }, (_, i) => ({ id: `f${i}`, category: 'sink', center: { x: 1, y: 1 }, widthM: 0.4, depthM: 0.4, heightM: 0.8, rotationRad: 0, confidence: 'high' as const }));
  return { ...base, room: { ...base.room, walls, openings, objects } };
};
const modelOfRooms = (rooms: ReturnType<typeof bigRoom>[]): JobModel => ({ ...emptyJobModel(P), rooms: rooms as JobModel['rooms'] });

rule('I4', 'a teammate\'s save is not taken without first keeping this device\'s model, and an account copy larger than the app allows is not taken at all', (w) => {
  const out: string[] = [];
  if (!savedBySomeoneElse({ updatedBy: 'user-2' }, 'user-1') || savedBySomeoneElse({ updatedBy: 'user-1' }, 'user-1') || !savedBySomeoneElse({ updatedBy: null }, 'user-1')) out.push('"saved by someone else" is not read from who saved the account copy');
  const hook = code(w.files[HOOK]);
  const take = /case 'take_server': \{([\s\S]*?)\n {6}\}/.exec(hook)?.[1] ?? '';
  if (!take) { out.push('the take-the-account branch could not be found'); return out; }
  const guardAt = take.indexOf('if (savedBySomeoneElse(head, userId) && local.hasContent && !keptRef.current) {');
  const keptAt = take.indexOf('if (!(await writeKeptModel(userId, projectId, aside))) {');
  const replaceAt = take.indexOf('await saveJobModel(userId, accountModel,');
  if (guardAt < 0 || keptAt < guardAt || replaceAt < keptAt) out.push('a teammate\'s save replaces this device\'s model before that model is set aside');
  if (!take.includes("aside = { from: 'device', model: m, keptAt: new Date().toISOString(), why: 'teammate' };")) out.push('the model set aside is not marked as kept because of a teammate\'s save');
  if (!/if \(!\(await writeKeptModel\(userId, projectId, aside\)\)\) \{ setChoiceFailed\(true\); setStatus\('retrying'\); scheduleRetry\(\); return; \}/.test(take)) out.push('when the device cannot keep its model the teammate\'s save is taken anyway');
  if (!/kept\.why === 'teammate' \? copy\.teammateKeptBody :/.test(w.files[STATUS])) out.push('the person is not told "Your teammate changed this model. Your previous copy is kept."');
  // The limits: what the app itself can make, and nothing larger.
  const A = w.impl.accountModelRefusal;
  const ok60 = modelOfRooms(Array.from({ length: ACCOUNT_LIMITS.rooms }, (_, i) => bigRoom(`r${i}`)));
  if (A(ok60) !== null || A(scanModel()) !== null || A(typedModel()) !== null) out.push('a model the app itself can make is refused');
  if (A(modelOfRooms(Array.from({ length: ACCOUNT_LIMITS.rooms + 1 }, (_, i) => bigRoom(`r${i}`)))) !== 'too_many_rooms') out.push('61 rooms are taken');
  if (A(modelOfRooms(Array.from({ length: 5000 }, (_, i) => bigRoom(`r${i}`)))) !== 'too_many_rooms') out.push('5,000 rooms are taken');
  if (A(modelOfRooms([bigRoom('a', { walls: ACCOUNT_LIMITS.wallsPerRoom + 1 })])) !== 'room_too_detailed') out.push('a room with 201 walls is taken');
  if (A(modelOfRooms([bigRoom('a', { openings: ACCOUNT_LIMITS.openingsPerRoom + 1 })])) !== 'room_too_detailed') out.push('a room with 401 doors and windows is taken');
  if (A(modelOfRooms([bigRoom('a', { objects: ACCOUNT_LIMITS.objectsPerRoom + 1 })])) !== 'room_too_detailed') out.push('a room with 401 fixtures is taken');
  if (A(modelOfRooms([bigRoom('a', { wallM: ACCOUNT_LIMITS.wallM * 1.5 })])) !== 'room_too_large') out.push('a wall longer than the editor allows is taken');
  if (A(modelOfRooms([bigRoom('a', { heightM: ACCOUNT_LIMITS.heightM * 2 })])) !== 'room_too_large') out.push('a wall taller than the editor allows is taken');
  const V = w.impl.accountValueTooLarge;
  if (!V({ rooms: Array.from({ length: 5000 }, () => ({})) }) || !V({ rooms: [{ room: { walls: Array.from({ length: 201 }, () => null) } }] }) || V({ rooms: [{ room: { walls: [] } }] }) || V(null) || V({ rooms: 'x' })) out.push('the raw size check does not count rooms and parts');
  const pass = fnBody(hook, 'const pass = useCallback(', '}, [projectId, userId, commit, send, adopt, scheduleRetry, withAnswers]);');
  const countAt = pass.indexOf('const tooLarge = accountValueTooLarge(full.value);');
  const readAt = pass.indexOf('readSavedModel(JSON.stringify(full.value ?? null), projectId)');
  if (countAt < 0 || readAt < countAt || !pass.includes('const read = tooLarge ? null : readSavedModel(')) out.push('an account copy is read through before its size is counted');
  if (!pass.includes('const outOfBounds = tooLarge || (accountModel !== null && accountModelRefusal(accountModel) !== null);') || !/outOfBounds \}, pendingQueued \}\);/.test(pass)) out.push('the limits are not put to the decision');
  if (!/case 'account_refused':\s+setStatus\('account_too_large'\);\s+return;/.test(hook)) out.push('an account copy over the limits is not said to be too large');
  return out;
});

rule('I5', 'the status line never sits on a lie: a failed read-back is retried, the turn limit leaves a true line, the fingerprint is not recomputed at every draw, and a view-only seat is told so', (w) => {
  const out: string[] = [];
  const hook = code(w.files[HOOK]);
  const send = fnBody(hook, 'const send = useCallback(', '}, [projectId, commit, scheduleRetry]);');
  const pass = fnBody(hook, 'const pass = useCallback(', '}, [projectId, userId, commit, send, adopt, scheduleRetry, withAnswers]);');
  if (!send.includes("if (back.kind === 'offline' || back.kind === 'error' || back.kind === 'missing') { setStatus('retrying'); scheduleRetry(); return; }")) out.push('after a save that went out, a read-back that fails leaves the line where it was with no later try');
  if (/setStatus\('checking'\)/.test(send) || /setStatus\('checking'\)/.test(pass)) out.push('a run can leave the line on "Checking your account"');
  const run = fnBody(hook, 'const run = useCallback(', '}, [pass, scheduleRetry]);');
  if (!run.includes('} while (again.current && gen.current === my && turns < SYNC_MAX_TURNS);') || !run.includes("if (again.current && gen.current === my) { setStatus('retrying'); scheduleRetry(); }")) out.push('a run that stops at its turn limit leaves no true line and no later try');
  if (!/const scheduleRetry = useCallback\(\(\) => \{[\s\S]*?retryTimer\.current = setTimeout\(\(\) => \{ retryTimer\.current = null; if \(gen\.current === my\) runRef\.current\(\); \}, SYNC_RETRY_MS\);/.test(hook)) out.push('the later try is not scheduled');
  if (!hook.includes('if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; }')) out.push('the later try outlives the screen');
  if (!hook.includes('const fingerprintNow = useMemo(() => (model ? modelFingerprint(model) : null), [model]);')) out.push('the whole model is turned to text at every draw');
  if (count(hook, 'modelFingerprint(model)') !== 1) out.push('the model on screen is fingerprinted in more than one place at draw time');
  const viewAt = send.indexOf("if (viewOnlyRef.current) { setStatus('view_only'); return; }");
  if (viewAt < 0 || viewAt > send.indexOf('const gate = scanGate(m, meta);') || viewAt > send.indexOf('pushAccountModel(')) out.push('a seat that may not change the model is asked the scan question, or its save is sent and refused');
  if (!hook.includes("const shown: SyncStatus = unsent ? (viewOnly ? 'view_only' : 'waiting') : status;")) out.push('a view-only seat is told a save is waiting');
  if (!/viewOnly = false/.test(w.files[SCREEN]) || !/useLivingModelSync\(\{ projectId, userId, project, model, loadState, modelFound, viewOnly, lang, onAdopt \}\)/.test(w.files[SCREEN])) out.push('the screen does not hand the seat to the hook');
  return out;
});

// ── J. the yes is on record ──────────────────────────────────────────────────
const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

rule('J1', 'the yes to the scan question is recorded: the kind, the version, a hash of the exact words in the language read, and the words archived', (w) => {
  const out: string[] = [];
  const enTitle = String(w.EN[`${K}sync.scanAskTitleBody`] ?? '');
  const enBody = String(w.EN[`${K}sync.scanAskBody`] ?? '');
  const esTitle = String(w.ES[`${K}sync.scanAskTitleBody`] ?? '');
  const esBody = String(w.ES[`${K}sync.scanAskBody`] ?? '');
  if (SCAN_UPLOAD_COPY.title !== enTitle || SCAN_UPLOAD_COPY.body !== enBody) out.push('the words on record (SCAN_UPLOAD_COPY) are not the words the screen shows: bump SCAN_UPLOAD_VERSION and run scripts/archive-legal-text.ts');
  if (SCAN_UPLOAD_COPY.button !== w.EN[`${K}sync.saveToAccountLabel`]) out.push('the button on record is not the button on the screen');
  if (sha256(legalNoticeText(enTitle, enBody)) !== SCAN_UPLOAD_TEXT_SHA256) out.push('SCAN_UPLOAD_TEXT_SHA256 is not the hash of the English question');
  if (!esTitle || !esBody || sha256(legalNoticeText(esTitle, esBody)) !== SCAN_UPLOAD_TEXT_SHA256_ES) out.push('SCAN_UPLOAD_TEXT_SHA256_ES is not the hash of the Spanish question');
  const en = scanRoomUploadItem('en');
  const es = scanRoomUploadItem('es');
  if (en.kind !== 'scan_room_upload' || en.version !== SCAN_UPLOAD_VERSION || en.sha !== SCAN_UPLOAD_TEXT_SHA256 || es.sha !== SCAN_UPLOAD_TEXT_SHA256_ES || es.sha === en.sha) out.push('a Spanish phone does not record the Spanish hash and an English phone the English');
  if (w.files[ARCHIVE_EN] !== legalNoticeText(enTitle, enBody)) out.push(`${ARCHIVE_EN} is missing or is not the English question word for word`);
  if (w.files[ARCHIVE_ES] !== legalNoticeText(esTitle, esBody)) out.push(`${ARCHIVE_ES} is missing or is not the Spanish question word for word`);
  if (!/export const NOTICES = \[[\s\S]*scan_room_upload-en[\s\S]*scan_room_upload-es/.test(w.files[ARCHIVE])) out.push('the archive script does not file the question');
  // What the question says is what is sent (rule D2 holds the field lists): the words name each thing.
  for (const word of ['name', 'floor outline', 'ceiling height', 'walls', 'doors', 'windows', 'fixtures', 'came from a scan', 'No photo or video is sent.', 'asked again for each scanned room']) if (!enBody.includes(word)) out.push(`the question does not say: ${word}`);
  // The tap records it, best effort, and only a tap that answered the question.
  const hook = code(w.files[HOOK]);
  if (!hook.includes('const asked = unaskedScanRoomIds(m, meta).length > 0;') || !hook.includes('void commit(metaAfterScanYes(meta, m)).then(() => { if (asked) recordScanUploadYes(userId, langRef.current); }).then(run, run);')) out.push('Save to My Account on the question does not record the yes');
  if (count(hook, 'recordScanUploadYes(') !== 1) out.push('a yes is recorded from somewhere other than the answer');
  const io = code(w.files[IO]);
  if (!/export function recordScanUploadYes\(userId: string \| null \| undefined, lang: 'en' \| 'es'\): void \{[\s\S]*?legal\.recordScanRoomUpload\(userId, lang\);/.test(io)) out.push('the record does not go through utils/legalAcceptance');
  if (!/export function recordScanRoomUpload\([^)]*\): void \{\s+try \{ void recorder\.note\(userId, \[scanRoomUploadItem\(lang\)\], 'in_app', at\)/.test(w.files[LEGAL])) out.push('utils/legalAcceptance does not note the scan_room_upload item');
  const mig = sql(w.files[KIND_MIGRATION]);
  if (!mig.includes("if p_kind not in ('terms', 'privacy', 'code_answer_ack', 'scan_ack', 'scan_room_upload') then")) out.push('the migration does not add scan_room_upload to the closed list of kinds');
  if (!/security definer\s+set search_path to ''/.test(mig) || !/revoke all on function public\.record_my_legal_acceptance\([^)]*\) from public, anon;/.test(mig)) out.push('the replaced recorder is not SECURITY DEFINER with an empty search_path, closed to anon');
  if (!w.files[KIND_PROOF].includes("const FILE = '20261011091000_legal_acceptance_scan_room_upload.sql';") || (w.files[KIND_PROOF].match(/^\s+case \d+:/gm) ?? []).length < 8) out.push('the new kind has no PGlite proof with planted mutations');
  if (!w.files['scripts/pgq/README.md'].includes('legal-acceptance-scan-room-upload.mjs')) out.push('the proofs README does not list the new proof');
  const counsel = w.files[COUNSEL];
  if (!counsel.includes(enBody) || !counsel.includes(esBody) || !counsel.includes(esTitle) || !/scan_room_upload/.test(counsel) || !/needs counsel/i.test(counsel)) out.push('docs/legal/consent-texts-for-counsel.md does not carry the question in English and Spanish, marked as needing counsel\'s read');
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
  // The review's finding, as the code was: a device with nothing on it sends its empty model on the strength of an old match.
  { rule: 'A1', name: 'an empty device sends over the account copy (Start a New Model, an emptied model)', plant: swap({ reconcile: (i) => (!i.local.hasContent && i.server && i.meta.baseRevision > 0 && i.server.revision === i.meta.baseRevision && i.server.schemaVersion === 1 && i.server.fingerprint !== null && !i.server.outOfBounds && !(i.meta.pending && i.pendingQueued) ? { kind: 'push', base: i.server.revision } : reconcile(i)) }) },
  { rule: 'A2', name: 'an empty device sends over the account copy (sweep)', plant: swap({ reconcile: (i) => { const a = reconcile(i); return a.kind === 'conflict' && !i.local.hasContent && i.server && i.meta.baseRevision === i.server.revision ? { kind: 'push', base: i.server.revision } : a; } }) },
  { rule: 'A1', name: 'Start a New Model takes the account copy without asking', plant: swap({ reconcile: (i) => reconcile({ ...i, meta: { ...i.meta, startedNew: false } }) }) },
  { rule: 'A2', name: 'Start a New Model takes the account copy without asking (sweep)', plant: swap({ reconcile: (i) => reconcile({ ...i, meta: { ...i.meta, startedNew: false } }) }) },
  { rule: 'A1', name: 'Start a New Model does not reset the base: the old match stands', plant: swap({ resetSyncBase: (m) => m }) , },
  { rule: 'A1', name: 'a lost model key is put to him as a question', plant: swap({ reconcile: (i) => { const a = reconcile(i); return a.kind === 'take_server' && !i.local.hasContent && i.meta.baseRevision === 0 && typeof i.server?.fingerprint === 'string' && i.server.fingerprint !== 'E' && i.meta.accountSeen ? { kind: 'conflict' } : a; } }) },
  { rule: 'A1', name: 'his answer over one revision stands for every later one', plant: swap({ reconcile: (i) => (i.meta.chosenOver !== null && i.server && !i.local.hasContent && typeof i.server.fingerprint === 'string' ? { kind: 'push', base: i.server.revision } : reconcile(i)) }) },
  { rule: 'A1', name: 'a save that landed and was saved over is called both-changed', plant: swap({ reconcile: (i) => reconcile({ ...i, server: i.server ? { ...i.server, recentWrites: [] } : null }) }) },
  { rule: 'A2', name: 'a save that landed and was saved over is called both-changed (sweep)', plant: swap({ reconcile: (i) => reconcile({ ...i, server: i.server ? { ...i.server, recentWrites: [] } : null }) }) },
  { rule: 'A1', name: 'a save the row names at its own base is believed', plant: swap({ reconcile: (i) => { const p0 = i.meta.pending; const hit = p0 && i.server && i.server.writeId !== p0.writeId ? (i.server.recentWrites ?? []).find((x) => x.writeId === p0.writeId) : undefined; return hit && i.local.fingerprint === p0!.fingerprint && !(i.pendingQueued) ? { kind: 'take_server' } : reconcile(i); } }) },
  { rule: 'A1', name: 'a removed account copy is sent again from a device that had matched it', plant: swap({ reconcile: (i) => { const a = reconcile(i); return a.kind === 'account_gone' ? { kind: 'push', base: 0 } : a; } }) },
  { rule: 'A2', name: 'a removed account copy is sent again (sweep)', plant: swap({ reconcile: (i) => { const a = reconcile(i); return a.kind === 'account_gone' ? { kind: 'push', base: 0 } : a; } }) },
  { rule: 'A1', name: 'an account copy over the limits is taken', plant: swap({ reconcile: (i) => reconcile({ ...i, server: i.server ? { ...i.server, outOfBounds: false } : null }) }) },
  { rule: 'A2', name: 'an account copy over the limits is taken or offered (sweep)', plant: swap({ reconcile: (i) => reconcile({ ...i, server: i.server ? { ...i.server, outOfBounds: false } : null }) }) },
  { rule: 'A1', name: 'a teammate who emptied the model is put to him as a question when nothing changed here', plant: swap({ reconcile: (i) => { const a = reconcile(i); return a.kind === 'take_server' && i.server?.fingerprint === 'E' && i.local.hasContent ? { kind: 'conflict' } : a; } }) },
  { rule: 'B2', name: 'the notes are reset on a device that never matched the account', plant: edit(HOOK, 'if (!modelFoundRef.current && meta.baseRevision > 0 && hasSyncHistory(meta))', 'if (!modelFoundRef.current)') },
  { rule: 'B2', name: 'the account model is fetched before the missing-table check', plant: edit(HOOK, "    const first = await fetchAccountHead(projectId);\n    if (!live()) return;\n", "    await fetchAccountModel(projectId);\n    const first = await fetchAccountHead(projectId);\n    if (!live()) return;\n") },
  { rule: 'D1', name: 'one yes covers every room scanned later (per job, not per room)', plant: swap({ scanGate: (m, mt) => (mt.scanChoice === 'account' ? 'send' : scanGate(m, mt)) }) },
  { rule: 'D1', name: 'the yes is not kept by room', plant: swap({ metaAfterScanYes: (mt) => ({ ...mt, scanChoice: 'account' }) }) },
  { rule: 'D1', name: 'the question does not name the rooms', plant: edit(STATUS, "          {askNames ? <Text style={styles.para} testID=\"lm-scan-ask-rooms\">{copy.scanAskRoomsBody(askNames)}</Text> : null}\n", '') },
  { rule: 'D1', name: 'the screen does not list the scanned rooms in the account', plant: edit(STATUS, "{accountScanNames && (status === 'saved' || status === 'waiting') ?", '{false ?') },
  { rule: 'D2', name: 'the scan id is sent', plant: swap({ modelForAccount: (m) => { const sent = modelForAccount(m); return { ...sent, rooms: sent.rooms.map((r, i) => (m.rooms[i].scanId ? { ...r, scanId: m.rooms[i].scanId } : r)) }; } }) },
  { rule: 'D2', name: 'Apple\'s own wall width is sent', plant: swap({ modelForAccount: (m) => { const sent = modelForAccount(m); return { ...sent, rooms: sent.rooms.map((r, i) => ({ ...r, room: { ...r.room, walls: r.room.walls.map((x, j) => ({ ...x, scanLengthM: m.rooms[i].room.walls[j].scanLengthM })) } })) }; } }) },
  { rule: 'D2', name: 'the per-number sources and the confidence are sent', plant: swap({ modelForAccount: (m) => { const sent = modelForAccount(m); return { ...sent, rooms: sent.rooms.map((r, i) => ({ ...r, room: { ...r.room, walls: r.room.walls.map((x, j) => ({ ...x, lengthSource: m.rooms[i].room.walls[j].lengthSource, confidence: m.rooms[i].room.walls[j].confidence })) } })) }; } }) },
  { rule: 'D2', name: 'the device\'s clock is sent', plant: swap({ modelForAccount: (m) => ({ ...modelForAccount(m), updatedAt: '2026-10-09T12:00:00.000Z' }) }) },
  { rule: 'D2', name: 'a room that names its scan is sent as typed', plant: swap({ modelForAccount: (m) => { const sent = modelForAccount(m); return { ...sent, rooms: sent.rooms.map((r, i) => ({ ...r, source: m.rooms[i].source })) }; } }) },
  { rule: 'I1', name: 'Keep on This Phone leaves the waiting save in the queue', plant: edit(HOOK, 'void commit(metaAfterScanNo(meta)).then(() => cancelQueuedAccountSave(projectId, userId)).then(run, run);', 'void commit(metaAfterScanNo(meta)).then(run, run);') },
  { rule: 'I1', name: 'the waiting save is taken back before the notes say "do not send"', plant: edit(HOOK, 'void commit(metaAfterScanNo(meta)).then(() => cancelQueuedAccountSave(projectId, userId)).then(run, run);', 'void cancelQueuedAccountSave(projectId, userId).then(() => commit(metaAfterScanNo(meta))).then(run, run);') },
  { rule: 'I1', name: 'the cancel takes every project\'s waiting save', plant: edit(QUEUE, "m.operation === 'rpc' && m.table === table && m.data?.id === recordId && m.rpc?.fn === fn && m.userId === userId", "m.operation === 'rpc' && m.table === table && m.rpc?.fn === fn && m.userId === userId") },
  { rule: 'I1', name: 'the cancel takes another account\'s waiting save', plant: edit(QUEUE, "m.operation === 'rpc' && m.table === table && m.data?.id === recordId && m.rpc?.fn === fn && m.userId === userId", "m.operation === 'rpc' && m.table === table && m.data?.id === recordId && m.rpc?.fn === fn") },
  { rule: 'I1', name: 'the cancel takes every write of the record', plant: edit(QUEUE, "m.operation === 'rpc' && m.table === table && m.data?.id === recordId && m.rpc?.fn === fn && m.userId === userId", "m.table === table && m.data?.id === recordId && m.userId === userId") },
  { rule: 'I1', name: 'the cancel writes a Not-saved line', plant: edit(QUEUE, "  if (remaining >= 0) notifyQueueChanged(remaining);\n  return { removed, readFailed };", "  if (removed > 0) await notifyDroppedWrites([], 'withdrawn', { asNotes: true });\n  if (remaining >= 0) notifyQueueChanged(remaining);\n  return { removed, readFailed };") },
  { rule: 'I1', name: 'a save on the wire goes on after Keep on This Phone', plant: edit(HOOK, "    // He tapped Keep on This Phone (or anything else that changed the notes) while the save was on the wire: stop here, decide again.\n    if (metaRef.current !== sending) { again.current = true; return; }\n", '') },
  { rule: 'I1', name: 'the sentence is keyed on the saved time', plant: swap({ accountMayHoldCopy: (m) => m.savedAt !== null }) },
  { rule: 'I1', name: 'the sentence forgets a save that was sent and not seen to land', plant: swap({ accountMayHoldCopy: (m) => m.baseRevision > 0 }) },
  { rule: 'I1', name: 'the panel says "kept on this phone only" while a copy may be in the account', plant: edit(STATUS, '{sync.accountMayHold ? `${copy.keptOnPhoneStoppedBody} ${copy.keptOnPhoneMayBody}` : copy.keptOnPhoneBody}', '{copy.keptOnPhoneBody}') },
  { rule: 'I1', name: 'a queued removal counts as a waiting save', plant: edit(IO, " && (m.operation !== 'rpc' || m.rpc?.fn === LIVING_MODEL_SAVE_FN)),", '),') },
  { rule: 'I1', name: 'a run that finishes after the tap writes the old answer back', plant: edit(HOOK, 'return cur ? { ...next, scanChoice: cur.scanChoice, scanConsentRoomIds: cur.scanConsentRoomIds } : next;', 'return next;') },
  { rule: 'I2', name: 'a removal that cannot be sent now is left in the queue', plant: edit(IO, "    if (outcome !== 'synced') {\n      await cloud.queue.cancelQueuedRpc(LIVING_MODELS_TABLE, projectId, LIVING_MODEL_REMOVE_FN, userId);\n      return 'not_removed';\n    }", "    if (outcome === 'failed') return 'not_removed';") },
  { rule: 'I2', name: 'the copy is called removed without reading the account', plant: edit(IO, "    return back.kind === 'none' ? 'removed' : 'not_removed';", "    return 'removed';") },
  { rule: 'I2', name: 'the first tap removes at once', plant: edit(STATUS, 'onPress={() => setConfirmRemove(true)}', 'onPress={() => sync.removeFromAccount()}') },
  { rule: 'I2', name: 'Keep on This Phone removes the account copy by itself', plant: edit(HOOK, 'void commit(metaAfterScanNo(meta)).then(() => cancelQueuedAccountSave(projectId, userId)).then(run, run);', 'void commit(metaAfterScanNo(meta)).then(() => cancelQueuedAccountSave(projectId, userId)).then(() => removeAccountModel(projectId, userId)).then(run, run);') },
  { rule: 'I2', name: 'removing the account copy clears the model on the device', plant: edit(HOOK, "      if (out === 'removed' && metaRef.current) await commit(metaAfterRemoval(metaRef.current));", "      if (out === 'removed' && metaRef.current) await commit(metaAfterRemoval(metaRef.current));\n      if (out === 'removed' && modelRef.current) await saveJobModel(userId, { ...modelRef.current, rooms: [] }, new Date().toISOString(), loadStateRef.current);") },
  { rule: 'I2', name: 'the account copy can be removed while the model is still being sent', plant: edit(HOOK, "    if (!meta || meta.scanChoice !== 'device') return;", '    if (!meta) return;') },
  { rule: 'I2', name: 'a device that finds the copy removed sends its own again', plant: edit(HOOK, "        setStatus('account_removed');\n        return;", "        await send(my, m, meta, local.fingerprint, 0, holds);\n        setStatus('account_removed');\n        return;") },
  { rule: 'I2', name: 'the notes after a removal still say "matched"', plant: swap({ metaAfterRemoval: (m) => ({ ...m, pending: null }) }) },
  { rule: 'I3', name: 'a trade cut short is never finished', plant: swap({ swapRecovery: () => 'discard' }) },
  { rule: 'I3', name: 'a swap note is always written over the model', plant: swap({ swapRecovery: () => 'finish' }) },
  { rule: 'I3', name: 'the kept model is not copied before it is written over (the two-write trade)', plant: edit(STORE, "  try { await AsyncStorage.setItem(swapKey, JSON.stringify(note)); } catch { return null; }\n", '') },
  { rule: 'I3', name: 'the model on screen is set aside before the kept model is copied', plant: edit(STORE, "  try { await AsyncStorage.setItem(swapKey, JSON.stringify(note)); } catch { return null; }\n  // (2) The model on screen, set aside.\n  if (!(await writeKeptModel(userId, projectId, aside))) {", "  if (!(await writeKeptModel(userId, projectId, aside))) {\n  try { await AsyncStorage.setItem(swapKey, JSON.stringify(note)); } catch { return null; }") },
  { rule: 'I3', name: 'the screen reads the model without finishing a trade', plant: edit(SCREEN, 'void recoverKeptSwap(userId, projectId, new Date().toISOString()).then(() => loadJobModel(userId, projectId)).then((loaded) => {', 'void loadJobModel(userId, projectId).then((loaded) => {') },
  { rule: 'I3', name: 'the swap note is removed before the kept model is back', plant: edit(STORE, "      if (todo === 'finish' && !(await saveJobModel(userId, note.incoming, nowIso, 'ready'))) return;\n", "      await AsyncStorage.removeItem(swapKey);\n      if (todo === 'finish' && !(await saveJobModel(userId, note.incoming, nowIso, 'ready'))) return;\n") },
  { rule: 'I3', name: 'the hook goes back to two separate writes', plant: edit(HOOK, "    const swapped = await swapKeptModel(userId, projectId, mine, k, new Date().toISOString(), loadStateRef.current);\n    if (!swapped) return false;", "    const swapped: KeptModel = { from: 'device', model: mine, keptAt: new Date().toISOString() };\n    if (!(await writeKeptModel(userId, projectId, swapped))) return false;\n    if (!(await saveJobModel(userId, k.model, new Date().toISOString(), loadStateRef.current))) return false;") },
  { rule: 'I4', name: 'a teammate\'s save is taken with no backup', plant: edit(HOOK, 'if (savedBySomeoneElse(head, userId) && local.hasContent && !keptRef.current) {', 'if (false as boolean) {') },
  { rule: 'I4', name: 'the backup is written after the model was replaced', plant: edit(HOOK, "        const ok = await saveJobModel(userId, accountModel, new Date().toISOString(), loadStateRef.current);\n        if (!live()) return;\n        if (!ok) { setStatus('failed'); return; }", "        if (!ok) { setStatus('failed'); return; }") },
  { rule: 'I4', name: 'the teammate\'s save is taken when the backup could not be written', plant: edit(HOOK, "if (!(await writeKeptModel(userId, projectId, aside))) { setChoiceFailed(true); setStatus('retrying'); scheduleRetry(); return; }", 'await writeKeptModel(userId, projectId, aside);') },
  { rule: 'I4', name: 'the person is not told his copy was kept', plant: edit(STATUS, "kept.why === 'teammate' ? copy.teammateKeptBody : kept.from", "kept.from") },
  { rule: 'I4', name: 'any number of rooms is taken', plant: swap({ accountModelRefusal: () => null }) },
  { rule: 'I4', name: 'the limits count rooms only', plant: swap({ accountModelRefusal: (m) => (m.rooms.length > 60 ? 'too_many_rooms' : null) }) },
  { rule: 'I4', name: 'the raw size check passes everything', plant: swap({ accountValueTooLarge: () => false }) },
  { rule: 'I4', name: 'the account copy is read through before it is counted', plant: edit(HOOK, 'const read = tooLarge ? null : readSavedModel(', 'const read = readSavedModel(') },
  { rule: 'I4', name: 'the limits are not put to the decision', plant: edit(HOOK, 'accountModel ? modelHasContent(accountModel) : undefined, outOfBounds }, pendingQueued });', 'accountModel ? modelHasContent(accountModel) : undefined }, pendingQueued });') },
  { rule: 'I5', name: 'a failed read-back sits on Checking your account', plant: edit(HOOK, "if (back.kind === 'offline' || back.kind === 'error' || back.kind === 'missing') { setStatus('retrying'); scheduleRetry(); return; }", "if (back.kind === 'offline' || back.kind === 'error' || back.kind === 'missing') { setStatus('checking'); return; }") },
  { rule: 'I5', name: 'a failed read-back is not retried', plant: edit(HOOK, "if (back.kind === 'offline' || back.kind === 'error' || back.kind === 'missing') { setStatus('retrying'); scheduleRetry(); return; }", "if (back.kind === 'offline' || back.kind === 'error' || back.kind === 'missing') { setStatus('retrying'); return; }") },
  { rule: 'I5', name: 'the turn limit leaves the line as it was', plant: edit(HOOK, "        if (again.current && gen.current === my) { setStatus('retrying'); scheduleRetry(); }\n", '') },
  { rule: 'I5', name: 'the model is turned to text at every draw', plant: edit(HOOK, 'const fingerprintNow = useMemo(() => (model ? modelFingerprint(model) : null), [model]);', 'const fingerprintNow = model ? modelFingerprint(model) : null;') },
  { rule: 'I5', name: 'a view-only seat\'s save is sent and shown as failed', plant: edit(HOOK, "    if (viewOnlyRef.current) { setStatus('view_only'); return; }\n", '') },
  { rule: 'I5', name: 'a view-only seat is told a save is waiting', plant: edit(HOOK, "unsent ? (viewOnly ? 'view_only' : 'waiting') : status;", "unsent ? 'waiting' : status;") },
  { rule: 'I5', name: 'the later try outlives the screen', plant: edit(HOOK, '      if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; }\n', '') },
  { rule: 'J1', name: 'the English question changes and the record still carries the old hash', plant: en('sync.scanAskBody', 'Saving it to your account sends the room’s name and its sizes: floor outline, ceiling height, walls, doors, windows and fixtures, and that the room came from a scan. No photo or video is sent. You are asked again for each scanned room you add later.') },
  { rule: 'J1', name: 'the Spanish question changes and the record still carries the old hash', plant: (w) => ({ ...w, ES: { ...w.ES, [`${K}sync.scanAskBody`]: `${String(w.ES[`${K}sync.scanAskBody`])} ` } }) },
  { rule: 'J1', name: 'the archived English words are edited', plant: edit(ARCHIVE_EN, 'No photo or video is sent.', 'No photo is sent.') },
  { rule: 'J1', name: 'the yes is not recorded', plant: edit(HOOK, '.then(() => { if (asked) recordScanUploadYes(userId, langRef.current); })', '') },
  { rule: 'J1', name: 'every Save to My Account tap is recorded as a yes to the question', plant: edit(HOOK, 'if (asked) recordScanUploadYes(userId, langRef.current);', 'recordScanUploadYes(userId, langRef.current);') },
  { rule: 'J1', name: 'the migration keeps the list of four', plant: edit(KIND_MIGRATION, "'scan_ack', 'scan_room_upload') then", "'scan_ack') then") },
  { rule: 'J1', name: 'the record is noted as the first-use scan notice', plant: edit(LEGAL, "void recorder.note(userId, [scanRoomUploadItem(lang)], 'in_app', at)", "void recorder.note(userId, [scanAckItem(lang)], 'in_app', at)") },
  { rule: 'J1', name: 'the counsel file loses the Spanish question', plant: (w) => ({ ...w, files: { ...w.files, [COUNSEL]: w.files[COUNSEL].split(String(w.ES[`${K}sync.scanAskBody`])).join('') } }) },
  { rule: 'J1', name: 'the question stops saying a later room is asked about again', plant: (w) => ({ ...w, EN: { ...w.EN, [`${K}sync.scanAskBody`]: String(w.EN[`${K}sync.scanAskBody`]).replace(' You are asked again for each scanned room you add later.', '') } }) },
  { rule: 'H1', name: 'the job id is compared as written (no lower())', plant: edit(MIGRATION, "check (lower(model ->> 'projectId') = lower(project_id::text))", "check ((model ->> 'projectId') = project_id::text)") },
  { rule: 'H1', name: 'the function stores any number of rooms', plant: edit(MIGRATION, "if pg_catalog.jsonb_array_length(p_model -> 'rooms') > 60 then", 'if false then') },
  { rule: 'H1', name: 'a viewer may remove the account copy', plant: edit(MIGRATION, "if not public.can_access_project(p_project_id, 'editor') then\n    raise exception 'living_model_remove:", "if not public.can_access_project(p_project_id) then\n    raise exception 'living_model_remove:") },
  { rule: 'H1', name: 'anon may call the remove function', plant: edit(MIGRATION, 'revoke all on function public.living_model_remove(uuid) from public, anon;\n', '') },
  { rule: 'H1', name: 'the row forgets its recent saves', plant: edit(MIGRATION, '         recent_writes = v_recent,\n', '') },
  { rule: 'H1', name: 'a removed job starts again at revision 1', plant: edit(MIGRATION, "select coalesce((select x.last_revision from public.living_model_removals x where x.project_id = p_project_id), 0) + 1 into v_start;", 'v_start := 1;') },
  { rule: 'H1', name: 'the remove function deletes every job\'s row', plant: edit(MIGRATION, 'delete from public.living_models m where m.project_id = p_project_id returning m.revision into v_rev;', 'delete from public.living_models m returning m.revision into v_rev;') },
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
  { rule: 'C2', name: 'an unsent change still reads saved', plant: edit(HOOK, '    status: shown, savedAt,', '    status, savedAt,') },
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
  { rule: 'F1', name: 'the both-changed branch takes the account by itself', plant: edit(HOOK, "        setStatus('conflict');\n        return;\n      }\n      case 'account_unreadable':", "        adopt(accountModel);\n        setStatus('conflict');\n        return;\n      }\n      case 'account_unreadable':") },
  { rule: 'F1', name: 'the next run reads the model the screen has not redrawn yet', plant: edit(HOOK, "    adopted.current = { model: m, from: propRef.current };\n    modelRef.current = m;\n", '') },
  { rule: 'F1', name: 'a redraw with the old model undoes the adopted one', plant: edit(HOOK, 'modelRef.current = adopted.current ? adopted.current.model : model;', 'modelRef.current = model;') },
  { rule: 'F1', name: 'Use the One in Your Account does not keep this device\'s model first', plant: edit(HOOK, "      const k: KeptModel = { from: 'device', model: mine, keptAt: new Date().toISOString() };\n      if (!(await writeKeptModel(userId, projectId, k))) return false;\n", "      const k: KeptModel = { from: 'device', model: mine, keptAt: new Date().toISOString() };\n") },
  { rule: 'F1', name: 'Keep This Device\'s Model goes ahead when the account copy could not be kept', plant: edit(HOOK, "    const k: KeptModel = { from: 'account', model: c.account, keptAt: new Date().toISOString() };\n    if (!(await writeKeptModel(userId, projectId, k))) return false;\n", "    const k: KeptModel = { from: 'account', model: c.account, keptAt: new Date().toISOString() };\n    await writeKeptModel(userId, projectId, k);\n") },
  { rule: 'F1', name: 'a new choice writes over a model still set aside', plant: edit(HOOK, 'if (!c || !meta || !mine || keptRef.current) return false;', 'if (!c || !meta || !mine) return false;') },
  { rule: 'F1', name: 'the kept model is removed after a choice', plant: edit(HOOK, "    conflictRef.current = null;\n    setConflict(null);\n    adopt(c.account);", "    conflictRef.current = null;\n    setConflict(null);\n    void removeKeptModel(userId, projectId);\n    adopt(c.account);") },
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

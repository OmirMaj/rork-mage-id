// utils/livingModel/syncCore.ts — the rules for saving a job model to the
// account (pure: no React, no storage, no network). The reads and writes are in
// syncIo.ts (the server, through the offline queue) and syncStore.ts (the
// device); hooks/useLivingModelSync.ts runs them.
//
// THE MODEL IS LOCAL FIRST. Every change is saved on the device at once
// (store.ts), exactly as before. After that the model is sent to
// public.living_models (supabase/migrations/20261011090000_living_models.sql)
// through public.living_model_save, which takes the REVISION the save was based
// on and refuses a stale one.
//
// WHAT DECIDES (reconcile, below). This device remembers the account revision
// its model was last equal to (`baseRevision`) and a fingerprint of the model at
// that moment (`baseFingerprint`). "This device changed" is not a flag that can
// be lost: it is the model on the device no longer matching that fingerprint.
// THE INTENDED RULES, in the order they are asked:
//   a save of this device is still queued        wait
//   no account row, never matched                send this device's model, if it has one
//   no account row, and one WAS matched          the account copy was removed: say so, send nothing
//   the account model is a newer build's         neither read nor written over
//   the account model is larger than the app allows   refused: not opened here, not written over
//   this device's pending save IS the row        landed
//   this device's pending save landed and someone saved after it
//                                                the account is ahead (not "both changed")
//   THIS DEVICE HAS NO CONTENT and the account's copy has some
//                                                NEVER SENT. Taken when nothing was changed here
//                                                on purpose; asked when he started a new model or
//                                                emptied this one. (Only his own answer to that
//                                                question, Keep This Device's Model, sends it.)
//   account ahead, this device unchanged         take the account's
//   this device changed, account the same        send this device's
//   BOTH changed                                 NEVER decided here. The person is asked.
//
// BEFORE THE MIGRATION IS APPLIED the read answers "no such table". That is
// `missing`: the model stays device-only with the sentence it has today, and
// nothing is ever queued (a write to a missing table is a refusal the queue
// would report as a failure).
//
// SCANS. A room dropped in from a phone scan carries that scan's sizes. The
// phone tells people a scan's measurements stay on the phone, so a scanned
// room that is not already in the account is NOT SENT until the person says
// yes TO THAT ROOM (`scanGate`: a room scanned and added later is asked about
// again). "Keep on This Phone" keeps the whole model on the device until he
// changes it. What is sent is built by `modelForAccount`, field by field:
// nothing that is not named there leaves the device. Of a scanned room that
// is its name and kind, where it sits, its sizes (floor outline, ceiling
// height, walls, doors, windows, fixtures) and the one word "scan". NOT sent:
// Apple's own wall width, the id of the scan, which single numbers were typed
// over, how sure the scan was, the raw scan data, the scan list, the phone's
// model, the capture time, and the device's clock (the server sets its own).
import type { CeilingHeight, Pt, ScanObject, ScanOpening, ScanWall } from '@/utils/roomScan/types';
import { MAX_CEILING_M, MAX_ROOMS, MAX_ROOM_SIDE_M } from './modelCore';
import { isTaskStage, type TaskStage } from './stageCore';
import type { JobModel, PlacedRoom } from './types';

export const LIVING_MODELS_TABLE = 'living_models';
export const LIVING_MODEL_SAVE_FN = 'living_model_save';
/** The one function that deletes the account copy (the person's own confirmed tap, nothing else). */
export const LIVING_MODEL_REMOVE_FN = 'living_model_remove';
/** The JobModel version this build writes. The server refuses a writer older than the row. */
export const LIVING_MODEL_SCHEMA_VERSION = 1;

// ── what leaves the device ───────────────────────────────────────────────────

const pt = (p: Pt): Pt => ({ x: p.x, y: p.y });

/** True when a placed room came from a phone scan (its label says so, or it still names its scan). */
export const roomCameFromScan = (r: Pick<PlacedRoom, 'source' | 'scanId'>): boolean => r.source === 'scan' || typeof r.scanId === 'string';

function wallForAccount(w: ScanWall): ScanWall {
  const out = { id: w.id, label: w.label, a: pt(w.a), b: pt(w.b), lengthM: w.lengthM, heightM: w.heightM, curved: w.curved, onOutline: w.onOutline } as ScanWall;
  if (Array.isArray(w.polygon)) out.polygon = w.polygon.map((q) => ({ u: q.u, v: q.v }));
  return out;
}

function openingForAccount(o: ScanOpening): ScanOpening {
  return { id: o.id, kind: o.kind, wallId: o.wallId, offsetM: o.offsetM, widthM: o.widthM, heightM: o.heightM, sillM: o.sillM } as ScanOpening;
}

function objectForAccount(o: ScanObject): ScanObject {
  return { id: o.id, category: o.category, center: pt(o.center), widthM: o.widthM, depthM: o.depthM, heightM: o.heightM, rotationRad: o.rotationRad } as ScanObject;
}

function ceilingForAccount(c: CeilingHeight): CeilingHeight {
  return { known: c.known, min: c.min, max: c.max, typical: c.typical } as CeilingHeight;
}

function roomForAccount(r: PlacedRoom): PlacedRoom {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    level: r.level,
    placement: { xM: r.placement.xM, yM: r.placement.yM, rotationDeg: r.placement.rotationDeg },
    // The one word that says the room came from a scan. The scan's own id stays on the phone.
    source: roomCameFromScan(r) ? 'scan' : 'typed',
    room: {
      walls: r.room.walls.map(wallForAccount),
      openings: r.room.openings.map(openingForAccount),
      objects: (r.room.objects ?? []).map(objectForAccount),
      floor: r.room.floor.map(pt),
      ceilingHeightM: ceilingForAccount(r.room.ceilingHeightM),
    },
  };
}

/**
 * The model as it is sent: every field named, one by one. A field this
 * function does not name is not sent. Of a scan, only the placed room's name,
 * its sizes and the word "scan" are named here. The time is left empty: the
 * server keeps its own (living_models.updated_at), never the device's clock.
 */
export function modelForAccount(model: JobModel): JobModel {
  const links: Record<string, string[]> = {};
  for (const [roomId, ids] of Object.entries(model.links ?? {})) links[roomId] = ids.filter((t) => typeof t === 'string');
  const out: JobModel = { version: 1, projectId: model.projectId, rooms: model.rooms.map(roomForAccount), links, updatedAt: '' };
  if (model.stages) {
    const stages: Record<string, TaskStage> = {};
    for (const [taskId, st] of Object.entries(model.stages)) if (isTaskStage(st)) stages[taskId] = st;
    if (Object.keys(stages).length) out.stages = stages;
  }
  return out;
}

// ── what this build will accept from the account ─────────────────────────────

/** The same limits the Room Editor keeps (modelCore), and room for any real scan. The save function refuses beyond the counts too. */
export const ACCOUNT_LIMITS = Object.freeze({ rooms: MAX_ROOMS, wallsPerRoom: 200, openingsPerRoom: 400, objectsPerRoom: 400, floorPoints: 400, wallM: MAX_ROOM_SIDE_M, heightM: MAX_CEILING_M });

export type AccountModelRefusal = 'too_many_rooms' | 'room_too_detailed' | 'room_too_large';

/**
 * Why an account copy is NOT opened on this device, or null when it is within
 * what the app itself could have made. A teammate's build, or anyone with the
 * API, could have stored more: that is refused here, said on the screen, and
 * the device's model is left as it is.
 */
export function accountModelRefusal(model: JobModel): AccountModelRefusal | null {
  const L = ACCOUNT_LIMITS;
  const tol = 1.001;
  if (model.rooms.length > L.rooms) return 'too_many_rooms';
  for (const r of model.rooms) {
    const s = r.room;
    if (s.walls.length > L.wallsPerRoom || s.openings.length > L.openingsPerRoom || (s.objects ?? []).length > L.objectsPerRoom || s.floor.length > L.floorPoints) return 'room_too_detailed';
    for (const w of s.walls) {
      const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
      if (!(len <= L.wallM * tol) || (typeof w.heightM === 'number' && !(w.heightM <= L.heightM * tol))) return 'room_too_large';
    }
    const c = s.ceilingHeightM;
    if (c && c.known && !(c.typical <= L.heightM * tol)) return 'room_too_large';
  }
  return null;
}

/** True when the model holds anything a person made: a room, a tick or a picked stage. */
export function modelHasContent(model: JobModel): boolean {
  return model.rooms.length > 0
    || Object.values(model.links ?? {}).some((ids) => ids.length > 0)
    || Object.keys(model.stages ?? {}).length > 0;
}

function stable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`;
}

/**
 * A fingerprint of what the model SAYS (the sent form, keys in a fixed order,
 * the save time left out). Two models with one fingerprint are the same model
 * for every purpose here; the length is part of it, beside two different hashes.
 */
export function modelFingerprint(model: JobModel): string {
  const sent = modelForAccount(model);
  const text = stable({ rooms: sent.rooms, links: sent.links, stages: sent.stages ?? {} });
  let a = 0x811c9dc5;
  let b = 5381;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = (Math.imul(b, 33) + c) >>> 0;
  }
  return `${text.length.toString(36)}.${a.toString(36)}.${b.toString(36)}`;
}

// ── what this device remembers about the account ─────────────────────────────

/** 'unasked' until the person answers a scan question for this job. 'device' = Keep on This Phone. */
export type ScanChoice = 'unasked' | 'account' | 'device';

export interface PendingSave {
  writeId: string;
  /** The account revision the save was based on. */
  base: number;
  /** The fingerprint of the model that was sent. */
  fingerprint: string;
  /** The scanned rooms in the model that was sent (in the account once this save lands). */
  scanRoomIds: string[];
}

export interface ModelSyncMeta {
  /** True once a read of the table has answered (the migration is applied). Nothing is queued before that. */
  accountSeen: boolean;
  /** The account revision this device's model was last equal to. 0 = never. */
  baseRevision: number;
  /** The fingerprint of the model at that revision. null = never. */
  baseFingerprint: string | null;
  /** A save that was sent or queued and has not been seen on the account yet. */
  pending: PendingSave | null;
  /** The server's time for the account copy this device last matched. */
  savedAt: string | null;
  /** The write ids this device made, newest last (a few). The account row's id among them means "this device". */
  ownWriteIds: string[];
  scanChoice: ScanChoice;
  /** Scanned rooms known to be in the account copy already (sent after a yes, or put there by a teammate). */
  accountScanRoomIds: string[];
  /** Scanned rooms he said yes to sending, room by room. A room scanned and added later is not here, so it is asked about. */
  scanConsentRoomIds: string[];
  /** He tapped Start a New Model and nothing has been matched with the account since: the account's copy is put to him first. */
  startedNew: boolean;
  /** The account revision he chose this device's model OVER (Keep This Device's Model). null = no such choice stands. */
  chosenOver: number | null;
  /** True once any save was handed to the queue or the wire: a copy may be in the account even if this device never saw it land. */
  everSent: boolean;
}

export const EMPTY_SYNC_META: ModelSyncMeta = Object.freeze({
  accountSeen: false, baseRevision: 0, baseFingerprint: null, pending: null, savedAt: null,
  ownWriteIds: [] as string[], scanChoice: 'unasked' as ScanChoice, accountScanRoomIds: [] as string[],
  scanConsentRoomIds: [] as string[], startedNew: false, chosenOver: null, everSent: false,
});

const MAX_OWN_WRITE_IDS = 8;
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const strList = (v: unknown, max: number): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0).slice(-max) : []);
const rev = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0);
const freshMeta = (): ModelSyncMeta => ({ ...EMPTY_SYNC_META, ownWriteIds: [], accountScanRoomIds: [], scanConsentRoomIds: [] });

/** Read saved meta. Anything that is not sound meta reads as "never synced", which can only ever lead to a question, not to a loss. */
export function parseSyncMeta(raw: string | null | undefined): ModelSyncMeta {
  if (!raw) return freshMeta();
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not meta');
    const p = v.pending as Record<string, unknown> | null | undefined;
    const pending: PendingSave | null = p && typeof p === 'object' && str(p.writeId) && str(p.fingerprint)
      ? { writeId: p.writeId as string, base: rev(p.base), fingerprint: p.fingerprint as string, scanRoomIds: strList(p.scanRoomIds, 500) } : null;
    const baseRevision = rev(v.baseRevision);
    const baseFingerprint = baseRevision > 0 ? str(v.baseFingerprint) : null;
    const matched = baseFingerprint ? baseRevision : 0;
    return {
      accountSeen: v.accountSeen === true,
      baseRevision: matched,
      baseFingerprint,
      pending,
      savedAt: str(v.savedAt),
      ownWriteIds: strList(v.ownWriteIds, MAX_OWN_WRITE_IDS),
      scanChoice: v.scanChoice === 'account' || v.scanChoice === 'device' ? v.scanChoice : 'unasked',
      accountScanRoomIds: strList(v.accountScanRoomIds, 500),
      scanConsentRoomIds: strList(v.scanConsentRoomIds, 500),
      startedNew: v.startedNew === true,
      chosenOver: matched > 0 && rev(v.chosenOver) === matched ? matched : null,
      everSent: v.everSent === true || pending !== null,
    };
  } catch {
    return freshMeta();
  }
}

/** Has this device's model changed since it last matched the account? Never synced: any content counts. */
export function deviceChanged(meta: ModelSyncMeta, local: { hasContent: boolean; fingerprint: string }): boolean {
  if (meta.baseRevision === 0 || meta.baseFingerprint === null) return local.hasContent;
  return local.fingerprint !== meta.baseFingerprint;
}

/**
 * Forget which account revision this device matched, so the account's copy is
 * looked at FIRST and nothing here is sent on the strength of an old match.
 * Called when the saved model is gone from the device while the notes still
 * say "matched" (the model key was lost), and, with `startedNew`, when he taps
 * Start a New Model. A save still on its way is left alone: it is his.
 */
export function resetSyncBase(meta: ModelSyncMeta, opts: { startedNew: boolean }): ModelSyncMeta {
  return { ...meta, baseRevision: 0, baseFingerprint: null, chosenOver: null, startedNew: meta.startedNew || opts.startedNew };
}

/** Does anything in the notes say this device once matched or sent a model? (Then losing the model key is not "a new job".) */
export const hasSyncHistory = (meta: ModelSyncMeta): boolean => meta.baseRevision > 0 || meta.pending !== null || meta.everSent;

/** May a copy of this model be in the account? True from the first save handed to the queue, whether or not it was ever seen to land. */
export const accountMayHoldCopy = (meta: ModelSyncMeta): boolean => meta.everSent || meta.baseRevision > 0 || meta.pending !== null;

// ── the account row ──────────────────────────────────────────────────────────

/** One save the account remembers: its id and the revision it landed at. */
export interface LandedWrite { writeId: string; revision: number }

export interface ServerHead {
  revision: number;
  writeId: string | null;
  schemaVersion: number;
  updatedAt: string;
  updatedBy: string | null;
  /** The last few saves of this row (the function keeps them), newest last. Empty when the row does not carry them. */
  recentWrites: LandedWrite[];
}

function parseRecentWrites(v: unknown): LandedWrite[] {
  if (!Array.isArray(v)) return [];
  const out: LandedWrite[] = [];
  for (const x of v.slice(-16)) {
    if (!x || typeof x !== 'object') continue;
    const w = str((x as Record<string, unknown>).w);
    const r = (x as Record<string, unknown>).r;
    if (w && typeof r === 'number' && Number.isInteger(r) && r >= 1) out.push({ writeId: w, revision: r });
  }
  return out;
}

/** One row of public.living_models as PostgREST returns it, or null when it is not a row this build understands. */
export function parseServerHead(row: unknown): ServerHead | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  if (typeof r.revision !== 'number' || !Number.isInteger(r.revision) || r.revision < 1) return null;
  if (typeof r.updated_at !== 'string' || r.updated_at === '') return null;
  return {
    revision: r.revision,
    writeId: str(r.last_write_id),
    schemaVersion: typeof r.schema_version === 'number' ? r.schema_version : 1,
    updatedAt: r.updated_at,
    updatedBy: str(r.updated_by),
    recentWrites: parseRecentWrites(r.recent_writes),
  };
}

/**
 * Is this the answer of a database that does not have the table yet? 42P01 is
 * Postgres's undefined_table; PGRST205 is PostgREST not finding it in its
 * schema cache; PGRST202 is the same for the function. Only these: any other
 * error is a real failure and is shown as one.
 */
export function isMissingTable(err: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!err) return false;
  const code = err.code ?? '';
  if (code === '42P01' || code === 'PGRST205' || code === 'PGRST202') return true;
  const m = (err.message ?? '').toLowerCase();
  return m.includes(LIVING_MODELS_TABLE) && (m.includes('does not exist') || m.includes('could not find the table') || m.includes('schema cache'));
}

// ── reconcile ────────────────────────────────────────────────────────────────

export interface ReconcileServer {
  revision: number;
  writeId: string | null;
  schemaVersion: number;
  /** The last few saves the row remembers (ServerHead.recentWrites). */
  recentWrites?: readonly LandedWrite[];
  /** undefined = the model itself has not been fetched yet. null = fetched, and this build cannot read it. */
  fingerprint?: string | null;
  /** Known once the model was fetched: does the account's copy hold a room, a tick or a stage? */
  hasContent?: boolean;
  /** Known once the model was fetched: it is larger than the app allows (accountModelRefusal). */
  outOfBounds?: boolean;
}

export interface ReconcileInput {
  local: { hasContent: boolean; fingerprint: string };
  meta: ModelSyncMeta;
  /** null = the account has no row for this job. */
  server: null | ReconcileServer;
  /** True while this device's pending save is still in the offline queue. */
  pendingQueued: boolean;
}

export type ReconcileAction =
  /** Neither side has a model. */
  | { kind: 'nothing' }
  /** A save of this device's is still queued: wait for it. */
  | { kind: 'wait' }
  /** This device's pending save IS the account's row. */
  | { kind: 'landed' }
  /** Both sides hold the same model. */
  | { kind: 'in_sync' }
  /** This device is strictly ahead (or the account never had a row): send it, based on `base`. */
  | { kind: 'push'; base: number }
  /** The account is strictly ahead and nothing was changed here on purpose: take the account's. */
  | { kind: 'take_server' }
  /** The decision needs the account's model itself: fetch it and ask again. */
  | { kind: 'need_model' }
  /** Both changed since they last matched, or this device is empty on purpose while the account is not. The person chooses. Nothing is written by this function's caller until he does. */
  | { kind: 'conflict' }
  /** The account's model was saved by a newer build. This build neither reads it nor writes over it. */
  | { kind: 'account_unreadable' }
  /** The account's model is larger than the app allows. It is not opened here and not written over. */
  | { kind: 'account_refused' }
  /** This device matched an account copy and the account now has none: it was removed. Nothing is sent until he says so. */
  | { kind: 'account_gone' };

/**
 * A save of this device's that LANDED and was then saved over by someone else:
 * the row's own list of recent saves names it. The notes then stand on that
 * save (its revision, its fingerprint), so what follows is "the account is
 * ahead", not "both changed". Anything else: the notes as they are.
 */
export function settleLandedPending(meta: ModelSyncMeta, server: Pick<ReconcileServer, 'writeId' | 'revision' | 'recentWrites'> | null): ModelSyncMeta {
  const p = meta.pending;
  if (!p || !server || server.writeId === p.writeId) return meta;
  const landed = (server.recentWrites ?? []).find((w) => w.writeId === p.writeId);
  if (!landed || landed.revision <= p.base || landed.revision >= server.revision) return meta;
  return { ...meta, baseRevision: landed.revision, baseFingerprint: p.fingerprint, pending: null, accountScanRoomIds: [...p.scanRoomIds], startedNew: false, chosenOver: null, everSent: true };
}

/**
 * Decide what to do with the device's model and the account's. Pure, total,
 * and it never returns a choice between two changed models: that is `conflict`.
 * It never returns a send from a device with no content over an account copy
 * that has some, unless the person chose exactly that (`chosenOver`).
 */
export function reconcile(input: ReconcileInput): ReconcileAction {
  const { local, server, pendingQueued } = input;
  if (input.meta.pending && pendingQueued) return { kind: 'wait' };
  if (!server) {
    if (!local.hasContent) return { kind: 'nothing' };
    return input.meta.baseRevision > 0 ? { kind: 'account_gone' } : { kind: 'push', base: 0 };
  }
  if (server.schemaVersion > LIVING_MODEL_SCHEMA_VERSION || server.fingerprint === null) return { kind: 'account_unreadable' };
  if (server.outOfBounds === true) return { kind: 'account_refused' };
  if (input.meta.pending && server.writeId !== null && server.writeId === input.meta.pending.writeId) return { kind: 'landed' };
  const meta = settleLandedPending(input.meta, server);
  const changed = deviceChanged(meta, local);
  const sameRevision = meta.baseRevision > 0 && server.revision === meta.baseRevision;
  // A device with nothing on it never sends over an account copy that has something.
  if (!local.hasContent && meta.chosenOver !== server.revision) {
    if (!changed && sameRevision && !meta.startedNew) return { kind: 'in_sync' };
    if (server.fingerprint === undefined) return { kind: 'need_model' };
    if (server.hasContent !== false) return changed || meta.startedNew ? { kind: 'conflict' } : { kind: 'take_server' };
    // Both are empty: the ordinary rules below are safe.
  }
  if (!changed) return sameRevision ? { kind: 'in_sync' } : { kind: 'take_server' };
  // This device changed.
  if (sameRevision) return { kind: 'push', base: server.revision };
  // The account moved too (or the two were never matched). The same model on both sides is not a conflict.
  if (server.fingerprint === undefined) return { kind: 'need_model' };
  if (server.fingerprint === local.fingerprint) return { kind: 'in_sync' };
  return { kind: 'conflict' };
}

// ── scans ────────────────────────────────────────────────────────────────────

/** The rooms that came from a phone scan. */
export function scanRoomIds(model: JobModel): string[] {
  return model.rooms.filter(roomCameFromScan).map((r) => r.id);
}

/** The scanned rooms that are NOT in the account copy yet: sending the model would send their sizes for the first time. */
export function unsentScanRoomIds(model: JobModel, meta: Pick<ModelSyncMeta, 'accountScanRoomIds'>): string[] {
  const there = new Set(meta.accountScanRoomIds);
  return scanRoomIds(model).filter((id) => !there.has(id));
}

/** The scanned rooms he has NOT been asked about: not in the account, and no yes on record for that room. */
export function unaskedScanRoomIds(model: JobModel, meta: Pick<ModelSyncMeta, 'accountScanRoomIds' | 'scanConsentRoomIds'>): string[] {
  const yes = new Set(meta.scanConsentRoomIds);
  return unsentScanRoomIds(model, meta).filter((id) => !yes.has(id));
}

export type ScanGate =
  /** Nothing stands in the way of sending. */
  | 'send'
  /** A scanned room would be sent for the first time and he has not said yes to THAT room: ask, send nothing. */
  | 'ask'
  /** He chose Keep on This Phone: the whole model stays on the device. */
  | 'device';

/** May this model be sent? One yes covers the scanned rooms that were named in the question, and no others. */
export function scanGate(model: JobModel, meta: Pick<ModelSyncMeta, 'scanChoice' | 'accountScanRoomIds' | 'scanConsentRoomIds'>): ScanGate {
  if (meta.scanChoice === 'device') return 'device';
  return unaskedScanRoomIds(model, meta).length > 0 ? 'ask' : 'send';
}

/** Notes after Save to My Account: a yes for the scanned rooms in the model at that moment, by id. */
export function metaAfterScanYes(meta: ModelSyncMeta, model: JobModel): ModelSyncMeta {
  const ids = new Set([...meta.scanConsentRoomIds, ...unsentScanRoomIds(model, meta)]);
  return { ...meta, scanChoice: 'account', scanConsentRoomIds: [...ids].slice(-500) };
}

/** Notes after Keep on This Phone: nothing more is sent, and no yes stays on record for a room that was not sent. */
export function metaAfterScanNo(meta: ModelSyncMeta): ModelSyncMeta {
  const there = new Set(meta.accountScanRoomIds);
  return { ...meta, scanChoice: 'device', scanConsentRoomIds: meta.scanConsentRoomIds.filter((id) => there.has(id)) };
}

// ── the status line ──────────────────────────────────────────────────────────

export type SyncStatus =
  /** The table is there and neither side has a model yet: there is nothing to say. */
  | 'empty'
  /** No account copy: signed out, no backend, a sample job, or the table is not there yet. Today's sentence. */
  | 'device'
  /** The first read of the account is in flight. */
  | 'checking'
  /** The account could not be read to the end this time; another try is scheduled. */
  | 'retrying'
  /** The account holds this device's model (read back, or the two were compared). */
  | 'saved'
  /** A save is queued, or the account cannot be reached and there is something to send. */
  | 'waiting'
  /** The account refused the save or answered with an error. */
  | 'failed'
  /** His seat on this job reads the model and may not change it: nothing is sent, and that is not a failure. */
  | 'view_only'
  /** A scanned room would be sent for the first time: nothing is sent until he answers. */
  | 'scan_ask'
  /** He chose Keep on This Phone. */
  | 'kept_on_device'
  /** Both changed, or this device is empty on purpose: he is being asked. */
  | 'conflict'
  /** The account's model is from a newer build. */
  | 'account_newer'
  /** The account's model is larger than the app allows: not opened here. */
  | 'account_too_large'
  /** The account copy this device once matched was removed. */
  | 'account_removed';

/** The arguments of the one server write, in the function's own names. */
export function saveArgs(projectId: string, model: JobModel, base: number, writeId: string): Record<string, unknown> {
  return {
    p_project_id: projectId,
    p_model: modelForAccount(model),
    p_base_revision: base,
    p_write_id: writeId,
    p_schema_version: LIVING_MODEL_SCHEMA_VERSION,
  };
}

/** The arguments of the one server delete. */
export function removeArgs(projectId: string): Record<string, unknown> {
  return { p_project_id: projectId };
}

/** Meta after the account was seen to hold `fingerprint` at `head`. `accountScanRoomIds` are the scanned rooms in that account copy. */
export function metaAfterMatch(meta: ModelSyncMeta, head: ServerHead, fingerprint: string, accountScanRoomIds: readonly string[]): ModelSyncMeta {
  return {
    ...meta,
    accountSeen: true,
    baseRevision: head.revision,
    baseFingerprint: fingerprint,
    pending: null,
    savedAt: head.updatedAt,
    accountScanRoomIds: [...accountScanRoomIds],
    startedNew: false,
    chosenOver: null,
  };
}

/** Meta after Keep This Device's Model: the notes stand on the account's revision, and his choice over THAT revision is remembered. */
export function metaAfterKeepDevice(meta: ModelSyncMeta, head: ServerHead, accountFingerprint: string, accountScanRoomIds: readonly string[]): ModelSyncMeta {
  return { ...metaAfterMatch(meta, head, accountFingerprint, accountScanRoomIds), savedAt: meta.savedAt, chosenOver: head.revision };
}

/** Meta after a save was handed to the queue. */
export function metaAfterSend(meta: ModelSyncMeta, pending: PendingSave): ModelSyncMeta {
  return { ...meta, pending, everSent: true, ownWriteIds: [...meta.ownWriteIds, pending.writeId].slice(-MAX_OWN_WRITE_IDS) };
}

/** Meta after the account copy was removed (seen gone): nothing is matched, nothing is on its way, no scanned room is "in the account". */
export function metaAfterRemoval(meta: ModelSyncMeta): ModelSyncMeta {
  return { ...meta, baseRevision: 0, baseFingerprint: null, pending: null, savedAt: null, accountScanRoomIds: [], scanConsentRoomIds: [], chosenOver: null, startedNew: false, everSent: false };
}

/** Was the account's current row written by THIS device? */
export function isThisDevice(meta: Pick<ModelSyncMeta, 'ownWriteIds'>, head: Pick<ServerHead, 'writeId'>): boolean {
  return head.writeId !== null && meta.ownWriteIds.includes(head.writeId);
}

/**
 * Is the account's copy someone ELSE's work? True when another person saved
 * it. Then the model on this device is set aside before the account's takes
 * its place (when the kept place is free), and the screen says so.
 */
export function savedBySomeoneElse(head: Pick<ServerHead, 'updatedBy'>, userId: string | null | undefined): boolean {
  return !!userId && head.updatedBy !== userId;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Only a real project id reaches the server (a sample job's id is not one). */
export const isSyncableProjectId = (projectId: string | null | undefined): projectId is string => typeof projectId === 'string' && UUID_RE.test(projectId);

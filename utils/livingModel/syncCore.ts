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
//   no account row                         send this device's model, if it has one
//   account ahead, this device unchanged   take the account's
//   this device changed, account the same  send this device's
//   BOTH changed                           NEVER decided here. The person is asked.
//
// BEFORE THE MIGRATION IS APPLIED the read answers "no such table". That is
// `missing`: the model stays device-only with the sentence it has today, and
// nothing is ever queued (a write to a missing table is a refusal the queue
// would report as a failure).
//
// SCANS. A room dropped in from a phone scan carries that scan's sizes. The
// phone tells people a scan's measurements stay on the phone, so a model with
// a scanned room that is not already in the account is NOT SENT until the
// person says yes, once per job (`scanGate`). "Keep on This Phone" keeps the
// whole model on the device until he changes it. What is sent is built by
// `modelForAccount`, field by field: nothing that is not named there leaves
// the device, so Apple's raw scan data, the scan list, the phone's model and
// the capture time cannot ride along.
import type { CeilingHeight, Pt, ScanObject, ScanOpening, ScanWall } from '@/utils/roomScan/types';
import { isTaskStage, type TaskStage } from './stageCore';
import type { JobModel, PlacedRoom } from './types';

export const LIVING_MODELS_TABLE = 'living_models';
export const LIVING_MODEL_SAVE_FN = 'living_model_save';
/** The JobModel version this build writes. The server refuses a writer older than the row. */
export const LIVING_MODEL_SCHEMA_VERSION = 1;

// ── what leaves the device ───────────────────────────────────────────────────

const pt = (p: Pt): Pt => ({ x: p.x, y: p.y });

function wallForAccount(w: ScanWall): ScanWall {
  const out: ScanWall = {
    id: w.id, label: w.label, a: pt(w.a), b: pt(w.b), lengthM: w.lengthM, scanLengthM: w.scanLengthM,
    lengthSource: w.lengthSource, heightM: w.heightM, confidence: w.confidence, curved: w.curved, onOutline: w.onOutline,
  };
  if (Array.isArray(w.polygon)) out.polygon = w.polygon.map((q) => ({ u: q.u, v: q.v }));
  return out;
}

function openingForAccount(o: ScanOpening): ScanOpening {
  return {
    id: o.id, kind: o.kind, wallId: o.wallId, offsetM: o.offsetM, widthM: o.widthM, heightM: o.heightM, sillM: o.sillM,
    confidence: o.confidence, widthSource: o.widthSource, heightSource: o.heightSource,
  };
}

function objectForAccount(o: ScanObject): ScanObject {
  return {
    id: o.id, category: o.category, center: pt(o.center), widthM: o.widthM, depthM: o.depthM, heightM: o.heightM,
    rotationRad: o.rotationRad, confidence: o.confidence,
  };
}

function ceilingForAccount(c: CeilingHeight): CeilingHeight {
  return { known: c.known, min: c.min, max: c.max, typical: c.typical, source: c.source };
}

function roomForAccount(r: PlacedRoom): PlacedRoom {
  const out: PlacedRoom = {
    id: r.id,
    name: r.name,
    kind: r.kind,
    level: r.level,
    placement: { xM: r.placement.xM, yM: r.placement.yM, rotationDeg: r.placement.rotationDeg },
    source: r.source,
    room: {
      walls: r.room.walls.map(wallForAccount),
      openings: r.room.openings.map(openingForAccount),
      objects: (r.room.objects ?? []).map(objectForAccount),
      floor: r.room.floor.map(pt),
      ceilingHeightM: ceilingForAccount(r.room.ceilingHeightM),
    },
  };
  if (typeof r.scanId === 'string') out.scanId = r.scanId;
  return out;
}

/**
 * The model as it is sent: every field named, one by one. A field this
 * function does not name is not sent. Nothing of a scan but the placed room's
 * sizes is named here.
 */
export function modelForAccount(model: JobModel): JobModel {
  const links: Record<string, string[]> = {};
  for (const [roomId, ids] of Object.entries(model.links ?? {})) links[roomId] = ids.filter((t) => typeof t === 'string');
  const out: JobModel = { version: 1, projectId: model.projectId, rooms: model.rooms.map(roomForAccount), links, updatedAt: model.updatedAt };
  if (model.stages) {
    const stages: Record<string, TaskStage> = {};
    for (const [taskId, st] of Object.entries(model.stages)) if (isTaskStage(st)) stages[taskId] = st;
    if (Object.keys(stages).length) out.stages = stages;
  }
  return out;
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

/** 'unasked' until the person answers the scan question for this job. */
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
}

export const EMPTY_SYNC_META: ModelSyncMeta = Object.freeze({
  accountSeen: false, baseRevision: 0, baseFingerprint: null, pending: null, savedAt: null,
  ownWriteIds: [] as string[], scanChoice: 'unasked' as ScanChoice, accountScanRoomIds: [] as string[],
});

const MAX_OWN_WRITE_IDS = 8;
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const strList = (v: unknown, max: number): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0).slice(-max) : []);
const rev = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0);

/** Read saved meta. Anything that is not sound meta reads as "never synced", which can only ever lead to a question, not to a loss. */
export function parseSyncMeta(raw: string | null | undefined): ModelSyncMeta {
  if (!raw) return { ...EMPTY_SYNC_META, ownWriteIds: [], accountScanRoomIds: [] };
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not meta');
    const p = v.pending as Record<string, unknown> | null | undefined;
    const pending: PendingSave | null = p && typeof p === 'object' && str(p.writeId) && str(p.fingerprint)
      ? { writeId: p.writeId as string, base: rev(p.base), fingerprint: p.fingerprint as string, scanRoomIds: strList(p.scanRoomIds, 500) } : null;
    const baseRevision = rev(v.baseRevision);
    const baseFingerprint = baseRevision > 0 ? str(v.baseFingerprint) : null;
    return {
      accountSeen: v.accountSeen === true,
      baseRevision: baseFingerprint ? baseRevision : 0,
      baseFingerprint,
      pending,
      savedAt: str(v.savedAt),
      ownWriteIds: strList(v.ownWriteIds, MAX_OWN_WRITE_IDS),
      scanChoice: v.scanChoice === 'account' || v.scanChoice === 'device' ? v.scanChoice : 'unasked',
      accountScanRoomIds: strList(v.accountScanRoomIds, 500),
    };
  } catch {
    return { ...EMPTY_SYNC_META, ownWriteIds: [], accountScanRoomIds: [] };
  }
}

/** Has this device's model changed since it last matched the account? Never synced: any content counts. */
export function deviceChanged(meta: ModelSyncMeta, local: { hasContent: boolean; fingerprint: string }): boolean {
  if (meta.baseRevision === 0 || meta.baseFingerprint === null) return local.hasContent;
  return local.fingerprint !== meta.baseFingerprint;
}

// ── the account row ──────────────────────────────────────────────────────────

export interface ServerHead {
  revision: number;
  writeId: string | null;
  schemaVersion: number;
  updatedAt: string;
  updatedBy: string | null;
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

export interface ReconcileInput {
  local: { hasContent: boolean; fingerprint: string };
  meta: ModelSyncMeta;
  /** null = the account has no row for this job. */
  server: null | {
    revision: number;
    writeId: string | null;
    schemaVersion: number;
    /** undefined = the model itself has not been fetched yet. null = fetched, and this build cannot read it. */
    fingerprint?: string | null;
  };
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
  /** This device is strictly ahead (or the account has no row): send it, based on `base`. */
  | { kind: 'push'; base: number }
  /** The account is strictly ahead and this device has no changes of its own: take the account's. */
  | { kind: 'take_server' }
  /** The decision needs the account's model itself: fetch it and ask again. */
  | { kind: 'need_model' }
  /** Both changed since they last matched. The person chooses. Nothing is written by this function's caller until he does. */
  | { kind: 'conflict' }
  /** The account's model was saved by a newer build. This build neither reads it nor writes over it. */
  | { kind: 'account_unreadable' };

/**
 * Decide what to do with the device's model and the account's. Pure, total,
 * and it never returns a choice between two changed models: that is `conflict`.
 */
export function reconcile(input: ReconcileInput): ReconcileAction {
  const { local, meta, server, pendingQueued } = input;
  if (meta.pending && pendingQueued) return { kind: 'wait' };
  const changed = deviceChanged(meta, local);
  if (!server) return local.hasContent ? { kind: 'push', base: 0 } : { kind: 'nothing' };
  if (server.schemaVersion > LIVING_MODEL_SCHEMA_VERSION || server.fingerprint === null) return { kind: 'account_unreadable' };
  if (meta.pending && server.writeId !== null && server.writeId === meta.pending.writeId) return { kind: 'landed' };
  if (!changed) {
    if (meta.baseRevision > 0 && server.revision === meta.baseRevision) return { kind: 'in_sync' };
    return { kind: 'take_server' };
  }
  // This device changed.
  if (meta.baseRevision > 0 && server.revision === meta.baseRevision) return { kind: 'push', base: server.revision };
  // The account moved too (or the two were never matched). The same model on both sides is not a conflict.
  if (server.fingerprint === undefined) return { kind: 'need_model' };
  if (server.fingerprint === local.fingerprint) return { kind: 'in_sync' };
  return { kind: 'conflict' };
}

// ── scans ────────────────────────────────────────────────────────────────────

/** The rooms that came from a phone scan. */
export function scanRoomIds(model: JobModel): string[] {
  return model.rooms.filter((r) => r.source === 'scan' || typeof r.scanId === 'string').map((r) => r.id);
}

/** The scanned rooms that are NOT in the account copy yet: sending the model would send their sizes for the first time. */
export function unsentScanRoomIds(model: JobModel, meta: Pick<ModelSyncMeta, 'accountScanRoomIds'>): string[] {
  const there = new Set(meta.accountScanRoomIds);
  return scanRoomIds(model).filter((id) => !there.has(id));
}

export type ScanGate =
  /** Nothing stands in the way of sending. */
  | 'send'
  /** A scanned room would be sent for the first time and the person has not been asked: ask, send nothing. */
  | 'ask'
  /** He chose Keep on This Phone: the whole model stays on the device. */
  | 'device';

/** May this model be sent? The answer to the scan question, per job. */
export function scanGate(model: JobModel, meta: Pick<ModelSyncMeta, 'scanChoice' | 'accountScanRoomIds'>): ScanGate {
  if (meta.scanChoice === 'device') return 'device';
  if (meta.scanChoice === 'account') return 'send';
  return unsentScanRoomIds(model, meta).length > 0 ? 'ask' : 'send';
}

// ── the status line ──────────────────────────────────────────────────────────

export type SyncStatus =
  /** The table is there and neither side has a model yet: there is nothing to say. */
  | 'empty'
  /** No account copy: signed out, no backend, a sample job, or the table is not there yet. Today's sentence. */
  | 'device'
  /** The first read of the account is in flight. */
  | 'checking'
  /** The account holds this device's model (read back, or the two were compared). */
  | 'saved'
  /** A save is queued, or the account cannot be reached and there is something to send. */
  | 'waiting'
  /** The account refused the save or answered with an error. */
  | 'failed'
  /** A scanned room would be sent for the first time: nothing is sent until he answers. */
  | 'scan_ask'
  /** He chose Keep on This Phone. */
  | 'kept_on_device'
  /** Both changed: he is being asked. */
  | 'conflict'
  /** The account's model is from a newer build. */
  | 'account_newer';

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
  };
}

/** Meta after a save was handed to the queue. */
export function metaAfterSend(meta: ModelSyncMeta, pending: PendingSave): ModelSyncMeta {
  return { ...meta, pending, ownWriteIds: [...meta.ownWriteIds, pending.writeId].slice(-MAX_OWN_WRITE_IDS) };
}

/** Was the account's current row written by THIS device? */
export function isThisDevice(meta: Pick<ModelSyncMeta, 'ownWriteIds'>, head: Pick<ServerHead, 'writeId'>): boolean {
  return head.writeId !== null && meta.ownWriteIds.includes(head.writeId);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Only a real project id reaches the server (a sample job's id is not one). */
export const isSyncableProjectId = (projectId: string | null | undefined): projectId is string => typeof projectId === 'string' && UUID_RE.test(projectId);

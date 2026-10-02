// utils/messageAttachments.ts — photos and PDFs on portal messages: every rule
// as a pure function (no React, no Supabase, no AsyncStorage, no FileSystem),
// so scripts/validate-message-attachments.ts runs all of it under bun.
//
// The server is the authority. A portal_messages row may name a file only once
// its bytes are in the private `message-attachments` bucket: the BEFORE INSERT
// trigger in supabase/migrations/20261001150000_portal_message_attachments.sql
// looks every path up in storage.objects and refuses the row otherwise. The
// rules below mirror that trigger so the app never builds a row it would
// refuse, and the outbox state machine at the bottom never calls a message
// "sent" while a file is still on the device.
//
// Kept in step with supabase/functions/_shared/messageFiles.ts (Deno side) and
// the migration's literals: the validator's parity check fails when one of the
// three changes alone.

import type { MessageAttachment, MessageAttachmentKind, MessageAttachmentMime } from '@/types';
import type { PhotoUploadOutcome } from '@/utils/photoUploadCore';

export const MESSAGE_ATTACHMENT_BUCKET = 'message-attachments';
export const MESSAGE_ATTACHMENT_MAX_BYTES = 20971520; // 20 MB
export const MESSAGE_ATTACHMENT_MAX_COUNT = 10;
export const MESSAGE_ATTACHMENT_MIMES: readonly MessageAttachmentMime[] =
  ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
export const MESSAGE_ATTACHMENT_URL_TTL_SECONDS = 300; // thread display
export const MESSAGE_ATTACHMENT_OPEN_TTL_SECONDS = 120; // open / download at tap
export const MESSAGE_OUTBOX_MAX_RETRIES = 5; // 'retryable' budget
export const MESSAGE_OUTBOX_RLS_MAX_RETRIES = 6; // 'rls-pending' budget (project row not synced yet)

/** The trigger's longest file name, in characters (code points). */
const NAME_MAX = 200;
/** The trigger's largest width / height. */
const DIM_MAX = 20000;
/** The trigger's key set for one attachment. */
const ATTACHMENT_KEYS = new Set(['id', 'name', 'mime', 'size', 'kind', 'width', 'height', 'path']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOWER_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/g;
const HAS_CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

export function extForMime(m: MessageAttachmentMime): 'jpg' | 'png' | 'webp' | 'pdf' {
  switch (m) {
    case 'image/jpeg': return 'jpg';
    case 'image/png': return 'png';
    case 'image/webp': return 'webp';
    default: return 'pdf';
  }
}

export function kindForMime(m: MessageAttachmentMime): MessageAttachmentKind {
  return m === 'application/pdf' ? 'pdf' : 'image';
}

const isAllowedMime = (m: unknown): m is MessageAttachmentMime =>
  typeof m === 'string' && (MESSAGE_ATTACHMENT_MIMES as readonly string[]).includes(m);

const BY_EXTENSION: Record<string, MessageAttachmentMime> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf',
};

/**
 * The declared type reduced to one of the four the bucket accepts, or null.
 * 'image/jpg' / 'image/pjpeg' are JPEG; an EMPTY type falls back to the file
 * extension (pickers on some Android builds hand over no type). Anything else
 * — GIF, HEIC, SVG, HTML, octet-stream — is refused, extension or not.
 */
export function normalizeMime(mime: string | null | undefined, name?: string): MessageAttachmentMime | null {
  const m = String(mime ?? '').split(';')[0].trim().toLowerCase();
  if (m === 'image/jpg' || m === 'image/pjpeg') return 'image/jpeg';
  if (isAllowedMime(m)) return m;
  if (m !== '') return null;
  const dot = String(name ?? '').lastIndexOf('.');
  if (dot < 0) return null;
  return BY_EXTENSION[String(name).slice(dot + 1).trim().toLowerCase()] ?? null;
}

const DEFAULT_NAMES: Record<MessageAttachmentMime, string> = {
  'image/jpeg': 'Photo.jpg', 'image/png': 'Photo.png', 'image/webp': 'Photo.webp', 'application/pdf': 'Document.pdf',
};

/**
 * A file name the trigger accepts and a download can use: the last path
 * segment only, control characters removed, slashes made '_', whitespace
 * collapsed, at most 200 characters with the extension kept. Empty (or only
 * dots) becomes 'Photo.jpg' / 'Photo.png' / 'Photo.webp' / 'Document.pdf'.
 */
export function cleanAttachmentName(name: string, mime: MessageAttachmentMime): string {
  const raw = String(name ?? '');
  const last = raw.split(/[\\/]/).pop() ?? '';
  let s = last.replace(/\s+/g, ' ').replace(CONTROL_RE, '').replace(/[\\/]/g, '_').trim();
  if (/^\.*$/.test(s)) return DEFAULT_NAMES[mime];
  const chars = Array.from(s);
  if (chars.length > NAME_MAX) {
    const dot = s.lastIndexOf('.');
    const ext = dot > 0 ? Array.from(s.slice(dot)) : [];
    const keepExt = ext.length > 0 && ext.length <= 10 ? ext : [];
    s = chars.slice(0, NAME_MAX - keepExt.length).join('').trimEnd() + keepExt.join('');
  }
  return s;
}

export type AttachmentRefusal = 'type' | 'size' | 'empty' | 'count';

/**
 * Can this file go on the message? Count first (the eleventh file is refused
 * whatever it is), then type, then empty, then size. An unknown size (null)
 * passes here; the upload itself is checked again by Storage (20 MB cap) and
 * by the trigger (the stored size must equal the row's).
 */
export function checkAttachment(
  c: { mime: string | null | undefined; size: number | null | undefined; name: string },
  alreadyAttached: number,
): { ok: true; mime: MessageAttachmentMime; kind: MessageAttachmentKind; name: string }
  | { ok: false; reason: AttachmentRefusal } {
  if (alreadyAttached >= MESSAGE_ATTACHMENT_MAX_COUNT) return { ok: false, reason: 'count' };
  const mime = normalizeMime(c.mime, c.name);
  if (!mime) return { ok: false, reason: 'type' };
  const size = c.size;
  if (typeof size === 'number') {
    if (!(size > 0)) return { ok: false, reason: 'empty' };
    if (size > MESSAGE_ATTACHMENT_MAX_BYTES) return { ok: false, reason: 'size' };
  }
  return { ok: true, mime, kind: kindForMime(mime), name: cleanAttachmentName(c.name, mime) };
}

const startsWith = (head: Uint8Array, bytes: number[], at = 0): boolean =>
  head.length >= at + bytes.length && bytes.every((b, i) => head[at + i] === b);

/** What the first bytes say the file is, or null for anything else. */
export function sniffMime(head: Uint8Array): MessageAttachmentMime | null {
  if (!head || typeof head.length !== 'number') return null;
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(head, [0x52, 0x49, 0x46, 0x46]) && startsWith(head, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  if (startsWith(head, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf';
  return null;
}

/** True only when the bytes are the declared type (a .pdf that is not a PDF is false). */
export function sniffMatches(head: Uint8Array, declared: MessageAttachmentMime): boolean {
  return sniffMime(head) === declared;
}

/**
 * The storage key: `<projectId>/<messageId>/<attachmentId>.<ext>`, all three
 * lower-cased uuids. The trigger requires exactly this for the row's own
 * project_id and id, so a row can never point at another project's or another
 * message's object. Throws on a non-uuid (a key built from anything else would
 * be refused by the trigger anyway; failing here is earlier and louder).
 */
export function messageAttachmentPath(
  projectId: string, messageId: string, attachmentId: string, mime: MessageAttachmentMime,
): string {
  if (!isUuid(projectId) || !isUuid(messageId) || !isUuid(attachmentId)) {
    throw new Error('messageAttachmentPath: ids must be uuids');
  }
  if (!isAllowedMime(mime)) throw new Error('messageAttachmentPath: type not allowed');
  return `${projectId.toLowerCase()}/${messageId.toLowerCase()}/${attachmentId.toLowerCase()}.${extForMime(mime)}`;
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const validName = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && Array.from(v).length <= NAME_MAX && !/[\\/]/.test(v) && !HAS_CONTROL_RE.test(v);
const validDim = (v: unknown): boolean => v === undefined || v === null || (isInt(v) && v >= 1 && v <= DIM_MAX);

/**
 * Tolerant reader for server rows, portal RPC rows and queued rows. Drops any
 * element the trigger would refuse (unknown key, bad id, mime/kind disagreeing,
 * bad name, size, dimensions, a repeated id) and never throws on junk. `path`
 * is kept only when it is a string (the portal RPC never sends it).
 */
export function parseAttachments(raw: unknown): MessageAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: MessageAttachment[] = [];
  const seen = new Set<string>();
  for (const el of raw) {
    if (out.length >= MESSAGE_ATTACHMENT_MAX_COUNT) break;
    if (!el || typeof el !== 'object' || Array.isArray(el)) continue;
    const o = el as Record<string, unknown>;
    if (!Object.keys(o).every((k) => ATTACHMENT_KEYS.has(k))) continue;
    if (typeof o.id !== 'string' || !LOWER_UUID_RE.test(o.id) || seen.has(o.id)) continue;
    if (!isAllowedMime(o.mime)) continue;
    if (o.kind !== kindForMime(o.mime)) continue;
    if (!validName(o.name)) continue;
    if (!isInt(o.size) || o.size < 1 || o.size > MESSAGE_ATTACHMENT_MAX_BYTES) continue;
    if (!validDim(o.width) || !validDim(o.height)) continue;
    if (o.path !== undefined && o.path !== null && typeof o.path !== 'string') continue;
    seen.add(o.id);
    const a: MessageAttachment = { id: o.id, name: o.name, mime: o.mime, size: o.size, kind: kindForMime(o.mime) };
    if (isInt(o.width)) a.width = o.width;
    if (isInt(o.height)) a.height = o.height;
    if (typeof o.path === 'string') a.path = o.path;
    out.push(a);
  }
  return out;
}

/** The jsonb element the trigger accepts: {id,name,mime,size,kind,path} + width/height when present. */
export function toAttachmentRow(a: MessageAttachment): Record<string, unknown> {
  const row: Record<string, unknown> = { id: a.id, name: a.name, mime: a.mime, size: a.size, kind: a.kind };
  if (typeof a.path === 'string') row.path = a.path;
  if (isInt(a.width)) row.width = a.width;
  if (isInt(a.height)) row.height = a.height;
  return row;
}

export function attachmentCounts(list: { kind: MessageAttachmentKind }[]): { photos: number; pdfs: number } {
  let photos = 0, pdfs = 0;
  for (const a of Array.isArray(list) ? list : []) {
    if (a?.kind === 'pdf') pdfs++;
    else if (a?.kind === 'image') photos++;
  }
  return { photos, pdfs };
}

// ─── Outbox state machine ──────────────────────────────────────────────────
// MSGAPP's utils/messageOutbox.ts persists entries and does the I/O; every
// decision about what an upload or write result MEANS lives here. An outbox
// entry is by definition not sent: the message becomes "sent" only when the
// row write is synced or queued behind its project (applyWriteOutcome done).

export type OutboxAttachmentState = 'pending' | 'uploaded' | 'failed';
export type OutboxFailReason = 'gone' | 'refused' | 'server' | 'type_mismatch' | 'write_failed';

export interface OutboxAttachment extends MessageAttachment {
  path: string;
  localUri: string;
  state: OutboxAttachmentState;
  failReason?: OutboxFailReason;
  tries: number;
  rlsTries: number;
}

export interface OutboxEntry {
  id: string; // = the portal_messages row id
  userId: string;
  projectId: string;
  portalId: string;
  body: string;
  authorName: string;
  createdAt: string;
  attachments: OutboxAttachment[];
  phase: 'uploading' | 'waiting_network' | 'writing' | 'failed';
  failReason?: OutboxFailReason;
}

export type UploadOutcome = PhotoUploadOutcome;

const lowerIfUuid = (s: string): string => (isUuid(s) ? s.toLowerCase() : s);

export function newOutboxEntry(input: {
  id: string; userId: string; projectId: string; portalId: string;
  body: string; authorName: string; createdAt: string;
  files: { id: string; name: string; mime: MessageAttachmentMime; size: number; width?: number; height?: number; localUri: string }[];
}): OutboxEntry {
  const id = lowerIfUuid(input.id);
  const projectId = lowerIfUuid(input.projectId);
  const attachments: OutboxAttachment[] = (input.files ?? []).map((f) => {
    const a: OutboxAttachment = {
      id: f.id.toLowerCase(),
      name: cleanAttachmentName(f.name, f.mime),
      mime: f.mime,
      size: f.size,
      kind: kindForMime(f.mime),
      path: messageAttachmentPath(projectId, id, f.id, f.mime),
      localUri: f.localUri,
      state: 'pending',
      tries: 0,
      rlsTries: 0,
    };
    if (isInt(f.width) && f.width >= 1 && f.width <= DIM_MAX) a.width = f.width;
    if (isInt(f.height) && f.height >= 1 && f.height <= DIM_MAX) a.height = f.height;
    return a;
  });
  return {
    id, userId: input.userId, projectId, portalId: input.portalId,
    body: input.body, authorName: input.authorName, createdAt: input.createdAt,
    attachments, phase: 'uploading',
  };
}

/** The entry's failure, if any: 'gone' wins (only Remove helps), then the first failed file. */
function firstFailure(atts: OutboxAttachment[]): OutboxFailReason | undefined {
  if (atts.some((a) => a.state === 'failed' && a.failReason === 'gone')) return 'gone';
  const f = atts.find((a) => a.state === 'failed');
  return f ? (f.failReason ?? 'refused') : undefined;
}

/**
 * Fold one upload result into the entry.
 *   success | already-uploaded → 'uploaded' (a retry re-uploading the same key
 *     gets "already exists": the bytes are there)
 *   transient   → stays 'pending', phase 'waiting_network', no try spent
 *   rls-pending → 'pending', rlsTries + 1; the 6th → 'failed' 'refused'
 *   retryable   → tries + 1; the 5th → 'failed' 'server'
 *   terminal    → 'failed' with the given reason (default 'refused')
 * Any failed file makes the entry 'failed'; every file uploaded makes it
 * 'writing' (the row write is next).
 */
export function applyUploadOutcome(
  e: OutboxEntry, attachmentId: string, outcome: UploadOutcome,
  terminal?: 'gone' | 'refused' | 'type_mismatch',
): OutboxEntry {
  const target = String(attachmentId).toLowerCase();
  if (!e.attachments.some((a) => a.id === target)) return e;
  const attachments = e.attachments.map((a): OutboxAttachment => {
    if (a.id !== target) return a;
    switch (outcome) {
      case 'success':
      case 'already-uploaded':
        return { ...a, state: 'uploaded', failReason: undefined };
      case 'transient':
        return { ...a, state: 'pending' };
      case 'rls-pending': {
        const rlsTries = a.rlsTries + 1;
        return rlsTries >= MESSAGE_OUTBOX_RLS_MAX_RETRIES
          ? { ...a, rlsTries, state: 'failed', failReason: 'refused' }
          : { ...a, rlsTries, state: 'pending' };
      }
      case 'retryable': {
        const tries = a.tries + 1;
        return tries >= MESSAGE_OUTBOX_MAX_RETRIES
          ? { ...a, tries, state: 'failed', failReason: 'server' }
          : { ...a, tries, state: 'pending' };
      }
      case 'terminal':
      default:
        return { ...a, state: 'failed', failReason: terminal ?? 'refused' };
    }
  });
  const failed = firstFailure(attachments);
  if (failed) return { ...e, attachments, phase: 'failed', failReason: failed };
  const phase: OutboxEntry['phase'] = attachments.every((a) => a.state === 'uploaded')
    ? 'writing'
    : outcome === 'transient' ? 'waiting_network' : 'uploading';
  return { ...e, attachments, phase, failReason: undefined };
}

const MISSING_FILE_MARKERS = [
  'enoent', 'no such file', 'photo source expired', 'file does not exist',
  'could not be read', 'is not readable', 'does not exist', 'empty file',
];

/**
 * A terminal upload error's reason: 'gone' when the file is no longer on the
 * device (the messages utils/fileBytes.ts and photoUploadCore's isTerminal
 * treat as a missing source), else 'refused'.
 */
export function terminalReasonFor(err: unknown): 'gone' | 'refused' {
  let msg = '';
  if (typeof err === 'string') msg = err;
  else if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
    msg = (err as { message: string }).message;
  }
  const m = msg.toLowerCase();
  return MISSING_FILE_MARKERS.some((k) => m.includes(k)) ? 'gone' : 'refused';
}

/** Every file uploaded and nothing failed: the row may be written. */
export function outboxReadyToWrite(e: OutboxEntry): boolean {
  return e.phase !== 'failed' && e.attachments.every((a) => a.state === 'uploaded');
}

/**
 * The portal_messages insert row. `attachments` is present ONLY when there is
 * at least one file, so a text-only message still writes if this code ships
 * before the migration adds the column. Throws unless outboxReadyToWrite.
 */
export function outboxRowFor(e: OutboxEntry): Record<string, unknown> {
  if (!outboxReadyToWrite(e)) throw new Error('outboxRowFor: files are not all uploaded');
  const row: Record<string, unknown> = {
    id: e.id,
    portal_id: e.portalId,
    project_id: e.projectId,
    invite_id: null,
    author_type: 'gc',
    author_name: e.authorName,
    body: e.body,
    read_by_gc: true,
    read_by_client: false,
    created_at: e.createdAt,
  };
  if (e.attachments.length > 0) row.attachments = e.attachments.map(toAttachmentRow);
  return row;
}

/** synced / queued → done (it is sent or ordered behind its project); failed → 'write_failed'. */
export function applyWriteOutcome(
  e: OutboxEntry, outcome: 'synced' | 'queued' | 'failed',
): { done: true } | { done: false; entry: OutboxEntry } {
  if (outcome === 'synced' || outcome === 'queued') return { done: true };
  return { done: false, entry: { ...e, phase: 'failed', failReason: 'write_failed' } };
}

/**
 * Try again: failed files go back to 'pending' with fresh budgets, EXCEPT a
 * 'gone' file (it is not on the device; only Remove helps), which keeps the
 * entry failed. Otherwise the phase is 'uploading'.
 */
export function retryOutboxEntry(e: OutboxEntry): OutboxEntry {
  const attachments = e.attachments.map((a): OutboxAttachment =>
    a.state === 'failed' && a.failReason !== 'gone'
      ? { ...a, state: 'pending', failReason: undefined, tries: 0, rlsTries: 0 }
      : a);
  if (attachments.some((a) => a.state === 'failed')) {
    return { ...e, attachments, phase: 'failed', failReason: 'gone' };
  }
  return { ...e, attachments, phase: 'uploading', failReason: undefined };
}

export type OutboxDisplay =
  | { state: 'uploading'; done: number; total: number }
  | { state: 'waiting_network'; done: number; total: number }
  | { state: 'writing' }
  | { state: 'failed'; reason: OutboxFailReason; retryable: boolean };

/** What the bubble shows. Never a "sent" state: an outbox entry is not sent. */
export function outboxDisplay(e: OutboxEntry): OutboxDisplay {
  const failedFile = firstFailure(e.attachments);
  if (failedFile || e.phase === 'failed') {
    const reason: OutboxFailReason = failedFile ?? e.failReason ?? 'server';
    return { state: 'failed', reason, retryable: reason !== 'gone' };
  }
  if (e.phase === 'writing') return { state: 'writing' };
  const total = e.attachments.length;
  const done = e.attachments.filter((a) => a.state === 'uploaded').length;
  return e.phase === 'waiting_network'
    ? { state: 'waiting_network', done, total }
    : { state: 'uploading', done, total };
}

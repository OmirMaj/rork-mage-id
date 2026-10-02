// portal-message-files/core.ts — the pure half of the function (no Deno, no
// I/O), so scripts/validate-message-attachments.ts runs every rule under bun.
//
// The homeowner holds a portal access token and no Supabase session, so she
// cannot write to Storage or to portal_messages herself. This function does it
// for her, and everything it signs or writes is decided from the token's
// project and the LIVE rows, never from keys or paths the caller sends: a
// signed URL is an unrevocable bearer token.
//
// The rules mirror utils/messageAttachments.ts and _shared/messageFiles.ts
// (the validator's parity check keeps the three in step).

import {
  MESSAGE_FILES_MAX_BYTES,
  MESSAGE_FILES_MAX_COUNT,
  cleanName,
  extFor,
  isMessageFileMime,
  isUuid,
  kindFor,
  pathFor,
  sniffMatches,
} from '../_shared/messageFiles.ts';

export { MESSAGE_FILES_BUCKET, pathFor, sniffMatches, isUuid } from '../_shared/messageFiles.ts';

/** Thread display URLs, re-signed by the page before they expire. */
export const URL_TTL_SECONDS = 300;
/** Open / download at tap. */
export const DOWNLOAD_TTL_SECONDS = 120;
/** The one-off URL 'send' reads the first 16 bytes through. */
export const SNIFF_TTL_SECONDS = 60;
/** Storage's fixed lifetime for a signed upload URL (one key, no upsert). */
export const UPLOAD_URL_TTL_SECONDS = 7200;
/** One page load asks for at most this many messages; more is refused, not truncated. */
export const MAX_MESSAGE_IDS = 50;
export const BODY_MAX = 4000;
export const AUTHOR_MAX = 120;
const PORTAL_ID_MAX = 200;
const TOKEN_MAX = 400;
const DIM_MAX = 20000;

type FileIn = { id: string; name: string; mime: string; size: number };
type SendFileIn = FileIn & { width?: number; height?: number };

export type FilesRequest =
  | { action: 'upload'; portalId: string; token: string; messageId: string; file: FileIn }
  | { action: 'send'; portalId: string; token: string; messageId: string; body: string; authorName: string; files: SendFileIn[] }
  | { action: 'urls'; portalId: string; token: string; messageIds: string[] }
  | { action: 'download'; portalId: string; token: string; messageId: string; attachmentId: string };

type Refusal = 'type' | 'size' | 'name' | 'ids' | 'count';
type Parsed = { ok: true; req: FilesRequest } | { ok: false; reason?: Refusal };

const str = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max ? v.trim() : null;
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

function parseFile(v: unknown): { ok: true; file: SendFileIn } | { ok: false; reason: Refusal } {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, reason: 'ids' };
  const f = v as Record<string, unknown>;
  if (!isUuid(f.id)) return { ok: false, reason: 'ids' };
  if (typeof f.name !== 'string' || f.name.length > 1000) return { ok: false, reason: 'name' };
  const mime = typeof f.mime === 'string' ? f.mime.trim().toLowerCase() : '';
  if (!isMessageFileMime(mime)) return { ok: false, reason: 'type' };
  if (!isInt(f.size) || f.size < 1 || f.size > MESSAGE_FILES_MAX_BYTES) return { ok: false, reason: 'size' };
  const file: SendFileIn = { id: f.id.toLowerCase(), name: f.name, mime, size: f.size };
  if (isInt(f.width) && f.width >= 1 && f.width <= DIM_MAX) file.width = f.width;
  if (isInt(f.height) && f.height >= 1 && f.height <= DIM_MAX) file.height = f.height;
  return { ok: true, file };
}

/**
 * The request body, or a refusal (400). Every id is a uuid (lower-cased), a
 * file's type is one of the four, its size an integer 1..20 MB, a message
 * carries 1..10 files with distinct ids, and `urls` names 1..50 messages
 * (more is refused, not truncated).
 *
 * A `passcode` field is deliberately never read. The portal snapshot and
 * thread are served on the access token alone (the passcode is a page-side
 * control), so the token is this function's gate too. Checking a supplied
 * passcode here would answer 401 for a wrong one and 200 for the right one: a
 * passcode oracle outside validate-portal-passcode's ceilings (the same
 * argument as signed-media-urls/core.ts).
 */
export function parsePortalFilesRequest(body: unknown): Parsed {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false };
  const b = body as Record<string, unknown>;
  const portalId = str(b.portalId, PORTAL_ID_MAX);
  const token = str(b.token, TOKEN_MAX);
  if (!portalId || !token) return { ok: false };

  if (b.action === 'upload') {
    if (!isUuid(b.messageId)) return { ok: false, reason: 'ids' };
    const f = parseFile(b.file);
    if (!f.ok) return { ok: false, reason: f.reason };
    const { id, name, mime, size } = f.file;
    return { ok: true, req: { action: 'upload', portalId, token, messageId: b.messageId.toLowerCase(), file: { id, name, mime, size } } };
  }
  if (b.action === 'send') {
    if (!isUuid(b.messageId)) return { ok: false, reason: 'ids' };
    if (b.body !== undefined && b.body !== null && typeof b.body !== 'string') return { ok: false };
    if (b.authorName !== undefined && b.authorName !== null && typeof b.authorName !== 'string') return { ok: false };
    if (!Array.isArray(b.files) || b.files.length < 1 || b.files.length > MESSAGE_FILES_MAX_COUNT) return { ok: false, reason: 'count' };
    const files: SendFileIn[] = [];
    const seen = new Set<string>();
    for (const raw of b.files) {
      const f = parseFile(raw);
      if (!f.ok) return { ok: false, reason: f.reason };
      if (seen.has(f.file.id)) return { ok: false, reason: 'ids' };
      seen.add(f.file.id);
      files.push(f.file);
    }
    return {
      ok: true,
      req: {
        action: 'send', portalId, token, messageId: b.messageId.toLowerCase(),
        body: typeof b.body === 'string' ? b.body : '',
        authorName: typeof b.authorName === 'string' ? b.authorName : '',
        files,
      },
    };
  }
  if (b.action === 'urls') {
    if (!Array.isArray(b.messageIds) || b.messageIds.length < 1) return { ok: false, reason: 'ids' };
    if (b.messageIds.length > MAX_MESSAGE_IDS) return { ok: false, reason: 'count' };
    if (!b.messageIds.every(isUuid)) return { ok: false, reason: 'ids' };
    const messageIds = [...new Set((b.messageIds as string[]).map((s) => s.toLowerCase()))];
    return { ok: true, req: { action: 'urls', portalId, token, messageIds } };
  }
  if (b.action === 'download') {
    if (!isUuid(b.messageId) || !isUuid(b.attachmentId)) return { ok: false, reason: 'ids' };
    return {
      ok: true,
      req: { action: 'download', portalId, token, messageId: b.messageId.toLowerCase(), attachmentId: b.attachmentId.toLowerCase() },
    };
  }
  return { ok: false };
}

/** `<projectId>/<messageId>`, the message's folder in the bucket; null unless both are uuids. */
export function folderFor(projectId: string, messageId: string): string | null {
  if (!isUuid(projectId) || !isUuid(messageId)) return null;
  return `${projectId.toLowerCase()}/${messageId.toLowerCase()}`;
}

/**
 * The attachments jsonb for the insert: {id,name,mime,size,kind,path}
 * (+ width/height), names cleaned, paths from pathFor — the trigger's key set.
 * Throws on a file the parser would have refused (never reached from index.ts).
 */
export function rowsFor(projectId: string, messageId: string, files: SendFileIn[]): Record<string, unknown>[] {
  return files.map((f) => {
    const path = pathFor(projectId, messageId, f.id, f.mime);
    const kind = kindFor(f.mime);
    if (!path || !kind) throw new Error('rowsFor: invalid file');
    const row: Record<string, unknown> = {
      id: f.id.toLowerCase(), name: cleanName(f.name, f.mime), mime: f.mime, size: f.size, kind, path,
    };
    if (isInt(f.width) && f.width >= 1 && f.width <= DIM_MAX) row.width = f.width;
    if (isInt(f.height) && f.height >= 1 && f.height <= DIM_MAX) row.height = f.height;
    return row;
  });
}

/**
 * Storage's listing of the message folder against the files 'send' names:
 * `missing` = no object under the file's key; `mismatched` = an object whose
 * stored size or type is not what the row will claim (the trigger would
 * refuse it; the function removes it so a corrected file can take the key).
 */
export function verifyListing(
  listing: { name: string; metadata?: { size?: number; mimetype?: string } | null }[],
  files: { id: string; mime: string; size: number }[],
): { missing: string[]; mismatched: string[] } {
  const byName = new Map<string, { size?: number; mimetype?: string } | null | undefined>();
  for (const o of Array.isArray(listing) ? listing : []) {
    if (o && typeof o.name === 'string') byName.set(o.name, o.metadata);
  }
  const missing: string[] = [];
  const mismatched: string[] = [];
  for (const f of files) {
    const ext = extFor(f.mime);
    const name = `${String(f.id).toLowerCase()}.${ext}`;
    if (!ext || !byName.has(name)) { missing.push(f.id); continue; }
    const meta = byName.get(name);
    if (!meta || Number(meta.size) !== f.size || meta.mimetype !== f.mime) mismatched.push(f.id);
  }
  return { missing, mismatched };
}

/**
 * What a token holder may have signed: attachments of rows in the token's
 * project whose stored path is exactly pathFor(projectId, row.id, a.id, a.mime).
 * A path into another message's folder, another project, or anything else is
 * never returned, whatever the row says.
 */
export function signable(
  rows: { id: string; project_id: string | null; attachments: unknown }[],
  projectId: string,
): { attachmentId: string; messageId: string; key: string; name: string }[] {
  const out: { attachmentId: string; messageId: string; key: string; name: string }[] = [];
  if (!isUuid(projectId) || !Array.isArray(rows)) return out;
  const pid = projectId.toLowerCase();
  for (const row of rows) {
    if (!row || !isUuid(row.id) || typeof row.project_id !== 'string') continue;
    if (row.project_id.toLowerCase() !== pid) continue;
    if (!Array.isArray(row.attachments)) continue;
    for (const a of row.attachments as unknown[]) {
      if (!a || typeof a !== 'object') continue;
      const att = a as { id?: unknown; mime?: unknown; path?: unknown; name?: unknown };
      if (!isUuid(att.id) || typeof att.mime !== 'string' || typeof att.path !== 'string') continue;
      const key = pathFor(pid, row.id, att.id, att.mime);
      if (!key || att.path !== key) continue;
      out.push({ attachmentId: att.id.toLowerCase(), messageId: row.id.toLowerCase(), key, name: cleanName(att.name, att.mime) });
    }
  }
  return out;
}

// deno-lint-ignore no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/g;

/** The author name the row carries: control characters removed, whitespace collapsed, 120 max ('' when nothing is left). */
export function cleanAuthor(v: unknown): string {
  if (typeof v !== 'string') return '';
  const s = v.replace(/\s+/g, ' ').replace(CONTROL_RE, '').trim();
  return Array.from(s).slice(0, AUTHOR_MAX).join('').trim();
}

/** The message body the row carries: trimmed, 4000 max. */
export function cleanBody(v: unknown): string {
  if (typeof v !== 'string') return '';
  return Array.from(v.trim()).slice(0, BODY_MAX).join('').trim();
}

/**
 * The trigger's refusal (its message is the bare code) mapped to the answer
 * the page can act on; null when the text is not one of the trigger's codes.
 */
export function mapTriggerRefusal(code: unknown): 'not_uploaded' | 'file_rejected' | 'refused' | null {
  const c = typeof code === 'string' ? code.trim() : '';
  if (c === 'attachment_not_uploaded') return 'not_uploaded';
  if (c === 'attachment_size_mismatch' || c === 'attachment_type_mismatch') return 'file_rejected';
  if (/^(message_empty|attachment_[a-z_]+|attachments_immutable)$/.test(c)) return 'refused';
  return null;
}

/** Storage's answer for a key that already holds an object (a retry of an upload that landed). */
export function isAlreadyExists(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { message?: unknown; statusCode?: unknown; status?: unknown; error?: unknown };
  const text = [e.message, e.error].filter((x) => typeof x === 'string').join(' ').toLowerCase();
  return String(e.statusCode ?? e.status ?? '') === '409' || /already exists|duplicate/.test(text);
}

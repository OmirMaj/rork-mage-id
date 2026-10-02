// _shared/messageFiles.ts — the server half of the portal message attachment
// rules. Pure (no Deno.*, no URL imports), so Deno functions and bun scripts
// import the same file.
//
// Mirror of utils/messageAttachments.ts (the app half) and of the literals in
// supabase/migrations/20261001150000_portal_message_attachments.sql. The
// parity check in scripts/validate-message-attachments.ts fails when one of
// the three changes alone, so a later edit changes all three.

export const MESSAGE_FILES_BUCKET = 'message-attachments';
export const MESSAGE_FILES_MAX_BYTES = 20971520; // 20 MB
export const MESSAGE_FILES_MAX_COUNT = 10;
export const MESSAGE_FILES_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export type MessageFileMime = typeof MESSAGE_FILES_MIMES[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

export const isMessageFileMime = (m: unknown): m is MessageFileMime =>
  typeof m === 'string' && (MESSAGE_FILES_MIMES as readonly string[]).includes(m);

const EXT: Record<MessageFileMime, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf',
};

export function extFor(mime: string): string | null {
  return isMessageFileMime(mime) ? EXT[mime] : null;
}

export function kindFor(mime: string): 'image' | 'pdf' | null {
  if (!isMessageFileMime(mime)) return null;
  return mime === 'application/pdf' ? 'pdf' : 'image';
}

/**
 * `<projectId>/<messageId>/<attachmentId>.<ext>`, all lower-cased uuids — the
 * only key the trigger accepts for a row. null for a non-uuid or a type the
 * bucket refuses (never a key built from request text).
 */
export function pathFor(projectId: string, messageId: string, attachmentId: string, mime: string): string | null {
  const ext = extFor(mime);
  if (!ext || !isUuid(projectId) || !isUuid(messageId) || !isUuid(attachmentId)) return null;
  return `${projectId.toLowerCase()}/${messageId.toLowerCase()}/${attachmentId.toLowerCase()}.${ext}`;
}

const startsWith = (head: Uint8Array, bytes: number[], at = 0): boolean =>
  head.length >= at + bytes.length && bytes.every((b, i) => head[at + i] === b);

/** What the first bytes say the file is, or null. */
export function sniffMime(head: Uint8Array): MessageFileMime | null {
  if (!head || typeof head.length !== 'number') return null;
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(head, [0x52, 0x49, 0x46, 0x46]) && startsWith(head, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  if (startsWith(head, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf';
  return null;
}

/** True only when the bytes are the declared type. */
export function sniffMatches(head: Uint8Array, mime: string): boolean {
  return isMessageFileMime(mime) && sniffMime(head) === mime;
}

const DEFAULT_NAMES: Record<MessageFileMime, string> = {
  'image/jpeg': 'Photo.jpg', 'image/png': 'Photo.png', 'image/webp': 'Photo.webp', 'application/pdf': 'Document.pdf',
};
// deno-lint-ignore no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/g;

/** Same rules as utils/messageAttachments.cleanAttachmentName (last segment, no slashes or control characters, 200 max). */
export function cleanName(name: unknown, mime: string): string {
  const fallback = isMessageFileMime(mime) ? DEFAULT_NAMES[mime] : 'File';
  const raw = typeof name === 'string' ? name : '';
  const last = raw.split(/[\\/]/).pop() ?? '';
  let s = last.replace(/\s+/g, ' ').replace(CONTROL_RE, '').replace(/[\\/]/g, '_').trim();
  if (/^\.*$/.test(s)) return fallback;
  const chars = Array.from(s);
  if (chars.length > 200) {
    const dot = s.lastIndexOf('.');
    const ext = dot > 0 ? Array.from(s.slice(dot)) : [];
    const keepExt = ext.length > 0 && ext.length <= 10 ? ext : [];
    s = chars.slice(0, 200 - keepExt.length).join('').trimEnd() + keepExt.join('');
  }
  return s;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * "1 photo", "3 photos", "1 PDF", "2 photos and 1 PDF" — for the notify email
 * and push. '' for none or junk (anything but an array of 'image' / 'pdf').
 */
export function attachmentSummaryLine(kinds: unknown): string {
  if (!Array.isArray(kinds)) return '';
  let photos = 0, pdfs = 0;
  for (const k of kinds) {
    if (k === 'image') photos++;
    else if (k === 'pdf') pdfs++;
  }
  const parts: string[] = [];
  if (photos > 0) parts.push(plural(photos, 'photo', 'photos'));
  if (pdfs > 0) parts.push(plural(pdfs, 'PDF', 'PDFs'));
  return parts.join(' and ');
}

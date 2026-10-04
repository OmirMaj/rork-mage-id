// _shared/messageFileBytes.ts: read the files a CLIENT attached to a portal
// message, for the project OWNER only. Pure (no runtime globals, no remote
// imports): the service client is a parameter, so
// scripts/validate-ask-files-server.ts runs every rule under bun against a
// fake database and a fake bucket.
//
// WHY THIS IS ITS OWN FILE. The service role bypasses RLS and reads any object
// in the bucket. A caller names a file by two ids and nothing else; this file
// decides from the LIVE row whether those ids are his to read, rebuilds the
// storage key itself, and only then downloads. It never downloads a key it
// read from the row or from the request.
//
// OWNER ONLY. The one account that may read a client's files here is the
// account that owns the project (projects.user_id). Somebody the owner shared
// the job with is refused like a stranger: that is the rule of the bucket's
// own read policy and of the table's row policy, and this file adds no second
// way in.
//
// The refusals are deliberately generic. MessageFileAccessError never says
// which check failed, and before_notice is raised only after the owner check,
// so only the owner learns that a message is older than the notice.
//
// Nothing in this file writes a log line.

import {
  MESSAGE_FILES_BUCKET,
  cleanName,
  isMessageFileMime,
  isUuid,
  kindFor,
  pathFor,
  sniffMatches,
  type MessageFileMime,
} from './messageFiles.ts';

/** Answered as one generic 403, whatever the reason. */
export class MessageFileAccessError extends Error {
  constructor() {
    super('message_file_unavailable');
    this.name = 'MessageFileAccessError';
  }
}

export class MessageFileRefusal extends Error {
  constructor(
    readonly code: 'file_too_large' | 'files_too_large' | 'unreadable_file' | 'before_notice',
    readonly index: number,
  ) {
    super(code);
    this.name = 'MessageFileRefusal';
  }
}

export interface MessageFileRef { messageId: string; attachmentId: string }
export interface LoadedMessageFile { index: number; name: string; mime: MessageFileMime; kind: 'image' | 'pdf'; bytes: Uint8Array }
export interface LoadedMessage { body: string; files: LoadedMessageFile[] }

/** The slice of the service client this file uses. */
export interface MessageFileQuery {
  eq(column: string, value: string): MessageFileQuery;
  maybeSingle(): PromiseLike<{ data: unknown; error: unknown }>;
}
export interface MessageFileSvc {
  from(table: string): { select(columns: string): MessageFileQuery };
  storage: {
    from(bucket: string): {
      download(key: string): PromiseLike<{ data: { arrayBuffer(): Promise<ArrayBuffer> } | null; error: unknown }>;
    };
  };
}

/** One message carries at most this many refs in one read (the function's file limit). */
export const MESSAGE_REFS_MAX = 4;
/** The message text that goes back to the caller is cut here. */
export const MESSAGE_BODY_CHARS = 4000;

const ISO_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/;
const isoMs = (v: unknown): number => (typeof v === 'string' && ISO_TIME_RE.test(v) ? Date.parse(v) : NaN);
const sameId = (a: unknown, b: string): boolean => typeof a === 'string' && a.toLowerCase() === b.toLowerCase();
const isLimit = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

type Row = Record<string, unknown>;
const asRow = (v: unknown): Row | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : null);

interface Wanted { index: number; key: string; name: string; mime: MessageFileMime; kind: 'image' | 'pdf'; size: number }

/**
 * True only when `callerId` is the account that OWNS `projectId`
 * (projects.user_id). The filter asks for it and the answer is checked again
 * here, so neither one alone lets another account through. There is no second
 * way in: somebody the owner shared the job with is not the owner.
 *
 * No query is made unless both ids are uuids: a filter value is spliced into
 * the request as written. (ask-files uses this same check for plan pages.)
 */
export async function callerOwnsProject(svc: MessageFileSvc, callerId: unknown, projectId: unknown): Promise<boolean> {
  if (!isUuid(callerId) || !isUuid(projectId)) return false;
  const owned = await svc
    .from('projects')
    .select('id, user_id')
    .eq('id', projectId)
    .eq('user_id', callerId)
    .maybeSingle();
  const project = owned && !owned.error ? asRow(owned.data) : null;
  return !!project && sameId(project.id, projectId) && sameId(project.user_id, callerId);
}

/**
 * The files of ONE client message, for the owner of its project.
 *
 * @throws MessageFileAccessError  not his, not found, not a client's row, or a
 *                                 stored path that is not the one this file
 *                                 would build (always the same generic error)
 * @throws MessageFileRefusal      before_notice, file_too_large,
 *                                 files_too_large, unreadable_file
 */
export async function loadOwnedMessageFiles(
  svc: MessageFileSvc,
  callerId: string,
  refs: MessageFileRef[],
  opts: { maxBytesEach: number; maxBytesTotal: number; notBefore: string },
): Promise<LoadedMessage> {
  // 1. Shape. No query is made until every id is a uuid: a filter value is
  //    spliced into the request as written.
  if (!isUuid(callerId)) throw new MessageFileAccessError();
  if (!Array.isArray(refs) || refs.length < 1 || refs.length > MESSAGE_REFS_MAX) throw new MessageFileAccessError();
  if (!opts || !isLimit(opts.maxBytesEach) || !isLimit(opts.maxBytesTotal)) throw new MessageFileAccessError();
  const seen = new Set<string>();
  for (const ref of refs) {
    if (!ref || !isUuid(ref.messageId) || !isUuid(ref.attachmentId)) throw new MessageFileAccessError();
    if (!sameId(ref.messageId, refs[0].messageId)) throw new MessageFileAccessError();
    const aid = ref.attachmentId.toLowerCase();
    if (seen.has(aid)) throw new MessageFileAccessError();
    seen.add(aid);
  }
  const messageId = refs[0].messageId.toLowerCase();

  // 2. The live row, by id.
  const found = await svc
    .from('portal_messages')
    .select('id, project_id, author_type, body, attachments, created_at')
    .eq('id', messageId)
    .maybeSingle();
  const row = found && !found.error ? asRow(found.data) : null;
  if (!row || !sameId(row.id, messageId)) throw new MessageFileAccessError();

  // 3. A client's message, on a real project.
  const projectId = row.project_id;
  if (!isUuid(projectId)) throw new MessageFileAccessError();
  if (row.author_type !== 'client') throw new MessageFileAccessError();

  // 4. The caller OWNS that project.
  if (!(await callerOwnsProject(svc, callerId, projectId))) throw new MessageFileAccessError();

  // 5. The cut-off: only a message sent after the client was told. An unset
  //    or unreadable time means no message qualifies.
  const from = isoMs(opts.notBefore);
  const at = isoMs(row.created_at);
  if (!Number.isFinite(from) || !Number.isFinite(at) || at < from) throw new MessageFileRefusal('before_notice', 0);

  // 6. Each wanted file is on the row, is one of the four types, and its
  //    stored path is exactly the key this file builds from the row's own ids.
  const stored: unknown[] = Array.isArray(row.attachments) ? row.attachments : [];
  const wanted: Wanted[] = [];
  for (let index = 0; index < refs.length; index++) {
    const aid = refs[index].attachmentId.toLowerCase();
    let hit: Wanted | null = null;
    for (const entry of stored) {
      const a = asRow(entry);
      if (!a || !isUuid(a.id) || !sameId(a.id, aid)) continue;
      if (!isMessageFileMime(a.mime)) continue;
      const key = pathFor(projectId, messageId, aid, a.mime);
      const kind = kindFor(a.mime);
      if (!key || !kind || typeof a.path !== 'string' || a.path !== key) continue;
      if (typeof a.size !== 'number' || !Number.isInteger(a.size) || a.size < 1) continue;
      hit = { index, key, name: cleanName(a.name, a.mime), mime: a.mime, kind, size: a.size };
      break;
    }
    if (!hit) throw new MessageFileAccessError();
    wanted.push(hit);
  }

  // 7. The row's own sizes, before any download.
  let declared = 0;
  for (const w of wanted) {
    if (w.size > opts.maxBytesEach) throw new MessageFileRefusal('file_too_large', w.index);
  }
  for (const w of wanted) {
    declared += w.size;
    if (declared > opts.maxBytesTotal) throw new MessageFileRefusal('files_too_large', w.index);
  }

  // 8. The bytes, one file at a time, in request order, stopping at the first
  //    failure. The real size is checked again: the row's number is a claim.
  const files: LoadedMessageFile[] = [];
  let total = 0;
  for (const w of wanted) {
    let bytes: Uint8Array;
    try {
      const got = await svc.storage.from(MESSAGE_FILES_BUCKET).download(w.key);
      if (!got || got.error || !got.data) throw new MessageFileAccessError();
      bytes = new Uint8Array(await got.data.arrayBuffer());
    } catch {
      throw new MessageFileAccessError();
    }
    if (bytes.length === 0) throw new MessageFileRefusal('unreadable_file', w.index);
    if (bytes.length > opts.maxBytesEach) throw new MessageFileRefusal('file_too_large', w.index);
    total += bytes.length;
    if (total > opts.maxBytesTotal) throw new MessageFileRefusal('files_too_large', w.index);
    if (!sniffMatches(bytes.subarray(0, 16), w.mime)) throw new MessageFileRefusal('unreadable_file', w.index);
    files.push({ index: w.index, name: w.name, mime: w.mime, kind: w.kind, bytes });
  }

  // 9. The files and the message text. Who wrote it is not returned.
  const text = typeof row.body === 'string' ? row.body.trim() : '';
  return { body: Array.from(text).slice(0, MESSAGE_BODY_CHARS).join('').trim(), files };
}

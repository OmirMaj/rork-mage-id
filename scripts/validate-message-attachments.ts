#!/usr/bin/env bun
// scripts/validate-message-attachments.ts
//
// Track MSG, lane MSGDATA: photos and PDFs in the portal thread, both ways.
// The server refuses any message whose files it cannot prove were uploaded
// (the BEFORE INSERT trigger in
// supabase/migrations/20261001150000_portal_message_attachments.sql), the
// homeowner's files go through supabase/functions/portal-message-files, and
// the app's outbox never calls a message sent while a file is on the device.
//
// This runs the pure rules (utils/messageAttachments.ts,
// supabase/functions/_shared/messageFiles.ts, portal-message-files/core.ts)
// and pins the wiring in index.ts, notify/index.ts and the migration text.
// The migration itself is executed by the PGlite proof
// (scratchpad/pgq/message-attachments.mjs); this file only reads it.
//
// Run via: bun run scripts/validate-message-attachments.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MESSAGE_ATTACHMENT_BUCKET,
  MESSAGE_ATTACHMENT_MAX_BYTES,
  MESSAGE_ATTACHMENT_MAX_COUNT,
  MESSAGE_ATTACHMENT_MIMES,
  MESSAGE_ATTACHMENT_OPEN_TTL_SECONDS,
  MESSAGE_ATTACHMENT_URL_TTL_SECONDS,
  MESSAGE_OUTBOX_MAX_RETRIES,
  MESSAGE_OUTBOX_RLS_MAX_RETRIES,
  applyUploadOutcome,
  applyWriteOutcome,
  attachmentCounts,
  checkAttachment,
  cleanAttachmentName,
  messageAttachmentPath,
  newOutboxEntry,
  normalizeMime,
  outboxDisplay,
  outboxReadyToWrite,
  outboxRowFor,
  parseAttachments,
  retryOutboxEntry,
  sniffMatches,
  sniffMime,
  terminalReasonFor,
  toAttachmentRow,
  type OutboxEntry,
} from '../utils/messageAttachments';
import {
  MESSAGE_FILES_BUCKET,
  MESSAGE_FILES_MAX_BYTES,
  MESSAGE_FILES_MAX_COUNT,
  MESSAGE_FILES_MIMES,
  attachmentSummaryLine,
  cleanName,
  pathFor,
  sniffMatches as sniffMatchesServer,
} from '../supabase/functions/_shared/messageFiles';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string): string => { try { return readFileSync(join(ROOT, p), 'utf8'); } catch { return ''; } };

let passed = 0, failed = 0;
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
}
const throws = (f: () => unknown): boolean => { try { f(); return false; } catch { return true; } };

// core.ts imports '../_shared/messageFiles.ts' (Deno needs the extension; tsc
// refuses it), so it is loaded at run time and typed here.
type CoreFile = { id: string; name: string; mime: string; size: number; width?: number; height?: number };
type CoreReq =
  | { action: 'upload'; portalId: string; token: string; messageId: string; file: CoreFile }
  | { action: 'send'; portalId: string; token: string; messageId: string; body: string; authorName: string; files: CoreFile[] }
  | { action: 'urls'; portalId: string; token: string; messageIds: string[] }
  | { action: 'download'; portalId: string; token: string; messageId: string; attachmentId: string };
interface CoreMod {
  URL_TTL_SECONDS: number;
  DOWNLOAD_TTL_SECONDS: number;
  MAX_MESSAGE_IDS: number;
  BODY_MAX: number;
  AUTHOR_MAX: number;
  parsePortalFilesRequest(b: unknown): { ok: true; req: CoreReq } | { ok: false; reason?: string };
  rowsFor(p: string, m: string, f: CoreFile[]): Record<string, unknown>[];
  verifyListing(l: { name: string; metadata?: { size?: number; mimetype?: string } | null }[], f: { id: string; mime: string; size: number }[]): { missing: string[]; mismatched: string[] };
  signable(rows: { id: string; project_id: string | null; attachments: unknown }[], p: string): { attachmentId: string; messageId: string; key: string; name: string }[];
  cleanAuthor(v: unknown): string;
  folderFor(p: string, m: string): string | null;
  mapTriggerRefusal(c: unknown): string | null;
}

// ── source helpers ──────────────────────────────────────────────────────────
/** Blank // and /* *\/ comments (strings and template literals kept). */
function stripTsComments(src: string): string {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') out += '\n'; i++; } i++; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out += c; i++;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') { out += src[i]; i++; } out += src[i]; i++; }
      out += q; continue;
    }
    out += c;
  }
  return out;
}
/** Blank SQL `--` comments outside '...' strings and $tag$ bodies are kept as code. */
function stripSqlComments(src: string): string {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '-' && src[i + 1] === '-') { while (i < src.length && src[i] !== '\n') i++; out += '\n'; continue; }
    if (c === "'") { out += c; i++; while (i < src.length && src[i] !== "'") { out += src[i]; i++; } out += "'"; continue; }
    out += c;
  }
  return out;
}
function balancedFrom(s: string, open: number): string {
  let d = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '(' || c === '{' || c === '[') d++;
    else if (c === ')' || c === '}' || c === ']') { d--; if (d === 0) return s.slice(open, i + 1); }
  }
  return s.slice(open);
}
// validate-edge-security.ts:21 — the formatting-independent error-body sweep.
const LEAK_TOKEN_RE = /String\(e\b|String\(err\b|\.message\b|\bresult\.error\b|\braw\b|\bupstream\b/;
function stripStringLiterals(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'" || c === '"') { const q = c; i++; while (i < s.length && s[i] !== q && s[i] !== '\n') { if (s[i] === '\\') i++; i++; } out += q + q; continue; }
    if (c === '`') {
      out += '`'; i++;
      while (i < s.length && s[i] !== '`') {
        if (s[i] === '\\') { i += 2; continue; }
        if (s[i] === '$' && s[i + 1] === '{') { const start = i; i++; let d = 0; do { if (s[i] === '{') d++; else if (s[i] === '}') d--; i++; } while (i < s.length && d > 0); out += s.slice(start, i); continue; }
        i++;
      }
      out += '`'; continue;
    }
    out += c;
  }
  return out;
}
/** Every json(...) / new Response(JSON.stringify(...)) argument, bare identifiers resolved to their initializer. */
function responseBodies(src: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  const re = /(?<![.\w$])(?:jsonResponse|jsonResp|json)\(|new Response\(JSON\.stringify\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const args = balancedFrom(src, m.index + m[0].length - 1);
    let text = args.slice(1, -1);
    const bare = text.match(/^\s*([A-Za-z_$][\w$]*)\s*(?:,|$)/);
    if (bare) {
      const decl = new RegExp(`(?<![.\\w$])${bare[1]}\\s*(?::[^=\\n]*)?=(?!=)\\s*`, 'g');
      let last: RegExpExecArray | null = null, d: RegExpExecArray | null;
      while ((d = decl.exec(src)) && d.index < m.index) last = d;
      if (last) {
        const at = last.index + last[0].length;
        text += '\n' + (/[({[]/.test(src[at]) ? balancedFrom(src, at) : src.slice(at, src.indexOf('\n', at) < 0 ? undefined : src.indexOf('\n', at)));
      }
    }
    out.push({ line: src.slice(0, m.index).split('\n').length, text });
  }
  return out;
}
const leaky = (src: string): string[] =>
  responseBodies(src).flatMap(({ line, text }) => { const hit = stripStringLiterals(text).match(LEAK_TOKEN_RE); return hit ? [`line ${line}: ${hit[0]}`] : []; });

// ── fixtures ────────────────────────────────────────────────────────────────
const P = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const P2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const M1 = 'c0000000-0000-4000-8000-000000000001';
const M2 = 'c0000000-0000-4000-8000-000000000002';
const A1 = 'd0000000-0000-4000-8000-00000000000a';
const A2 = 'd0000000-0000-4000-8000-00000000000b';
const A3 = 'd0000000-0000-4000-8000-00000000000c';
const bytes = (...xs: (number | string)[]): Uint8Array =>
  new Uint8Array(xs.flatMap((x) => (typeof x === 'string' ? [...x].map((ch) => ch.charCodeAt(0)) : [x])));
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 'JFIF', 0x00, 0x01, 0x01, 0x00, 0x00, 0x01);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 'IHDR');
const WEBP = bytes('RIFF', 0x24, 0x08, 0x00, 0x00, 'WEBP', 'VP8 ');
const PDF = bytes('%PDF-1.7\n%', 0xe2, 0xe3, 0xcf, 0xd3, 0x0a);
const PDF_NO_DASH = bytes('%PDF1.7 junk here');
const HTML = bytes('<!doctype html><h');

async function main() {
  // ══ A. pure helpers ═══════════════════════════════════════════════════════
  console.log('\nA. pure helpers (utils/messageAttachments.ts)');
  ok('normalizeMime: image/jpg and image/pjpeg are JPEG; case and parameters ignored',
    normalizeMime('image/jpg') === 'image/jpeg' && normalizeMime('image/pjpeg') === 'image/jpeg' && normalizeMime('IMAGE/PNG; q=1') === 'image/png');
  ok("normalizeMime: an empty type falls back to the extension ('' + x.PDF -> pdf, .jpeg, .webp)",
    normalizeMime('', 'x.PDF') === 'application/pdf' && normalizeMime(null, 'a.jpeg') === 'image/jpeg' && normalizeMime(undefined, 'b.WebP') === 'image/webp');
  ok('normalizeMime: gif, heic, svg, html, octet-stream (even named .jpg) and an extension-less blank are null',
    ['image/gif', 'image/heic', 'image/svg+xml', 'text/html', 'application/octet-stream'].every((m) => normalizeMime(m, 'x.jpg') === null)
    && normalizeMime('', 'noext') === null && normalizeMime('', 'x.gif') === null);

  const c = (mime: string | null, size: number | null, name = 'a.jpg', n = 0) => checkAttachment({ mime, size, name }, n);
  const r20 = c('image/jpeg', 20971520);
  ok('checkAttachment: exactly 20971520 bytes is accepted', r20.ok === true, JSON.stringify(r20));
  ok("checkAttachment: 20971521 bytes -> 'size'", JSON.stringify(c('image/jpeg', 20971521)) === '{"ok":false,"reason":"size"}');
  ok("checkAttachment: 0 bytes -> 'empty'", JSON.stringify(c('image/jpeg', 0)) === '{"ok":false,"reason":"empty"}');
  ok('checkAttachment: an unknown (null) size passes here', c('application/pdf', null, 'p.pdf').ok === true);
  ok("checkAttachment: 10 already attached -> 'count'", JSON.stringify(c('image/jpeg', 100, 'a.jpg', 10)) === '{"ok":false,"reason":"count"}');
  ok("checkAttachment: image/gif -> 'type'", JSON.stringify(c('image/gif', 100, 'a.gif')) === '{"ok":false,"reason":"type"}');
  ok('checkAttachment: refusal order is count > type > empty > size',
    (c('image/gif', 0, 'a.gif', 10) as { reason?: string }).reason === 'count'
    && (c('image/gif', 0, 'a.gif', 0) as { reason?: string }).reason === 'type'
    && (c('image/jpeg', 0, 'a.jpg', 9) as { reason?: string }).reason === 'empty');
  const okRes = c('image/jpg', 500, '../x/IMG 1.jpg');
  ok('checkAttachment: a good file comes back normalized, with its kind and a cleaned name',
    okRes.ok === true && okRes.mime === 'image/jpeg' && okRes.kind === 'image' && okRes.name === 'IMG 1.jpg', JSON.stringify(okRes));

  ok('sniffMime: real headers of the four types', sniffMime(JPEG) === 'image/jpeg' && sniffMime(PNG) === 'image/png' && sniffMime(WEBP) === 'image/webp' && sniffMime(PDF) === 'application/pdf');
  ok('sniffMatches: each header matches its declared type', sniffMatches(JPEG, 'image/jpeg') && sniffMatches(PNG, 'image/png') && sniffMatches(WEBP, 'image/webp') && sniffMatches(PDF, 'application/pdf'));
  ok('sniffMatches: a PNG header declared as JPEG is false; a JPEG declared as PDF is false',
    sniffMatches(PNG, 'image/jpeg') === false && sniffMatches(JPEG, 'application/pdf') === false);
  ok("sniffMime: '%PDF' without '-' and an HTML '<!doctype' are null; empty bytes are null",
    sniffMime(PDF_NO_DASH) === null && sniffMime(HTML) === null && sniffMime(new Uint8Array()) === null && sniffMatches(HTML, 'application/pdf') === false);

  ok('messageAttachmentPath: <project>/<message>/<attachment>.<ext>, lower-cased',
    messageAttachmentPath(P.toUpperCase(), M1.toUpperCase(), A1.toUpperCase(), 'image/png') === `${P}/${M1}/${A1}.png`
    && messageAttachmentPath(P, M1, A1, 'application/pdf') === `${P}/${M1}/${A1}.pdf`
    && messageAttachmentPath(P, M1, A1, 'image/jpeg').endsWith('.jpg'));
  ok('messageAttachmentPath: throws on a non-uuid in any position',
    throws(() => messageAttachmentPath('proj', M1, A1, 'image/jpeg')) && throws(() => messageAttachmentPath(P, '../x', A1, 'image/jpeg'))
    && throws(() => messageAttachmentPath(P, M1, `${A1}/..`, 'image/jpeg')));
  const longName = `${'a'.repeat(250)}.pdf`;
  const cleaned = cleanAttachmentName(longName, 'application/pdf');
  ok("cleanAttachmentName: '../../etc/passwd' keeps only the last segment", cleanAttachmentName('../../etc/passwd', 'application/pdf') === 'passwd');
  ok('cleanAttachmentName: control characters removed, whitespace collapsed (tabs and newlines become spaces), no slash or backslash left',
    cleanAttachmentName('a\u0000b\u0007c\n  d\t.jpg', 'image/jpeg') === 'abc d .jpg' && !/[\\/]/.test(cleanAttachmentName('C:\\Users\\me\\x.pdf', 'application/pdf')));
  ok('cleanAttachmentName: at most 200 characters, extension kept', Array.from(cleaned).length === 200 && cleaned.endsWith('.pdf'), `${cleaned.length}`);
  ok("cleanAttachmentName: empty -> 'Document.pdf' / 'Photo.jpg'",
    cleanAttachmentName('', 'application/pdf') === 'Document.pdf' && cleanAttachmentName('  ', 'image/jpeg') === 'Photo.jpg' && cleanAttachmentName('..', 'image/png') === 'Photo.png');

  const good = { id: A1, name: 'crack.jpg', mime: 'image/jpeg', size: 1000, kind: 'image', path: `${P}/${M1}/${A1}.jpg` };
  const parsed = parseAttachments([
    good,
    { ...good, id: A2, extra: 1 },
    { ...good, id: 'not-a-uuid' },
    { ...good, id: A3, kind: 'pdf' },
    { ...good, id: 'd0000000-0000-4000-8000-00000000000d', size: 0 },
    { ...good, id: 'd0000000-0000-4000-8000-00000000000e', size: 20971521 },
    { ...good, id: 'd0000000-0000-4000-8000-00000000000f', name: 42 },
    { ...good },
    { id: 'd0000000-0000-4000-8000-000000000010', name: 'p.pdf', mime: 'application/pdf', size: 9, kind: 'pdf', width: 10, height: null },
  ]);
  ok('parseAttachments: keeps good elements; drops extra key, bad uuid, kind/mime disagreement, size 0, size > cap, non-string name, repeated id',
    parsed.length === 2 && parsed[0].id === A1 && parsed[0].path === good.path && parsed[1].kind === 'pdf' && parsed[1].width === 10 && parsed[1].path === undefined,
    JSON.stringify(parsed));
  ok('parseAttachments: never throws on junk', [null, 5, 'x', {}, [null, 5, 'x', [], { id: A1 }], undefined].every((j) => Array.isArray(parseAttachments(j)) && parseAttachments(j).length === 0));
  ok('toAttachmentRow: exactly the trigger key set (+ width/height when present)',
    JSON.stringify(Object.keys(toAttachmentRow({ ...good, kind: 'image', mime: 'image/jpeg' })).sort()) === '["id","kind","mime","name","path","size"]'
    && 'width' in toAttachmentRow({ ...good, kind: 'image', mime: 'image/jpeg', width: 4 }));
  ok('attachmentCounts: photos and PDFs counted apart', JSON.stringify(attachmentCounts([{ kind: 'image' }, { kind: 'pdf' }, { kind: 'image' }])) === '{"photos":2,"pdfs":1}');

  // ══ B. outbox state machine ═══════════════════════════════════════════════
  console.log('\nB. outbox state machine');
  const base = {
    id: M1, userId: 'u1', projectId: P, portalId: 'portal-1', body: 'See photos', authorName: 'Omar', createdAt: '2026-10-01T10:00:00.000Z',
  };
  const two = newOutboxEntry({
    ...base,
    files: [
      { id: A1, name: 'one.jpg', mime: 'image/jpeg', size: 1000, width: 800, height: 600, localUri: 'file:///a.jpg' },
      { id: A2, name: 'plan.pdf', mime: 'application/pdf', size: 5000, localUri: 'file:///b.pdf' },
    ],
  });
  ok("newOutboxEntry: phase 'uploading', every file 'pending', paths from messageAttachmentPath",
    two.phase === 'uploading' && two.attachments.every((a) => a.state === 'pending' && a.tries === 0 && a.rlsTries === 0)
    && two.attachments[0].path === messageAttachmentPath(P, M1, A1, 'image/jpeg') && two.attachments[1].path === messageAttachmentPath(P, M1, A2, 'application/pdf')
    && two.attachments[1].kind === 'pdf');
  ok('outboxReadyToWrite: false while any file is pending; outboxRowFor throws then',
    outboxReadyToWrite(two) === false && throws(() => outboxRowFor(two)));
  let e: OutboxEntry = applyUploadOutcome(two, A1, 'already-uploaded');
  ok("already-uploaded counts as uploaded (the bytes are in the bucket)", e.attachments[0].state === 'uploaded' && e.attachments[0].tries === 0 && e.phase !== 'failed');
  e = applyUploadOutcome(e, A2, 'transient');
  ok("transient: stays 'pending', phase 'waiting_network', spends no try",
    e.attachments[1].state === 'pending' && e.phase === 'waiting_network' && e.attachments[1].tries === 0 && e.attachments[1].rlsTries === 0);
  ok('outboxReadyToWrite: still false with one file pending', outboxReadyToWrite(e) === false);
  let rt: OutboxEntry = two;
  for (let i = 0; i < MESSAGE_OUTBOX_MAX_RETRIES - 1; i++) rt = applyUploadOutcome(rt, A1, 'retryable');
  ok(`retryable: ${MESSAGE_OUTBOX_MAX_RETRIES - 1} tries keep it pending`, rt.attachments[0].state === 'pending' && rt.attachments[0].tries === MESSAGE_OUTBOX_MAX_RETRIES - 1 && rt.phase === 'uploading');
  rt = applyUploadOutcome(rt, A1, 'retryable');
  ok(`retryable: fails at ${MESSAGE_OUTBOX_MAX_RETRIES} with 'server'; the entry is failed`,
    MESSAGE_OUTBOX_MAX_RETRIES === 5 && rt.attachments[0].state === 'failed' && rt.attachments[0].failReason === 'server' && rt.phase === 'failed');
  let rl: OutboxEntry = two;
  for (let i = 0; i < MESSAGE_OUTBOX_RLS_MAX_RETRIES - 1; i++) rl = applyUploadOutcome(rl, A2, 'rls-pending');
  const rlBefore = rl.attachments[1].state;
  rl = applyUploadOutcome(rl, A2, 'rls-pending');
  ok(`rls-pending: fails at ${MESSAGE_OUTBOX_RLS_MAX_RETRIES} with 'refused'`,
    MESSAGE_OUTBOX_RLS_MAX_RETRIES === 6 && rlBefore === 'pending' && rl.attachments[1].state === 'failed' && rl.attachments[1].failReason === 'refused' && rl.attachments[1].tries === 0);
  const term = applyUploadOutcome(two, A1, 'terminal', 'gone');
  ok("terminal: failed with the given reason (default 'refused')",
    term.attachments[0].failReason === 'gone' && term.phase === 'failed' && applyUploadOutcome(two, A1, 'terminal').attachments[0].failReason === 'refused');
  ok("terminalReasonFor: missing local file -> 'gone', anything else -> 'refused'",
    terminalReasonFor(new Error('ENOENT: no such file or directory')) === 'gone'
    && terminalReasonFor(new Error('photo source expired — the browser released this image')) === 'gone'
    && terminalReasonFor('File does not exist') === 'gone'
    && terminalReasonFor(new Error('new row violates row-level security policy')) === 'refused' && terminalReasonFor(null) === 'refused');

  const done = applyUploadOutcome(applyUploadOutcome(two, A1, 'success'), A2, 'success');
  ok("every file uploaded: ready, phase 'writing'", outboxReadyToWrite(done) && done.phase === 'writing');
  const row = outboxRowFor(done);
  ok('outboxRowFor: the gc insert row (author gc, read by gc, invite null, own id/portal/project)',
    row.id === M1 && row.portal_id === 'portal-1' && row.project_id === P && row.author_type === 'gc' && row.invite_id === null
    && row.read_by_gc === true && row.read_by_client === false && row.body === 'See photos' && row.created_at === base.createdAt);
  const rowAtts = row.attachments as Record<string, unknown>[];
  ok('outboxRowFor: 2 files -> attachments equal toAttachmentRow(...) with exactly the trigger key set',
    Array.isArray(rowAtts) && rowAtts.length === 2
    && JSON.stringify(rowAtts) === JSON.stringify(done.attachments.map(toAttachmentRow))
    && rowAtts.every((a) => Object.keys(a).every((k) => ['id', 'name', 'mime', 'size', 'kind', 'width', 'height', 'path'].includes(k)))
    && !('localUri' in rowAtts[0]) && !('state' in rowAtts[0]) && rowAtts[0].width === 800);
  const textOnly = newOutboxEntry({ ...base, id: M2, files: [] });
  ok('outboxRowFor: a text-only entry has NO attachments key (works before the migration lands)',
    outboxReadyToWrite(textOnly) && !('attachments' in outboxRowFor(textOnly)));

  const wf = applyWriteOutcome(done, 'failed');
  ok("applyWriteOutcome: failed -> phase failed 'write_failed', retryable",
    wf.done === false && wf.entry.phase === 'failed' && wf.entry.failReason === 'write_failed'
    && JSON.stringify(outboxDisplay(wf.entry)) === '{"state":"failed","reason":"write_failed","retryable":true}');
  ok('applyWriteOutcome: synced / queued -> done', applyWriteOutcome(done, 'synced').done === true && applyWriteOutcome(done, 'queued').done === true);

  const mixed = applyUploadOutcome(applyUploadOutcome(two, A1, 'terminal', 'gone'), A2, 'terminal', 'refused');
  const retried = retryOutboxEntry(mixed);
  ok("retryOutboxEntry: a 'gone' file stays failed; the others reset to pending with fresh budgets",
    retried.attachments[0].state === 'failed' && retried.attachments[0].failReason === 'gone'
    && retried.attachments[1].state === 'pending' && retried.attachments[1].tries === 0 && retried.attachments[1].rlsTries === 0
    && outboxDisplay(retried).state === 'failed' && (outboxDisplay(retried) as { retryable?: boolean }).retryable === false);
  const retried2 = retryOutboxEntry(rt);
  ok("retryOutboxEntry: without a 'gone' file the entry is 'uploading' again", retried2.phase === 'uploading' && retried2.attachments[0].state === 'pending' && retried2.attachments[0].tries === 0);

  const wfEntry = wf.done ? done : wf.entry;
  const displays = [two, e, rt, rl, term, done, mixed, retried, retried2, wfEntry, textOnly].map(outboxDisplay);
  ok("outboxDisplay: never a state named 'sent'", displays.every((d) => (d.state as string) !== 'sent' && !JSON.stringify(d).includes('sent')));
  ok('outboxDisplay: done/total counts are right',
    JSON.stringify(outboxDisplay(two)) === '{"state":"uploading","done":0,"total":2}'
    && JSON.stringify(outboxDisplay(e)) === '{"state":"waiting_network","done":1,"total":2}'
    && JSON.stringify(outboxDisplay(done)) === '{"state":"writing"}');

  // ══ C. edge core ══════════════════════════════════════════════════════════
  console.log('\nC. edge core (portal-message-files/core.ts)');
  const core = (await import(join(ROOT, 'supabase/functions/portal-message-files/core.ts'))) as CoreMod;
  const auth = { portalId: ' portal-1 ', token: 'tok-1' };
  const f = (id: string, over: Partial<CoreFile> = {}): CoreFile => ({ id, name: 'one.jpg', mime: 'image/jpeg', size: 1000, ...over });
  const up = core.parsePortalFilesRequest({ action: 'upload', ...auth, messageId: M1.toUpperCase(), file: f(A1) });
  const sd = core.parsePortalFilesRequest({ action: 'send', ...auth, messageId: M1, body: 'hi', authorName: 'Dana', files: [f(A1), f(A2, { mime: 'application/pdf', name: 'p.pdf' })], passcode: '1234' });
  const ur = core.parsePortalFilesRequest({ action: 'urls', ...auth, messageIds: [M1, M2.toUpperCase(), M1] });
  const dl = core.parsePortalFilesRequest({ action: 'download', ...auth, messageId: M1, attachmentId: A1 });
  ok('parsePortalFilesRequest: accepts the four shapes (ids lower-cased, portal id trimmed, urls de-duplicated)',
    up.ok && up.req.action === 'upload' && up.req.messageId === M1 && up.req.portalId === 'portal-1'
    && sd.ok && sd.req.action === 'send' && sd.req.files.length === 2
    && ur.ok && ur.req.action === 'urls' && ur.req.messageIds.length === 2 && ur.req.messageIds[1] === M2
    && dl.ok && dl.req.action === 'download' && dl.req.attachmentId === A1);
  ok('parsePortalFilesRequest: a passcode field is never read (the parsed request has none)', sd.ok && !('passcode' in sd.req) && !JSON.stringify(sd).includes('1234'));
  const refuse = (b: unknown) => core.parsePortalFilesRequest(b);
  const elevenFiles = Array.from({ length: 11 }, (_, i) => f(`d0000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`));
  ok("parsePortalFilesRequest: 11 files refused ('count')", JSON.stringify(refuse({ action: 'send', ...auth, messageId: M1, files: elevenFiles })) === '{"ok":false,"reason":"count"}');
  ok('parsePortalFilesRequest: duplicate file ids refused', refuse({ action: 'send', ...auth, messageId: M1, files: [f(A1), f(A1.toUpperCase())] }).ok === false);
  ok('parsePortalFilesRequest: a non-uuid messageId refused', refuse({ action: 'upload', ...auth, messageId: '../x', file: f(A1) }).ok === false);
  const fiftyOne = Array.from({ length: 51 }, (_, i) => `e0000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`);
  ok('parsePortalFilesRequest: 51 messageIds refused, not truncated (50 accepted)',
    refuse({ action: 'urls', ...auth, messageIds: fiftyOne }).ok === false && refuse({ action: 'urls', ...auth, messageIds: fiftyOne.slice(0, 50) }).ok === true);
  ok("parsePortalFilesRequest: image/gif refused ('type')", JSON.stringify(refuse({ action: 'upload', ...auth, messageId: M1, file: f(A1, { mime: 'image/gif' }) })) === '{"ok":false,"reason":"type"}');
  ok("parsePortalFilesRequest: 20971521 bytes refused ('size')", JSON.stringify(refuse({ action: 'upload', ...auth, messageId: M1, file: f(A1, { size: 20971521 }) })) === '{"ok":false,"reason":"size"}');
  ok('parsePortalFilesRequest: a 401-character token refused (400 accepted)',
    refuse({ action: 'urls', portalId: 'p', token: 't'.repeat(401), messageIds: [M1] }).ok === false
    && refuse({ action: 'urls', portalId: 'p', token: 't'.repeat(400), messageIds: [M1] }).ok === true);
  ok('parsePortalFilesRequest: junk bodies refused', [null, 5, 'x', [], {}, { action: 'nope', ...auth }].every((b) => refuse(b).ok === false));

  const rows = core.rowsFor(P, M1, [f(A1, { name: '../evil/x\u0007.jpg', width: 10, height: 20 }), f(A2, { mime: 'application/pdf', name: '' })]);
  ok('rowsFor: paths equal pathFor(...), names cleaned, kinds from the type',
    rows[0].path === pathFor(P, M1, A1, 'image/jpeg') && rows[1].path === pathFor(P, M1, A2, 'application/pdf')
    && rows[0].name === 'x.jpg' && rows[1].name === 'Document.pdf' && rows[1].kind === 'pdf' && rows[0].width === 10
    && JSON.stringify(Object.keys(rows[1]).sort()) === '["id","kind","mime","name","path","size"]');
  const vl = core.verifyListing(
    [
      { name: `${A1}.jpg`, metadata: { size: 1000, mimetype: 'image/jpeg' } },
      { name: `${A2}.pdf`, metadata: { size: 4999, mimetype: 'application/pdf' } },
      { name: `${A3}.png`, metadata: { size: 1000, mimetype: 'image/jpeg' } },
    ],
    [f(A1), f(A2, { mime: 'application/pdf', size: 5000 }), f(A3, { mime: 'image/png' }), f('d0000000-0000-4000-8000-0000000000ff')],
  );
  ok('verifyListing: missing and size / mimetype mismatches reported by id',
    JSON.stringify(vl.missing) === JSON.stringify(['d0000000-0000-4000-8000-0000000000ff']) && JSON.stringify(vl.mismatched) === JSON.stringify([A2, A3]), JSON.stringify(vl));
  const sig = core.signable([
    { id: M1, project_id: P, attachments: [
      { id: A1, name: 'a.jpg', mime: 'image/jpeg', path: `${P}/${M1}/${A1}.jpg` },
      { id: A2, name: 'b.jpg', mime: 'image/jpeg', path: `${P}/${M2}/${A2}.jpg` },
      { id: A3, name: 'c.jpg', mime: 'image/jpeg', path: `${P2}/${M1}/${A3}.jpg` },
      { id: 'd0000000-0000-4000-8000-000000000011', name: 'd.pdf', mime: 'application/pdf', path: `${P}/${M1}/d0000000-0000-4000-8000-000000000011.jpg` },
      null, 5, { id: 'nope', mime: 'image/jpeg', path: 'x' },
    ] },
    { id: M2, project_id: P2, attachments: [{ id: A1, name: 'z.jpg', mime: 'image/jpeg', path: `${P2}/${M2}/${A1}.jpg` }] },
    { id: 'not-a-uuid', project_id: P, attachments: [] },
  ], P);
  ok("signable: only the token project's rows, only paths equal to pathFor(project, row.id, a.id, a.mime)",
    sig.length === 1 && sig[0].attachmentId === A1 && sig[0].messageId === M1 && sig[0].key === `${P}/${M1}/${A1}.jpg` && sig[0].name === 'a.jpg', JSON.stringify(sig));
  ok("signable: a path into another message's folder or another project is NOT returned",
    !sig.some((s) => s.key.includes(M2) || s.key.startsWith(P2)) && core.signable([{ id: M1, project_id: P, attachments: 'junk' }], P).length === 0);
  ok('folderFor / cleanAuthor: uuids only; author cleaned and capped at 120',
    core.folderFor(P, M1.toUpperCase()) === `${P}/${M1}` && core.folderFor('x', M1) === null
    && core.cleanAuthor('  Dana\u0000  Lee ') === 'Dana Lee' && Array.from(core.cleanAuthor('x'.repeat(300))).length === core.AUTHOR_MAX && core.cleanAuthor(5) === '');
  ok('mapTriggerRefusal: not_uploaded / file_rejected / refused / null',
    core.mapTriggerRefusal('attachment_not_uploaded') === 'not_uploaded' && core.mapTriggerRefusal('attachment_size_mismatch') === 'file_rejected'
    && core.mapTriggerRefusal('attachment_type_mismatch') === 'file_rejected' && core.mapTriggerRefusal('attachment_bad_path') === 'refused'
    && core.mapTriggerRefusal('message_empty') === 'refused' && core.mapTriggerRefusal('duplicate key value') === null);
  ok('TTLs: display 300 s and open 120 s, the same numbers on both sides',
    core.URL_TTL_SECONDS === 300 && core.DOWNLOAD_TTL_SECONDS === 120
    && MESSAGE_ATTACHMENT_URL_TTL_SECONDS === core.URL_TTL_SECONDS && MESSAGE_ATTACHMENT_OPEN_TTL_SECONDS === core.DOWNLOAD_TTL_SECONDS
    && core.MAX_MESSAGE_IDS === 50 && core.BODY_MAX === 4000);

  // ══ D. parity ═════════════════════════════════════════════════════════════
  console.log('\nD. parity (app helper, Deno helper, migration)');
  const MIG_RAW = read('supabase/migrations/20261001150000_portal_message_attachments.sql');
  const MIG = stripSqlComments(MIG_RAW);
  const MIMES_SQL = "array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']";
  ok('bucket name identical (app, Deno, migration insert + trigger lookup)',
    MESSAGE_ATTACHMENT_BUCKET === 'message-attachments' && MESSAGE_FILES_BUCKET === MESSAGE_ATTACHMENT_BUCKET
    && MIG.includes(`values ('${MESSAGE_ATTACHMENT_BUCKET}', '${MESSAGE_ATTACHMENT_BUCKET}', false,`)
    && MIG.includes(`o.bucket_id = '${MESSAGE_ATTACHMENT_BUCKET}'`));
  ok('max bytes identical (app, Deno, bucket limit, trigger size check)',
    MESSAGE_ATTACHMENT_MAX_BYTES === 20971520 && MESSAGE_FILES_MAX_BYTES === MESSAGE_ATTACHMENT_MAX_BYTES
    && MIG.includes(`false, ${MESSAGE_FILES_MAX_BYTES},`) && MIG.includes(`v_size > ${MESSAGE_FILES_MAX_BYTES}`),
    `app ${MESSAGE_ATTACHMENT_MAX_BYTES} deno ${MESSAGE_FILES_MAX_BYTES}`);
  ok('max count identical (app, Deno, trigger)',
    MESSAGE_ATTACHMENT_MAX_COUNT === 10 && MESSAGE_FILES_MAX_COUNT === MESSAGE_ATTACHMENT_MAX_COUNT && MIG.includes(`v_len > ${MESSAGE_FILES_MAX_COUNT}`));
  const sqlCaseMimes = [...MIG.matchAll(/when '([a-z]+\/[a-z]+)' then '(jpg|png|webp|pdf)'/g)].map((m) => m[1]);
  ok('mime list identical (app, Deno, bucket allowlist, trigger case)',
    JSON.stringify([...MESSAGE_ATTACHMENT_MIMES]) === JSON.stringify([...MESSAGE_FILES_MIMES])
    && MIG.includes(MIMES_SQL) && JSON.stringify(sqlCaseMimes) === JSON.stringify([...MESSAGE_FILES_MIMES]));
  ok('paths and names agree across the two helpers',
    pathFor(P, M1, A1, 'image/webp') === messageAttachmentPath(P, M1, A1, 'image/webp') && pathFor(P, M1, A1, 'image/gif') === null && pathFor('x', M1, A1, 'image/jpeg') === null
    && ['../../etc/passwd', '', `${'b'.repeat(300)}.jpg`, 'a\u0001/b'].every((n) => cleanName(n, 'image/jpeg') === cleanAttachmentName(n, 'image/jpeg'))
    && [JPEG, PNG, WEBP, PDF, HTML].every((h) => MESSAGE_FILES_MIMES.every((m) => sniffMatchesServer(h, m) === sniffMatches(h, m))));
  ok("attachmentSummaryLine: [] -> '', ['image'] -> '1 photo', ['image','image','pdf'] -> '2 photos and 1 PDF'",
    attachmentSummaryLine([]) === '' && attachmentSummaryLine(['image']) === '1 photo' && attachmentSummaryLine(['image', 'image', 'pdf']) === '2 photos and 1 PDF');
  ok("attachmentSummaryLine: '3 photos', '1 PDF', '2 PDFs'; junk -> ''",
    attachmentSummaryLine(['image', 'image', 'image']) === '3 photos' && attachmentSummaryLine(['pdf']) === '1 PDF' && attachmentSummaryLine(['pdf', 'pdf']) === '2 PDFs'
    && attachmentSummaryLine(null) === '' && attachmentSummaryLine('image') === '' && attachmentSummaryLine([5, 'gif']) === '');

  // ══ E. index.ts ═══════════════════════════════════════════════════════════
  console.log('\nE. portal-message-files/index.ts');
  const IDX_RAW = read('supabase/functions/portal-message-files/index.ts');
  const IDX = stripTsComments(IDX_RAW);
  const header = IDX_RAW.slice(0, IDX_RAW.search(/^import /m));
  ok('index.ts loaded; header says "verify_jwt is OFF"', IDX.length > 0 && /verify_jwt is OFF/.test(header));
  const serveAt = IDX.indexOf('serve(async');
  const SERVE = serveAt >= 0 ? IDX.slice(serveAt) : '';
  const ipAt = SERVE.search(/rateLimitCount\(`portal-files:ip:\$\{clientIpFrom\(req\.headers\)\}`|over\(`portal-files:ip:\$\{clientIpFrom\(req\.headers\)\}`/);
  const gateAt = SERVE.indexOf('svc.rpc("portal_project_for_token"');
  const portalLimitAts = [...SERVE.matchAll(/(?:rateLimitCount|over)\(`portal-files:(?:upload|send):/g)].map((m) => m.index ?? -1);
  const firstStorage = SERVE.indexOf('.storage');
  ok('the per-IP limit precedes the token check', ipAt >= 0 && gateAt > ipAt, `ip ${ipAt} gate ${gateAt}`);
  ok('the token check (portal_project_for_token) precedes every per-portal limit and every Storage call',
    gateAt >= 0 && portalLimitAts.length === 2 && portalLimitAts.every((p) => p > gateAt) && (firstStorage < 0 || firstStorage > gateAt)
    && /if \(!isUuid\(gate\)\) return DENIED\(\);/.test(SERVE), JSON.stringify({ gateAt, portalLimitAts }));
  ok('the limiter is the shared rateLimitCount, keyed per IP by clientIpFrom',
    /import \{ rateLimitCount \} from "\.\.\/_shared\/auth\.ts";/.test(IDX) && /import \{ clientIpFrom \} from "\.\.\/_shared\/notifyGuards\.ts";/.test(IDX)
    && /await rateLimitCount\(scope\)/.test(IDX));

  const storageCalls = [...IDX.matchAll(/\.storage\s*\.from\(([^)]*)\)\s*\.\s*(\w+)\(/g)].map((m) => {
    const open = (m.index ?? 0) + m[0].length - 1;
    return { bucket: m[1].trim(), method: m[2], args: balancedFrom(IDX, open).slice(1, -1) };
  });
  ok('every Storage call uses MESSAGE_FILES_BUCKET (6 calls: sign upload, list, sign sniff, remove, sign urls, sign download)',
    storageCalls.length === 6 && storageCalls.every((s) => s.bucket === 'MESSAGE_FILES_BUCKET'), JSON.stringify(storageCalls.map((s) => `${s.bucket}.${s.method}`)));
  ok('no Storage call argument is a template literal or a req./body. expression',
    storageCalls.every((s) => !s.args.includes('`') && !/\b(?:req|body)\./.test(s.args)), JSON.stringify(storageCalls.map((s) => s.args)));
  ok('every Storage key / prefix comes from core pathFor / folderFor / signable',
    /const key = pathFor\(projectId, r\.messageId, r\.file\.id, r\.file\.mime\);/.test(IDX)
    && /const folder = folderFor\(projectId, r\.messageId\);/.test(IDX)
    && /const key = pathFor\(projectId, r\.messageId, f\.id, f\.mime\);/.test(IDX)
    && /signable\(\(rows \?\? \[\]\) as MsgRow\[\], projectId\)/.test(IDX) && /signable\(row \? \[row as MsgRow\] : \[\], projectId\)/.test(IDX)
    && /attachments: rowsFor\(projectId, r\.messageId, r\.files\)/.test(IDX));
  const ttlOf = (method: string) => storageCalls.filter((s) => s.method === method).map((s) => s.args.split(',')[1]?.trim());
  ok('signing TTLs are the core constants (300 display, 120 download, 60 sniff; upload URL has no caller TTL)',
    JSON.stringify(ttlOf('createSignedUrls')) === '["URL_TTL_SECONDS"]'
    && JSON.stringify(ttlOf('createSignedUrl').sort()) === '["DOWNLOAD_TTL_SECONDS","SNIFF_TTL_SECONDS"]'
    && storageCalls.filter((s) => s.method === 'createSignedUploadUrl').every((s) => s.args.trim() === 'key'),
    JSON.stringify({ urls: ttlOf('createSignedUrls'), url: ttlOf('createSignedUrl') }));
  const leaks = leaky(IDX);
  ok('no response body echoes Postgres / Storage text (validate-edge-security LEAK_TOKEN_RE over every json(...))', leaks.length === 0, leaks.join('; '));
  ok('one DENIED() for every 401', (IDX.match(/\b401\b/g) ?? []).length === 1 && /const DENIED = \(\) => json\(\{ error: "denied" \}, 401\);/.test(IDX));
  const sendAt = IDX.indexOf('async function send(');
  const SEND = sendAt >= 0 ? IDX.slice(sendAt, IDX.indexOf('\n}\n', sendAt)) : '';
  const sniffCallAt = SEND.search(/await headOf\(svc, key\)/);
  const sniffCheckAt = SEND.search(/sniffMatches\(head, f\.mime\)/);
  const insertAt = SEND.search(/\.from\("portal_messages"\)\.insert\(/);
  ok('the sniff (Range: bytes=0-15) runs before the insert, and a mismatch is refused before it',
    /headers: \{ Range: "bytes=0-15" \}/.test(IDX) && sniffCallAt > 0 && sniffCheckAt > sniffCallAt && insertAt > sniffCheckAt
    && SEND.slice(sniffCheckAt, insertAt).includes('return json({ error: "file_rejected", ids: rejected }, 422)'));
  ok("'upload' refuses an existing message (409 message_exists) before minting",
    /if \(existing\) return json\(\{ error: "message_exists" \}, 409\);/.test(IDX) && IDX.indexOf('message_exists') < IDX.indexOf('createSignedUploadUrl('));
  ok("'urls' reads only this portal's rows by parser-validated ids", /\.eq\("portal_id", r\.portalId\)\.in\("id", r\.messageIds\)/.test(IDX));

  // ══ F. migration text ═════════════════════════════════════════════════════
  console.log('\nF. migration text');
  ok('bucket is private on insert and on conflict', /values \('message-attachments', 'message-attachments', false, 20971520,/.test(MIG) && /set public = false,/.test(MIG) && !/set public = true/.test(MIG));
  const policyBlocks = [...MIG.matchAll(/create policy (message_attachments_\w+) on storage\.objects([\s\S]*?);\s*\n/g)].map((m) => ({ name: m[1], body: m[2] }));
  ok('both owner storage policies (SELECT + INSERT), to authenticated only',
    policyBlocks.length === 2 && policyBlocks.some((p) => p.name === 'message_attachments_owner_select' && /for select to authenticated/.test(p.body))
    && policyBlocks.some((p) => p.name === 'message_attachments_owner_insert' && /for insert to authenticated/.test(p.body))
    && policyBlocks.every((p) => !/\bto (anon|public)\b/.test(p.body)) && !/for (update|delete)[^;]*message-attachments/.test(MIG));
  const existsBlocks = policyBlocks.flatMap((p) => [...p.body.matchAll(/exists \(/g)].map((m) => balancedFrom(p.body, (m.index ?? 0) + m[0].length - 1)));
  ok('every `name` inside an EXISTS on projects is `objects.name`',
    existsBlocks.length === 2 && existsBlocks.every((b) => /public\.projects/.test(b) && /foldername\(objects\.name\)/.test(b) && !/foldername\(\s*name\s*\)/.test(b)));
  ok('the INSERT policy pins depth 2 and a uuid message folder', /array_length\(storage\.foldername\(objects\.name\), 1\) = 2/.test(MIG) && /\(storage\.foldername\(objects\.name\)\)\[2\] ~ '\^\[0-9a-f\]\{8\}/.test(MIG));
  ok('the public/anon guard is present (raises on a public/anon policy or a public bucket)',
    /roles && array\['public', 'anon'\]::name\[\]/.test(MIG) && /raise exception '\[msgdata\] % storage polic/.test(MIG) && /if v_public is distinct from false then/.test(MIG));
  ok('grants: table UPDATE revoked, UPDATE (read_by_gc) granted, no table-wide UPDATE grant',
    /revoke update on public\.portal_messages from authenticated;/.test(MIG) && /grant\s+update \(read_by_gc\) on public\.portal_messages to authenticated;/.test(MIG)
    && !/grant\s+update\s+on\s+public\.portal_messages/.test(MIG) && !/grant\s+all\s+on\s+public\.portal_messages\s+to\s+(authenticated|anon)/.test(MIG));
  ok('grants: DELETE revoked from authenticated, everything revoked from anon, truncate/trigger/references revoked',
    /revoke delete on public\.portal_messages from authenticated;/.test(MIG) && /revoke all\s+on public\.portal_messages from anon;/.test(MIG)
    && /revoke truncate, trigger, references on public\.portal_messages from anon, authenticated;/.test(MIG) && /revoke maintain on public\.portal_messages/.test(MIG));
  const trg = MIG.match(/create trigger (\w+)\s+before insert or update on public\.portal_messages\s+for each row execute function public\.portal_message_attachments_check\(\);/);
  ok('trigger name sorts after trg_resolve_portal_msg_project, BEFORE INSERT OR UPDATE', !!trg && trg[1] > 'trg_resolve_portal_msg_project', trg?.[1]);
  const fnStart = MIG.indexOf('create or replace function public.portal_message_attachments_check()');
  const FN = fnStart >= 0 ? MIG.slice(fnStart, MIG.indexOf('$fn$;', fnStart)) : '';
  ok("check function: security definer, set search_path = '', execute revoked from public, anon, authenticated",
    /security definer\s+set search_path = ''/.test(FN)
    && /revoke execute on function public\.portal_message_attachments_check\(\) from public, anon, authenticated;/.test(MIG));
  ok('check function: immutability on UPDATE, the storage.objects lookup, the exact-path rule',
    /if tg_op = 'UPDATE' then\s+if new\.attachments is distinct from old\.attachments then\s+raise exception 'attachments_immutable' using errcode = '42501';/.test(FN)
    && /from storage\.objects o\s+where o\.bucket_id = 'message-attachments'\s+and o\.name = v_paths\[i\]/.test(FN)
    && /if not found then\s+raise exception 'attachment_not_uploaded'/.test(FN)
    && /v_path := new\.project_id \|\| '\/' \|\| new\.id::text \|\| '\/' \|\| v_id \|\| '\.' \|\| v_ext;/.test(FN)
    && /\(v_el ->> 'path'\) <> v_path/.test(FN));
  const codes = ['message_empty', 'attachment_too_many', 'attachment_no_project', 'attachment_bad_key', 'attachment_bad_id', 'attachment_bad_type', 'attachment_bad_kind',
    'attachment_bad_name', 'attachment_bad_size', 'attachment_bad_path', 'attachment_not_uploaded', 'attachment_size_mismatch', 'attachment_type_mismatch', 'attachments_immutable'];
  ok('every refusal code is raised as a bare code', codes.every((cd) => FN.includes(`raise exception '${cd}' using errcode`)), codes.filter((cd) => !FN.includes(`raise exception '${cd}'`)).join(', '));
  const gm = MIG.slice(MIG.indexOf('create or replace function public.portal_get_messages'), MIG.indexOf('end; $$;', MIG.indexOf('create or replace function public.portal_get_messages')));
  ok("portal_get_messages still gates on portal_project_for_token and strips 'path'",
    /v_pid := public\.portal_project_for_token\(p_portal_id, p_access_token\);/.test(gm) && /raise exception 'portal_denied'/.test(gm) && /jsonb_agg\(e - 'path'\)/.test(gm)
    && /grant execute on function public\.portal_get_messages\(text, text\) to anon, authenticated, service_role;/.test(MIG));
  const nt = MIG.slice(MIG.indexOf('create or replace function public.trg_notify_portal_message()'), MIG.indexOf('$function$;', MIG.indexOf('create or replace function public.trg_notify_portal_message()')));
  ok('trg_notify_portal_message keeps the gc-branch nested projects check and the invoker search_path',
    /set search_path to ''/.test(nt) && !/security definer/i.test(nt)
    && /if not exists \(\s+select 1 from public\.projects p\s+where p\.id::text = NEW\.project_id\s+and p\.client_portal ->> 'portalId' = NEW\.portal_id\s+\) then\s+return NEW;/.test(nt));
  ok('trg_notify_portal_message adds attachment_count and attachment_kinds to BOTH payloads',
    (nt.match(/'attachment_count', pg_catalog\.jsonb_array_length/g) ?? []).length === 2 && (nt.match(/'attachment_kinds', \(select coalesce/g) ?? []).length === 2
    && nt.indexOf("'portal_message'") < nt.indexOf("'attachment_count'") && nt.lastIndexOf("'attachment_count'") > nt.indexOf("'portal_reply'"));
  ok('header names WHY, WHAT, ORDER and VERIFY AFTER', ['-- WHY', '-- WHAT', '-- ORDER', '-- VERIFY AFTER', '-- ORPHANS'].every((h) => MIG_RAW.includes(h)));

  // ══ G. notify ═════════════════════════════════════════════════════════════
  console.log('\nG. notify/index.ts');
  const NOTIFY = stripTsComments(read('supabase/functions/notify/index.ts'));
  const branch = (name: string): string => {
    const at = NOTIFY.indexOf(`case '${name}': {`);
    if (at < 0) return '';
    const next = NOTIFY.slice(at + 10).search(/\n {4}case '/);
    return NOTIFY.slice(at, next < 0 ? undefined : at + 10 + next);
  };
  const pmB = branch('portal_message');
  const prB = branch('portal_reply');
  ok('notify imports attachmentSummaryLine from _shared/messageFiles.ts', /import \{ attachmentSummaryLine \} from "\.\.\/_shared\/messageFiles\.ts";/.test(NOTIFY));
  ok("both branches call attachmentSummaryLine(payload.attachment_kinds) and add the line under the quote",
    [pmB, prB].every((b) => /attachmentSummaryLine\(payload\.attachment_kinds\)/.test(b))
    && /emailQuote\(trimmed\) \+ attachmentLineHtml\(files, 'Open the thread in MAGE ID to see them\.'\)/.test(pmB)
    && /emailQuote\(trimmed\) \+ attachmentLineHtml\(files, 'Open your portal to see them\.'\)/.test(prB));
  ok("an empty body with files reads 'Sent <summary>.' in push, preheader and quote",
    /const shown = body\.trim\(\) \|\| !files \? body : `Sent \$\{files\}\.`;/.test(pmB) && /pushBody: `\$\{author\}: \$\{shown\.slice\(0, 140\)\}`/.test(pmB)
    && /preheader: `\$\{author\}: \$\{shown\.slice\(0, 100\)\}`/.test(pmB) && /const body = text\.trim\(\) \|\| !files \? text : `Sent \$\{files\}\.`;/.test(prB));
  const helperAt = NOTIFY.indexOf('function attachmentLineHtml(');
  const HELPER = helperAt >= 0 ? NOTIFY.slice(helperAt, NOTIFY.indexOf('\n}\n', helperAt)) : '';
  ok('the attachment line is escaped text with no link', /escapeHtml\(sentence\)/.test(HELPER) && !/href|<a\b/.test(HELPER) && /attached\. \$\{where\}/.test(HELPER));
  ok('no storage path, signed URL or attachment URL reaches the email or push',
    [pmB, prB, HELPER].every((b) => b.length > 0 && !/\.path\b|signedUrl|createSigned|\.storage\b|message-attachments|attachments\s*\[/.test(b)));

  console.log(`\n${failed === 0 ? '✓' : '✗'} validate-message-attachments: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });

// scripts/validate-message-attachments-app.ts — the contractor's side of
// client messages with photos and PDFs (track MSG, lane MSGAPP).
//
//   A  utils/messageOutbox.ts driven through createMessageOutbox with stubs
//      (in-memory storage, fake files, scripted upload results): a file
//      message is written exactly once, only after every file is uploaded;
//      offline keeps it waiting; another tenant's entry is never sent; the
//      end-of-process sweep never touches a file outside the outbox folder.
//   B  source scans: the screen's pins, the status line never beside a time,
//      Retry + Remove on a failed message, the text-only send unchanged, the
//      signed-URL TTLs and the pre-await window.open, the copy hook as the
//      only t() caller, no hex colours, and the copy's voice.
//
// Pure bun: messageOutbox.ts binds react-native only on first use of its app
// instance, which this file never touches.
//
// Run: bun run scripts/validate-message-attachments-app.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createMessageOutbox,
  MESSAGE_OUTBOX_KEY,
  signRetryDelayMs,
  type OutboxDeps,
  type OutboxFileInput,
} from '../utils/messageOutbox';
import type { OutboxEntry } from '../utils/messageAttachments';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
/** Comments blanked (block and line), so a scan reads code only. */
const code = (p: string) => read(p).replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, extra ? `\n     ${extra}` : ''); }
}

// ─── A. the outbox shell ────────────────────────────────────────────────────

const PROJECT = '22222222-2222-4222-8222-222222222222';
const PORTAL = '44444444-4444-4444-8444-444444444444';
const DIR = 'file:///doc/mageid-msg-outbox/';
const USER_A = 'user-a';
const USER_B = 'user-b';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 9, 9]);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 10, 37, 37, 69, 79, 70, 10, 1, 2]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, 1]);

let seq = 0;
const uuid = () => {
  seq++;
  const h = seq.toString(16).padStart(12, '0');
  return `aaaaaaaa-bbbb-4ccc-8ddd-${h}`;
};

type UploadScript = (path: string) => void | Promise<void>;

function world(opts: { uploadDelayMs?: number } = {}) {
  const store = new Map<string, string>();
  const files = new Map<string, Uint8Array>(); // every local file, inside or outside the outbox dir
  const deleted: string[] = [];
  const copied: { from: string; to: string }[] = [];
  const uploads: string[] = [];
  let script: UploadScript = () => {};
  let uid: string | null = USER_A;
  let live = true;
  const deps: OutboxDeps = {
    storageGet: async (k) => store.get(k) ?? null,
    storageSet: async (k, v) => { store.set(k, v); },
    storageRemove: async (k) => { store.delete(k); },
    outboxDir: DIR,
    copyIn: async (uri, name) => {
      const to = `${DIR}${name}`;
      const bytes = files.get(uri);
      if (!bytes) throw new Error(`ENOENT ${uri}`);
      files.set(to, bytes);
      copied.push({ from: uri, to });
      return to;
    },
    deleteLocal: async (uri) => { deleted.push(uri); files.delete(uri); },
    listLocal: async () => [...files.keys()],
    readBytes: async (uri) => {
      const b = files.get(uri);
      if (!b) throw new Error(`ENOENT: no such file ${uri}`);
      return b;
    },
    upload: async (path) => {
      uploads.push(path);
      if (opts.uploadDelayMs) await new Promise((r) => setTimeout(r, opts.uploadDelayMs));
      await script(path);
    },
    currentUserId: () => uid,
    bearerLive: () => live,
    isWeb: false,
    now: () => '2026-10-02T12:00:00.000Z',
  };
  const outbox = createMessageOutbox(deps);
  const writes: Record<string, unknown>[] = [];
  let writeResult: 'synced' | 'queued' | 'failed' = 'synced';
  const writer = {
    writePortalMessage: async (row: Record<string, unknown>) => { writes.push(row); return writeResult; },
  };
  const pick = (mime: 'image/jpeg' | 'application/pdf', bytes: Uint8Array, name: string): OutboxFileInput => {
    const id = uuid();
    const localUri = `file:///cache/picker/${id}`;
    files.set(localUri, bytes);
    return { id, name, mime, size: bytes.length, localUri };
  };
  const entries = async (): Promise<OutboxEntry[]> => JSON.parse(store.get(MESSAGE_OUTBOX_KEY) ?? '[]');
  return {
    store, files, deleted, copied, uploads, outbox, writes, writer, pick, entries, deps,
    setScript: (s: UploadScript) => { script = s; },
    setUser: (u: string | null) => { uid = u; },
    setLive: (l: boolean) => { live = l; },
    setWrite: (r: 'synced' | 'queued' | 'failed') => { writeResult = r; },
  };
}

const offline = () => { throw new TypeError('Failed to fetch'); };

async function partA() {
  console.log('\nA. the outbox shell (createMessageOutbox with stubs):');

  // add → persisted, files copied into the outbox folder.
  {
    const w = world();
    const f1 = w.pick('image/jpeg', JPEG, 'IMG_0001.jpg');
    const f2 = w.pick('application/pdf', PDF, 'Change order 4.pdf');
    const msgId = uuid();
    const e = await w.outbox.add({ id: msgId, projectId: PROJECT, portalId: PORTAL, body: 'Tile is in', authorName: 'Ace GC', files: [f1, f2] });
    const stored = await w.entries();
    ok('add: the entry is persisted under mageid_message_outbox with this user and its two files',
      stored.length === 1 && stored[0].id === msgId && stored[0].userId === USER_A && stored[0].attachments.length === 2
        && MESSAGE_OUTBOX_KEY === 'mageid_message_outbox');
    ok('add: both files are copied into the outbox folder and the entry points at the copies',
      w.copied.length === 2 && e.attachments.every((a) => a.localUri.startsWith(DIR))
        && w.copied.some((c) => c.from === f1.localUri) && w.copied.some((c) => c.from === f2.localUri));
    ok('add: nothing is uploaded or written by add itself', w.uploads.length === 0 && w.writes.length === 0);

    // transient → waiting_network, no write, file kept.
    w.setScript(offline);
    const r1 = await w.outbox.process(w.writer);
    const afterOffline = (await w.entries())[0];
    ok('offline upload: no row write, the entry waits (phase waiting_network), its copies stay on disk',
      w.writes.length === 0 && afterOffline?.phase === 'waiting_network' && r1.sent === 0 && r1.remaining === 1
        && afterOffline.attachments.every((a) => w.files.has(a.localUri)) && w.deleted.length === 0,
      JSON.stringify({ writes: w.writes.length, phase: afterOffline?.phase, r1 }));
    ok('offline upload: the file is still pending, not failed',
      afterOffline?.attachments.every((a) => a.state === 'pending') === true);

    // success on both → exactly ONE write with the deterministic paths; synced → gone + copies deleted.
    w.setScript(() => {});
    const r2 = await w.outbox.process(w.writer);
    const row = w.writes[0] as { id?: string; attachments?: { path?: string; id?: string }[] } | undefined;
    const want = [`${PROJECT}/${msgId}/${f1.id}.jpg`, `${PROJECT}/${msgId}/${f2.id}.pdf`];
    ok('back online: exactly one writePortalMessage call, after both uploads', w.writes.length === 1 && r2.sent === 1,
      JSON.stringify({ writes: w.writes.length, r2 }));
    ok('the row carries both attachments with the deterministic <project>/<message>/<file>.<ext> paths',
      row?.id === msgId && JSON.stringify((row?.attachments ?? []).map((a) => a.path)) === JSON.stringify(want)
        && (row?.attachments ?? []).every((a) => !('localUri' in a)),
      JSON.stringify(row?.attachments));
    ok("'synced': the entry is gone and its local copies are deleted",
      (await w.entries()).length === 0 && !w.store.has(MESSAGE_OUTBOX_KEY)
        && e.attachments.every((a) => w.deleted.includes(a.localUri) && !w.files.has(a.localUri)));
    ok('the picked originals outside the outbox folder are never deleted',
      !w.deleted.includes(f1.localUri) && !w.deleted.includes(f2.localUri));
  }

  // first file lands, the second hits no signal → still no row.
  {
    const w = world();
    const f1 = w.pick('image/jpeg', JPEG, 'a.jpg');
    const f2 = w.pick('application/pdf', PDF, 'b.pdf');
    await w.outbox.add({ id: uuid(), projectId: PROJECT, portalId: PORTAL, body: 'half', authorName: 'Ace GC', files: [f1, f2] });
    w.setScript((path) => { if (path.endsWith('.pdf')) offline(); });
    await w.outbox.process(w.writer);
    const e = (await w.entries())[0];
    ok('one file uploaded, the next offline: no row is written, the first is uploaded and the second waits',
      w.writes.length === 0 && e?.phase === 'waiting_network'
        && e.attachments[0].state === 'uploaded' && e.attachments[1].state === 'pending',
      JSON.stringify({ writes: w.writes.length, phase: e?.phase, states: e?.attachments.map((a) => a.state) }));
    w.setScript(() => {});
    await w.outbox.process(w.writer);
    ok('…and back online it uploads only the second file, then writes once',
      w.writes.length === 1 && w.uploads.filter((u) => u.endsWith('.jpg')).length === 1 && (await w.entries()).length === 0);
  }

  // 'queued' → gone too (the offline queue owns the row now).
  {
    const w = world();
    w.setWrite('queued');
    await w.outbox.add({ id: uuid(), projectId: PROJECT, portalId: PORTAL, body: '', authorName: 'Ace GC', files: [w.pick('image/jpeg', JPEG, 'a.jpg')] });
    const r = await w.outbox.process(w.writer);
    ok("'queued': the entry leaves the outbox (its row is the offline queue's now)", (await w.entries()).length === 0 && r.sent === 1 && w.writes.length === 1);
  }

  // write 'failed' → kept as write_failed; retry → a second write.
  {
    const w = world();
    w.setWrite('failed');
    const id = uuid();
    await w.outbox.add({ id, projectId: PROJECT, portalId: PORTAL, body: 'Invoice attached', authorName: 'Ace GC', files: [w.pick('application/pdf', PDF, 'inv.pdf')] });
    await w.outbox.process(w.writer);
    const e = (await w.entries())[0];
    ok("write 'failed': the entry is kept, phase failed, reason write_failed",
      e?.id === id && e.phase === 'failed' && e.failReason === 'write_failed' && w.writes.length === 1, JSON.stringify(e));
    w.setWrite('synced');
    await w.outbox.retry(id);
    await w.outbox.process(w.writer);
    ok('retry: a second write, no second upload (the file is already in storage), then gone',
      w.writes.length === 2 && w.uploads.length === 1 && (await w.entries()).length === 0,
      JSON.stringify({ writes: w.writes.length, uploads: w.uploads.length }));
  }

  // another user's entry is never uploaded nor written.
  {
    const w = world();
    await w.outbox.add({ id: uuid(), projectId: PROJECT, portalId: PORTAL, body: 'hi', authorName: 'Ace GC', files: [w.pick('image/jpeg', JPEG, 'a.jpg')] });
    w.setUser(USER_B);
    const r = await w.outbox.process(w.writer);
    ok("an entry another user queued is never uploaded nor written under this session",
      w.uploads.length === 0 && w.writes.length === 0 && r.sent === 0 && (await w.entries()).length === 1,
      JSON.stringify({ uploads: w.uploads.length, writes: w.writes.length }));
    w.setUser(null);
    const r0 = await w.outbox.process(w.writer);
    ok('signed out: nothing is sent', w.uploads.length === 0 && w.writes.length === 0 && r0.sent === 0);
  }

  // bearer not live → nothing uploaded.
  {
    const w = world();
    await w.outbox.add({ id: uuid(), projectId: PROJECT, portalId: PORTAL, body: 'hi', authorName: 'Ace GC', files: [w.pick('image/jpeg', JPEG, 'a.jpg')] });
    w.setLive(false);
    const r = await w.outbox.process(w.writer);
    ok('no live session token: nothing is uploaded or written, the entry waits',
      w.uploads.length === 0 && w.writes.length === 0 && r.remaining === 1 && (await w.entries())[0]?.phase === 'uploading');
  }

  // sniff mismatch → failed type_mismatch, no upload call.
  {
    const w = world();
    await w.outbox.add({ id: uuid(), projectId: PROJECT, portalId: PORTAL, body: 'pic', authorName: 'Ace GC', files: [w.pick('image/jpeg', PNG, 'not-a-jpeg.jpg')] });
    await w.outbox.process(w.writer);
    const e = (await w.entries())[0];
    ok("bytes that are not the declared type: failed 'type_mismatch', never uploaded, never written",
      e?.phase === 'failed' && e.failReason === 'type_mismatch' && w.uploads.length === 0 && w.writes.length === 0, JSON.stringify(e?.failReason));
  }

  // a file gone from the device → failed 'gone' (Remove only).
  {
    const w = world();
    const f = w.pick('image/jpeg', JPEG, 'a.jpg');
    const e0 = await w.outbox.add({ id: uuid(), projectId: PROJECT, portalId: PORTAL, body: 'pic', authorName: 'Ace GC', files: [f] });
    w.files.delete(e0.attachments[0].localUri);
    await w.outbox.process(w.writer);
    const e = (await w.entries())[0];
    ok("a file no longer on the device: failed 'gone', never uploaded", e?.phase === 'failed' && e.failReason === 'gone' && w.uploads.length === 0);
  }

  // single-flight.
  {
    const w = world({ uploadDelayMs: 15 });
    await w.outbox.add({ id: uuid(), projectId: PROJECT, portalId: PORTAL, body: 'two', authorName: 'Ace GC', files: [w.pick('image/jpeg', JPEG, 'a.jpg'), w.pick('application/pdf', PDF, 'b.pdf')] });
    const p1 = w.outbox.process(w.writer);
    const p2 = w.outbox.process(w.writer);
    const [r1, r2] = await Promise.all([p1, p2]);
    ok('two process() calls at once run one set of uploads and one write (single-flight)',
      p1 === p2 && w.uploads.length === 2 && w.writes.length === 1 && r1.sent === 1 && r2.sent === 1,
      JSON.stringify({ same: p1 === p2, uploads: w.uploads.length, writes: w.writes.length }));
  }

  // end-of-process sweep: orphans in the folder go; files outside never do.
  {
    const w = world();
    const orphan = `${DIR}orphan-from-a-wiped-tenant.jpg`;
    const outside = 'file:///doc/mageid-photo-queue/keep-me.jpg';
    w.files.set(orphan, JPEG);
    w.files.set(outside, JPEG);
    const e = await w.outbox.add({ id: uuid(), projectId: PROJECT, portalId: PORTAL, body: 'x', authorName: 'Ace GC', files: [w.pick('image/jpeg', JPEG, 'a.jpg')] });
    w.setScript(offline);
    await w.outbox.process(w.writer);
    ok('the sweep deletes a file in the outbox folder that no entry references',
      w.deleted.includes(orphan) && !w.files.has(orphan));
    ok("the sweep keeps a waiting entry's own copy", w.files.has(e.attachments[0].localUri) && !w.deleted.includes(e.attachments[0].localUri));
    ok('the sweep never deletes a file outside the outbox folder', !w.deleted.includes(outside) && w.files.has(outside));
  }

  // remove: copies deleted, never the original, never the bucket.
  {
    const w = world();
    const f = w.pick('image/jpeg', JPEG, 'a.jpg');
    const e = await w.outbox.add({ id: uuid(), projectId: PROJECT, portalId: PORTAL, body: 'x', authorName: 'Ace GC', files: [f] });
    let changed = 0;
    const off = w.outbox.onChanged(() => { changed++; });
    await w.outbox.remove(e.id);
    off();
    ok('remove: the entry and its outbox copy go, the picked original stays, listeners hear it',
      (await w.entries()).length === 0 && w.deleted.includes(e.attachments[0].localUri) && !w.deleted.includes(f.localUri) && changed > 0);
  }

  // a message added while a pass is running is sent by that pass.
  {
    const w = world({ uploadDelayMs: 10 });
    await w.outbox.add({ id: uuid(), projectId: PROJECT, portalId: PORTAL, body: 'one', authorName: 'Ace GC', files: [w.pick('image/jpeg', JPEG, 'a.jpg')] });
    const p = w.outbox.process(w.writer);
    await w.outbox.add({ id: uuid(), projectId: PROJECT, portalId: PORTAL, body: 'two', authorName: 'Ace GC', files: [w.pick('image/jpeg', JPEG, 'b.jpg')] });
    const again = w.outbox.process(w.writer);
    const r = await p;
    ok('a message added during a running pass is picked up by it (no stranded entry)',
      again === p && w.writes.length === 2 && r.sent === 2 && (await w.entries()).length === 0, JSON.stringify({ writes: w.writes.length, r }));
  }

  // web: no copies, no sweep.
  {
    const w = world();
    (w.deps as { isWeb: boolean }).isWeb = true;
    const web = createMessageOutbox(w.deps);
    const f = w.pick('image/jpeg', JPEG, 'a.jpg');
    const e = await web.add({ id: uuid(), projectId: PROJECT, portalId: PORTAL, body: 'x', authorName: 'Ace GC', files: [f] });
    ok('web: the picked blob uri is kept as is (no copy)', w.copied.length === 0 && e.attachments[0].localUri === f.localUri);
  }
}

// ─── B. source scans ────────────────────────────────────────────────────────

function partB() {
  console.log('\nB. source scans:');
  const cm = read('app/client-messages.tsx');
  const cmc = code('app/client-messages.tsx');

  ok('client-messages: the composer\'s first element still matches the offline-group-abort pin',
    /const ownerOnlyBlocked = role === 'editor' \|\| role === 'viewer' \|\| role === 'field';/.test(cm)
      && /\{ownerOnlyBlocked \? \([\s\S]{0,400}Only the project owner can message the client\.[\s\S]{0,120}\) : \(\s*<View style=\{\[styles\.compose, \{ paddingBottom/.test(cm));
  const screens = cmc.match(/<Stack\.Screen options=\{\{[^}]*\}\} \/>/g) ?? [];
  ok(`client-messages: exactly 3 Stack.Screen states (${screens.length})`, screens.length === 3 && screens.every((s) => /\.\.\.headerBack/.test(s)));
  ok('client-messages: no router.back()', !/router\.back\(\)/.test(cmc));
  ok('client-messages: the tray and the attach button live INSIDE the composer view',
    /<View style=\{\[styles\.compose, \{ paddingBottom: insets\.bottom \+ 10 \}\]\}>\s*<AttachmentTray[\s\S]{0,200}<View style=\{styles\.composeRow\}>\s*<Pressable\s+onPress=\{handleAttach\}/.test(cmc));

  // The time label is drawn only for a message that is not pending.
  const timeLabel = cmc.match(/\{([^{}]*)\? \(\s*<Text style=\{\[styles\.time, mine && styles\.timeMine\]\}>\s*\{new Date\(m\.createdAt\)\.toLocaleTimeString/);
  ok('client-messages: the toLocaleTimeString time label is guarded by !pending',
    !!timeLabel && /isLastInRun && !pending\s*$/.test(timeLabel[1].trim() + '') , timeLabel ? timeLabel[1] : 'time label not found');
  ok('client-messages: the time label is the only toLocaleTimeString in a bubble',
    (cmc.slice(cmc.indexOf('function MessageBubble'), cmc.indexOf('function outboxMessage')).match(/toLocaleTimeString/g) ?? []).length === 1);
  ok('client-messages: a pending message never gets a separator (a time label) either',
    /if \(!pending && \(!prev \|\| gapFromPrev > GROUP_GAP_MS\)\)/.test(cmc));
  ok('client-messages: outbox entries and queued rows are drawn as pending',
    /pending: \{ display: outboxDisplay\(e\), outboxId: e\.id \}/.test(cmc) && /queuedIds\.has\(m\.id\) \? \{ message: m, pending: \{ queued: true \} \}/.test(cmc));

  const grid = code('components/messages/AttachmentGrid.tsx');
  const failedCase = grid.slice(grid.indexOf("case 'failed':"), grid.indexOf('default:', grid.indexOf("case 'failed':")));
  ok('the failed status renders Retry (when retryable) and Remove',
    /display\.retryable && onRetry \?[\s\S]*?\{copy\.retry\}/.test(failedCase) && /onRemove \?[\s\S]*?\{copy\.remove\}/.test(failedCase)
      && /\{copy\.notSent\}/.test(failedCase) && /copy\.failReason\(display\.reason\)/.test(failedCase));
  ok('client-messages wires Retry to retryOutbox and Remove to a confirm before removeOutbox',
    /threadQ\.retryOutbox\(outboxId\)/.test(cmc) && /showAlert\(copy\.removeTitle, copy\.removeBody,[\s\S]{0,200}threadQ\.removeOutbox\(outboxId\)/.test(cmc));

  // Text-only sends are unchanged; files go through the outbox only.
  const handleSend = cmc.slice(cmc.indexOf('const handleSend = useCallback'), cmc.indexOf('const handleConvertToCO'));
  ok('handleSend: a message with files goes to sendFiles; the text path still calls threadQ.sendMessage',
    /if \(filesRef\.current\.length > 0\) \{ await sendFiles\(\); return; \}/.test(handleSend)
      && /await threadQ\.sendMessage\(\{/.test(handleSend) && !/sendWithAttachments/.test(handleSend));
  const sendFiles = cmc.slice(cmc.indexOf('const sendFiles = useCallback'), cmc.indexOf('const handleSend = useCallback'));
  ok('sendFiles: through threadQ.sendWithAttachments, with no success haptic or "sent" toast',
    /threadQ\.sendWithAttachments\(\{/.test(sendFiles) && !/Haptics|nailIt|NotificationFeedbackType\.Success/.test(sendFiles));
  ok('sendWithAttachments is called nowhere else on the screen', (cmc.match(/sendWithAttachments/g) ?? []).length === 1);

  const pt = code('hooks/usePortalThread.ts');
  ok('usePortalThread: `await writePortalMessage({ ...row })` still present, no direct portal_messages write',
    /await writePortalMessage\(\{ \.\.\.row \}\)/.test(pt) && !/supabaseWriteDetailed\('portal_messages'/.test(pt));
  ok('usePortalThread: parseAttachments in both row readers',
    /function rowToMessage[\s\S]*?attachments: parseAttachments\(r\.attachments\)[\s\S]*?\n\}/.test(pt)
      && /function queuedRowToMessage[\s\S]*?attachments: parseAttachments\(d\.attachments\)[\s\S]*?\n\}/.test(pt));
  ok('usePortalThread: the outbox is kicked in the onQueueFlushed listener',
    /onQueueFlushed\(\(tables\) => \{[\s\S]{0,400}kickOutbox\(\);\s*\}\);/.test(pt));
  ok('usePortalThread: the outbox is kicked on mount, after sendWithAttachments and on retry',
    /if \(enabled\) kickOutbox\(\);/.test(pt) && /await messageOutbox\.add\([\s\S]{0,300}\}\);\s*kickOutbox\(\);/.test(pt)
      && /await messageOutbox\.retry\(id\);\s*kickOutbox\(\);/.test(pt));
  ok('usePortalThread: only this session\'s entries for this portal are drawn',
    /e\.portalId === portalId && e\.userId === uid/.test(pt));

  const urls = code('hooks/useMessageAttachmentUrls.ts');
  const ma = read('utils/messageAttachments.ts');
  ok('message-attachment TTLs are the MSGDATA constants (300 display / 120 open)',
    /MESSAGE_ATTACHMENT_URL_TTL_SECONDS = 300;/.test(ma) && /MESSAGE_ATTACHMENT_OPEN_TTL_SECONDS = 120;/.test(ma));
  ok('useMessageAttachmentUrls signs with those constants and no number of its own',
    /createSignedUrls\([\s\S]{0,80}?,\s*MESSAGE_ATTACHMENT_URL_TTL_SECONDS\)/.test(urls)
      && /createSignedUrl\(path, MESSAGE_ATTACHMENT_OPEN_TTL_SECONDS/.test(urls)
      && !/createSignedUrls?\([\s\S]{0,80}?,\s*\d+/.test(urls));
  ok('signed URLs are never written to AsyncStorage (memory only)',
    !/AsyncStorage|localStorage|setItem\(/.test(urls));
  const openInTab = urls.slice(urls.indexOf('const openInTab'), urls.indexOf('const shareLocal'));
  ok('the web open path calls window.open before its first await',
    openInTab.indexOf("window.open('', '_blank')") > 0
      && openInTab.indexOf("window.open('', '_blank')") < openInTab.indexOf('await ')
      && /w\.opener = null;/.test(openInTab) && /w\.close\(\)/.test(openInTab));

  // i18n: only the copy hook calls t()/tn() among the new files.
  const NEW_FILES = [
    'utils/messageOutbox.ts', 'hooks/useMessageAttachmentUrls.ts', 'hooks/useAttachmentPicker.ts',
    'components/messages/AttachmentTray.tsx', 'components/messages/AttachmentGrid.tsx', 'components/messages/AttachmentViewer.tsx',
  ];
  const callers = NEW_FILES.filter((f) => /\b(t|tn)\(\s*['"`]/.test(code(f)) || /useT\(/.test(code(f)));
  ok('only hooks/useMessageAttachmentCopy.ts calls t()/tn() among the new files', callers.length === 0, callers.join(', '));
  const copySrc = read('hooks/useMessageAttachmentCopy.ts');
  const SEED = new Set(['common.action.cancel', 'common.action.remove', 'common.action.share', 'common.action.download',
    'common.action.retry', 'common.action.close', 'common.action.open']);
  const keys = [...copySrc.matchAll(/\b(?:t|tn)\(\s*'([^']+)'/g)].map((m) => m[1]);
  const badKeys = keys.filter((k) => !k.startsWith('office.clientMessages.') && !SEED.has(k));
  ok(`every key is office.clientMessages.* or a seed action key (${keys.length} call sites)`, keys.length >= 35 && badKeys.length === 0, badKeys.join(', '));
  const SEED_EN: Record<string, string> = {
    'common.action.cancel': 'Cancel', 'common.action.remove': 'Remove', 'common.action.share': 'Share',
    'common.action.download': 'Download', 'common.action.retry': 'Retry', 'common.action.close': 'Close', 'common.action.open': 'Open',
  };
  const seedMismatch = [...copySrc.matchAll(/\bt\(\s*'(common\.action\.[a-z]+)',\s*'([^']*)'/g)].filter((m) => SEED_EN[m[1]] !== m[2]);
  ok('seed action keys keep their exact English', seedMismatch.length === 0, seedMismatch.map((m) => m[1]).join(', '));

  // Colours: theme tokens only, except the viewer's fixed backdrop and ink.
  const HEX = /#[0-9a-fA-F]{3,8}\b|rgba?\(/;
  const hexIn = ['components/messages/AttachmentTray.tsx', 'components/messages/AttachmentGrid.tsx']
    .filter((f) => HEX.test(code(f)));
  ok('no #hex / rgb( literals in the tray or the grid', hexIn.length === 0, hexIn.join(', '));
  const viewer = code('components/messages/AttachmentViewer.tsx');
  const viewerHex = viewer.split('\n').filter((l) => HEX.test(l));
  ok("the viewer's only literals are its near-black backdrop and white ink",
    viewerHex.length > 0 && viewerHex.every((l) => /^const (BACKDROP|ON_BACKDROP|ON_BACKDROP_SOFT) = /.test(l.trim())), viewerHex.join(' | '));
  ok('a failure uses danger tokens, waiting uses warning tokens (never brand green)',
    /failedBox: \{[\s\S]*?backgroundColor: t\.dangerSoft/.test(grid) && /failedTitle: \{[^}]*color: t\.dangerLabel/.test(grid)
      && /statusWaiting: \{ color: t\.warningLabel \}/.test(grid));

  // The copy itself (docs/VOICE.md §11).
  const strings = [...copySrc.matchAll(/\b(?:t|tn)\(\s*'[^']+',\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|\{([^}]*)\})/g)]
    .flatMap((m) => (m[3] ? [...m[3].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((x) => x[1]) : [m[1] ?? m[2] ?? '']));
  const BANNED = /!|\bplease\b|\boops\b|\bwhoops\b|\bawesome\b|\bseamless|\beffortless|\bunlock\b|\bpowerful\b|\bhonest|\boutbox\b|\bupload queue\b|\bbucket\b|\bRLS\b|\bpayload\b|\boffline queue\b|\bnull\b|\bundefined\b|\.\.\.|\bhe\b|\bhis\b|\bhim\b|\bshe\b|\bher\b|\(s\)/i;
  const bad = strings.filter((s) => BANNED.test(s));
  ok(`the copy has no "!", "please", banned or developer words (${strings.length} strings)`, strings.length >= 35 && bad.length === 0, bad.join(' | '));
  ok('the copy uses real plurals for the upload count', /tn\('office\.clientMessages\.state\.uploading', count, \{ one: 'Uploading…', other: 'Uploading \{done\} of \{count\}…' \}/.test(copySrc));
  ok('at most one em dash per string', strings.every((s) => (s.match(/—/g) ?? []).length <= 1));

  // A contractor message with files and no text has no bubble behind it: its
  // PDF chip must carry its own accentFill so the white ink stays readable.
  const msgBubble = cmc.slice(cmc.indexOf('function MessageBubble'), cmc.indexOf('function outboxMessage'));
  ok('client-messages: the grid is told when no bubble surrounds it (bare={!hasText})',
    /<AttachmentGrid[\s\S]{0,120}bare=\{!hasText\}/.test(msgBubble) && /const hasText = m\.body\.trim\(\)\.length > 0;/.test(msgBubble));
  ok('AttachmentGrid: a bare contractor PDF chip is filled with accentFill, the on-bubble one stays transparent',
    /pdfChipMineBare: \{[^}]*backgroundColor: t\.accentFill/.test(grid)
      && /mine \? \(bare \? styles\.pdfChipMineBare : styles\.pdfChipMine\) : styles\.pdfChipTheirs/.test(grid));

  // Desktop sizing uses the single desktop gate, not a hand-rolled width.
  ok('client-messages and AttachmentGrid gate desktop sizing on useIsDesktopWeb (no hand-rolled >= 1024)',
    /const wide = useIsDesktopWeb\(\);/.test(cmc) && /const tile = useIsDesktopWeb\(\) \? TILE_DESK : TILE_PHONE;/.test(grid)
      && !/>=\s*1024/.test(cmc) && !/>=\s*1024/.test(grid));

  // Signing that fails is retried on a backoff, not left grey forever.
  ok('useMessageAttachmentUrls: an incomplete signing pass counts a failure and re-arms the retry timer',
    /const incomplete = due\.some\(\(a\) => !got\.has\(a\.id\)\);\s*setFailures\(\(n\) => \(incomplete \? n \+ 1 : 0\)\);/.test(urls)
      && /const allSigned = exp\.length > 0 && exp\.length === ids\.length;\s*const wait = allSigned\s*\?[^:]+: signRetryDelayMs\(failures\);/.test(urls)
      && /\}, \[byId, signed, failures\]\);/.test(urls));
}

function partC() {
  console.log('\nC. signing retry backoff:');
  const seq = [0, 1, 2, 3, 4, 5, 6, 50].map(signRetryDelayMs);
  ok(`signRetryDelayMs: 30 s before any failure, then 15 / 30 / 60 / 120 / 240 s, capped at 5 min (${seq.join(',')})`,
    seq.join(',') === '30000,15000,30000,60000,120000,240000,300000,300000');
  ok('signRetryDelayMs: a negative or NaN count waits the plain 30 s',
    signRetryDelayMs(-1) === 30_000 && signRetryDelayMs(Number.NaN) === 30_000);
}

await partA();
partB();
partC();

if (fail > 0) {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`\n${pass} passed, 0 failed\n`);

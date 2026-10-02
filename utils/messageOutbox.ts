// utils/messageOutbox.ts — the I/O shell around the outbox state machine in
// utils/messageAttachments.ts (track MSG, lane MSGAPP).
//
// A contractor's message with photos or PDFs cannot ride the text offline
// queue: that queue is AsyncStorage JSON (utils/photoUploadQueue.ts explains
// why multi-MB bytes cannot live there). So a file message waits HERE, on the
// device, until every file is confirmed in the private message-attachments
// bucket, and only then is its portal_messages row written through
// writePortalMessage (ordered behind its project's own write, like any GC
// row). Until that write is 'synced' or 'queued' the message is NOT sent, and
// the thread draws it from this outbox with its real state.
//
// Every decision about what an upload or write result MEANS lives in
// messageAttachments.ts (pure, bun-tested). This file only persists entries,
// copies files, reads bytes, uploads and calls the writer. createMessageOutbox
// takes its I/O as deps so scripts/validate-message-attachments-app.ts drives
// it with stubs; `messageOutbox` is the app instance, bound lazily so bun can
// import this module without loading react-native.
//
// Persistence: AsyncStorage key 'mageid_message_outbox' (mageid_ prefix, so
// the tenant wipe sweeps it). Native files are copied at add time into
// `${documentDirectory}mageid-msg-outbox/<attachmentId>.<ext>`, which the OS
// does not purge the way it purges the picker's cache. On web the picked
// blob: URI is kept as is: the browser releases it on reload, and the read
// then fails as 'gone' (the copy tells him to keep the page open).
//
// Never deletes anything in the bucket (there is no client DELETE policy, by
// design) and never deletes a local file outside the outbox folder.

import type { MessageAttachmentMime } from '@/types';
import type { WriteOutcome } from '@/utils/offlineQueue';
import {
  applyUploadOutcome,
  applyWriteOutcome,
  extForMime,
  newOutboxEntry,
  outboxReadyToWrite,
  outboxRowFor,
  retryOutboxEntry,
  sniffMatches,
  terminalReasonFor,
  type OutboxEntry,
  type UploadOutcome,
} from '@/utils/messageAttachments';
import { classifyPhotoUploadError } from '@/utils/photoUploadCore';

export const MESSAGE_OUTBOX_KEY = 'mageid_message_outbox';
/** The outbox folder's name under documentDirectory. */
export const MESSAGE_OUTBOX_DIR_NAME = 'mageid-msg-outbox/';

/**
 * How long hooks/useMessageAttachmentUrls waits before signing the thread's
 * files again while some are still unsigned. `failures` is the number of
 * signing passes in a row that left a file unsigned: 0 waits 30 s (a pass may
 * still be running), then 15 s, 30 s, 60 s ... capped at 5 min, so a dead
 * connection or a refused file is retried without hammering storage.
 */
export function signRetryDelayMs(failures: number): number {
  if (!(failures > 0)) return 30_000;
  return Math.min(300_000, 15_000 * 2 ** Math.min(failures - 1, 10));
}

/** One picked file (the shape of hooks/useAttachmentPicker PickedAttachment). */
export interface OutboxFileInput {
  id: string;
  name: string;
  mime: MessageAttachmentMime;
  size: number;
  width?: number;
  height?: number;
  localUri: string;
}

export interface OutboxDeps {
  storageGet(key: string): Promise<string | null>;
  storageSet(key: string, value: string): Promise<void>;
  storageRemove(key: string): Promise<void>;
  /** Copy a picked file into the outbox folder under `name`; returns the copy's uri. */
  copyIn(uri: string, name: string): Promise<string>;
  deleteLocal(uri: string): Promise<void>;
  /** Every file uri currently in the outbox folder. */
  listLocal(): Promise<string[]>;
  /** The outbox folder's uri prefix. Nothing outside it is ever deleted. */
  outboxDir: string;
  readBytes(uri: string): Promise<Uint8Array>;
  /** Put the bytes at `path`; throws the Storage error object on failure. */
  upload(path: string, bytes: Uint8Array, mime: MessageAttachmentMime): Promise<void>;
  currentUserId(): string | null | Promise<string | null>;
  bearerLive(): boolean | Promise<boolean>;
  isWeb: boolean;
  now?: () => string;
}

export interface MessageOutbox {
  read(): Promise<OutboxEntry[]>;
  add(input: {
    id: string; projectId: string; portalId: string; body: string; authorName: string;
    files: OutboxFileInput[];
  }): Promise<OutboxEntry>;
  retry(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  process(deps: { writePortalMessage: (row: Record<string, unknown>) => Promise<WriteOutcome> }):
    Promise<{ sent: number; remaining: number }>;
  onChanged(listener: () => void): () => void;
}

type ProcessDeps = Parameters<MessageOutbox['process']>[0];
type ProcessResult = { sent: number; remaining: number };

function parseEntries(raw: string | null): OutboxEntry[] {
  if (!raw) return [];
  const v = JSON.parse(raw) as unknown;
  if (!Array.isArray(v)) return [];
  return v.filter((e): e is OutboxEntry =>
    !!e && typeof e === 'object' && typeof (e as OutboxEntry).id === 'string'
      && typeof (e as OutboxEntry).userId === 'string' && Array.isArray((e as OutboxEntry).attachments));
}

export function createMessageOutbox(deps: OutboxDeps): MessageOutbox {
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const l of [...listeners]) {
      try { l(); } catch { /* a listener must never wedge the outbox */ }
    }
  };
  const now = deps.now ?? (() => new Date().toISOString());
  const ours = (uri: string) => typeof uri === 'string' && deps.outboxDir.length > 0 && uri.startsWith(deps.outboxDir);

  // Every read-modify-write runs one at a time (photoUploadQueue discipline).
  // The lock is NOT held across an upload or the row write.
  let lock: Promise<unknown> = Promise.resolve();
  const withLock = <T,>(fn: () => Promise<T>): Promise<T> => {
    const run = lock.then(fn, fn);
    lock = run.then(() => undefined, () => undefined);
    return run;
  };

  /** Throws when storage holds something unreadable, so a write never clobbers it. */
  const readOrThrow = async (): Promise<OutboxEntry[]> => parseEntries(await deps.storageGet(MESSAGE_OUTBOX_KEY));
  const write = async (list: OutboxEntry[]) => {
    if (list.length === 0) await deps.storageRemove(MESSAGE_OUTBOX_KEY);
    else await deps.storageSet(MESSAGE_OUTBOX_KEY, JSON.stringify(list));
  };

  const deleteOurCopies = async (e: OutboxEntry) => {
    if (deps.isWeb) return;
    for (const a of e.attachments) {
      if (!ours(a.localUri)) continue; // never the user's original
      try { await deps.deleteLocal(a.localUri); } catch { /* a leftover is swept later */ }
    }
  };

  /** Apply fn to one entry under the lock; null when the entry is gone. */
  const mutate = (id: string, fn: (e: OutboxEntry) => OutboxEntry): Promise<OutboxEntry | null> =>
    withLock(async () => {
      const list = await readOrThrow();
      const i = list.findIndex((e) => e.id === id);
      if (i < 0) return null;
      const next = fn(list[i]);
      list[i] = next;
      await write(list);
      return next;
    }).then((r) => { notify(); return r; });

  const take = (id: string): Promise<OutboxEntry | null> =>
    withLock(async () => {
      const list = await readOrThrow();
      const gone = list.find((e) => e.id === id) ?? null;
      if (!gone) return null;
      await write(list.filter((e) => e.id !== id));
      return gone;
    }).then(async (gone) => {
      if (gone) await deleteOurCopies(gone);
      notify();
      return gone;
    });

  const getEntry = async (id: string): Promise<OutboxEntry | null> => {
    try { return (await readOrThrow()).find((e) => e.id === id) ?? null; } catch { return null; }
  };

  // Raised by add/retry; a running pass sees it and makes one more pass, so a
  // message added while a pass is in flight is not left for the next trigger.
  let dirty = false;
  let inflight: Promise<ProcessResult> | null = null;
  // Copies made by an add() that has not persisted its entry yet: the sweep
  // must not take them for orphans.
  const copying = new Set<string>();

  const sweep = async () => {
    if (deps.isWeb) return;
    let files: string[];
    let referenced: Set<string>;
    try {
      files = await deps.listLocal();
      referenced = new Set((await readOrThrow()).flatMap((e) => e.attachments.map((a) => a.localUri)));
    } catch { return; }
    for (const f of files) {
      if (!ours(f) || referenced.has(f) || copying.has(f)) continue;
      try { await deps.deleteLocal(f); } catch { /* next sweep */ }
    }
  };

  const remainingFor = async (uid: string | null): Promise<number> => {
    if (!uid) return 0;
    try {
      return (await readOrThrow()).filter((e) => e.userId === uid && e.phase !== 'failed').length;
    } catch { return 0; }
  };

  /** One entry: upload its pending files, then write its row. Returns 'offline' to stop the pass. */
  const runEntry = async (id: string, d: ProcessDeps): Promise<'sent' | 'kept' | 'offline'> => {
    let e = await getEntry(id);
    if (!e || e.phase === 'failed') return 'kept';
    for (const pending of e.attachments.filter((a) => a.state === 'pending')) {
      const cur = (await getEntry(id))?.attachments.find((a) => a.id === pending.id);
      if (!cur || cur.state !== 'pending') continue;
      let outcome: UploadOutcome | null = null;
      let terminal: 'gone' | 'refused' | 'type_mismatch' | undefined;
      let bytes: Uint8Array | null = null;
      try {
        bytes = await deps.readBytes(cur.localUri);
      } catch (err) {
        outcome = 'terminal';
        terminal = terminalReasonFor(err);
      }
      if (bytes && !sniffMatches(bytes.slice(0, 16), cur.mime)) {
        outcome = 'terminal';
        terminal = 'type_mismatch';
      }
      if (!outcome && bytes && bytes.length !== cur.size) {
        // The trigger compares the row's size with the stored object's, so
        // the row carries the byte count actually uploaded, not the picker's.
        const n = bytes.length;
        await mutate(id, (x) => ({ ...x, attachments: x.attachments.map((a) => (a.id === cur.id ? { ...a, size: n } : a)) }));
      }
      if (!outcome && bytes) {
        try {
          await deps.upload(cur.path, bytes, cur.mime);
          outcome = 'success';
        } catch (err) {
          outcome = classifyPhotoUploadError(err);
          if (outcome === 'terminal') terminal = terminalReasonFor(err);
        }
      }
      const settled = outcome ?? 'retryable';
      // Persisted after every file: a crash mid-way resumes here, and the
      // deterministic path turns a redo into 'already-uploaded'.
      e = await mutate(id, (x) => applyUploadOutcome(x, cur.id, settled, terminal));
      if (!e) return 'kept'; // removed while uploading
      if (settled === 'transient') return 'offline';
      if (e.phase === 'failed') return 'kept';
      if (settled !== 'success' && settled !== 'already-uploaded') return 'kept'; // next pass
    }
    e = await getEntry(id);
    if (!e || !outboxReadyToWrite(e)) return 'kept';
    e = await mutate(id, (x) => (outboxReadyToWrite(x) ? { ...x, phase: 'writing' } : x));
    if (!e || !outboxReadyToWrite(e)) return 'kept';
    let outcome: WriteOutcome;
    try {
      outcome = await d.writePortalMessage(outboxRowFor(e));
    } catch {
      outcome = 'failed';
    }
    const res = applyWriteOutcome(e, outcome);
    if (res.done) {
      await take(id);
      return 'sent';
    }
    await mutate(id, () => res.entry);
    return 'kept';
  };

  const run = async (d: ProcessDeps): Promise<ProcessResult> => {
    let sent = 0;
    const uid = await deps.currentUserId();
    if (!uid) return { sent, remaining: 0 };
    if (!(await deps.bearerLive())) return { sent, remaining: await remainingFor(uid) };
    let offline = false;
    do {
      dirty = false;
      let snapshot: OutboxEntry[];
      try { snapshot = await readOrThrow(); } catch { break; }
      for (const s of snapshot) {
        if (s.userId !== uid) continue; // another tenant's message is never sent under this session
        const r = await runEntry(s.id, d);
        if (r === 'sent') sent++;
        if (r === 'offline') { offline = true; break; }
      }
    } while (dirty && !offline);
    await sweep();
    return { sent, remaining: await remainingFor(uid) };
  };

  return {
    async read() {
      try { return await readOrThrow(); } catch { return []; }
    },

    async add(input) {
      const uid = await deps.currentUserId();
      if (!uid) throw new Error('Not signed in');
      // Built first with the picked uris, so a bad id throws before any copy.
      const draft = newOutboxEntry({
        id: input.id, userId: uid, projectId: input.projectId, portalId: input.portalId,
        body: input.body, authorName: input.authorName, createdAt: now(), files: input.files,
      });
      const copies = new Map<string, string>();
      if (!deps.isWeb && deps.outboxDir) {
        for (const a of draft.attachments) {
          copying.add(`${deps.outboxDir}${a.id}.${extForMime(a.mime)}`);
          try {
            const local = await deps.copyIn(a.localUri, `${a.id}.${extForMime(a.mime)}`);
            copying.add(local);
            copies.set(a.id, local);
          } catch { /* the picked uri still works until the OS purges its cache */ }
        }
      }
      const entry: OutboxEntry = {
        ...draft,
        attachments: draft.attachments.map((a) => ({ ...a, localUri: copies.get(a.id) ?? a.localUri })),
      };
      try {
        await withLock(async () => {
          const list = await readOrThrow();
          await write([...list.filter((e) => e.id !== entry.id), entry]);
        });
      } finally {
        for (const a of draft.attachments) copying.delete(`${deps.outboxDir}${a.id}.${extForMime(a.mime)}`);
        for (const c of copies.values()) copying.delete(c);
      }
      dirty = true;
      notify();
      return entry;
    },

    async retry(id) {
      await mutate(id, (e) => retryOutboxEntry(e));
      dirty = true;
    },

    async remove(id) {
      await take(id);
    },

    process(d) {
      if (inflight) return inflight;
      inflight = run(d)
        .catch(() => ({ sent: 0, remaining: 0 }))
        .finally(() => { inflight = null; });
      return inflight;
    },

    onChanged(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

// ─── The app instance ──────────────────────────────────────────────────────
// Bound on first use with lazy requires, so importing this module (bun, the
// validator) never loads react-native, AsyncStorage or expo-file-system.

let real: MessageOutbox | null = null;
function app(): MessageOutbox {
  if (real) return real;
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { Platform } = require('react-native') as typeof import('react-native');
  const AsyncStorage = (require('@react-native-async-storage/async-storage') as { default: typeof import('@react-native-async-storage/async-storage').default }).default;
  const FileSystem = require('expo-file-system/legacy') as typeof import('expo-file-system/legacy');
  const { readFileBytes } = require('@/utils/fileBytes') as typeof import('@/utils/fileBytes');
  const { supabase } = require('@/lib/supabase') as typeof import('@/lib/supabase');
  const { currentSessionUserId, bearerStillLive } = require('@/utils/offlineQueue') as typeof import('@/utils/offlineQueue');
  const { MESSAGE_ATTACHMENT_BUCKET } = require('@/utils/messageAttachments') as typeof import('@/utils/messageAttachments');
  /* eslint-enable @typescript-eslint/no-require-imports */
  const isWeb = Platform.OS === 'web';
  const dir = isWeb || !FileSystem.documentDirectory ? '' : `${FileSystem.documentDirectory}${MESSAGE_OUTBOX_DIR_NAME}`;
  real = createMessageOutbox({
    storageGet: (k) => AsyncStorage.getItem(k),
    storageSet: (k, v) => AsyncStorage.setItem(k, v),
    storageRemove: (k) => AsyncStorage.removeItem(k),
    outboxDir: dir,
    async copyIn(uri, name) {
      if (!dir) return uri;
      const info = await FileSystem.getInfoAsync(dir);
      if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      const target = `${dir}${name}`;
      // Stage then move, so the target is never half-written (photoUploadQueue).
      const staged = `${target}.${Date.now()}.part`;
      await FileSystem.copyAsync({ from: uri, to: staged });
      await FileSystem.moveAsync({ from: staged, to: target });
      return target;
    },
    async deleteLocal(uri) {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    },
    async listLocal() {
      if (!dir) return [];
      const info = await FileSystem.getInfoAsync(dir);
      if (!info.exists) return [];
      return (await FileSystem.readDirectoryAsync(dir)).map((n) => `${dir}${n}`);
    },
    readBytes: (uri) => readFileBytes(uri),
    async upload(path, bytes, mime) {
      const { error } = await supabase.storage
        .from(MESSAGE_ATTACHMENT_BUCKET)
        .upload(path, bytes, { contentType: mime, upsert: false });
      if (error) throw error;
    },
    currentUserId: () => currentSessionUserId(),
    bearerLive: () => bearerStillLive(),
    isWeb,
  });
  return real;
}

export const messageOutbox: MessageOutbox = {
  read: () => app().read(),
  add: (input) => app().add(input),
  retry: (id) => app().retry(id),
  remove: (id) => app().remove(id),
  process: (d) => app().process(d),
  onChanged: (listener) => app().onChanged(listener),
};

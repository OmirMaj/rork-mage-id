// hooks/useMessageAttachmentUrls.ts — the contractor's signed URLs for the
// photos and PDFs in a client thread (track MSG, lane MSGAPP).
//
// The message-attachments bucket is private: the project owner's session may
// SELECT its own objects (storage policy message_attachments_owner_select),
// so the thread signs short-lived URLs itself. They live in memory only —
// never in AsyncStorage — and are re-signed 60 s before they expire while the
// screen is mounted and again when the app comes back to the foreground.
// Thread display uses MESSAGE_ATTACHMENT_URL_TTL_SECONDS (300); opening or
// saving a file mints a fresh MESSAGE_ATTACHMENT_OPEN_TTL_SECONDS (120) one at
// the tap.
//
// An attachment still in the device's outbox has no storage path yet: its
// thumbnail and viewer use the local copy, and save/share hands over that
// local file.
//
// Web: a tab is opened BEFORE the first await (the signing round-trip
// consumes the tap's user activation; a later window.open is a pop-up Safari
// swallows), cut loose from this page, pointed at the URL, and closed if the
// signing fails (utils/contractSealing.ts precedent).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { MessageAttachment, PortalMessage } from '@/types';
import {
  MESSAGE_ATTACHMENT_BUCKET,
  MESSAGE_ATTACHMENT_OPEN_TTL_SECONDS,
  MESSAGE_ATTACHMENT_URL_TTL_SECONDS,
} from '@/utils/messageAttachments';
import { oops } from '@/components/animations/NailItToast';
import { useMessageAttachmentCopy } from '@/hooks/useMessageAttachmentCopy';
import { signRetryDelayMs } from '@/utils/messageOutbox';

/** An attachment as the thread draws it: a server one (path) or an outbox one (localUri). */
export type ThreadAttachment = MessageAttachment & { localUri?: string };

const RESIGN_LEAD_MS = 60_000;
const REFRESH_GAP_MS = 60_000;
const BATCH = 100;

interface Signed { url: string; expiresAt: number }

const UTI: Record<string, string> = {
  'application/pdf': 'com.adobe.pdf',
  'image/jpeg': 'public.jpeg',
  'image/png': 'public.png',
  'image/webp': 'org.webmproject.webp',
};

export interface MessageAttachmentUrls {
  urlFor(id: string): string | null;
  refresh(id: string): void;
  /** A PDF opens in the browser; a photo goes to onOpenPhoto (the viewer). */
  open(att: ThreadAttachment): void;
  share(att: ThreadAttachment): void;
}

export function useMessageAttachmentUrls(
  messages: PortalMessage[],
  opts?: { onOpenPhoto?: (att: ThreadAttachment) => void },
): MessageAttachmentUrls {
  const copy = useMessageAttachmentCopy();
  const [signed, setSigned] = useState<Record<string, Signed>>({});
  const signedRef = useRef(signed);
  signedRef.current = signed;
  const lastRefresh = useRef(new Map<string, number>());
  const onOpenPhoto = useRef(opts?.onOpenPhoto);
  onOpenPhoto.current = opts?.onOpenPhoto;
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  // Every server attachment (with a storage key) in the thread, by id.
  const byId = useMemo(() => {
    const m = new Map<string, { id: string; path: string }>();
    for (const msg of messages) {
      for (const a of msg.attachments ?? []) {
        if (typeof a.path === 'string' && a.path.length > 0) m.set(a.id, { id: a.id, path: a.path });
      }
    }
    return m;
  }, [messages]);

  const [tick, setTick] = useState(0);
  // Signing passes in a row that left a file unsigned (offline, a timeout, a
  // refused row). Each one re-arms the timer below, backing off 15 s, 30 s,
  // 60 s ... up to 5 min; a clean pass resets it to 0.
  const [failures, setFailures] = useState(0);
  const signing = useRef(false);

  const signDue = useCallback(async () => {
    if (!isSupabaseConfigured || signing.current) return;
    const now = Date.now();
    const due = [...byId.values()].filter((a) => {
      const s = signedRef.current[a.id];
      return !s || s.expiresAt - now <= RESIGN_LEAD_MS;
    });
    if (due.length === 0) return;
    signing.current = true;
    const got = new Set<string>();
    try {
      for (let i = 0; i < due.length; i += BATCH) {
        const chunk = due.slice(i, i + BATCH);
        const pathToId = new Map(chunk.map((a) => [a.path, a.id] as const));
        try {
          const { data, error } = await supabase.storage
            .from(MESSAGE_ATTACHMENT_BUCKET)
            .createSignedUrls(chunk.map((a) => a.path), MESSAGE_ATTACHMENT_URL_TTL_SECONDS);
          if (error || !data) continue;
          const expiresAt = Date.now() + MESSAGE_ATTACHMENT_URL_TTL_SECONDS * 1000;
          const next: Record<string, Signed> = {};
          for (const row of data) {
            const id = row.path ? pathToId.get(row.path) : undefined;
            if (id && row.signedUrl && !row.error) { next[id] = { url: row.signedUrl, expiresAt }; got.add(id); }
          }
          if (alive.current && Object.keys(next).length > 0) setSigned((prev) => ({ ...prev, ...next }));
        } catch { /* offline: the tiles keep their placeholder; the retry timer below tries again */ }
      }
    } finally {
      signing.current = false;
    }
    if (!alive.current) return;
    const incomplete = due.some((a) => !got.has(a.id));
    setFailures((n) => (incomplete ? n + 1 : 0));
  }, [byId]);

  // Sign on change, then again 60 s before the earliest expiry.
  useEffect(() => {
    void signDue();
  }, [signDue, tick]);
  useEffect(() => {
    const ids = [...byId.keys()];
    if (ids.length === 0) return;
    const exp = ids.map((id) => signed[id]?.expiresAt).filter((x): x is number => typeof x === 'number');
    const allSigned = exp.length > 0 && exp.length === ids.length;
    const wait = allSigned
      ? Math.max(5_000, Math.min(...exp) - RESIGN_LEAD_MS - Date.now())
      : signRetryDelayMs(failures);
    const h = setTimeout(() => setTick((n) => n + 1), wait);
    return () => clearTimeout(h);
  }, [byId, signed, failures]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') setTick((n) => n + 1); });
    return () => sub.remove();
  }, []);

  const urlFor = useCallback((id: string): string | null => signed[id]?.url ?? null, [signed]);

  const refresh = useCallback((id: string) => {
    const now = Date.now();
    const last = lastRefresh.current.get(id) ?? 0;
    if (now - last < REFRESH_GAP_MS) return; // once per id per minute
    lastRefresh.current.set(id, now);
    setSigned((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setTick((n) => n + 1);
  }, []);

  /** A fresh short URL for one file, or null. `download` names the saved file (web). */
  const mintOne = useCallback(async (path: string, download?: string): Promise<string | null> => {
    try {
      const { data, error } = await supabase.storage
        .from(MESSAGE_ATTACHMENT_BUCKET)
        .createSignedUrl(path, MESSAGE_ATTACHMENT_OPEN_TTL_SECONDS, download ? { download } : undefined);
      return error || !data?.signedUrl ? null : data.signedUrl;
    } catch {
      return null;
    }
  }, []);

  /** Web: open a blank tab now, then point it at whatever `resolve` gives. */
  const openInTab = useCallback((resolve: () => Promise<string | null>) => {
    const w = typeof window !== 'undefined' ? window.open('', '_blank') : null;
    if (!w) { oops(copy.popupBlocked); return; }
    void (async () => {
      const url = await resolve();
      if (!url) {
        try { w.close(); } catch { /* already gone */ }
        oops(copy.openFailed);
        return;
      }
      try {
        w.opener = null;
        w.location.href = url;
      } catch {
        try { w.close(); } catch { /* already gone */ }
        oops(copy.openFailed);
      }
    })();
  }, [copy]);

  const shareLocal = useCallback(async (uri: string, mime: string) => {
    if (!(await Sharing.isAvailableAsync())) { oops(copy.shareUnavailable); return; }
    await Sharing.shareAsync(uri, { mimeType: mime, UTI: UTI[mime] });
  }, [copy]);

  const share = useCallback((att: ThreadAttachment) => {
    if (Platform.OS === 'web') {
      if (att.path) openInTab(() => mintOne(att.path!, att.name));
      else if (att.localUri) openInTab(async () => att.localUri ?? null);
      return;
    }
    void (async () => {
      try {
        if (!att.path) {
          if (att.localUri) await shareLocal(att.localUri, att.mime);
          return;
        }
        if (!(await Sharing.isAvailableAsync())) { oops(copy.shareUnavailable); return; }
        const url = await mintOne(att.path);
        const base = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
        if (!url || !base) { oops(copy.openFailed); return; }
        const dir = `${base}mageid-msg-share/${att.id}/`;
        await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
        const dl = await FileSystem.downloadAsync(url, `${dir}${att.name}`);
        // downloadAsync resolves on a 4xx/5xx and writes the error body.
        if (dl.status !== 200) { oops(copy.openFailed); return; }
        await Sharing.shareAsync(dl.uri, { mimeType: att.mime, UTI: UTI[att.mime] });
      } catch (err) {
        console.warn('[useMessageAttachmentUrls] share failed', err);
        oops(copy.openFailed);
      }
    })();
  }, [copy, mintOne, openInTab, shareLocal]);

  const open = useCallback((att: ThreadAttachment) => {
    if (att.kind === 'image') { onOpenPhoto.current?.(att); return; }
    if (Platform.OS === 'web') {
      if (att.path) openInTab(() => mintOne(att.path!));
      else if (att.localUri) openInTab(async () => att.localUri ?? null);
      return;
    }
    if (!att.path) { share(att); return; } // a local PDF opens through the share sheet
    void (async () => {
      const url = await mintOne(att.path!);
      if (!url) { oops(copy.openFailed); return; }
      try { await WebBrowser.openBrowserAsync(url); } catch { oops(copy.openFailed); }
    })();
  }, [copy, mintOne, openInTab, share]);

  return { urlFor, refresh, open, share };
}

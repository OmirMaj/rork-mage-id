// Resolves the portal payload for a visitor who has no MAGE session.
//
// WHY: app/client-view.tsx used to resolve the project purely out of the local
// ProjectContext. That works for the GC previewing their own portal and for
// nobody else — an anonymous homeowner has an empty ProjectContext, so the
// screen always fell through to "Portal Not Found". utils/portalSnapshot.ts has
// documented a portal_snapshots fallback since the short-link shipped, but the
// RN screen never implemented it; only the static HTML portal did.
//
// Two off-session sources, in this order:
//
//   1. `#d=<base64url>` URL fragment — the whole snapshot inlined in the link.
//      Preferred because it needs no network at all, so a homeowner standing in
//      a basement with no signal still sees their portal. A fragment never
//      leaves the client, so it also leaks nothing to the server.
//   2. `portal_get_snapshot(portal_id, access_token)` RPC — the server-side
//      copy the GC's app publishes on every save. This is what makes the SHORT
//      link work, and short links are what survive SMS and email clients (the
//      base64 fragment is routinely truncated or mangled in transit, which is
//      the actual mechanism behind most "expired link" reports).
//
// The RPC — not a direct `from('portal_snapshots').select()`. Migration
// 20260713150001_portal_lock_direct_access.sql revoked anon SELECT on that
// table after an audit found the guessable portalId was enough to dump any
// tenant's snapshot. The 192-bit accessToken in the link's `?t=` param is the
// real credential now, and only the SECURITY DEFINER RPC checks it.
//
// Specifically `portal_get_snapshot_v2` (20260826190000), which is the only
// read that honours `expires_at` and the only one whose reply distinguishes
// expired / never-published / denied. v1 is kept as a fallback so the app can
// ship ahead of that migration, but v1 cannot report expiry at all.

import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { PortalSnapshot } from '@/utils/portalSnapshot';

export type PortalSnapshotStatus =
  /** Not needed — the caller already resolved the portal locally. */
  | 'idle'
  | 'loading'
  /** Snapshot in hand. */
  | 'ready'
  /** The link has no `?t=` key, so there is nothing we are allowed to fetch. */
  | 'missing_key'
  /** The server rejected the id + key pair, or there is no such portal. */
  | 'not_found'
  /** Key checks out but the GC has never published a snapshot for it. */
  | 'not_published'
  /** The link had a real deadline and it has passed. */
  | 'expired'
  /** Couldn't reach Supabase at all — a retry may well succeed. */
  | 'unreachable';

interface PortalSnapshotState {
  status: PortalSnapshotStatus;
  snapshot: PortalSnapshot | null;
  /** True when the payload came from the URL fragment rather than the server. */
  fromHash: boolean;
  /** The link's deadline, when the server reported one. Null means never. */
  expiresAt: string | null;
}

export interface PortalSnapshotResult extends PortalSnapshotState {
  /** Re-runs the fetch. Only meaningful after a transport failure. */
  reload: () => void;
}

/**
 * Reads `#d=<base64url>` off the current URL. Web-only: a native deep link has
 * no fragment, and expo-router does not surface one either.
 */
export function decodeHashSnapshot(): PortalSnapshot | null {
  if (Platform.OS !== 'web') return null;
  try {
    const hash = globalThis.location?.hash ?? '';
    const match = /[#&]d=([^&]+)/.exec(hash);
    if (!match) return null;
    const b64 = decodeURIComponent(match[1]).replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const ascii = typeof atob === 'function'
      ? atob(b64 + pad)
      : Buffer.from(b64 + pad, 'base64').toString('binary');
    // The encoder UTF-8-escapes before base64, so decode the bytes back rather
    // than trusting the Latin-1 string — otherwise any non-ASCII project name
    // comes out mojibake.
    const bytes = Uint8Array.from(ascii, c => c.charCodeAt(0));
    const json = typeof TextDecoder !== 'undefined' ? new TextDecoder().decode(bytes) : ascii;
    const parsed = JSON.parse(json) as PortalSnapshot;
    return parsed && typeof parsed === 'object' && parsed.project ? parsed : null;
  } catch {
    // A truncated fragment is the common case, not an exceptional one — fall
    // through to the server copy silently.
    return null;
  }
}

/** Pulls the `?t=` access key straight off the URL on web, as a backstop for
 *  when the caller's router params haven't resolved it. */
function readTokenFromUrl(): string | undefined {
  if (Platform.OS !== 'web') return undefined;
  try {
    const search = globalThis.location?.search ?? '';
    return new URLSearchParams(search).get('t') ?? undefined;
  } catch {
    return undefined;
  }
}

/** Envelope returned by portal_get_snapshot_v2. */
interface SnapshotEnvelope {
  status?: 'ok' | 'expired' | 'not_published';
  snapshot?: PortalSnapshot;
  expiresAt?: string | null;
}

/** `portal_denied` is raised for a bad id, a bad key and a disabled portal
 *  alike — deliberately, so the RPC can't be used to enumerate portalIds. */
function isDenied(message: unknown): boolean {
  return typeof message === 'string' && message.includes('portal_denied');
}

/** True when the database simply doesn't have the v2 function yet (the app can
 *  ship ahead of the migration; PostgREST reports an unknown RPC as PGRST202). */
function isMissingFunction(error: { code?: string; message?: string }): boolean {
  return error.code === 'PGRST202'
    || (typeof error.message === 'string' && error.message.includes('portal_get_snapshot_v2'));
}

const IDLE: PortalSnapshotState = { status: 'idle', snapshot: null, fromHash: false, expiresAt: null };

export function usePortalSnapshot(
  portalId: string | undefined,
  opts: { enabled: boolean; accessToken?: string },
): PortalSnapshotResult {
  const { enabled, accessToken } = opts;
  const [result, setResult] = useState<PortalSnapshotState>(IDLE);
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt(a => a + 1), []);

  useEffect(() => {
    if (!enabled || !portalId) {
      setResult(IDLE);
      return;
    }

    const hashSnapshot = decodeHashSnapshot();
    if (hashSnapshot) {
      setResult({ status: 'ready', snapshot: hashSnapshot, fromHash: true, expiresAt: null });
      return;
    }

    const token = accessToken ?? readTokenFromUrl();
    if (!token) {
      setResult({ status: 'missing_key', snapshot: null, fromHash: false, expiresAt: null });
      return;
    }
    if (!isSupabaseConfigured) {
      setResult({ status: 'unreachable', snapshot: null, fromHash: false, expiresAt: null });
      return;
    }

    let cancelled = false;
    setResult({ status: 'loading', snapshot: null, fromHash: false, expiresAt: null });
    const args = { p_portal_id: portalId, p_access_token: token };

    const settle = (status: PortalSnapshotStatus, snapshot: PortalSnapshot | null, expiresAt: string | null) => {
      if (!cancelled) setResult({ status, snapshot, fromHash: false, expiresAt });
    };

    // v2 first: it is the only read that enforces `expires_at` and the only one
    // that can tell "expired" apart from "never published" apart from "denied".
    // v1 is the fallback so the app still works against a database that hasn't
    // run 20260826190000 yet — at the cost of not being able to report expiry.
    void supabase.rpc('portal_get_snapshot_v2', args).then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        if (isDenied(error.message)) { settle('not_found', null, null); return; }
        if (!isMissingFunction(error)) { settle('unreachable', null, null); return; }
        void supabase.rpc('portal_get_snapshot', args).then(v1 => {
          if (cancelled) return;
          if (v1.error) {
            settle(isDenied(v1.error.message) ? 'not_found' : 'unreachable', null, null);
            return;
          }
          if (!v1.data) { settle('not_published', null, null); return; }
          settle('ready', v1.data as PortalSnapshot, null);
        });
        return;
      }

      const envelope = (data ?? {}) as SnapshotEnvelope;
      const expiresAt = envelope.expiresAt ?? null;
      if (envelope.status === 'expired') { settle('expired', null, expiresAt); return; }
      if (envelope.status === 'not_published' || !envelope.snapshot) {
        settle('not_published', null, expiresAt);
        return;
      }
      settle('ready', envelope.snapshot, expiresAt);
    });

    return () => { cancelled = true; };
  }, [enabled, portalId, accessToken, attempt]);

  return { ...result, reload };
}

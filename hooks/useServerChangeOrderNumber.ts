// hooks/useServerChangeOrderNumber.ts — the number the SERVER gave a change
// order, read back before anything client-facing prints it.
//
// Wave 4, lane co-workflow (#77 / #141). A CO number used to be this device's
// max + 1, printed as settled: the owner's phone offline on site and his web
// session could both issue "CO #4", and the email, the portal, the e-sign
// record and the frozen G701 "prior approved changes" row all carried the
// duplicate. The server now owns the number (20260920050000: it keeps the
// device's number when free and moves a collider to max + 1). This hook is the
// screen's side of that contract, modelled on useServerRecordNumber in
// hooks/useCollectionSettled.ts (#148, RFIs):
//
//   'checking'   — looking.
//   'pending'    — the INSERT is still queued on this device (or on the wire):
//                  the number is a proposal. The screen shows "(pending #)" and
//                  holds the email, the portal share and the PDF.
//   'unsaved'    — the INSERT was refused and sits in the sync ledger: it will
//                  not reach MAGE by itself, so no number is coming.
//   'edit_unsaved' — the CO is on MAGE with a confirmed `number`, but a later
//                  EDIT of it is under Not saved (integration round 2). The
//                  number stands; client-facing output waits, because the
//                  phone's version is one MAGE does not have.
//   'confirmed'  — read back from the server (or confirmed earlier and
//                  remembered on this device). `number` is the server's.
//   'unverified' — not queued, but the read failed (no signal) and this device
//                  never confirmed it. Nothing client-facing goes out on it.
//
// When the server's number differs from the one this device holds, the
// ['changeOrders'] query is invalidated so the provider adopts it, and
// `renumberedFrom` tells the screen to say so.
//
// Confirmed numbers are remembered per CO id (memory + AsyncStorage key
// mageid_co_numbers_confirmed) — from this hook's own reads and from the
// provider's server fetch (rememberServerChangeOrderNumbers) — so a CO
// confirmed yesterday can still be printed offline on site today: a number, once read from the server, never
// changes (20260920050000 §2 pins it on client updates).

import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { getOfflineQueue, onQueueChanged, onQueueFlushed } from '@/utils/offlineQueue';
import { insertStillQueued } from '@/utils/invoiceWrites';
import { unsavedWriteIds, unsavedCreateIds, onSyncLedgerChanged } from '@/utils/syncLedger';

// >>> co-number-state (pure; scripts/validate-w4-co-workflow-numbers.ts evaluates this block)
export type CoNumberState = 'checking' | 'pending' | 'unsaved' | 'confirmed' | 'unverified' | 'edit_unsaved';

/**
 * The decision, from what the hook observed. `read` is the server read:
 * { number } when the row came back, { missing: true } when it did not exist
 * yet, { error: true } when the read itself failed, undefined when it was not
 * attempted (queued / unsaved / not configured).
 */
export function coNumberStateFrom(o: {
  queued: boolean;
  /** The CO's CREATE (insert/upsert) is under Not saved. */
  unsaved: boolean;
  /** Integration round 2: a later EDIT of it is under Not saved (the create
   *  landed). Round 1 read ANY ledger line of the CO as `unsaved` and told him
   *  the CO "did not reach MAGE … has no confirmed number" — untrue, and with
   *  the park rule every later edit kept it there until Retry or Discard. */
  editUnsaved?: boolean;
  configured: boolean;
  read?: { number: number } | { missing: true } | { error: true };
  remembered?: number;
}): { state: CoNumberState; number?: number } {
  if (o.queued) return { state: 'pending' };
  if (o.unsaved) return { state: 'unsaved' };
  const r = numberFrom(o);
  // The number is confirmed; the edit is what waits.
  if (o.editUnsaved && r.state === 'confirmed') return { state: 'edit_unsaved', number: r.number };
  return r;
}

function numberFrom(o: {
  configured: boolean;
  read?: { number: number } | { missing: true } | { error: true };
  remembered?: number;
}): { state: CoNumberState; number?: number } {
  // No backend (a dev build): there is no server number to wait for.
  if (!o.configured) return { state: 'confirmed', number: o.remembered };
  if (!o.read) return { state: 'checking' };
  if ('number' in o.read) return { state: 'confirmed', number: o.read.number };
  // The direct insert is still on the wire (it fires no queue event on landing).
  if ('missing' in o.read) return { state: 'pending' };
  return o.remembered != null ? { state: 'confirmed', number: o.remembered } : { state: 'unverified' };
}

/** Why a client-facing action waits on the number, or null when it may go. */
export function coNumberHoldReason(state: CoNumberState, action: 'email' | 'portal' | 'pdf'): string | null {
  const what = action === 'email' ? 'emailed' : action === 'portal' ? 'put on the client portal' : 'printed';
  switch (state) {
    case 'confirmed': return null;
    case 'checking': return 'Checking this change order’s number with MAGE…';
    case 'pending':
      return `This change order is still reaching MAGE, which gives it its final number. It can be ${what} once it has synced — another device may already have used this number.`;
    case 'unsaved':
      return `This change order did not reach MAGE (see the sync status), so it has no confirmed number and cannot be ${what} yet. Retry it from the sync status first.`;
    case 'unverified':
      return `MAGE could not confirm this change order’s number (no connection), so it cannot be ${what} yet. Try again with signal.`;
    case 'edit_unsaved':
      return `Your latest change to this change order is not saved to MAGE yet (it is under Not saved on the sync status), so it cannot be ${what} — the client would get a version MAGE does not have. Retry or discard it there first.`;
  }
}
// <<< co-number-state

const CONFIRMED_KEY = 'mageid_co_numbers_confirmed';
const MAX_REMEMBERED = 300;
const remembered = new Map<string, number>();
let rememberedLoaded: Promise<void> | null = null;

function loadRemembered(): Promise<void> {
  if (!rememberedLoaded) {
    rememberedLoaded = (async () => {
      try {
        const raw = await AsyncStorage.getItem(CONFIRMED_KEY);
        const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {};
        for (const [id, n] of Object.entries(parsed)) {
          if (typeof n === 'number' && Number.isFinite(n) && !remembered.has(id)) remembered.set(id, n);
        }
      } catch { /* a missing or corrupt cache only means "not remembered" */ }
    })();
  }
  return rememberedLoaded;
}

function rememberMany(entries: readonly (readonly [string, number])[]): void {
  let changed = false;
  for (const [id, n] of entries) {
    if (typeof n !== 'number' || !Number.isFinite(n) || remembered.get(id) === n) continue;
    remembered.delete(id);
    remembered.set(id, n);
    changed = true;
  }
  if (!changed) return;
  while (remembered.size > MAX_REMEMBERED) {
    const oldest = remembered.keys().next().value;
    if (oldest === undefined) break;
    remembered.delete(oldest);
  }
  void AsyncStorage.setItem(CONFIRMED_KEY, JSON.stringify(Object.fromEntries(remembered))).catch(() => undefined);
}

function remember(id: string, n: number): void {
  rememberMany([[id, n]]);
}

/**
 * Seed the confirmed numbers from the provider's SERVER read of change_orders
 * (the mapped server rows, BEFORE they are merged with device copies). A row
 * the server returned has landed, so its number is the server's — a CO made
 * on the web, or on this device long ago, is then printable offline on site
 * (Share PDF, and the Send & Save mail-app fallback #78 relies on) without
 * this screen ever having read it back itself. Never pass device copies: a
 * queued insert's number is only a proposal.
 */
export function rememberServerChangeOrderNumbers(rows: readonly { id: string; number: number }[]): void {
  if (rows.length === 0) return;
  // After the load, so the persisted map is merged, not overwritten.
  void loadRemembered().then(() => rememberMany(rows.map(r => [r.id, r.number] as const)));
}

export function useServerChangeOrderNumber(
  id: string | undefined,
  localNumber: number | undefined,
): { state: CoNumberState; number: number | undefined; renumberedFrom: number | undefined; recheck: () => void } {
  const qc = useQueryClient();
  const [state, setState] = useState<CoNumberState>('checking');
  const [serverNumber, setServerNumber] = useState<number | undefined>(undefined);
  // The number this device showed before the server's came back different.
  const [renumberedFrom, setRenumberedFrom] = useState<number | undefined>(undefined);
  const seq = useRef(0);
  const localRef = useRef(localNumber);
  localRef.current = localNumber;
  const retries = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recheckRef = useRef<() => void>(() => undefined);

  const recheck = useCallback(() => {
    if (!id) return;
    const mine = ++seq.current;
    void (async () => {
      await loadRemembered();
      let queued = false;
      try { queued = insertStillQueued(await getOfflineQueue(), 'change_orders', id); } catch { queued = true; }
      // Round 2: `unsaved` only when the ledger holds the CO's CREATE — a CO
      // whose insert landed and whose later edit is under Not saved keeps its
      // confirmed number (editUnsaved gives the hold its own reason).
      let unsaved = false;
      let editUnsaved = false;
      if (!queued) {
        try { unsaved = (await unsavedCreateIds('change_orders')).has(id); } catch { unsaved = false; }
        if (!unsaved) { try { editUnsaved = (await unsavedWriteIds('change_orders')).has(id); } catch { editUnsaved = false; } }
      }
      if (mine !== seq.current) return;
      let read: { number: number } | { missing: true } | { error: true } | undefined;
      if (!queued && !unsaved && isSupabaseConfigured) {
        try {
          const { data, error } = await supabase.from('change_orders').select('number').eq('id', id).maybeSingle();
          if (error) read = { error: true };
          else {
            const n = data && typeof (data as { number?: unknown }).number === 'number' ? (data as { number: number }).number : undefined;
            read = typeof n === 'number' ? { number: n } : { missing: true };
          }
        } catch { read = { error: true }; }
        if (mine !== seq.current) return;
      }
      const out = coNumberStateFrom({
        queued, unsaved, editUnsaved, configured: isSupabaseConfigured, read, remembered: remembered.get(id),
      });
      const numbered = out.state === 'confirmed' || out.state === 'edit_unsaved';
      setState(out.state);
      setServerNumber(numbered ? out.number ?? localRef.current : undefined);
      if (numbered && typeof out.number === 'number') {
        remember(id, out.number);
        if (localRef.current != null && out.number !== localRef.current) {
          setRenumberedFrom(prev => prev ?? localRef.current);
          // The provider still holds the device's guess: re-pull the list so
          // every surface (project screen, G703, AIA) adopts the server's.
          void qc.invalidateQueries({ queryKey: ['changeOrders'] });
        }
      }
      if (read && 'missing' in read && retries.current < 10) {
        retries.current++;
        if (retryTimer.current) clearTimeout(retryTimer.current);
        retryTimer.current = setTimeout(() => recheckRef.current(), 3000);
      }
    })();
  }, [id, qc]);

  recheckRef.current = recheck;

  useEffect(() => {
    retries.current = 0;
    recheck();
    const offChange = onQueueChanged(() => recheck());
    const offFlush = onQueueFlushed(tables => { if (tables.has('change_orders')) recheck(); });
    const offLedger = onSyncLedgerChanged(() => recheck());
    const seqRef = seq;
    return () => {
      offChange(); offFlush(); offLedger(); seqRef.current++;
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [recheck]);

  return { state, number: serverNumber, renumberedFrom, recheck };
}

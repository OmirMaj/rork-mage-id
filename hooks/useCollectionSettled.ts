// hooks/useCollectionSettled.ts — what the RFI and submittal screens need to
// know about their collection before they may seed a form or print a number.
//
// Wave 3, lane rfi-core (audit 2026-09-18):
//   #142 An RFI opened by link on a fresh browser rendered the form while the
//        rfis fetch was still in flight: every useState initializer ran with
//        existingRFI = null, the header then flipped to "RFI #4" over blank
//        fields, and Update wrote '' / NULL over the real record. The screens
//        now wait for the collection to SETTLE (react-query state for
//        ['rfis', userId] / ['submittals', userId] — never an empty array read
//        as "loaded"), then key the form on the record id, or say the record is
//        gone / not shared.
//   #55  The screens refetch their collection when they open and when the app
//        comes back to the foreground, so the copy he edits is as fresh as the
//        network allows (the server guard in 20260919080000 is the real fix).
//        Per query, never a global focusManager bridge (useMageReachability
//        records that bridge firing ~40 selects on every foreground).
//   #148 Numbers are assigned by the server on insert. Until the screen has
//        read the server's number back it shows "(pending #)", and the
//        architect email waits — a guessed "RFI #7" is never printed as fact.
//
// The pure block below is executed by scripts/validate-rfi-core-screens.ts.

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { getOfflineQueue, onQueueChanged, onQueueFlushed } from '@/utils/offlineQueue';
import { pendingIdsForTable } from '@/utils/projectContextPure';

// >>> rfi-core-pure
/** What a record screen may render right now. */
export type RecordGate = 'form' | 'loading' | 'missing' | 'error';

/**
 * #142. `form` when no record is asked for (a new one) or it is in hand.
 * Otherwise wait while the collection has not settled, or while the query
 * already holds the record but the provider has not copied it over yet (one
 * render later). Settled without it: gone or never shared — say so; a failed
 * read says that instead. Never fall through to a blank, saveable form.
 */
export function recordGate(i: {
  wantsRecord: boolean;
  foundInContext: boolean;
  foundInQuery: boolean;
  settled: boolean;
  failed: boolean;
}): RecordGate {
  if (!i.wantsRecord || i.foundInContext) return 'form';
  if (i.foundInQuery || !i.settled) return 'loading';
  return i.failed ? 'error' : 'missing';
}

/** Equal the way a form field is equal: trimmed text, '' ≡ undefined ≡ null,
 *  arrays element-wise. */
function formValueKey(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v)) return JSON.stringify(v.map(x => (typeof x === 'string' ? x.trim() : x)));
  return JSON.stringify(v);
}

/**
 * #55 / #58. Only the fields he actually changed, compared against the record
 * the form OPENED with — never the whole form. A form seeded from a copy the
 * architect has since answered would otherwise write status 'open' and a NULL
 * response straight back over the answer.
 */
export function changedFields<T extends Record<string, unknown>>(opened: T, form: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(form) as (keyof T)[]) {
    if (formValueKey(form[k]) !== formValueKey(opened[k])) out[k] = form[k];
  }
  return out;
}

type Party = string;
interface HandoffLike { at: string; fromParty: Party; toParty: Party; note?: string }

/**
 * Where the ball goes when he saves (#56). Closing sends it to 'closed'. An
 * answer hands it back to the GC when it is newly typed here, OR when the RFI
 * is answered and the answer landed AFTER the ball last went to that party
 * (the portal answered it; rows answered before the portal fix heal on the
 * next save). An RFI he deliberately re-sent for a follow-up after the answer
 * keeps its ball.
 */
export function rfiBallAfterSave(p: {
  prevBall: Party | undefined;
  handoffs: HandoffLike[] | undefined;
  status: string;
  responseTyped: boolean;
  dateResponded: string | undefined;
  now: string;
}): { ball: Party; added: HandoffLike[] } {
  const prev = p.prevBall ?? 'gc';
  if (p.status === 'closed' && prev !== 'closed') {
    return { ball: 'closed', added: [{ at: p.now, fromParty: prev, toParty: 'closed', note: 'RFI closed by GC' }] };
  }
  if (prev === 'gc' || prev === 'closed') return { ball: prev, added: [] };
  let answeredAfterSend = false;
  if (p.status === 'answered' && p.dateResponded) {
    const sent = [...(p.handoffs ?? [])].reverse().find(h => h.toParty === prev);
    const answeredAt = Date.parse(p.dateResponded);
    const sentAt = sent ? Date.parse(sent.at) : NaN;
    answeredAfterSend = !Number.isFinite(sentAt) || (Number.isFinite(answeredAt) && answeredAt >= sentAt);
  }
  if (p.responseTyped || answeredAfterSend) {
    return { ball: 'gc', added: [{ at: p.now, fromParty: prev, toParty: 'gc', note: 'Response received' }] };
  }
  return { ball: prev, added: [] };
}

/** Why this save would undo an answer (#55) — the server refuses it, so the
 *  screen says so first instead of letting it silently revert. */
export function rfiRegressionReason(opened: { status: string; response?: string }, form: { status: string; response: string }): string | null {
  if ((opened.status === 'answered' || opened.status === 'closed') && form.status === 'open') {
    return 'An answered RFI stays answered — the response is on record. Void it, or raise a follow-up RFI.';
  }
  if ((opened.response ?? '').trim() && !form.response.trim()) {
    return 'The recorded response can\'t be cleared. Edit it instead, or void the RFI.';
  }
  return null;
}

interface CycleLike { cycleNumber?: number; status?: string; returnDate?: string | null }

/** The open cycle: the LAST one, still in_review with no returned date. */
export function openCycleOf<C extends CycleLike>(cycles: C[] | undefined): C | null {
  const last = (cycles ?? [])[(cycles ?? []).length - 1];
  return last && last.status === 'in_review' && !last.returnDate ? last : null;
}

/** The number the next response lands on (#147): the open cycle's own, else
 *  the highest + 1. The architect page repeats this rule. */
export function nextCycleNumber(cycles: CycleLike[] | undefined): number {
  const open = openCycleOf(cycles);
  if (open && typeof open.cycleNumber === 'number') return open.cycleNumber;
  return (cycles ?? []).reduce((m, c) => Math.max(m, typeof c.cycleNumber === 'number' ? c.cycleNumber : 0), 0) + 1;
}

/** The manual "Add Review Cycle" form (#147): a stamp that came back needs the
 *  day it came back; nothing is dated "now" behind his back. Days are
 *  'YYYY-MM-DD'. */
export function manualCycleProblem(c: { reviewer: string; status: string; sentDay: string; returnDay: string }): string | null {
  if (!c.reviewer.trim()) return 'Enter the reviewer.';
  if (c.status !== 'in_review' && !c.returnDay) return 'Add the Returned date — a stamped cycle needs the day it came back.';
  if (c.status === 'in_review' && c.returnDay) return 'A cycle still in review has no Returned date. Pick the stamp it came back with, or clear Returned.';
  if (c.sentDay && c.returnDay && c.returnDay < c.sentDay) return 'Returned can\'t be before Sent.';
  return null;
}

/** State of a record's server-assigned number (#148). */
export type NumberState = 'checking' | 'pending' | 'confirmed' | 'local';

/**
 * The header label — a number is printed only when it is the server's.
 * `_local` (the device's copy) is deliberately NOT printed: the server numbers
 * every insert itself, so the local copy is the device's guess until a refetch
 * has replaced it, and nothing here can prove that refetch ran (an insert can
 * land as #8 and the phone drop offline before it reads #8 back).
 */
export function recordNumberLabel(kind: string, state: NumberState, confirmed: number | undefined, _local: number | undefined): string {
  if (state === 'confirmed' && typeof confirmed === 'number') return `${kind} #${confirmed}`;
  if (state === 'pending') return `${kind} (pending #)`;
  // 'local': the server could not be asked (offline / read failed).
  if (state === 'local') return `${kind} (number not confirmed)`;
  // 'checking': a beat, never a guess.
  return kind;
}

/** Why the architect email / portal send must wait for the number. */
export function numberHoldReason(kind: string, state: NumberState): string | null {
  if (state === 'confirmed') return null;
  if (state === 'pending') return `This ${kind} hasn't reached the server yet, so it has no number. It sends once it syncs.`;
  if (state === 'checking') return `Checking this ${kind}'s number…`;
  return `You're offline — this ${kind}'s number can't be confirmed, so it can't be sent yet.`;
}
/**
 * #58 (review round 2): Send never saves. A save and a send in the same tap
 * run inside one render's closures — the context mutators read the record
 * list from BEFORE the save, so the portal snapshot froze the old question and
 * a second queued write put it back on the server. The simplest rule that is
 * provably right: while there are unsaved edits, every send is disabled with
 * this reason; he saves (staying on the screen), and the send in a later
 * render reads the saved record.
 */
export function sendBlockReason(i: { isDirty: boolean; numberHold: string | null }): string | null {
  if (i.isDirty) return 'Save your changes before sending — what goes out is the saved record, not the screen.';
  return i.numberHold;
}

/**
 * #147 interim: while a cycle is still out for review, a hand-logged cycle
 * would APPEND (the app cannot close the open one in place until the
 * submittal_append_review_cycle RPC is wired), counting one round twice. So
 * the manual form is closed while a cycle is open, and says why.
 */
export function manualCycleBlockedReason(cycles: CycleLike[] | undefined): string | null {
  const open = openCycleOf(cycles);
  if (!open) return null;
  const n = typeof open.cycleNumber === 'number' ? open.cycleNumber : nextCycleNumber(cycles);
  return `Cycle ${n} is still out for review. The reviewer's answer through the reply link closes it; logging a cycle here now would count the same round twice.`;
}

/**
 * #55 / #58 (review round 3): the form keeps in step with the LIVE row. The
 * form seeds once, often from the cached copy, and the open / foreground
 * refetch lands after. When a newer copy of the record arrives, every field
 * he has NOT touched (form equals what it opened with) takes the live value;
 * a field he did touch keeps his edit. The live row then becomes the new
 * baseline. Without this an answer the architect filed through the portal
 * never reached the screen, and the stale 'open' / empty response read as an
 * unsaved edit forever — Send stayed blocked and Save was refused.
 */
export function rebaseFormOnLive<T extends Record<string, unknown>>(opened: T, form: T, live: T): T {
  const out = { ...live };
  for (const k of Object.keys(form) as (keyof T)[]) {
    if (formValueKey(form[k]) !== formValueKey(opened[k])) out[k] = form[k];
  }
  return out;
}

/**
 * #147 (review round 3): what a reviewer send does to the cycle log. With a
 * cycle still out for review, a send is a reminder for THAT round — appending
 * another in_review cycle would count one round twice and leave the first
 * open forever (the portal response closes only the last). Only a send with
 * nothing open starts a new cycle.
 */
export function reviewerSendCycle(cycles: CycleLike[] | undefined): { append: true } | { append: false; cycleNumber: number } {
  const open = openCycleOf(cycles);
  if (!open) return { append: true };
  return { append: false, cycleNumber: typeof open.cycleNumber === 'number' ? open.cycleNumber : nextCycleNumber(cycles) };
}
// <<< rfi-core-pure

export type CollectionKey = 'rfis' | 'submittals';

interface Snapshot { settled: boolean; failed: boolean; hasRecord: boolean }

/**
 * #142: has the provider's react-query read of this collection finished, and
 * does its data already hold `recordId`? Subscribes to the query cache, so a
 * screen re-renders the moment the fetch lands.
 */
export function useCollectionSettled(key: CollectionKey, recordId: string | undefined): Snapshot {
  const qc = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const read = useCallback((): Snapshot => {
    const queryKey = [key, userId];
    const st = qc.getQueryState(queryKey);
    const data = qc.getQueryData<{ id?: string }[]>(queryKey);
    // A read react-query has PAUSED (no network) will not settle by itself:
    // it counts as settled-and-failed, so the screen says "check your
    // connection" instead of spinning — or calling the record gone.
    const paused = st?.fetchStatus === 'paused';
    return {
      settled: !!st && (paused || ((st.status === 'success' || st.status === 'error') && st.fetchStatus !== 'fetching')),
      failed: st?.status === 'error' || paused,
      hasRecord: !!recordId && Array.isArray(data) && data.some(r => r?.id === recordId),
    };
  }, [qc, key, userId, recordId]);
  const [snap, setSnap] = useState<Snapshot>(read);
  useEffect(() => {
    setSnap(read());
    return qc.getQueryCache().subscribe(() => {
      const next = read();
      setSnap(prev => (prev.settled === next.settled && prev.failed === next.failed && prev.hasRecord === next.hasRecord ? prev : next));
    });
  }, [qc, read]);
  return snap;
}

/**
 * #55: refetch this collection when the screen opens and whenever the app
 * returns to the foreground while it is open — so an answer the architect
 * filed through the portal reaches the phone before he edits.
 */
export function useRefetchCollectionOnOpen(key: CollectionKey): void {
  const qc = useQueryClient();
  useEffect(() => {
    void qc.invalidateQueries({ queryKey: [key] });
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') void qc.invalidateQueries({ queryKey: [key] });
    });
    return () => sub.remove();
  }, [qc, key]);
}

/**
 * #148: the number the SERVER gave this record. Reads it back directly (a
 * read — writes still go through the offline queue). While the insert is
 * queued it is 'pending'; once the server's number is known and differs from
 * the local guess, the collection is refetched so the provider adopts it.
 */
export function useServerRecordNumber(
  table: CollectionKey,
  id: string | undefined,
  localNumber: number | undefined,
): { state: NumberState; number: number | undefined; recheck: () => void } {
  const qc = useQueryClient();
  const [state, setState] = useState<NumberState>('checking');
  const [serverNumber, setServerNumber] = useState<number | undefined>(undefined);
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
      let queued = false;
      try { queued = pendingIdsForTable(await getOfflineQueue(), table).has(id); } catch { queued = false; }
      if (mine !== seq.current) return;
      if (queued) { setState('pending'); setServerNumber(undefined); return; }
      if (!isSupabaseConfigured) { setState('local'); return; }
      try {
        const { data, error } = await supabase.from(table).select('number').eq('id', id).maybeSingle();
        if (mine !== seq.current) return;
        if (error) { setState('local'); return; }
        const n = data && typeof (data as { number?: unknown }).number === 'number' ? (data as { number: number }).number : undefined;
        if (typeof n !== 'number') {
          // Not queued and not on the server: the direct insert is still in
          // flight (it fires no queue event when it lands), so look again.
          setState('pending'); setServerNumber(undefined);
          if (retries.current < 10) {
            retries.current++;
            if (retryTimer.current) clearTimeout(retryTimer.current);
            retryTimer.current = setTimeout(() => recheckRef.current(), 3000);
          }
          return;
        }
        setServerNumber(n);
        setState('confirmed');
        if (n !== localRef.current) void qc.invalidateQueries({ queryKey: [table] });
      } catch {
        if (mine === seq.current) setState('local');
      }
    })();
  }, [id, table, qc]);

  recheckRef.current = recheck;

  useEffect(() => {
    retries.current = 0;
    recheck();
    const offChange = onQueueChanged(() => recheck());
    const offFlush = onQueueFlushed(tables => { if (tables.has(table)) recheck(); });
    return () => {
      offChange(); offFlush(); seq.current++;
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [recheck, table]);

  return { state, number: serverNumber, recheck };
}

// hooks/useJurisdictionAnswers.ts — the GC's saved department answers for one
// jurisdiction (lane PPASK). public.jurisdiction_answers, owner-only under RLS.
//
// READ. react-query, key ['jurisdiction-answers', key]: named columns
// (ANSWER_COLUMNS, never user_id), filtered by the exact key; RLS limits the
// rows to his own. What it shows is re-filtered by the exact key (answersFor),
// so an answer from another town can never appear here. Writes still waiting
// in this device's own offline queue are folded in (a save made offline shows
// at once, and after a restart, until it lands).
//
// WRITE. Only through utils/offlineQueue (supabaseWriteDetailed 'insert' /
// 'delete'), with a client-generated id, so a save works offline: 'synced'
// toasts "Answer saved", 'queued' toasts "Saved offline. It sends when you're
// back online.", and a refusal takes the optimistic copy back and returns
// 'failed' (callerOwnsRefusal: the sheet stays open and says so; nothing is
// written to the Not saved list for something the screen asked him to redo).
//
// An answer is never edited: delete (after a confirm) and save again, so the
// record of what was said on a date stays intact.
//
// NO ASYNCSTORAGE KEY. The rows live on the account. The react-query device
// cache (utils/queryPersist.ts) persists only allow-listed roots keyed by the
// user, and this root is not on it, so nothing here is written to the device
// except through the offline queue (mageid_offline_queue).

import { useCallback, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useT } from '@/contexts/LanguageContext';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import {
  getOwnOfflineQueueDetailed, onQueueFlushed, supabaseWriteDetailed, type WriteOutcome,
} from '@/utils/offlineQueue';
import {
  ANSWER_COLUMNS, JURISDICTION_ANSWERS_TABLE, JURISDICTION_KEY_RE, answersFor, fromInsert, fromRow, toEngineAnswers, toRow,
  type DeptAnswerInput, type EngineDeptAnswer, type SavedDeptAnswer,
} from '@/utils/permitPath/deptAnswers';
import { todayCalendarDay } from '@/utils/calendarDate';
import { nailIt, notice, oops } from '@/components/animations/NailItToast';
import { showAlert } from '@/utils/alert';

export const jurisdictionAnswersKey = (key: string | null) => ['jurisdiction-answers', key] as const;

/** Writes on the wire right now (not yet queued, not yet landed), so a refetch
 *  that races them neither drops a new answer nor brings back a deleted one. */
const inFlightInserts = new Map<string, SavedDeptAnswer>();
const inFlightDeletes = new Set<string>();

async function fetchAnswers(key: string): Promise<SavedDeptAnswer[]> {
  const res = await supabase
    .from(JURISDICTION_ANSWERS_TABLE)
    .select(ANSWER_COLUMNS)
    .eq('jurisdiction_key', key)
    .order('answered_on', { ascending: false })
    .limit(500);
  if (res.error) throw new Error(res.error.message);
  const byId = new Map<string, SavedDeptAnswer>();
  for (const r of (res.data ?? []) as unknown[]) {
    const a = fromRow(r as Parameters<typeof fromRow>[0]);
    if (a) byId.set(a.id, a);
  }
  // Fold in this device's own unsent writes for this table.
  try {
    const own = await getOwnOfflineQueueDetailed();
    for (const m of own.entries) {
      if (m.table !== JURISDICTION_ANSWERS_TABLE) continue;
      const id = typeof m.data?.id === 'string' ? m.data.id : null;
      if (!id) continue;
      if (m.operation === 'delete') byId.delete(id);
      else if (m.operation === 'insert' && m.data?.jurisdiction_key === key) {
        const a = fromRow(m.data as Parameters<typeof fromRow>[0]);
        if (a) byId.set(id, a);
      }
    }
  } catch {
    // The queue could not be read: show what the account returned.
  }
  for (const [id, a] of inFlightInserts) if (a.jurisdictionKey === key) byId.set(id, a);
  for (const id of inFlightDeletes) byId.delete(id);
  return [...byId.values()];
}

/** A v4 uuid for a new row (offline-safe: the device names the row). */
export function newAnswerId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const hex = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) s += '-';
    else if (i === 14) s += '4';
    else if (i === 19) s += hex[(Math.random() * 4) | 8];
    else s += hex[(Math.random() * 16) | 0];
  }
  return s;
}

export type SaveAnswerResult =
  | { outcome: 'synced' | 'queued'; answer: SavedDeptAnswer }
  | { outcome: 'failed'; reason: string }
  | { outcome: 'invalid'; reason: string };

export interface UseJurisdictionAnswers {
  /** This jurisdiction's answers, newest first (exact key only). */
  answers: SavedDeptAnswer[];
  /** One element per (answer, question id): PPENGINE RouteInputs['deptAnswers']. */
  engineAnswers: EngineDeptAnswer[];
  saveAnswer: (input: Omit<DeptAnswerInput, 'id'> & { id?: string }) => Promise<SaveAnswerResult>;
  /** Asks to confirm, then deletes. Resolves 'cancelled' when he backs out. */
  deleteAnswer: (id: string) => Promise<WriteOutcome | 'cancelled'>;
  loading: boolean;
  error: string | null;
}

export function useJurisdictionAnswers(key: string | null): UseJurisdictionAnswers {
  const { user } = useAuth();
  const { t } = useT();
  const qc = useQueryClient();
  const validKey = !!key && JURISDICTION_KEY_RE.test(key);
  const enabled = validKey && !!user && isSupabaseConfigured;
  const queryKey = useMemo(() => ['jurisdiction-answers', key] as const, [key]);

  const query = useQuery({
    queryKey,
    queryFn: () => fetchAnswers(key as string),
    enabled,
    staleTime: 60_000,
  });

  // A queued save or delete that lands: read the account again.
  useEffect(() => {
    if (!enabled) return;
    return onQueueFlushed((tables) => {
      if (tables.has(JURISDICTION_ANSWERS_TABLE)) void qc.invalidateQueries({ queryKey });
    });
  }, [enabled, qc, queryKey]);

  const answers = useMemo(() => answersFor(query.data ?? [], validKey ? key : null), [query.data, key, validKey]);
  const engineAnswers = useMemo(() => toEngineAnswers(answers), [answers]);

  const saveAnswer = useCallback<UseJurisdictionAnswers['saveAnswer']>(async (input) => {
    const notSaved = t('office.permitPath.save.failed', 'The answer wasn’t saved. Check your connection and try again.');
    if (!user || !isSupabaseConfigured) {
      return { outcome: 'invalid', reason: t('office.permitPath.save.signIn', 'Sign in to save answers.') };
    }
    const built = toRow({ ...input, id: input.id ?? newAnswerId() }, { today: todayCalendarDay() });
    if (!built.ok) return { outcome: 'invalid', reason: built.reason };
    const row = built.row;
    const answer = fromInsert(row, new Date().toISOString());
    const rowKey = ['jurisdiction-answers', row.jurisdiction_key] as const;
    inFlightInserts.set(row.id, answer);
    qc.setQueryData<SavedDeptAnswer[]>(rowKey, (old) => [answer, ...(old ?? []).filter((a) => a.id !== row.id)]);
    let outcome: WriteOutcome;
    try {
      outcome = await supabaseWriteDetailed(JURISDICTION_ANSWERS_TABLE, 'insert', row as unknown as Record<string, unknown>, { callerOwnsRefusal: true });
    } catch {
      outcome = 'failed';
    }
    inFlightInserts.delete(row.id);
    if (outcome === 'failed') {
      qc.setQueryData<SavedDeptAnswer[]>(rowKey, (old) => (old ?? []).filter((a) => a.id !== row.id));
      oops(notSaved);
      return { outcome: 'failed', reason: notSaved };
    }
    if (outcome === 'synced') {
      nailIt(t('office.permitPath.save.saved', 'Answer saved'));
      void qc.invalidateQueries({ queryKey: rowKey });
    } else {
      notice(t('office.permitPath.save.savedOffline', 'Saved offline. It sends when you’re back online.'));
    }
    return { outcome, answer };
  }, [qc, t, user]);

  const deleteAnswer = useCallback<UseJurisdictionAnswers['deleteAnswer']>(async (id) => {
    const confirmed = await new Promise<boolean>((resolve) => {
      showAlert(
        t('office.permitPath.save.deleteTitle', 'Delete this answer?'),
        t('office.permitPath.save.deleteBody', 'It comes off every route in this town. You can save it again.'),
        [
          { text: t('office.permitPath.save.keep', 'Keep it'), style: 'cancel', onPress: () => resolve(false) },
          { text: t('office.permitPath.save.delete', 'Delete'), style: 'destructive', onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      );
    });
    if (!confirmed) return 'cancelled';
    const before = qc.getQueryData<SavedDeptAnswer[]>(queryKey);
    inFlightDeletes.add(id);
    qc.setQueryData<SavedDeptAnswer[]>(queryKey, (old) => (old ?? []).filter((a) => a.id !== id));
    let outcome: WriteOutcome;
    try {
      outcome = await supabaseWriteDetailed(JURISDICTION_ANSWERS_TABLE, 'delete', { id }, { callerOwnsRefusal: true });
    } catch {
      outcome = 'failed';
    }
    inFlightDeletes.delete(id);
    if (outcome === 'failed') {
      if (before) qc.setQueryData(queryKey, before);
      oops(t('office.permitPath.save.deleteFailed', 'The answer wasn’t deleted. Try again.'));
    } else if (outcome === 'synced') {
      void qc.invalidateQueries({ queryKey });
    }
    return outcome;
  }, [qc, queryKey, t]);

  return {
    answers,
    engineAnswers,
    saveAnswer,
    deleteAnswer,
    loading: enabled && query.isLoading,
    error: query.error ? (query.error as Error).message : null,
  };
}

export default useJurisdictionAnswers;

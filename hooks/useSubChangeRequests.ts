// useSubChangeRequests — GC-side hook for the sub-change-request
// inbox. Pre-fix subs found extra scope on-site, called/texted the
// GC, who then opened change-order.tsx and re-typed everything.
// Now: sub portal posts a SubChangeRequest with photo + price; this
// hook is the GC's inbox surface.
//
// Pattern matches useDeliveryReceipts / useTimeEntries — offline-
// first AsyncStorage cache + Supabase pull on auth + queued writes.
// Sub-side INSERTs go through the SECURITY DEFINER RPC
// (`submit_sub_change_request`) defined in
// create_draw_periods_and_sub_change_requests.sql; this hook only
// reads + reviews.

import { useCallback, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { supabaseWrite } from '@/utils/offlineQueue';
import type { SubChangeRequest, SubChangeRequestStatus } from '@/types';

const STORAGE_KEY = 'tertiary_sub_change_requests';

interface DBRow {
  id: string;
  user_id: string;
  project_id: string;
  sub_portal_id: string;
  sub_name: string;
  description: string;
  amount: number;
  schedule_impact_days: number | null;
  photos: string[] | null;
  notes: string | null;
  status: SubChangeRequestStatus;
  resulting_change_order_id: string | null;
  review_notes: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

function fromDB(r: DBRow): SubChangeRequest {
  return {
    id: r.id,
    projectId: r.project_id,
    subPortalId: r.sub_portal_id,
    subName: r.sub_name,
    description: r.description,
    amount: Number(r.amount),
    scheduleImpactDays: r.schedule_impact_days ?? undefined,
    photos: Array.isArray(r.photos) ? r.photos : undefined,
    notes: r.notes ?? undefined,
    status: r.status,
    resultingChangeOrderId: r.resulting_change_order_id ?? undefined,
    reviewNotes: r.review_notes ?? undefined,
    submittedAt: r.submitted_at,
    reviewedAt: r.reviewed_at ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface UseSubChangeRequestsResult {
  requests: SubChangeRequest[];
  pendingForProject: (projectId: string) => SubChangeRequest[];
  pendingCount: number;
  loading: boolean;
  approve: (id: string, opts?: { resultingChangeOrderId?: string; notes?: string }) => void;
  reject: (id: string, reason: string) => void;
  requestRevision: (id: string, reason: string) => void;
  refresh: () => Promise<void>;
}

export function useSubChangeRequests(): UseSubChangeRequestsResult {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [requests, setRequests] = useState<SubChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const persist = useCallback((next: SubChangeRequest[]) => {
    setRequests(next);
    void (async () => {
      try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ok */ }
    })();
  }, []);

  // Hydrate cache.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!cancelled && raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) setRequests(parsed as SubChangeRequest[]);
        }
      } catch (err) {
        console.log('[useSubChangeRequests] local load failed', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const refresh = useCallback(async () => {
    if (!userId || !isSupabaseConfigured) return;
    try {
      const { data, error } = await supabase
        .from('sub_change_requests')
        .select('*')
        .eq('user_id', userId)
        .order('submitted_at', { ascending: false });
      if (error) {
        console.log('[useSubChangeRequests] server pull failed', error.message);
        return;
      }
      const list = (data as DBRow[] | null)?.map(fromDB) ?? [];
      persist(list);
    } catch (err) {
      console.log('[useSubChangeRequests] server pull error', err);
    }
  }, [userId, persist]);

  // Server pull on auth.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const updateStatus = useCallback((
    id: string,
    status: SubChangeRequestStatus,
    extras: Partial<Pick<SubChangeRequest, 'reviewNotes' | 'resultingChangeOrderId'>>,
  ) => {
    const now = new Date().toISOString();
    const next = requests.map(r => r.id === id
      ? { ...r, status, reviewedAt: now, updatedAt: now, ...extras }
      : r,
    );
    persist(next);
    if (userId && isSupabaseConfigured) {
      void supabaseWrite('sub_change_requests', 'update', {
        id,
        status,
        reviewed_at: now,
        review_notes: extras.reviewNotes ?? null,
        resulting_change_order_id: extras.resultingChangeOrderId ?? null,
        updated_at: now,
      });
    }
  }, [requests, persist, userId]);

  const approve = useCallback<UseSubChangeRequestsResult['approve']>((id, opts) => {
    updateStatus(id, 'approved', {
      resultingChangeOrderId: opts?.resultingChangeOrderId,
      reviewNotes: opts?.notes,
    });
  }, [updateStatus]);

  const reject = useCallback<UseSubChangeRequestsResult['reject']>((id, reason) => {
    updateStatus(id, 'rejected', { reviewNotes: reason });
  }, [updateStatus]);

  const requestRevision = useCallback<UseSubChangeRequestsResult['requestRevision']>((id, reason) => {
    updateStatus(id, 'needs_revision', { reviewNotes: reason });
  }, [updateStatus]);

  const pendingForProject = useCallback(
    (projectId: string) => requests.filter(r =>
      r.projectId === projectId && r.status === 'submitted',
    ),
    [requests],
  );

  const pendingCount = useMemo(
    () => requests.filter(r => r.status === 'submitted').length,
    [requests],
  );

  return useMemo(() => ({
    requests, pendingForProject, pendingCount, loading,
    approve, reject, requestRevision, refresh,
  }), [requests, pendingForProject, pendingCount, loading, approve, reject, requestRevision, refresh]);
}

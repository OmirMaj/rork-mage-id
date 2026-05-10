// useDrawPeriods — offline-first hook for the lender-facing
// draw-period rollup. Same shape as useDeliveryReceipts /
// useTimeEntries / useSubChangeRequests.
//
// Pre-fix the GC tracked the AIA G702/G703 pay app, sub invoices,
// and lien waivers as siblings with no "this is for THIS draw"
// grouping. PM audit's #4 missing primitive — every loan-funded
// residential job runs this monthly ritual.
//
// A DrawPeriod ties: invoice IDs included in the draw, lien-waiver
// IDs collected, the AIA pay-app ID, dollar columns (requested →
// approved → funded), and a status pivot the dashboard uses to
// surface "next action" per draw.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { supabaseWrite } from '@/utils/offlineQueue';
import { generateUUID } from '@/utils/generateId';
import type { DrawPeriod, DrawPeriodStatus } from '@/types';

const STORAGE_KEY = 'tertiary_draw_periods';

interface DBRow {
  id: string;
  user_id: string;
  project_id: string;
  number: number;
  label: string;
  period_start: string;
  period_end: string;
  status: DrawPeriodStatus;
  aia_pay_app_id: string | null;
  invoice_ids: string[] | null;
  lien_waiver_ids: string[] | null;
  amount_requested: number | null;
  amount_approved: number | null;
  amount_funded: number | null;
  submitted_at: string | null;
  approved_at: string | null;
  funded_at: string | null;
  closed_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function fromDB(r: DBRow): DrawPeriod {
  return {
    id: r.id,
    projectId: r.project_id,
    number: r.number,
    label: r.label,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    status: r.status,
    aiaPayAppId: r.aia_pay_app_id ?? undefined,
    invoiceIds: Array.isArray(r.invoice_ids) ? r.invoice_ids : [],
    lienWaiverIds: Array.isArray(r.lien_waiver_ids) ? r.lien_waiver_ids : [],
    amountRequested: r.amount_requested ?? undefined,
    amountApproved: r.amount_approved ?? undefined,
    amountFunded: r.amount_funded ?? undefined,
    submittedAt: r.submitted_at ?? undefined,
    approvedAt: r.approved_at ?? undefined,
    fundedAt: r.funded_at ?? undefined,
    closedAt: r.closed_at ?? undefined,
    notes: r.notes ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface UseDrawPeriodsResult {
  draws: DrawPeriod[];
  drawsForProject: (projectId: string) => DrawPeriod[];
  loading: boolean;
  addDraw: (input: Omit<DrawPeriod, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) => DrawPeriod;
  updateDraw: (id: string, patch: Partial<DrawPeriod>) => void;
  deleteDraw: (id: string) => void;
}

export function useDrawPeriods(): UseDrawPeriodsResult {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [draws, setDraws] = useState<DrawPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const hydratedRef = useRef(false);

  // Hydrate from local cache on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!cancelled && raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) setDraws(parsed as DrawPeriod[]);
        }
      } catch (err) {
        console.log('[useDrawPeriods] local load failed', err);
      } finally {
        if (!cancelled) {
          setLoading(false);
          hydratedRef.current = true;
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Server pull on auth.
  useEffect(() => {
    if (!userId || !isSupabaseConfigured) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('draw_periods')
          .select('*')
          .eq('user_id', userId)
          .order('period_end', { ascending: false });
        if (cancelled) return;
        if (error) {
          console.log('[useDrawPeriods] server pull failed', error.message);
          return;
        }
        const list = (data as DBRow[] | null)?.map(fromDB) ?? [];
        setDraws(list);
        try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch { /* ok */ }
      } catch (err) {
        console.log('[useDrawPeriods] server pull error', err);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const persist = useCallback((next: DrawPeriod[]) => {
    setDraws(next);
    void (async () => {
      try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ok */ }
    })();
  }, []);

  const addDraw = useCallback<UseDrawPeriodsResult['addDraw']>((input) => {
    const now = new Date().toISOString();
    const d: DrawPeriod = {
      id: input.id ?? generateUUID(),
      projectId: input.projectId,
      number: input.number,
      label: input.label,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      status: input.status,
      aiaPayAppId: input.aiaPayAppId,
      invoiceIds: input.invoiceIds ?? [],
      lienWaiverIds: input.lienWaiverIds ?? [],
      amountRequested: input.amountRequested,
      amountApproved: input.amountApproved,
      amountFunded: input.amountFunded,
      submittedAt: input.submittedAt,
      approvedAt: input.approvedAt,
      fundedAt: input.fundedAt,
      closedAt: input.closedAt,
      notes: input.notes,
      createdAt: now,
      updatedAt: now,
    };
    const next = [d, ...draws].sort((a, b) =>
      Date.parse(b.periodEnd) - Date.parse(a.periodEnd) || b.number - a.number,
    );
    persist(next);
    if (userId && isSupabaseConfigured) {
      void supabaseWrite('draw_periods', 'insert', {
        id: d.id,
        user_id: userId,
        project_id: d.projectId,
        number: d.number,
        label: d.label,
        period_start: d.periodStart,
        period_end: d.periodEnd,
        status: d.status,
        aia_pay_app_id: d.aiaPayAppId ?? null,
        invoice_ids: d.invoiceIds,
        lien_waiver_ids: d.lienWaiverIds,
        amount_requested: d.amountRequested ?? null,
        amount_approved: d.amountApproved ?? null,
        amount_funded: d.amountFunded ?? null,
        submitted_at: d.submittedAt ?? null,
        approved_at: d.approvedAt ?? null,
        funded_at: d.fundedAt ?? null,
        closed_at: d.closedAt ?? null,
        notes: d.notes ?? null,
        created_at: d.createdAt,
        updated_at: d.updatedAt,
      });
    }
    return d;
  }, [draws, persist, userId]);

  const updateDraw = useCallback<UseDrawPeriodsResult['updateDraw']>((id, patch) => {
    const now = new Date().toISOString();
    const next = draws.map(d => d.id === id ? { ...d, ...patch, updatedAt: now } : d);
    persist(next);
    if (userId && isSupabaseConfigured) {
      const d = next.find(x => x.id === id);
      if (d) {
        void supabaseWrite('draw_periods', 'update', {
          id,
          label: d.label,
          status: d.status,
          aia_pay_app_id: d.aiaPayAppId ?? null,
          invoice_ids: d.invoiceIds,
          lien_waiver_ids: d.lienWaiverIds,
          amount_requested: d.amountRequested ?? null,
          amount_approved: d.amountApproved ?? null,
          amount_funded: d.amountFunded ?? null,
          submitted_at: d.submittedAt ?? null,
          approved_at: d.approvedAt ?? null,
          funded_at: d.fundedAt ?? null,
          closed_at: d.closedAt ?? null,
          notes: d.notes ?? null,
          updated_at: now,
        });
      }
    }
  }, [draws, persist, userId]);

  const deleteDraw = useCallback<UseDrawPeriodsResult['deleteDraw']>((id) => {
    const next = draws.filter(d => d.id !== id);
    persist(next);
    if (userId && isSupabaseConfigured) {
      void supabaseWrite('draw_periods', 'delete', { id });
    }
  }, [draws, persist, userId]);

  const drawsForProject = useCallback(
    (projectId: string) => draws
      .filter(d => d.projectId === projectId)
      .sort((a, b) => b.number - a.number),
    [draws],
  );

  return useMemo(() => ({
    draws, drawsForProject, loading, addDraw, updateDraw, deleteDraw,
  }), [draws, drawsForProject, loading, addDraw, updateDraw, deleteDraw]);
}

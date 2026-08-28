import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { supabaseWrite } from '@/utils/offlineQueue';
import type { SubSubmittedInvoice, SubSubmittedInvoiceLine } from '@/types';

// Fetches sub-submitted invoices for a project (or for a single sub portal
// when subPortalId is provided). RLS scopes to portals owned by the GC.

interface Row {
  id: string;
  sub_portal_id: string;
  project_id: string | null;
  subcontractor_id: string | null;
  commitment_id: string | null;
  invoice_number: string;
  amount: number | string;
  retention_amount: number | string | null;
  description: string | null;
  line_items: SubSubmittedInvoiceLine[] | null;
  status: 'submitted' | 'approved' | 'rejected' | 'paid';
  submitted_by_name: string | null;
  submitted_by_email: string | null;
  notes_from_sub: string | null;
  notes_from_gc: string | null;
  created_at: string;
  reviewed_at: string | null;
  paid_at: string | null;
  // Payment reconciliation (20260826120000_ap_payment_reconciliation.sql).
  // Optional on the row type: a client running ahead of the migration just
  // reads them as undefined rather than throwing.
  payment_method?: string | null;
  payment_reference?: string | null;
  paid_on?: string | null;
}

function rowToInvoice(r: Row): SubSubmittedInvoice {
  return {
    id: r.id,
    subPortalId: r.sub_portal_id,
    projectId: r.project_id ?? undefined,
    subcontractorId: r.subcontractor_id ?? undefined,
    commitmentId: r.commitment_id ?? undefined,
    invoiceNumber: r.invoice_number,
    amount: typeof r.amount === 'string' ? parseFloat(r.amount) : r.amount,
    retentionAmount: r.retention_amount == null
      ? undefined
      : (typeof r.retention_amount === 'string'
          ? parseFloat(r.retention_amount)
          : r.retention_amount),
    description: r.description ?? undefined,
    lineItems: r.line_items ?? undefined,
    status: r.status,
    submittedByName: r.submitted_by_name ?? undefined,
    submittedByEmail: r.submitted_by_email ?? undefined,
    notesFromSub: r.notes_from_sub ?? undefined,
    notesFromGc: r.notes_from_gc ?? undefined,
    createdAt: r.created_at,
    reviewedAt: r.reviewed_at ?? undefined,
    paidAt: r.paid_at ?? undefined,
    paymentMethod: r.payment_method ?? undefined,
    paymentReference: r.payment_reference ?? undefined,
    paidOn: r.paid_on ?? undefined,
  };
}

export function useSubSubmittedInvoices(opts: { projectId?: string; subPortalId?: string }) {
  const { projectId, subPortalId } = opts;
  const queryClient = useQueryClient();

  const enabled = isSupabaseConfigured && (!!projectId || !!subPortalId);
  const queryKey = ['subSubmittedInvoices', projectId ?? null, subPortalId ?? null];

  const query = useQuery({
    queryKey,
    enabled,
    queryFn: async (): Promise<SubSubmittedInvoice[]> => {
      let q = supabase.from('sub_submitted_invoices').select('*');
      if (subPortalId) q = q.eq('sub_portal_id', subPortalId);
      else if (projectId) q = q.eq('project_id', projectId);
      const { data, error } = await q.order('created_at', { ascending: false });
      if (error) {
        console.log('[useSubSubmittedInvoices] fetch failed:', error.message);
        return [];
      }
      return ((data ?? []) as Row[]).map(rowToInvoice);
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const reviewMutation = useMutation({
    // Route through supabaseWrite so a flaky network during approval/reject
    // doesn't drop the GC's decision. The queue replays it on reconnect.
    mutationFn: async (args: {
      id: string;
      status: 'approved' | 'rejected' | 'paid';
      notesFromGc?: string;
      /** Reconciliation detail — the payment the GC made ELSEWHERE (MAGE never
       *  moves money). Only sent when provided, so approve/reject are
       *  byte-identical to before. */
      payment?: { method?: string; reference?: string; paidOn?: string };
      /** Adding detail to an already-paid invoice. Suppresses the paid_at
       *  stamp — re-stamping it would overwrite when the payment was
       *  originally recorded with "whenever the GC got around to typing the
       *  check number", corrupting the audit trail. */
      reconcileOnly?: boolean;
    }) => {
      const patch: Record<string, unknown> = {
        id: args.id,
        status: args.status,
      };
      if (args.notesFromGc != null) patch.notes_from_gc = args.notesFromGc;
      if (args.status === 'paid') {
        if (!args.reconcileOnly) patch.paid_at = new Date().toISOString();
      } else {
        patch.reviewed_at = new Date().toISOString();
      }
      if (args.payment) {
        // Empty strings would satisfy the NOT NULL-less column but read as
        // "recorded" — normalize blanks to null so they stay honestly missing.
        const norm = (v?: string) => {
          const s = v?.trim();
          return s ? s : null;
        };
        patch.payment_method = norm(args.payment.method);
        patch.payment_reference = norm(args.payment.reference);
        patch.paid_on = norm(args.payment.paidOn);
      }
      await supabaseWrite('sub_submitted_invoices', 'update', patch);
      return args;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
      // The recompute_commitment_paid_to_date trigger updates the linked
      // commitment row server-side. Refetch commitments so the UI's
      // paid-to-date / overpayment math reflects the change without a
      // page reload. Wildcard userId — the listing's queryKey is
      // ['commitments', userId] but we don't have userId here.
      void queryClient.invalidateQueries({ queryKey: ['commitments'] });
    },
  });

  const approve = useCallback(
    (id: string, notes?: string) => reviewMutation.mutate({ id, status: 'approved', notesFromGc: notes }),
    [reviewMutation],
  );
  const reject = useCallback(
    (id: string, notes?: string) => reviewMutation.mutate({ id, status: 'rejected', notesFromGc: notes }),
    [reviewMutation],
  );
  /** Record a payment made outside MAGE. `payment` carries the check/ACH detail
   *  that lets this reconcile against a bank statement; omitting it still works
   *  (the invoice reads as 'unreconciled' until detail is added). */
  const markPaid = useCallback(
    (id: string, payment?: { method?: string; reference?: string; paidOn?: string }) =>
      reviewMutation.mutate({ id, status: 'paid', payment }),
    [reviewMutation],
  );

  /** Add or correct payment detail on an ALREADY-paid invoice — the path for
   *  the legacy rows that were marked paid before reconciliation existed. */
  const reconcile = useCallback(
    (id: string, payment: { method?: string; reference?: string; paidOn?: string }) =>
      reviewMutation.mutate({ id, status: 'paid', payment, reconcileOnly: true }),
    [reviewMutation],
  );

  useEffect(() => {
    if (!enabled) return;
    const filter = subPortalId
      ? `sub_portal_id=eq.${subPortalId}`
      : projectId
        ? `project_id=eq.${projectId}`
        : null;
    if (!filter) return;
    const channelName = `sub-invoices-${subPortalId ?? projectId}`;
    const existing = supabase.getChannels().find(c => c.topic === `realtime:${channelName}`);
    if (existing) return;

    const channel = supabase.channel(channelName);
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'sub_submitted_invoices', filter },
      () => {
        void queryClient.invalidateQueries({ queryKey });
        // Same rationale as the mutation onSuccess: trigger updated
        // commitments server-side, refetch on the client.
        void queryClient.invalidateQueries({ queryKey: ['commitments'] });
      },
    );
    channel.subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [enabled, projectId, subPortalId, queryClient, queryKey]);

  const all = query.data ?? [];
  return {
    invoices: all,
    pending: all.filter(i => i.status === 'submitted'),
    approved: all.filter(i => i.status === 'approved'),
    paid: all.filter(i => i.status === 'paid'),
    rejected: all.filter(i => i.status === 'rejected'),
    isLoading: query.isLoading,
    refetch: query.refetch,
    approve,
    reject,
    markPaid,
    reconcile,
    isResponding: reviewMutation.isPending,
  };
}

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { supabaseWrite } from '@/utils/offlineQueue';
import type { SubSubmittedInvoice, SubSubmittedInvoiceLine } from '@/types';

// Fetches sub-submitted invoices for a project (or for a single sub portal
// when subPortalId is provided). RLS scopes to portals owned by the GC.
//
// `companyWide: true` reads every sub invoice the signed-in GC can see — for
// the cash-flow forecast (utils/cashFlowEngine.buildSubBillOutflows), which
// needs approved-but-unpaid bills across all jobs. No client-side scope is
// needed for that: the table's only SELECT policy, "gc reads sub invoices for
// own portals" (supabase/schema.sql), admits a row only when its
// sub_portal_links row belongs to auth.uid().

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

/** Query-key prefix of the company-wide read, so a review on any screen can
 *  refresh the forecast's copy too. */
const COMPANY_WIDE_KEY = ['subSubmittedInvoices', 'companyWide'] as const;
/** One empty list, so a consumer's useMemo deps stay stable before data lands. */
const NO_SUB_INVOICES: SubSubmittedInvoice[] = [];

/**
 * Every sub invoice the signed-in GC can see (RLS-scoped), or NULL when the
 * read failed — never [] on failure: "no sub bills" and "could not check" are
 * different facts, and the cash forecast says which one it has. With Supabase
 * not configured there is no server and so no sub invoice can exist: [].
 * For async callers outside React (the Morning Brief, the AI fact blocks).
 */
export async function fetchCompanySubInvoices(): Promise<SubSubmittedInvoice[] | null> {
  if (!isSupabaseConfigured) return [];
  try {
    const { data, error } = await supabase
      .from('sub_submitted_invoices')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      console.log('[useSubSubmittedInvoices] company-wide fetch failed:', error.message);
      return null;
    }
    return ((data ?? []) as Row[]).map(rowToInvoice);
  } catch (e) {
    console.log('[useSubSubmittedInvoices] company-wide fetch threw:', e);
    return null;
  }
}

export function useSubSubmittedInvoices(opts: { projectId?: string; subPortalId?: string; companyWide?: boolean }) {
  const { projectId, subPortalId } = opts;
  // A scoped read wins if a caller passes both.
  const companyWide = !!opts.companyWide && !projectId && !subPortalId;
  const queryClient = useQueryClient();

  const enabled = isSupabaseConfigured && (!!projectId || !!subPortalId || companyWide);
  const queryKey = companyWide
    ? [...COMPANY_WIDE_KEY]
    : ['subSubmittedInvoices', projectId ?? null, subPortalId ?? null];

  const query = useQuery({
    queryKey,
    enabled,
    queryFn: async (): Promise<SubSubmittedInvoice[]> => {
      if (companyWide) {
        // Throw on failure so the query reports an error instead of a
        // successful empty list — see `subBillsChecked` below.
        const rows = await fetchCompanySubInvoices();
        if (rows === null) throw new Error('sub invoices could not be read');
        return rows;
      }
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
    // The company-wide read backs the always-mounted Summary tab: poll it
    // every 5 min, not every 60 s. A review anywhere invalidates it at once.
    refetchInterval: companyWide ? 300_000 : 60_000,
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
      // The cash forecast's company-wide copy: an approval here is a check due
      // now there.
      void queryClient.invalidateQueries({ queryKey: [...COMPANY_WIDE_KEY] });
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

  const all = query.data ?? NO_SUB_INVOICES;
  // True only when the list is a real answer: the read succeeded, or there is
  // no server at all (no sub invoice can exist). While loading, or when no read
  // has EVER succeeded, it is false, and the cash forecast says sub bills were
  // not checked rather than treating the gap as $0. A failed BACKGROUND refetch
  // (isRefetchError: error status with data from an earlier success) keeps the
  // last successful list, so a jobsite signal drop does not blank the tile.
  const subBillsChecked = !isSupabaseConfigured || query.isSuccess || query.isRefetchError;
  return {
    invoices: all,
    subBillsChecked,
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

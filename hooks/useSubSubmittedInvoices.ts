import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
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
    mutationFn: async (args: {
      id: string;
      status: 'approved' | 'rejected' | 'paid';
      notesFromGc?: string;
    }) => {
      const patch: Record<string, unknown> = {
        status: args.status,
      };
      if (args.notesFromGc != null) patch.notes_from_gc = args.notesFromGc;
      if (args.status === 'paid') patch.paid_at = new Date().toISOString();
      else patch.reviewed_at = new Date().toISOString();
      const { error } = await supabase
        .from('sub_submitted_invoices')
        .update(patch)
        .eq('id', args.id);
      if (error) throw error;
      return args;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
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
  const markPaid = useCallback(
    (id: string) => reviewMutation.mutate({ id, status: 'paid' }),
    [reviewMutation],
  );

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
    isResponding: reviewMutation.isPending,
  };
}

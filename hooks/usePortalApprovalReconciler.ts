import { useEffect, useRef } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useProjects } from '@/contexts/ProjectContext';

// Closes the seam between the static client portal and the GC's app: when
// a client taps Approve / Decline on a change order, a row lands in
// change_order_approvals (handled by the portal HTML POST + RLS). This
// hook watches for unsynced approvals — those without a synced_to_co_at —
// and folds them onto the underlying ChangeOrder record:
//   - status flips to 'approved' or 'rejected'
//   - an audit entry is appended noting who signed + when
//   - the approval row is stamped synced_to_co_at so we don't re-apply.
//
// Mounted once at the root layout so it runs continuously while the GC is
// signed in. The poll cadence (90s) is conservative; the realtime channel
// (added in seam #4) gives instant pickup, this is the durable backstop.

const POLL_INTERVAL_MS = 90_000;

interface ApprovalRow {
  id: string;
  change_order_id: string;
  decision: 'approved' | 'declined';
  signer_name: string | null;
  signer_email: string | null;
  note: string | null;
  created_at: string;
  project_id: string | null;
}

export function usePortalApprovalReconciler(): void {
  const { user } = useAuth();
  const { changeOrders, updateChangeOrder } = useProjects();
  const reconcilingRef = useRef(false);

  useEffect(() => {
    if (!user || !isSupabaseConfigured) return;
    let cancelled = false;

    async function reconcileOnce() {
      if (reconcilingRef.current) return;
      reconcilingRef.current = true;
      try {
        const { data, error } = await supabase
          .from('change_order_approvals')
          .select('id, change_order_id, decision, signer_name, signer_email, note, created_at, project_id')
          .is('synced_to_co_at', null)
          .order('created_at', { ascending: true })
          .limit(50);
        if (cancelled || error || !data || data.length === 0) return;

        for (const row of data as ApprovalRow[]) {
          const co = changeOrders.find(c => c.id === row.change_order_id);
          if (!co) continue;
          // Only reconcile if the local status is something we'd flip
          // from. If the GC already changed it (e.g. revoked), don't
          // clobber that — but still mark the approval synced so we
          // don't keep retrying.
          const wantedStatus = row.decision === 'approved' ? 'approved' : 'rejected';
          if (co.status !== wantedStatus) {
            const auditEntry = {
              id: `audit-portal-${row.id.slice(0, 8)}`,
              action: row.decision === 'approved' ? 'approved_via_portal' : 'declined_via_portal',
              actor: row.signer_name || row.signer_email || 'client',
              timestamp: row.created_at,
              detail: row.note ? `Note: ${row.note}` : undefined,
            };
            const auditTrail = [...(co.auditTrail ?? []), auditEntry];
            updateChangeOrder(co.id, { status: wantedStatus, auditTrail });
          }
          // Mark synced regardless of whether we patched (idempotent).
          await supabase
            .from('change_order_approvals')
            .update({ synced_to_co_at: new Date().toISOString() })
            .eq('id', row.id);
        }
      } catch (err) {
        console.log('[usePortalApprovalReconciler] reconcile failed', err);
      } finally {
        reconcilingRef.current = false;
      }
    }

    void reconcileOnce();
    const interval = setInterval(reconcileOnce, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [user, changeOrders, updateChangeOrder]);
}

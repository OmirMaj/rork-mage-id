import { useEffect, useRef } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useProjects } from '@/contexts/ProjectContext';
import type { COAuditEntry } from '@/types';

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
//
// The stamp above is the part that used to be a lie. It was a fire-and-forget
// `.update()` against a table that had RLS enabled and NO UPDATE policy, so
// every write was default-denied. PostgREST answers a zero-row UPDATE with 200
// and no error, so the await resolved, nothing was logged, and synced_to_co_at
// was never written for any row on any account. Because the query below is
// `.is('synced_to_co_at', null).order(created_at asc).limit(50)`, the same 50
// oldest approvals occupied the window permanently: past a contractor's 50th
// lifetime portal decision, nothing new was ever reconciled — the client signed
// the change order, the money was committed, and the CO stayed 'pending' in the
// app forever. Two changes stop that recurring silently: the policy in
// supabase/migrations/20260902140000_co_approval_update_policy.sql, and
// stampSynced() below asserting on the returned row count instead of trusting
// a 200.

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

// The audit entry id doubles as the idempotence key for an approval row, so it
// has to be derived from the row and nothing else. Kept as a named helper so
// the writer and the "have we already applied this?" reader cannot drift.
function portalAuditEntryId(approvalId: string): string {
  return `audit-portal-${approvalId.slice(0, 8)}`;
}

// `.select('id')` is load-bearing, not decoration. Without a returning clause
// PostgREST cannot tell us how many rows it touched, which makes an RLS-denied
// UPDATE indistinguishable from a successful one — that is precisely how this
// stalled unnoticed. Returns whether the stamp actually landed.
async function stampSynced(approvalId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('change_order_approvals')
    .update({ synced_to_co_at: new Date().toISOString() })
    .eq('id', approvalId)
    .select('id');
  if (error) {
    console.log('[usePortalApprovalReconciler] stamp failed', approvalId, error.message);
    return false;
  }
  if (!data || data.length === 0) {
    // Zero rows with no error means RLS refused the write. Loud, because the
    // consequence is a jammed 50-row window and change orders that never leave
    // 'pending'.
    console.log('[usePortalApprovalReconciler] stamp matched 0 rows (RLS denied?)', approvalId);
    return false;
  }
  return true;
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

        // updateChangeOrder replaces auditTrail wholesale and `changeOrders` is
        // a stale closure for the rest of this pass, so two approvals for the
        // same CO in one batch used to build the second trail from the pre-flip
        // array and silently drop the first entry. Carry the merged trail
        // forward instead.
        const pendingTrails = new Map<string, COAuditEntry[]>();

        for (const row of data as ApprovalRow[]) {
          const co = changeOrders.find(c => c.id === row.change_order_id);
          if (!co) continue;
          const trail = pendingTrails.get(co.id) ?? co.auditTrail ?? [];
          const auditEntryId = portalAuditEntryId(row.id);
          // Idempotence key, derived from the approval row rather than from the
          // stamp, so it still holds when the stamp fails or the device is
          // offline and the row comes back on the next poll. Without it a GC
          // who deliberately reverted a client-approved CO (the client phoned
          // and changed their mind) had it re-flipped to 'approved' within 90
          // seconds with another copy of the same audit entry appended each
          // time, and could not undo a portal approval at all.
          const alreadyApplied = trail.some(e => e.id === auditEntryId);
          // Only reconcile if the local status is something we'd flip from. If
          // the GC already changed it (e.g. revoked), don't clobber that — but
          // still stamp the approval so we don't keep retrying.
          const wantedStatus = row.decision === 'approved' ? 'approved' : 'rejected';
          if (!alreadyApplied && co.status !== wantedStatus) {
            const auditEntry: COAuditEntry = {
              id: auditEntryId,
              action: row.decision === 'approved' ? 'approved_via_portal' : 'declined_via_portal',
              actor: row.signer_name || row.signer_email || 'client',
              timestamp: row.created_at,
              detail: row.note ? `Note: ${row.note}` : undefined,
            };
            const auditTrail = [...trail, auditEntry];
            pendingTrails.set(co.id, auditTrail);
            updateChangeOrder(co.id, { status: wantedStatus, auditTrail });
          }
          // Mark synced regardless of whether we patched (idempotent). A false
          // return means the row will come back next poll; the audit-entry
          // check above is what keeps that retry from re-applying anything.
          await stampSynced(row.id);
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

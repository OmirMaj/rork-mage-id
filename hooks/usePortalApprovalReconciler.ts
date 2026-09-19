import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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

/**
 * Merge the server's audit trail with this device's, by entry id (#40).
 * Server entries first, in their order — the sealed e-signature entry the
 * portal RPC appended lives only there — then any local entry the server has
 * not got yet. Before this, the reconciler built the trail from the stale
 * LOCAL copy and updateChangeOrder wrote the whole column back, so the client's
 * sealed signature entry was deleted within 90 seconds of them signing.
 * Pure; scripts/validate-client-portal-lane.ts lifts and runs it.
 */
export function mergeAuditTrails(server: COAuditEntry[], local: COAuditEntry[]): COAuditEntry[] {
  const out: COAuditEntry[] = [];
  const seen = new Set<string>();
  for (const e of [...server, ...local]) {
    if (!e || typeof e.id !== 'string' || seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
  }
  return out;
}

/**
 * What one approval row does to its change order. Pure; the validator runs it.
 *
 *  - ONE key says "this row has been folded in": our entry, audit-portal-<id8>.
 *    It is written on the FIRST pass for the row, whatever the CO's status —
 *    so a GC who reverted a client-approved CO is not re-flipped 90 s later,
 *    and a client's decline reason reaches the CO even when he had already
 *    marked it rejected himself (#125: that case used to write nothing).
 *  - The SEALED entry the signed RPC appended (id === the approval row's id)
 *    already records the client's decision, signer and record hash. Beside it,
 *    our entry records only what the app did — "status set" / "already" — not
 *    a second copy of the decision (#40).
 *  - Status flips only on that first pass, and only if it differs.
 */
export function planPortalApproval(
  row: { id: string; decision: 'approved' | 'declined'; signer_name: string | null; signer_email: string | null; note: string | null; created_at: string },
  coStatus: string | undefined,
  trail: COAuditEntry[],
): { entry: COAuditEntry | null; status: 'approved' | 'rejected' | null } {
  // The idempotence key, derived from the approval row and nothing else.
  const key = `audit-portal-${row.id.slice(0, 8)}`;
  const alreadyApplied = trail.some(e => e.id === key);
  if (alreadyApplied) return { entry: null, status: null };
  const wanted = row.decision === 'approved' ? 'approved' : 'rejected';
  const flips = coStatus !== wanted;
  const sealed = trail.some(e => e.id === row.id);
  const actor = row.signer_name || row.signer_email || 'client';
  const statusWord = wanted === 'approved' ? 'Approved' : 'Rejected';
  const entry: COAuditEntry = sealed
    ? {
        id: key,
        action: 'portal_decision_applied',
        actor: 'MAGE ID',
        timestamp: row.created_at,
        detail: flips
          ? `Status set to ${statusWord} from the client's signed portal decision.`
          : `Client's signed portal decision recorded; status was already ${statusWord}.`,
      }
    : {
        id: key,
        action: row.decision === 'approved' ? 'approved_via_portal' : 'declined_via_portal',
        actor,
        timestamp: row.created_at,
        detail: row.note ? `Note: ${row.note}` : undefined,
      };
  return { entry, status: flips ? wanted : null };
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
  const queryClient = useQueryClient();
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

        // `changeOrders` is a stale closure for the rest of this pass, so the
        // trail each CO ends the pass with is carried forward here — two
        // approvals for one CO in a batch must not build the second from the
        // pre-pass copy.
        const pendingTrails = new Map<string, COAuditEntry[]>();
        const pendingStatus = new Map<string, string | undefined>();
        let touched = false;

        for (const row of data as ApprovalRow[]) {
          // OWNERSHIP (2026-09-13). `changeOrders` is the TENANT-WIDE list, so
          // matching on change_order_id alone flipped a CO on the strength of
          // an approval recorded against a DIFFERENT project. `project_id` is
          // nullable for historical rows: null is tolerated, a MISMATCH is not.
          // (Migration 20260919030000 also refuses the foreign id server-side.)
          const co = changeOrders.find(c =>
            c.id === row.change_order_id
            && (!row.project_id || c.projectId === row.project_id));
          if (!co) continue;

          // #40: read the CO's trail from the SERVER before
          // writing. The signed RPC appends its sealed entry there and nowhere
          // else; building from the local copy erased it. A failed read skips
          // the row WITHOUT stamping it, so the next poll retries.
          let trail = pendingTrails.get(co.id);
          let status = pendingStatus.get(co.id);
          if (!trail) {
            const { data: fresh, error: freshErr } = await supabase
              .from('change_orders')
              .select('audit_trail')
              .eq('id', co.id)
              .maybeSingle();
            if (cancelled) return;
            if (freshErr || !fresh) {
              console.log('[usePortalApprovalReconciler] fresh CO read failed; retrying next poll', co.id, freshErr?.message);
              continue;
            }
            const serverTrail = Array.isArray(fresh.audit_trail) ? (fresh.audit_trail as COAuditEntry[]) : [];
            trail = mergeAuditTrails(serverTrail, co.auditTrail ?? []);
            // Status stays the APP's: an edit he made a moment ago may still
            // be in the offline queue, and the server would not know it yet.
            status = co.status;
          }

          const plan = planPortalApproval(row, status, trail);
          if (plan.entry) {
            const auditTrail = [...trail, plan.entry];
            pendingTrails.set(co.id, auditTrail);
            if (plan.status) pendingStatus.set(co.id, plan.status);
            else pendingStatus.set(co.id, status);
            touched = true;
            // deferReflow: this loop runs from the root, often while he is
            // editing the job in Schedule Pro. A client's approval must not
            // rewrite the schedule behind that screen, and the CO screen
            // promises nothing moves until he applies it (#37). The CO gets
            // the "place these days" marker; the project screen places them.
            const wantedStatus = plan.status;
            if (wantedStatus) updateChangeOrder(co.id, { status: wantedStatus, auditTrail }, { deferReflow: true });
            else updateChangeOrder(co.id, { auditTrail }, { deferReflow: true });
          } else {
            pendingTrails.set(co.id, trail);
            pendingStatus.set(co.id, status);
          }
          // Mark synced (idempotent). A false return means the row comes back
          // next poll; the audit-portal key above keeps that retry a no-op.
          await stampSynced(row.id);
        }
        // Pull the server's copy (the sealed entries, the status) into the
        // app's list — the realtime listener only refetches on status.
        if (touched) void queryClient.invalidateQueries({ queryKey: ['changeOrders'] });
      } catch (err) {
        console.log('[usePortalApprovalReconciler] reconcile failed', err);
      } finally {
        reconcilingRef.current = false;
      }
    }

    void reconcileOnce();
    const interval = setInterval(reconcileOnce, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [user, changeOrders, updateChangeOrder, queryClient]);
}

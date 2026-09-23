import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useProjects } from '@/contexts/ProjectContext';
import type { COApprover, COAuditEntry } from '@/types';

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
 *  - CONFLICT (#71 / #132, wave 4). The portal RPCs no longer write
 *    change_orders.status — this hook flips it, because that flip is what runs
 *    the "place these days" marker, its notification and fireGradingEvent in
 *    ProjectContext.updateChangeOrder. So this is also the last place a second
 *    answer for the SAME send can be caught: a sealed client_signed_via_portal /
 *    client_declined_via_portal entry whose id is ANOTHER approval row's, or our
 *    own key from another row, dated at or after the CO's current send
 *    (co.sentAt — the GC device's clock, the same compromise the server's
 *    legacy fallback makes). Then we write 'portal_decision_conflict', change
 *    no status, and say so in the trail the CO screen shows. A row whose own
 *    sealed entry is in the trail is not a conflict, and an answer to an
 *    EARLIER send (a CO revised and re-sent) is not one either. WHAT IT GIVES
 *    UP: with no sentAt on this device every earlier answer counts as current,
 *    so a re-sent CO's second decision waits for the GC instead of flipping.
 *  - #72: the pending Client approver is stamped in the same patch (status,
 *    name = signer, responseDate = the row's created_at, the decline note as
 *    rejectionReason), so client-view's "Approved by" banner and aiaBilling's
 *    approval date read the client's answer instead of 'pending'.
 */
export function planPortalApproval(
  row: { id: string; decision: 'approved' | 'declined'; signer_name: string | null; signer_email: string | null; note: string | null; created_at: string },
  coStatus: string | undefined,
  trail: COAuditEntry[],
  co?: { approvers?: COApprover[]; sentAt?: string },
): { entry: COAuditEntry | null; status: 'approved' | 'rejected' | null; approvers: COApprover[] | null } {
  // The idempotence key, derived from the approval row and nothing else.
  const key = `audit-portal-${row.id.slice(0, 8)}`;
  const alreadyApplied = trail.some(e => e.id === key);
  if (alreadyApplied) return { entry: null, status: null, approvers: null };
  const wanted = row.decision === 'approved' ? 'approved' : 'rejected';
  const sealed = trail.some(e => e.id === row.id);
  const actor = row.signer_name || row.signer_email || 'client';
  const statusWord = wanted === 'approved' ? 'Approved' : 'Rejected';

  // Another row's answer to the CURRENT send. Our own keys share the
  // 'audit-portal-' prefix; the sealed entries carry the other row's id.
  const sentMs = co?.sentAt ? Date.parse(co.sentAt) : NaN;
  const ownKeyPrefix = key.slice(0, 'audit-portal-'.length);
  const other = trail.find((e) => {
    if (!e || e.id === row.id || e.id === key) return false;
    const isSealed = e.action === 'client_signed_via_portal' || e.action === 'client_declined_via_portal';
    const isOurs = typeof e.id === 'string' && e.id.startsWith(ownKeyPrefix)
      && (e.action === 'portal_decision_applied' || e.action === 'approved_via_portal' || e.action === 'declined_via_portal');
    if (!isSealed && !isOurs) return false;
    const at = Date.parse(e.timestamp);
    // Unknown on either side: treat it as this send's (never flip on a doubt).
    if (Number.isFinite(sentMs) && Number.isFinite(at) && at < sentMs) return false;
    return true;
  });
  if (other) {
    const otherWord = other.action === 'client_declined_via_portal' || other.action === 'declined_via_portal'
      || /Status set to Rejected|already Rejected/.test(other.detail ?? '')
      ? 'declined' : 'approved';
    return {
      entry: {
        id: key,
        action: 'portal_decision_conflict',
        actor: 'MAGE ID',
        timestamp: row.created_at,
        detail: `Your client's portal recorded a second answer for this change order: ${row.decision} by ${actor}, `
          + `after it was already ${otherWord}${other.actor && other.actor !== 'MAGE ID' ? ` by ${other.actor}` : ''}. `
          + `Status left as ${coStatus || 'it was'} — confirm with your client before changing it.`,
      },
      status: null,
      approvers: null,
    };
  }

  const flips = coStatus !== wanted;
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

  // #72: the Client approver still waiting on this answer.
  const list = Array.isArray(co?.approvers) ? co!.approvers! : [];
  const at = list.findIndex(a => a && a.role === 'Client' && a.status === 'pending');
  const approvers = at < 0 ? null : list.map((a, i): COApprover => (i !== at ? a : {
    ...a,
    status: wanted,
    name: row.signer_name || row.signer_email || a.name,
    responseDate: row.created_at,
    ...(wanted === 'rejected' && row.note ? { rejectionReason: row.note } : {}),
  }));
  return { entry, status: flips ? wanted : null, approvers };
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
        const pendingApprovers = new Map<string, COApprover[]>();
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

          const plan = planPortalApproval(row, status, trail, {
            approvers: pendingApprovers.get(co.id) ?? co.approvers,
            sentAt: co.portalState?.sentAt,
          });
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
            // #72: the Client approver rides in the SAME patch (one queued
            // write), never a second update that could land without the other.
            const approvers = plan.approvers;
            if (approvers) pendingApprovers.set(co.id, approvers);
            if (wantedStatus && approvers) updateChangeOrder(co.id, { status: wantedStatus, auditTrail, approvers }, { deferReflow: true });
            else if (wantedStatus) updateChangeOrder(co.id, { status: wantedStatus, auditTrail }, { deferReflow: true });
            else if (approvers) updateChangeOrder(co.id, { auditTrail, approvers }, { deferReflow: true });
            else updateChangeOrder(co.id, { auditTrail }, { deferReflow: true });
            if (plan.entry.action === 'portal_decision_conflict') {
              // Loud in the log as well as in the trail the CO screen shows.
              console.warn('[usePortalApprovalReconciler] conflicting portal decision left for the GC', co.id, row.id);
            }
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

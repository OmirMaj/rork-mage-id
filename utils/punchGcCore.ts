// punchGcCore.ts — the GC side of the punch list, as pure rules (wave 4,
// lane punch-gc). app/punch-list.tsx and app/punch-walk.tsx call these;
// scripts/validate-w4-punch-gc-fixes.ts runs them without a device.
//
// Four rules live here because each one used to be an inline expression that
// was wrong in exactly one of its call sites:
//   1. punchStatusPatch — what a status move writes. A move OUT of Ready for
//      Review back to Open / In progress is a REJECT and must stamp rejectedAt
//      (CONTRACT 12): the punch_items_guard trigger (20260920120000) neutralises
//      any un-review that does not carry a later rejected_at, so a GC who sent
//      an item back from the status picker or the bulk bar — not only the
//      Reject modal — would watch it snap back to Review after the refetch.
//   2. punchGateAnswer — who gets into the screen (#127). A free-plan foreman
//      invited to the GC's job was shown a Business paywall from Tools / the
//      sidebar (no projectId) and while his role read was still in flight.
//   3. punchLocationText — '' is "no room given", and so is the legacy
//      'Unspecified' placeholder punch-walk used to SAVE (#56). The words are
//      chosen at render time; a placeholder saved into the data spread to the
//      export, the filters and the sub's portal as if it were a room.
//   4. punchFocusFor — where a "ready for review" notification lands (#51/#54):
//      the list the item is on, filtered to its status.

import type { Project, PunchItem, PunchItemStatus, PunchListType } from '@/types';
import { punchListTypeOf } from '@/types';
import { collaboratorMayAccess } from '@/utils/collaboratorAccess';
import type { ProjectRole } from '@/utils/projectRole';

/** The Reject modal's default. The sub portal reads exactly this text as
 *  "no reason given" (marketing/sub-portal GENERIC_REJECT_RE), so a send-back
 *  with no typed reason never prints a made-up one. */
export const PUNCH_REJECT_DEFAULT_NOTE = 'Rejected — needs rework';

/** Shown where an item has no room — never saved. */
export const PUNCH_NO_ROOM_TEXT = 'No room given';

/** A move from Review back to work: the GC is sending the sub's fix back. */
export function isPunchReject(from: PunchItemStatus | undefined, to: PunchItemStatus): boolean {
  return from === 'ready_for_review' && (to === 'open' || to === 'in_progress');
}

/**
 * The patch a status move writes. Always names `status` explicitly (Start,
 * Close and the bulk close are patch-scoped writes of exactly these keys).
 * Closing stamps closedAt. A reject stamps rejectedAt (punchRejectStamp — now,
 * or later than the item's previous reject) and the note — the
 * typed one, or the default the portal reads as "no reason given".
 */
export function punchStatusPatch(
  item: Pick<PunchItem, 'status' | 'rejectedAt'>,
  next: PunchItemStatus,
  nowIso: string,
  note?: string,
): Partial<PunchItem> {
  const patch: Partial<PunchItem> = { status: next };
  if (next === 'closed') patch.closedAt = nowIso;
  if (isPunchReject(item.status, next)) {
    patch.rejectedAt = punchRejectStamp(nowIso, item.rejectedAt);
    patch.rejectionNote = (note ?? '').trim() || PUNCH_REJECT_DEFAULT_NOTE;
  }
  return patch;
}

/**
 * The rejected_at a new reject writes: now, or 1 ms after the item's previous
 * reject when that stamp is later than this device's clock.
 *
 * Integration round 2 (field): punch_items_guard (20260920120000) counts a
 * reject as real only when NEW.rejected_at > OLD.rejected_at. The stamp is
 * this device's clock, so a GC whose phone runs behind the previous reject's
 * stamp (that one made on a laptop running minutes fast) was silently
 * neutralised — his screen said "sent back", the next read put the item back
 * in Review and the note reverted. The schedule stamps guard the same skew
 * (stampFieldEdits: max(now, prev + 1)). An unparseable previous stamp is
 * ignored (now), never a reason to skip the reject.
 */
export function punchRejectStamp(nowIso: string, prevIso: string | null | undefined): string {
  const now = Date.parse(nowIso);
  const prev = prevIso ? Date.parse(prevIso) : NaN;
  if (!Number.isFinite(prev) || !Number.isFinite(now) || prev < now) return nowIso;
  return new Date(prev + 1).toISOString();
}

/** One stamp for a batch reject: later than every item's previous reject. */
export function latestRejectedAt(items: readonly Pick<PunchItem, 'rejectedAt'>[]): string | undefined {
  let best: string | undefined;
  let bestMs = -Infinity;
  for (const i of items) {
    const ms = i.rejectedAt ? Date.parse(i.rejectedAt) : NaN;
    if (Number.isFinite(ms) && ms > bestMs) { bestMs = ms; best = i.rejectedAt; }
  }
  return best;
}

/**
 * The rejection box on a row. Red (it is the work order) only while the item
 * is back on the sub — Open / In progress. Once he marks it fixed again the old
 * reason is history: shown muted as "Previously returned", never as a live
 * send-back over the sub's new note.
 */
export function punchRejectionBox(item: Pick<PunchItem, 'status' | 'rejectionNote'>): { tone: 'active' | 'history'; text: string } | null {
  const note = (item.rejectionNote ?? '').trim();
  if (!note) return null;
  if (item.status === 'open' || item.status === 'in_progress') return { tone: 'active', text: note };
  return { tone: 'history', text: `Previously returned: ${note}` };
}

/** '' and the legacy 'Unspecified' placeholder are both "no room" — null. */
export function punchLocationText(location: string | null | undefined): string | null {
  const t = (location ?? '').replace(/\s+/g, ' ').trim();
  if (!t || t.toLowerCase() === 'unspecified') return null;
  return t;
}

/** Shared jobs on which his invite opens the punch list (FEATURE_ROLES). */
export function invitedPunchProjects<P extends Pick<Project, 'myRole'>>(projects: readonly P[]): P[] {
  return projects.filter(p => collaboratorMayAccess((p.myRole ?? null) as ProjectRole, 'punch_list_closeout'));
}

export type PunchGateAnswer = 'allow' | 'loading' | 'error' | 'paused' | 'missing' | 'paywall';

/**
 * #127, the same contract as Safety and RFIs:
 *  - no project: his own tier, or an accepted collaborator seat on any cached
 *    job (the picker is then limited to those jobs);
 *  - a project: his own tier or the collaborator grant; while the grant is
 *    still being read he waits (loading), a failed read offers retry (error),
 *    offline with no role on the phone says why (paused), a settled null role
 *    is "not on this job" (missing). The paywall only when his own plan is the
 *    real answer.
 */
export function punchGateAnswer(i: {
  projectId: string | undefined;
  ownTier: boolean;
  projectAllowed: boolean;
  invitedCount: number;
  role: ProjectRole;
  isLoading: boolean;
  isError: boolean;
  isPaused: boolean;
  reason?: string | null;
}): PunchGateAnswer {
  if (!i.projectId) return i.ownTier || i.invitedCount > 0 ? 'allow' : 'paywall';
  if (i.ownTier || i.projectAllowed) return 'allow';
  if (i.isLoading) return 'loading';
  if (i.isError) return 'error';
  if (i.isPaused && i.role === null && i.reason) return 'paused';
  if (i.role === null) return 'missing';
  return 'paywall';
}

/** Where a notification about `item` lands: its own list, filtered to its
 *  status (Review for a freshly marked item). Null when the item is not here. */
export function punchFocusFor(item: PunchItem | undefined): { list: PunchListType; status: PunchItemStatus } | null {
  if (!item) return null;
  return { list: punchListTypeOf(item), status: item.status };
}

/**
 * The ONE punch query the screen's list is fed from: ProjectContext keys it
 * `['punchItems', user?.id ?? null]` (its `userId`), so this must stay the same
 * expression. WHY exact and not the `['punchItems']` prefix: at launch the
 * provider renders before auth resolves, so a `['punchItems', null]` query
 * loads the phone copy and then sits in the cache, inactive, for gcTime (5
 * min). An invalidate never refetches an inactive query, so that entry keeps
 * the launch-time status — and a prefix-wide lookup met it BEFORE the signed-in
 * user's fresh entry and focused on Open while the item was Ready for Review
 * (review round 2, reproduced on the real tree). Reading, refetching and
 * pause-checking only this key makes a stale sibling entry unreachable.
 */
export function punchItemsQueryKey(userId: string | null | undefined): readonly ['punchItems', string | null] {
  return ['punchItems', userId ?? null] as const;
}

/**
 * The focused item exactly as the finished re-read left it: pass
 * `queryClient.getQueryData(punchItemsQueryKey(user?.id))` — ONE query's data,
 * never a scan of several (see punchItemsQueryKey for the stale-sibling bug a
 * scan had).
 *
 * WHY the cache and not the screen's list: ProjectContext copies the query
 * into its own state in an effect, one render AFTER the query settles — and
 * the invalidate promise the screen waits on resolves before that copy lands
 * (verified against @tanstack/query-core 5.99). Choosing the status filter
 * from the screen's list at that moment picked the launch-time status (Open),
 * and when the copy caught up the item — now Ready for Review — dropped out of
 * the very filter chosen to show it. The cache already holds what the list
 * WILL show.
 *
 * `known` is false when the query has no data (nothing to trust — use the
 * phone's copy). An item from another job counts as not here.
 */
export function punchItemFromQueryCache(
  data: unknown,
  id: string,
  projectId: string,
): { known: boolean; item?: PunchItem } {
  if (!Array.isArray(data)) return { known: false };
  const hit = (data as PunchItem[]).find(p => p && p.id === id);
  return { known: true, item: hit && hit.projectId === projectId ? hit : undefined };
}

/** What the focus last did: from which copy, and the list/filter it chose. */
export type PunchFocusApplied =
  | { from: 'phone' | 'fresh'; list: PunchListType; status: PunchItemStatus }
  | { from: 'phone' | 'fresh'; missing: true }
  | null;

export type PunchFocusStep =
  | { kind: 'none' }
  /** He moved the list or filter himself after the phone-copy focus: the
   *  fresh read settles the focus without yanking his view back. */
  | { kind: 'settle' }
  | { kind: 'missing'; from: 'phone' | 'fresh' }
  | { kind: 'apply'; from: 'phone' | 'fresh'; list: PunchListType; status: PunchItemStatus; itemId: string };

/**
 * The notification focus as a step function (#51/#54). At most two steps:
 *  - offline (the re-read is paused): focus on the phone's copy, said as such;
 *  - done (the re-read settled): focus on the FRESH item from the query cache,
 *    re-aiming a phone-copy focus — unless he has since changed the list or
 *    the status filter by hand, which is his answer and is left alone.
 * Nothing is chosen while the re-read is still in flight.
 */
export function punchFocusStep(i: {
  phase: 'idle' | 'refreshing' | 'offline' | 'done';
  loaded: boolean;
  applied: PunchFocusApplied;
  view: { list: PunchListType; status: PunchItemStatus | 'all' };
  fresh: { known: boolean; item?: PunchItem } | null;
  phoneItem: PunchItem | undefined;
}): PunchFocusStep {
  if (!i.loaded || i.phase === 'idle' || i.phase === 'refreshing') return { kind: 'none' };
  const from = i.phase === 'done' ? 'fresh' : 'phone';
  if (i.applied?.from === 'fresh') return { kind: 'none' };
  if (i.applied && from === 'phone') return { kind: 'none' };
  if (i.applied && 'list' in i.applied
      && (i.view.list !== i.applied.list || i.view.status !== i.applied.status)) {
    return { kind: 'settle' };
  }
  const item = from === 'fresh' && i.fresh?.known ? i.fresh.item : i.phoneItem;
  const plan = punchFocusFor(item);
  if (!plan || !item) return { kind: 'missing', from };
  return { kind: 'apply', from, list: plan.list, status: plan.status, itemId: item.id };
}

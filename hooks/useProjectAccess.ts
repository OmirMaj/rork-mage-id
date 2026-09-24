// useProjectAccess — canAccess(), but for a screen scoped to ONE project.
//
// Use this instead of useTierAccess on any screen that operates on a single
// project's data. It answers the same question, plus: "…or was this person
// invited to this project to do exactly this?"
//
// Without it, an invited teammate hits a paywall on the work they were invited
// to do, because tier resolves purely from their OWN subscription — see the
// header of utils/collaboratorAccess for the full failure.
//
// Financial blinding for the 'field' role is a separate axis and still applies
// on top (utils/roleBlinding): this decides whether the screen opens, that
// decides whether money shows on it.
//
// The tutorial practice pass is deliberately NOT ORed in here. It used to be,
// and that opened EVERY screen gated on punch_list_closeout or
// change_orders_invoicing on the sample — /change-order, /field-ticket,
// /ai-punch, … — several of which load a record by id from ANY project, so a
// sample projectId plus a REAL coId / ticketId opened the real job in the paid
// editor (integration review, round 2). The pass is opt-in instead: only the
// tutorial's own screens (punch-walk, invoice, the hub's tile locks) read
// useTutorialPractice, each of which writes only to the project it gated on.
// validate-tutorial-field-screens pins that allowlist.

import { useCallback } from 'react';
import { useTierAccess } from '@/hooks/useTierAccess';
import { useProjectRole } from '@/hooks/useProjectRole';
import { resolveProjectAccess } from '@/utils/collaboratorAccess';

export function useProjectAccess(projectId: string | undefined) {
  const { tier, canAccess, requiredTierFor } = useTierAccess();
  const role = useProjectRole(projectId);

  /** Tier access OR the collaborator grant for this project. */
  const canAccessProject = useCallback(
    (feature: Parameters<typeof canAccess>[0]): boolean =>
      resolveProjectAccess(canAccess(feature), role, feature as string),
    [canAccess, role],
  );

  return { tier, role, canAccess: canAccessProject, canAccessOwnTier: canAccess, requiredTierFor };
}

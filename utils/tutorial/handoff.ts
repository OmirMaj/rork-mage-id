// utils/tutorial/handoff.ts — the finale's 'Now do it on your job' button.
//
// The metric this whole feature is judged on is practised → done for real
// within 7 days, so the finale's primary button goes straight to the same
// screen on his newest REAL job. Tier-aware, because a Free user just
// practised a Business feature through the practice pass: for him the honest
// next step is the plans page (Paywall source 'tutorial_handoff'), right after
// he has felt the feature work — not a real screen that would paywall him.

import type { Project } from '@/types';
import type { FeatureKey, TutorialDef, TutorialDefs, TutorialPathname } from './types';
import { resolveProjectAccess } from '@/utils/collaboratorAccess';
import { newestRealProject } from './sandboxCore';

export type HandoffDestination = 'real_job' | 'create_job' | 'paywall' | 'stripe' | 'chain';

export interface HandoffAction {
  /** tutorial_handoff_clicked {destination}. */
  destination: HandoffDestination;
  label: string;
  route?: { pathname: TutorialPathname; params: Record<string, string> };
  /** destination 'paywall': the feature to show plans for. */
  feature?: FeatureKey;
  paywallSource?: 'tutorial_handoff';
  /** destination 'chain': the tutorial to offer next. */
  tutorialId?: TutorialDef['id'];
}

export interface HandoffCtx {
  projects: readonly Pick<Project, 'id' | 'name' | 'ownerUserId' | 'myRole' | 'createdAt' | 'updatedAt'>[];
  userId: string | null | undefined;
  /** useTierAccess().canAccess — his OWN real plan, never the practice pass.
   *  Per-job access (a field seat on a GC's Business job may punch-walk it
   *  on a Free plan) is resolved here with the same resolveProjectAccess
   *  that hooks/useProjectAccess uses, from each job's role. */
  canAccess: (feature: FeatureKey) => boolean;
  stripeConnected: boolean;
  fieldOnly: boolean;
}

export interface Handoff {
  /** null → the finale shows only Done (a field seat with no job he can reach). */
  primary: HandoffAction | null;
  secondary: HandoffAction | null;
  chain: HandoffAction | null;
}

/** Job names are user text; keep the button to one line. */
export function shortJobName(name: string, max = 24): string {
  const n = name.trim().replace(/\s+/g, ' ');
  return n.length <= max ? n : `${n.slice(0, max - 1).trimEnd()}…`;
}

export function handoffFor(def: TutorialDef, ctx: HandoffCtx, defs?: TutorialDefs): Handoff {
  const h = def.handoff;
  const feature = h.feature;
  const owns = !feature || ctx.canAccess(feature);
  // Pick the JOB first, then ask whether the feature opens on that job: on a
  // job shared with him, access follows the owner's plan (the collaborator
  // grant), so an invited foreman on a Free plan is sent to walk the GC's
  // Business job — not to a paywall for a plan he doesn't need.
  const job = newestRealProject(ctx.projects, ctx.userId, h.roles, (_p, role) =>
    !feature || resolveProjectAccess(owns, role, feature));
  let primary: HandoffAction | null;
  if (job) {
    primary = {
      destination: 'real_job',
      label: h.realJobLabel(shortJobName(job.name)),
      route: { pathname: h.pathname, params: { ...(h.params ?? {}), [h.projectParam]: job.id } },
    };
  } else if (!owns && feature) {
    primary = {
      destination: 'paywall',
      label: h.paywallLabel ?? 'See plans',
      feature,
      paywallSource: 'tutorial_handoff',
    };
  } else {
    primary = ctx.fieldOnly
      // A field seat can't create a job in the GC's account; with no job he
      // can reach, there is no honest 'do it for real' button — only Done,
      // which the finale always has.
      ? null
      : { destination: 'create_job', label: 'Start your first job →', route: { pathname: '/', params: { openCreate: '1' } } };
  }

  const secondary: HandoffAction | null =
    h.offerStripe && owns && !ctx.stripeConnected && !ctx.fieldOnly
      ? { destination: 'stripe', label: 'Connect Stripe so the Pay button takes real money →', route: { pathname: '/payments-setup', params: {} } }
      : null;

  let chain: HandoffAction | null = null;
  if (def.chainNext) {
    const next = defs?.[def.chainNext.tutorialId];
    const allowed = !ctx.fieldOnly || (next ? next.fieldSeatOk : false);
    // A chain only offers a tutorial that exists in this build.
    if (allowed && (defs === undefined || next)) chain = { destination: 'chain', label: def.chainNext.label, tutorialId: def.chainNext.tutorialId };
  }
  return { primary, secondary, chain };
}

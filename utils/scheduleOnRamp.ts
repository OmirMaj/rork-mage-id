/** The ways a user can start a schedule. `estimate`/`interview` are the two
 *  RECOMMENDED heroes; the rest live under "More ways". */
export type OnRampPath =
  | 'estimate' | 'interview' | 'blank' | 'template' | 'voice' | 'example' | 'manual';

export interface OnRampContext {
  /** The active project already has a linkedEstimate to build from. */
  hasEstimate?: boolean;
}

/** Pick the single recommended hero action. Estimate-first (moat-linked, one
 *  tap); otherwise the scaffolded AI interview. Never returns a path that can
 *  dead-end for a fresh user. */
export function recommendedOnRampPath(ctx: OnRampContext): OnRampPath {
  return ctx.hasEstimate ? 'estimate' : 'interview';
}

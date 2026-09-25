// utils/sidebarRail.ts — the desktop sidebar's collapsed rail and the Home-only
// action rail, as pure rules (wave 6c, lane S).
//
// WHY. The founder, on a 1512 x 945 MacBook: "the website app... really isn't
// utilizing the space a computer screen gives you" and "the scheduler does not
// work well". Two shell facts cost him the most width:
//   - the 240 px sidebar stayed full on Schedule Pro and the plan viewer, the
//     two canvases that want every pixel (a Gantt at 1272 px vs 1448 px);
//   - DesktopActionRail (300 px) drew on EVERY tab — Settings, Subs, Discover,
//     the Marketplace — when it only means something on Home.
// So the sidebar collapses to a 64 px icon rail (Cmd+Backslash, remembered per
// KIND of route: canvases default to the rail, everything else to the full
// sidebar), and the action rail is Home-only.
//
// PURE — no react-native, type-only imports. constants/designTokens pulls in
// react-native, so the two widths are literals here with a comment naming
// their Layout source; scripts/validate-shell-6c.ts reads designTokens as TEXT
// and fails if they drift.

/** Layout.sidebar.full (constants/designTokens.ts). */
export const SIDEBAR_FULL = 240; /* Layout.sidebar.full */
/** Layout.sidebar.rail (constants/designTokens.ts). */
export const SIDEBAR_RAIL = 64; /* Layout.sidebar.rail */

/** Per-viewer UI preference; a mageid_ key, so the sign-out sweep clears it. */
export const SIDEBAR_RAIL_KEY = 'mageid_sidebar_rail';

/** Top-level route segments whose sidebar defaults to the 64 px rail. */
export const CANVAS_ROUTES: ReadonlySet<string> = new Set(['schedule-pro', 'plan-viewer']);

/** Collapsed or not, remembered separately for canvases and for everything
 *  else — collapsing it on Schedule Pro must not collapse it on the RFI log. */
export type RailPref = { canvas: boolean; workspace: boolean };

export const DEFAULT_RAIL_PREF: RailPref = { canvas: true, workspace: false };

/** A stored pref. Anything unreadable (bad JSON, the wrong shape, null) is the
 *  default — never a throw, never a half-read pref. */
export function parseRailPref(raw: string | null | undefined): RailPref {
  if (typeof raw !== 'string' || raw.length === 0) return DEFAULT_RAIL_PREF;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== 'object') return DEFAULT_RAIL_PREF;
    const o = v as Record<string, unknown>;
    if (typeof o.canvas !== 'boolean' || typeof o.workspace !== 'boolean') return DEFAULT_RAIL_PREF;
    return { canvas: o.canvas, workspace: o.workspace };
  } catch {
    return DEFAULT_RAIL_PREF;
  }
}

export function isCanvasRoute(top: string | null | undefined): boolean {
  return typeof top === 'string' && CANVAS_ROUTES.has(top);
}

/** Is the sidebar collapsed on this route under this pref? */
export function railCollapsed(top: string | null | undefined, pref: RailPref): boolean {
  return isCanvasRoute(top) ? pref.canvas : pref.workspace;
}

/** The pref after Cmd+Backslash on this route: only the KIND this route
 *  belongs to flips. */
export function toggledPref(top: string | null | undefined, pref: RailPref): RailPref {
  return isCanvasRoute(top)
    ? { canvas: !pref.canvas, workspace: pref.workspace }
    : { canvas: pref.canvas, workspace: !pref.workspace };
}

export function sidebarWidthFor(collapsed: boolean): number {
  return collapsed ? SIDEBAR_RAIL : SIDEBAR_FULL;
}

export function sidebarWidthForRoute(top: string | null | undefined, pref: RailPref): number {
  return sidebarWidthFor(railCollapsed(top, pref));
}

// ─── The Home-only action rail ─────────────────────────────────────────────

/** Below this window width a 300 px rail beside the page does not fit. */
export const ACTION_RAIL_MIN_WIDTH = 1280;

export interface ActionRailInput {
  isDesktop: boolean;
  width: number;
  /** useSegments() of the (tabs) layout: ['(tabs)', '(home)', …]. */
  segments: readonly string[];
  userRole: string | null | undefined;
  /** The shell dock holds content — it takes the right-hand slot. */
  dockOpen: boolean;
}

/**
 * DesktopActionRail shows only on the contractor's Home index, on a desktop
 * window >= 1280, while the shell dock is empty. Not on Settings, Summary,
 * Subs, Discover or the Marketplace (it was the same 300 px on all of them),
 * not on /attention (segments[2] === 'attention' — that page IS the list), and
 * never for a client or a property manager (no GC attention feed).
 */
export function actionRailVisible(i: ActionRailInput): boolean {
  if (!i.isDesktop || !(i.width >= ACTION_RAIL_MIN_WIDTH)) return false;
  if (i.segments[1] !== '(home)') return false;
  if (!(i.segments[2] == null || i.segments[2] === 'index')) return false;
  if (i.userRole === 'client' || i.userRole === 'property_manager') return false;
  return !i.dockOpen;
}

/**
 * The Home tab's badge — THE canonical needs-attention count (useBrainWatch).
 * '!' when the read behind it failed (unknown, not zero), '99+' past 99, the
 * count otherwise, and no badge at 0. Moved verbatim from app/(tabs)/_layout.
 */
export function attentionBadgeLabel(total: number, sourceFailed: boolean): string | undefined {
  return sourceFailed
    ? '!'
    : total > 0
      ? (total > 99 ? '99+' : String(total))
      : undefined;
}

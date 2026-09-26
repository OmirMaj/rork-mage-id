// utils/dashboardColumns.ts — the geometry of the money dashboards' desktop
// layout: a main column beside a 360 px rail (wave 6d, lane B1).
//
// Pure (no react-native) so bun validators can import it. The numbers mirror
// constants/designTokens.ts Layout.column.rail and Layout.gutter; the
// validator (scripts/validate-dashboard-tables.ts) reads designTokens.ts and
// fails if the two drift.
//
// WHY 984. Below 600 px of main column the dashboards' cards and tables stop
// fitting their own content, so the rail drops under the main column instead
// of squeezing it: 600 main + 24 gutter + 360 rail = 984. At 1512 (sidebar
// 240, page padding 16) the column is 1240, so main is 856.

export const DASHBOARD_RAIL = 360; /* Layout.column.rail */
export const DASHBOARD_GUTTER = 24; /* Layout.gutter */
export const DASHBOARD_MAIN_MIN = 600;

/** Does a container this wide hold main | rail side by side? */
export function dashboardColumnsFit(w: number): boolean {
  return Number.isFinite(w) && w >= DASHBOARD_MAIN_MIN + DASHBOARD_GUTTER + DASHBOARD_RAIL;
}

/** The main column's width beside the rail, in a container this wide. */
export function dashboardMainWidth(w: number): number {
  return w - DASHBOARD_GUTTER - DASHBOARD_RAIL;
}

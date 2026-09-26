// utils/plans/planRail.ts — the plan viewer's sheet rail (wave 6d, lane P1).
// Pure; bun-importable.
//
// On desktop web the viewer lists the job's sheets down its left edge and
// ↑ / ↓ flip to the neighbouring sheet, so a PM goes A-101 → A-102 → S-201
// without going Back to the list. The rail shows the CURRENT set — a
// superseded copy only when it is the sheet already open (so the rail still
// marks where he is) — in sheet-number order.

/** Desktop only: is the sheet rail open? A per-viewer convenience. */
export const PLAN_RAIL_OPEN_KEY = 'mageid_plan_rail_open';

/** The stored rail flag; anything but an explicit 'false' reads open. */
export function parseRailOpen(raw: string | null | undefined): boolean {
  return raw !== 'false';
}

export interface RailSheet {
  id: string;
  name: string;
  sheetNumber?: string | null;
  superseded?: boolean;
}

/** The rail's sheets: the live set plus the open sheet if it is superseded,
 *  numbered sheets in natural order (A-2 before A-10), then by name;
 *  unnumbered sheets last. */
export function railSheets<T extends RailSheet>(projectSheets: readonly T[], activeId: string): T[] {
  const list = projectSheets.filter((s) => !s.superseded || s.id === activeId);
  const num = (s: T) => (s.sheetNumber ?? '').trim();
  return [...list].sort((a, b) => {
    const na = num(a);
    const nb = num(b);
    if (!na !== !nb) return na ? -1 : 1;
    const byNumber = na.localeCompare(nb, undefined, { numeric: true, sensitivity: 'base' });
    if (byNumber !== 0) return byNumber;
    return (a.name ?? '').localeCompare(b.name ?? '', undefined, { numeric: true, sensitivity: 'base' });
  });
}

/** The sheet ↑ (-1) or ↓ (1) from the open one. No wrap: null at either end,
 *  and null when the open sheet is not on the rail. */
export function adjacentSheetId(list: readonly { id: string }[], activeId: string, dir: 1 | -1): string | null {
  const i = list.findIndex((s) => s.id === activeId);
  if (i < 0) return null;
  const next = list[i + dir];
  return next ? next.id : null;
}

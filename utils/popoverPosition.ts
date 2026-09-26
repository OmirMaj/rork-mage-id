// utils/popoverPosition.ts — where a pointer-anchored popover menu goes
// (wave 6d, lane B1: the row-action popover in components/EntityActionSheet).
//
// Pure. The left clamp is the same arithmetic as
// components/schedule/ScheduleRowMenu.tsx rowMenuPopoverPosition (not edited
// here); this adds the flip: a menu that would run off the bottom opens ABOVE
// the pointer instead of being pushed up over it.
//
//   width = menu.width ?? Layout.menu.maxWidth (280)
//   left  = clamp(anchor.x, 8, viewport.width − width − 8)
//   top   = anchor.y + 4 when the menu fits below (bottom edge 8 clear);
//           otherwise max(8, anchor.y − 4 − height), flippedUp
//   a non-finite anchor → { left: 8, top: 8 }

export const POPOVER_EDGE = 8;
export const MENU_MAX_WIDTH = 280; /* Layout.menu.maxWidth */
export const MENU_OFFSET = 4; /* Layout.menu.offset */

export interface PopoverPoint { x: number; y: number }
export interface PopoverPlacement { left: number; top: number; flippedUp: boolean }

export function popoverPosition(
  anchor: PopoverPoint,
  menu: { width?: number; height: number },
  viewport: { width: number; height: number },
): PopoverPlacement {
  if (!anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) {
    return { left: POPOVER_EDGE, top: POPOVER_EDGE, flippedUp: false };
  }
  const width = menu.width ?? MENU_MAX_WIDTH;
  const h = Number.isFinite(menu.height) ? Math.max(0, menu.height) : 0;
  // Math.max last, so a viewport narrower than the menu pins it to the edge.
  const left = Math.max(POPOVER_EDGE, Math.min(anchor.x, viewport.width - width - POPOVER_EDGE));
  const below = anchor.y + MENU_OFFSET;
  if (below + h + POPOVER_EDGE <= viewport.height) {
    return { left, top: below, flippedUp: false };
  }
  return { left, top: Math.max(POPOVER_EDGE, anchor.y - MENU_OFFSET - h), flippedUp: true };
}

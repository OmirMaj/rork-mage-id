// utils/desktopHeader.ts — where the root Stack's header sits on desktop web
// (wave 6d restore, lane Z1).
//
// WHY THIS EXISTS. DesktopPageFrame (the root Stack's `screenLayout`) centres
// every framed route's CONTENT in a Layout.page[kind] column, but native-stack
// on web draws the header OUTSIDE screenLayout, as a full-width
// @react-navigation/elements <Header>. So on a framed page the Back button
// and the title floated at the sidebar edge while the page column sat in the
// middle of the window — measured at 2560 in wave 6b: title at x = 256, column
// 1020–1780. components/desktop/DesktopStackHeader insets the header's left
// and right containers by headerInsetFor(its own width, the route's column),
// so the header lines up with the column below it.
//
// Rules:
//  - '(tabs)' is null: the tab navigator frames itself and its root Stack
//    header is hidden anyway.
//  - a 'bleed' route (the canvases, leads, takeoff…) is null → inset 0: its
//    header keeps native-stack's own geometry.
//  - every other route uses pageTypeForRoute — self-capped routes too: their
//    self-cap IS the same Layout.page token (wave 6c swapped their literals).
//
// Known, accepted: /rfi and /submittal are 'table' routes (list-first logs), so
// with a record open in the 760 editor their header gets the 1600 inset —
// 0 up to a 1600 px stack, then 360 at 2560 (where a 760 column would get
// 780). Their list is the page the header belongs to.
//
// PURE — type-only imports plus utils/desktopPage (itself pure), so bun
// validators can load it.

import type { LayoutPageType } from '@/constants/designTokens';
import { pageTypeForRoute } from '@/utils/desktopPage';

/** The page column a root-Stack route's header lines up with, or null when the
 *  header keeps its full width ('(tabs)' and every 'bleed' route). */
export function headerColumnKind(routeName: string): Exclude<LayoutPageType, 'bleed'> | null {
  if (routeName === '(tabs)') return null;
  const k = pageTypeForRoute(routeName);
  return k === 'bleed' ? null : k;
}

/** How far each header container moves in from its edge so the header spans
 *  the centred column: half the stack's spare width, floored; 0 when the
 *  column already fills the stack or the width is not a finite number. */
export function headerInsetFor(stackWidth: number, columnMax: number): number {
  if (!Number.isFinite(stackWidth) || stackWidth <= columnMax) return 0;
  return Math.floor((stackWidth - columnMax) / 2);
}

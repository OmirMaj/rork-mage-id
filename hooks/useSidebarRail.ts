// hooks/useSidebarRail.ts — the desktop sidebar's 64 px rail (wave 6c, lane S).
//
//   useSidebarRail()            { collapsed, width, toggle } for the sidebar
//                               itself (components/DesktopSidebar).
//   useSidebarRailRouteSync()   called ONCE, in app/_layout's RootLayoutNav
//                               (the always-focused root screen, so the chord
//                               works under pushed routes): reports the top
//                               route segment to the store and binds
//                               Cmd/Ctrl+Backslash to collapse / expand.
//
// The rules live in utils/sidebarRail (pure); the state in
// utils/sidebarRailStore. useResponsiveLayout().sidebarWidth reads the same
// store, so the page column, the shell dock and the sync pill follow the rail
// with no extra wiring.

import { useLayoutEffect, useSyncExternalStore } from 'react';
import { useSegments } from 'expo-router';
import { useHotkeys } from '@/hooks/useHotkeys';
import { useIsDesktop, useIsDesktopWeb } from '@/components/ui/desktop';
import { railCollapsed, sidebarWidthFor } from '@/utils/sidebarRail';
import {
  getSidebarRail,
  setSidebarRoute,
  subscribeSidebarRail,
  toggleSidebarRail,
} from '@/utils/sidebarRailStore';

export interface SidebarRailState {
  collapsed: boolean;
  width: number;
  toggle: () => void;
}

export function useSidebarRail(): SidebarRailState {
  const snap = useSyncExternalStore(subscribeSidebarRail, getSidebarRail, getSidebarRail);
  const collapsed = railCollapsed(snap.topSegment, snap.pref);
  return { collapsed, width: sidebarWidthFor(collapsed), toggle: toggleSidebarRail };
}

/** 'mod+backslash' — hooks/useHotkeys spells the \ key "backslash" (KEY_ALIASES). */
export const SIDEBAR_RAIL_COMBO = 'mod+backslash';

const RAIL_BINDINGS = [
  { combo: SIDEBAR_RAIL_COMBO, label: 'Collapse sidebar', group: 'Navigation', handler: toggleSidebarRail },
];

export function useSidebarRailRouteSync(): void {
  const segments: readonly string[] = useSegments();
  const top = segments[0] ?? '';
  const isDesktop = useIsDesktop();
  const desktopWeb = useIsDesktopWeb();
  // Desktop only: a phone never reports a route, so it never loads the pref.
  useLayoutEffect(() => {
    if (isDesktop) setSidebarRoute(top);
  }, [isDesktop, top]);
  useHotkeys(RAIL_BINDINGS, { scope: 'global', enabled: desktopWeb });
}

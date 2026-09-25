// utils/sidebarRailStore.ts — the desktop sidebar's collapsed/expanded state,
// as a module store read with useSyncExternalStore (the pattern of
// components/brain/brainFabState).
//
// WHY A MODULE STORE. useResponsiveLayout() — called by ~every screen — reads
// the sidebar width from here, and a context would need a provider above the
// root layout. With a store, a toggle re-renders only the subscribers, and the
// snapshot object only changes when the pref or the top route segment does.
//
// PHONE: nothing here runs. AsyncStorage is required lazily and the saved pref
// loads on the FIRST setSidebarRoute() call, which only the desktop shell makes
// (hooks/useSidebarRail useSidebarRailRouteSync). A phone never reads storage.

import {
  DEFAULT_RAIL_PREF,
  SIDEBAR_RAIL_KEY,
  parseRailPref,
  toggledPref,
  type RailPref,
} from '@/utils/sidebarRail';

export interface SidebarRailSnapshot {
  pref: RailPref;
  /** The root Stack's top-level segment ('schedule-pro', '(tabs)', …). */
  topSegment: string;
}

let snapshot: SidebarRailSnapshot = { pref: DEFAULT_RAIL_PREF, topSegment: '' };
const listeners = new Set<() => void>();
let loadStarted = false;
/** A toggle made before the saved pref arrived wins over it. */
let toggledBeforeLoad = false;

function emit(next: SidebarRailSnapshot): void {
  snapshot = next;
  for (const fn of listeners) fn();
}

type Storage = {
  getItem(k: string): Promise<string | null>;
  setItem(k: string, v: string): Promise<void>;
};

function storage(): Storage | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@react-native-async-storage/async-storage') as { default?: Storage } & Storage;
    return (mod.default ?? mod) as Storage;
  } catch {
    return null;
  }
}

function loadOnce(): void {
  if (loadStarted) return;
  loadStarted = true;
  const s = storage();
  if (!s) return;
  s.getItem(SIDEBAR_RAIL_KEY)
    .then((raw) => {
      if (toggledBeforeLoad) return;
      const pref = parseRailPref(raw);
      if (pref.canvas !== snapshot.pref.canvas || pref.workspace !== snapshot.pref.workspace) {
        emit({ ...snapshot, pref });
      }
    })
    .catch(() => { /* the default stands */ });
}

export function getSidebarRail(): SidebarRailSnapshot {
  return snapshot;
}

export function subscribeSidebarRail(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** The shell reports the current top-level route (desktop only). The first
 *  call also loads the saved pref. */
export function setSidebarRoute(top: string): void {
  loadOnce();
  if (top === snapshot.topSegment) return;
  emit({ ...snapshot, topSegment: top });
}

/** Cmd+Backslash / the collapse and expand buttons: flip the kind of route
 *  the viewer is on, and save it. */
export function toggleSidebarRail(): void {
  loadOnce();
  // If the saved pref is still in flight, this explicit choice outranks it.
  toggledBeforeLoad = true;
  const pref = toggledPref(snapshot.topSegment, snapshot.pref);
  emit({ ...snapshot, pref });
  const s = storage();
  if (!s) return;
  try {
    s.setItem(SIDEBAR_RAIL_KEY, JSON.stringify(pref)).catch(() => { /* not saved; this session keeps it */ });
  } catch {
    /* not saved; this session keeps it */
  }
}

/** Tests only: back to a fresh module state. */
export function __resetSidebarRailForTests(): void {
  snapshot = { pref: DEFAULT_RAIL_PREF, topSegment: '' };
  loadStarted = false;
  toggledBeforeLoad = false;
  for (const fn of listeners) fn();
}

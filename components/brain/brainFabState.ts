// components/brain/brainFabState.ts
//
// Visibility state for the ONE global MAGE Brain FAB (components/brain/BrainFab).
//
// WHY THIS EXISTS — iOS visual audit 2026-08-16, defect #5.
// The FAB is mounted once, at the root, above the router, so it floats over
// every screen with no idea what is underneath it: a 56pt opaque circle parked
// in the bottom-right, which is exactly where badges, amounts, chevrons and
// row actions live. The audit caught it covering GRAND TOTAL in the estimate
// totals bar, a permit "Denied" badge (only the "D" showed), a failed-
// inspection note, "REVIEW NEEDED" in the COI vault, warranty category labels,
// the home checklist's "Try it free" chip, and a punch-list row.
//
// WHY THE FIX LIVES HERE AND NOT IN A SHARED SCROLL WRAPPER.
// There isn't one. `app/` has ~187 top-level ScrollView/FlatList/SectionLists
// and no common frame — ToolScreenChrome is header chrome, not a scroll
// container. React Native has no way to observe scrolling globally either, so
// the FAB cannot discover on its own that content is passing underneath it.
// The shared layer therefore has to be the FAB's own state, with screens
// opting in through one prop spread instead of each inventing a padding.
//
// WHY A MODULE STORE AND NOT A CONTEXT.
// `scrollHidden` flips on scroll frames. SearchContext is the only provider
// mounted above the router, and putting per-frame state there would re-render
// every `useSearch()` consumer — the search surface, the hotkey listener, the
// home header — for the whole duration of a drag. With useSyncExternalStore
// only <BrainFab/> subscribes, so a scroll costs exactly one re-render.

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useFocusEffect } from 'expo-router';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

/**
 * Bottom padding a scroll container needs so its last row clears the FAB.
 *
 * FAB geometry (see BrainFab): a 56pt circle whose BOTTOM edge sits at
 * `insets.bottom + 70`, so it occupies `insets.bottom + 70` through
 * `insets.bottom + 126` measured up from the window bottom. 126 + 24pt of
 * breathing room = 150. Use it as `paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE`.
 *
 * This is exact for a full-height screen. On a tab screen the container already
 * stops at the tab bar (~82pt up), so 150 over-pads by ~72 — harmless dead
 * space, and it's the value `app/(tabs)/(home)` already shipped with.
 */
export const BRAIN_FAB_CLEARANCE = 150;

export type BrainFabPresentation = {
  /** True when the FAB must not be drawn or hit-tested. */
  readonly hidden: boolean;
  /** Extra points to raise the FAB by, to clear a fixed bottom bar. */
  readonly lift: number;
};

const DEFAULT: BrainFabPresentation = Object.freeze({ hidden: false, lift: 0 });

// --- store ------------------------------------------------------------------

const listeners = new Set<() => void>();
/** Identity tokens of the mounted components asking for the FAB to be hidden. */
const suppressors = new Set<object>();
/** Identity token -> requested lift in points. The largest request wins. */
const lifts = new Map<object, number>();
let scrollHidden = false;
let snapshot: BrainFabPresentation = DEFAULT;

function publish(): void {
  let lift = 0;
  for (const v of lifts.values()) if (v > lift) lift = v;
  const hidden = scrollHidden || suppressors.size > 0;
  if (hidden === snapshot.hidden && lift === snapshot.lift) return;
  snapshot = { hidden, lift };
  for (const l of listeners) l();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => { listeners.delete(onChange); };
}

const getSnapshot = (): BrainFabPresentation => snapshot;
const getServerSnapshot = (): BrainFabPresentation => DEFAULT;

/**
 * Bring the FAB back after a scroll hid it. Called by BrainFab on every route
 * change: a screen that scrolled the FAB away stays mounted underneath the one
 * pushed on top of it, so without this the FAB would stay hidden on the new
 * screen until something scrolled again.
 */
export function resetBrainFabScroll(): void {
  if (!scrollHidden) return;
  scrollHidden = false;
  publish();
}

// --- hooks ------------------------------------------------------------------

/** Read the current presentation. Intended for BrainFab only. */
export function useBrainFabPresentation(): BrainFabPresentation {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Hide the FAB for as long as the calling component is mounted.
 *
 * Used by the client-facing estimate: a homeowner reading a fixed-price
 * proposal should not be shown the contractor's AI assistant at all, and
 * suppressing it is the only thing that guarantees the payment amounts can
 * never be covered — for an estimate of ANY length, at any scroll position.
 */
export function useHideBrainFab(hidden: boolean = true): void {
  const token = useRef<object>({}).current;
  // FOCUS-scoped, not mount-scoped. A tab screen stays mounted underneath
  // whatever is pushed on top of it, so a mount-scoped request would follow the
  // user around the app and strand the FAB off-screen everywhere — which is
  // exactly what happened the first time this shipped.
  useFocusEffect(
    useCallback(() => {
      if (!hidden) return;
      suppressors.add(token);
      publish();
      return () => { suppressors.delete(token); publish(); };
    }, [hidden, token]),
  );
}

/**
 * Raise the FAB by `height` points for as long as the calling component is
 * mounted, so it clears a fixed bottom bar.
 *
 * Pass the bar's measured `onLayout` height. The FAB's resting position already
 * clears the tab bar with a margin, so lifting by exactly the bar's height
 * preserves that same margin above the bar — no per-screen magic numbers.
 */
export function useBrainFabLift(height: number): void {
  const token = useRef<object>({}).current;
  // Focus-scoped for the same reason as useHideBrainFab: a bottom bar on a
  // backgrounded screen must not keep pushing the FAB up on every other screen.
  useFocusEffect(
    useCallback(() => {
      if (!(height > 0)) { if (lifts.delete(token)) publish(); return; }
      lifts.set(token, height);
      publish();
      return () => { lifts.delete(token); publish(); };
    }, [height, token]),
  );
}

/** Ignore sub-pixel jitter and momentum settle. */
const SCROLL_DEAD_ZONE = 8;
/** Near the top of a list the FAB is never in the way — keep it visible. */
const TOP_ZONE = 24;

/**
 * Scroll-away behaviour. Spread onto any scroll container:
 *
 *   <ScrollView {...useBrainFabScroll()} />
 *
 * Scrolling down (reading) slides the FAB out; scrolling back up brings it
 * back, as does being near the top. This is what fixes the MID-LIST overlaps —
 * a badge or amount the FAB happens to sit on halfway down a list is not
 * something bottom padding can ever reach.
 */
export function useBrainFabScroll(): {
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  scrollEventThrottle: number;
} {
  const lastY = useRef(0);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    const dy = y - lastY.current;
    // Hold `lastY` until the dead zone is crossed so slow drags still register
    // instead of being swallowed one sub-threshold frame at a time.
    if (Math.abs(dy) < SCROLL_DEAD_ZONE) return;
    lastY.current = y;
    const next = dy > 0 && y > TOP_ZONE;
    if (next === scrollHidden) return;
    scrollHidden = next;
    publish();
  }, []);

  // Never leave the FAB stuck off-screen. Reset on unmount, and again whenever
  // this screen gains or loses focus — arriving on a screen must always start
  // with the FAB visible, however the last one left it.
  useEffect(() => () => { resetBrainFabScroll(); }, []);
  useFocusEffect(
    useCallback(() => {
      lastY.current = 0;
      resetBrainFabScroll();
      return () => { resetBrainFabScroll(); };
    }, []),
  );

  return { onScroll, scrollEventThrottle: 16 };
}

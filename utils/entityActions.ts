// ============================================================================
// utils/entityActions.ts
//
// Catalog of quick actions available for any EntityRef. Consumed by the
// EntityActionSheet component (long-press surfaces) and by any future menu
// that needs a consistent set of per-entity verbs.
//
// Each action is a description — the SHEET wires the actual navigation /
// clipboard / share call at invocation time. This keeps the catalog pure so
// it can be inspected, filtered, and reordered without pulling in React.
// ============================================================================

import type { EntityRef, EntityKind } from '@/types';
import { getEntityRoute } from '@/utils/entityResolver';

export type EntityActionId =
  | 'open'
  | 'copyLink'
  | 'share'
  | 'markComplete'
  | 'duplicate'
  | 'delete';

export interface EntityAction {
  id: EntityActionId;
  /** Label shown in the sheet. */
  label: string;
  /** Optional Lucide icon name. EntityActionSheet looks this up at render time. */
  icon?: 'ExternalLink' | 'Link' | 'Share2' | 'CheckCircle2' | 'Copy' | 'Trash2';
  /** iOS action-sheet destructive style + red tint on other platforms. */
  destructive?: boolean;
}

// ---------------------------------------------------------------------------
// Per-kind capability table — start conservative. New verbs can be added here
// without touching any call sites; the sheet will surface whatever comes back.
// ---------------------------------------------------------------------------

const UNIVERSAL: EntityActionId[] = ['open', 'copyLink', 'share'];

const CAPABILITIES: Record<EntityKind, EntityActionId[]> = {
  project:      [...UNIVERSAL],
  task:         [...UNIVERSAL, 'markComplete'],
  photo:        [...UNIVERSAL, 'delete'],
  rfi:          [...UNIVERSAL, 'markComplete'],
  submittal:    [...UNIVERSAL, 'markComplete'],
  changeOrder:  [...UNIVERSAL, 'duplicate'],
  invoice:      [...UNIVERSAL, 'duplicate'],
  payment:      [...UNIVERSAL],
  dailyReport:  [...UNIVERSAL, 'duplicate'],
  punchItem:    [...UNIVERSAL, 'markComplete', 'delete'],
  warranty:     [...UNIVERSAL],
  contact:      [...UNIVERSAL],
  document:     [...UNIVERSAL, 'delete'],
  permit:       [...UNIVERSAL],
  equipment:    [...UNIVERSAL],
  subcontractor:[...UNIVERSAL],
  commitment:   [...UNIVERSAL],
  planSheet:    [...UNIVERSAL],
  commEvent:    [...UNIVERSAL],
  portalMessage:[...UNIVERSAL],
};

const ACTION_META: Record<EntityActionId, Omit<EntityAction, 'id'>> = {
  open:         { label: 'Open',          icon: 'ExternalLink' },
  copyLink:     { label: 'Copy link',     icon: 'Link' },
  share:        { label: 'Share',         icon: 'Share2' },
  markComplete: { label: 'Mark complete', icon: 'CheckCircle2' },
  duplicate:    { label: 'Duplicate',     icon: 'Copy' },
  delete:       { label: 'Delete',        icon: 'Trash2', destructive: true },
};

/**
 * All valid actions for a given EntityRef, in display order. Drops `open`
 * when the ref has no resolvable route (so the sheet never offers a dead
 * action), and drops kinds that aren't in the capability table.
 */
export function getEntityActions(ref: EntityRef): EntityAction[] {
  const ids = CAPABILITIES[ref.kind] ?? [];
  const hasRoute = getEntityRoute(ref) !== null;
  return ids
    .filter(id => (id === 'open' ? hasRoute : true))
    .map(id => ({ id, ...ACTION_META[id] }));
}

// ---------------------------------------------------------------------------
// Deep-link URLs — used by copyLink / share.
// ---------------------------------------------------------------------------

// App scheme is rork-app:// per app.json (legacy, do not rename). Deep-link
// URLs are passed through expo-linking so they resolve correctly on device.
const APP_SCHEME = 'rork-app://';

/**
 * Build a deep-link URL for a ref. Returns null if the ref has no dedicated
 * route (fallback to parent project in the UI layer).
 */
export function getEntityDeepLink(ref: EntityRef): string | null {
  const route = getEntityRoute(ref);
  if (!route) return null;

  const query = new URLSearchParams();
  if (route.params) {
    for (const [k, v] of Object.entries(route.params)) {
      if (v !== undefined && v !== null) query.set(k, String(v));
    }
  }
  const qs = query.toString();
  const path = route.pathname.startsWith('/') ? route.pathname : `/${route.pathname}`;
  return `${APP_SCHEME}${path}${qs ? `?${qs}` : ''}`;
}

/**
 * Plaintext share body suitable for SMS / email / clipboard. Combines the
 * human-readable label with the deep-link URL.
 */
export function getEntityShareBody(ref: EntityRef, label: string): string {
  const link = getEntityDeepLink(ref);
  return link ? `${label}\n${link}` : label;
}

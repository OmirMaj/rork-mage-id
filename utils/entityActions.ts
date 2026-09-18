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

import type { EntityRef, EntityKind, PunchItem, RFI } from '@/types';
import { getEntityRoute } from '@/utils/entityResolver';
import { shareLinkBase } from '@/utils/webAppOrigin';

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
  // Duplicate on a project = "use as template" — copies scope (name +
  // " (copy)", type, sf, quality, location, contract model, linked
  // estimate) into a fresh draft. Skips execution artifacts (photos,
  // DFRs, invoices, RFIs, contacts, closeout dates). Common pain
  // point: GCs running repeat kitchens / ADUs / bath remodels with
  // the same trade lineup re-create everything by hand otherwise.
  project:      [...UNIVERSAL, 'duplicate'],
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
  drawingPin:   [...UNIVERSAL, 'delete'],
  planMarkup:   [...UNIVERSAL, 'delete'],
  prequalPacket:[...UNIVERSAL],
  priceAlert:   [...UNIVERSAL, 'delete'],
  // No 'delete' verb: a delay event is claim material. Removing one is a
  // deliberate act that belongs on the record's own screen, not one tap deep in
  // a generic action sheet.
  delayEvent:   [...UNIVERSAL],
  lead:         [...UNIVERSAL],
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
 * The catalog for a ref, in display order — what the kind COULD do. Drops
 * `open` when the ref has no resolvable route. This is not what a menu should
 * show: a mutating verb is only offered once something can actually perform it
 * (see getRunnableEntityActions).
 */
export function getEntityActions(ref: EntityRef): EntityAction[] {
  const ids = CAPABILITIES[ref.kind] ?? [];
  const hasRoute = getEntityRoute(ref) !== null;
  return ids
    .filter(id => (id === 'open' ? hasRoute : true))
    .map(id => ({ id, ...ACTION_META[id] }));
}

// ---------------------------------------------------------------------------
// Which mutating verbs can actually RUN — the sheet's own wiring.
// ---------------------------------------------------------------------------
//
// WHY THIS TABLE EXISTS (audit round 2, #34). The catalog above offered
// Duplicate on invoices / change orders / daily reports, Mark complete on
// RFIs / submittals / tasks / punch items, and a red Delete on photos and punch
// items — but the sheet only ever forwarded those three verbs to an OPTIONAL
// `onAction` prop, and the project page and the activity feed mounted it with
// none. Every one of them closed the sheet and did nothing: a GC who tapped
// Delete on a punch item believed it was gone; the client portal still showed
// it. A control that silently does nothing is worse than no control.
//
// So a mutating verb is shown ONLY when something performs it:
//   · the sheet itself, for the (kind, verb) pairs below — each goes through
//     the same ProjectContext mutator the record's own screen uses, so it
//     syncs through the offline queue like any other edit; or
//   · the caller, for the verbs it names in `callerVerbs` (Home's project
//     Duplicate is the one today).
// Everything else is dropped from the menu rather than shown dead.
//
// Deliberately NOT self-wired:
//   · photo delete — a gallery photo is the source image for punch items
//     (utils/punchSourcePhoto), the anchor for plan pins, and can be the same
//     storage object as a filed daily report's photo. Deleting it from a
//     one-tap generic menu would blank records that are not on screen.
//   · submittal "complete" — approval is the reviewer's decision with four
//     possible outcomes, not a checkbox.
//   · task complete — schedule progress runs through the CPM engine and its
//     undo stack on the schedule screen.
//   · invoice / CO / DFR duplicate — each needs a fresh document number and a
//     reset of payment / approval state; half a copy is a wrong document.
const SHEET_WIRED: Partial<Record<EntityKind, EntityActionId[]>> = {
  rfi:       ['markComplete'],
  punchItem: ['markComplete', 'delete'],
};

const MUTATING: ReadonlySet<EntityActionId> = new Set(['markComplete', 'duplicate', 'delete']);

/** True when EntityActionSheet performs this verb itself for this kind. */
export function sheetWiresVerb(kind: EntityKind, id: EntityActionId): boolean {
  return (SHEET_WIRED[kind] ?? []).includes(id);
}

export interface RunnableActionContext {
  /** Verbs the caller's `onAction` really performs for THIS ref. */
  callerVerbs?: readonly EntityActionId[];
  /** Current status of the record, when known — "Mark complete" on a record
   *  that is already closed is a no-op, so it is not offered. */
  status?: string;
}

const ALREADY_COMPLETE = new Set(['closed', 'void']);

/**
 * What the menu may actually show for a ref: the catalog minus every mutating
 * verb nobody performs. Open / Copy link / Share are handled by the sheet for
 * every kind and always pass.
 */
export function getRunnableEntityActions(ref: EntityRef, ctx: RunnableActionContext = {}): EntityAction[] {
  const caller = ctx.callerVerbs ?? [];
  return getEntityActions(ref).filter(a => {
    if (!MUTATING.has(a.id)) return true;
    if (a.id === 'markComplete' && ctx.status && ALREADY_COMPLETE.has(ctx.status)) return false;
    return caller.includes(a.id) || sheetWiresVerb(ref.kind, a.id);
  });
}

/**
 * The patch that closes an RFI from the menu — the SAME shape app/rfi.tsx
 * writes when the GC sets status 'closed' and saves: the ball goes to 'closed'
 * (so it drops out of the live filter) and the hand-off is appended to the
 * audit trail that delay claims are built from. A bare `status: 'closed'`
 * would leave the ball with the architect and the log silent.
 */
export function rfiClosePatch(rfi: Pick<RFI, 'ballInCourt' | 'handoffs'>, nowIso: string): Partial<RFI> {
  const prevBall = rfi.ballInCourt ?? 'gc';
  if (prevBall === 'closed') return { status: 'closed' };
  return {
    status: 'closed',
    ballInCourt: 'closed',
    handoffs: [...(rfi.handoffs ?? []), { at: nowIso, fromParty: prevBall, toParty: 'closed', note: 'RFI closed by GC' }],
  };
}

/** Same fields app/punch-list.tsx sets when an item is closed there. */
export function punchClosePatch(nowIso: string): Partial<PunchItem> {
  return { status: 'closed', closedAt: nowIso };
}

// ---------------------------------------------------------------------------
// Deep-link URLs — used by copyLink / share.
// ---------------------------------------------------------------------------

// WHY https AND NOT mageid:// (audit round 2, #34). "Copy link" is how the
// office says "look at this RFI" to a PM or a bookkeeper — who opens it in an
// email on a laptop. `mageid://rfi?...` is not clickable there and opens
// nothing in a browser. The web app serves every route under `app/`, so the
// same path on the web-app origin (utils/webAppOrigin) opens the record for anyone; a teammate who is
// not signed in is bounced to /login and the auth gate replays the full path,
// query included (app/_layout.tsx), after sign-in. The app registers no
// universal links, so on a phone this opens the web app — still the record,
// never a dead end. `runtimeOrigin` (window.location.origin on web) lets a
// deploy preview link to itself; shareLinkBase refuses the marketing host.

/**
 * Build a shareable URL for a ref. Returns null if the ref has no dedicated
 * route (fallback to parent project in the UI layer).
 */
export function getEntityDeepLink(ref: EntityRef, runtimeOrigin?: string | null): string | null {
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
  return `${shareLinkBase(runtimeOrigin)}${path}${qs ? `?${qs}` : ''}`;
}

/**
 * Plaintext share body suitable for SMS / email / clipboard. Combines the
 * human-readable label with the deep-link URL.
 */
export function getEntityShareBody(ref: EntityRef, label: string, runtimeOrigin?: string | null): string {
  const link = getEntityDeepLink(ref, runtimeOrigin);
  return link ? `${label}\n${link}` : label;
}

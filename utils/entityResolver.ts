// ============================================================================
// utils/entityResolver.ts
//
// Universal resolution layer for EntityRef — see utils/ENTITY_REF.md.
//
// Three exported functions:
//   - getEntityRoute(ref)      → { pathname, params } for expo-router
//   - formatEntityLabel(ref, store) → human-readable label
//   - resolveEntity(ref, store)     → { entity, label, route }
//
// The "store" argument is the shape returned by `useProjects()`. Callers that
// already have the store in scope can pass it directly; most UI code should
// use `useEntityNavigation()` from hooks/useEntityNavigation.ts, which wires
// this up automatically.
// ============================================================================

import type { Href } from 'expo-router';
import type {
  EntityRef,
  EntityKind,
  Project,
  ChangeOrder,
  Invoice,
  DailyFieldReport,
  PunchItem,
  ProjectPhoto,
  RFI,
  Submittal,
  Warranty,
  Contact,
  Equipment,
  ScheduleTask,
  ProjectDocument,
  Permit,
} from '@/types';

// The minimum shape the resolver needs from useProjects(). Kept narrow so
// tests/mocks can supply a partial object without rebuilding the full context.
export interface EntityStore {
  projects: Project[];
  changeOrders: ChangeOrder[];
  invoices: Invoice[];
  getDailyReportsForProject?: (projectId: string) => DailyFieldReport[];
  punchItems: PunchItem[];
  projectPhotos: ProjectPhoto[];
  rfis: RFI[];
  submittals: Submittal[];
  warranties: Warranty[];
  contacts: Contact[];
  equipment: Equipment[];
}

// ---------------------------------------------------------------------------
// Route mapping
// ---------------------------------------------------------------------------

/**
 * The object form of expo-router's typed `Href`, so every `pathname` below is
 * checked against the real route table at compile time. UX-F8: two cases here
 * pointed at screens that do not exist ('/client-portal', '/price-alerts') and
 * an `as never` cast in useEntityNavigation hid it until a user tapped a
 * search result and landed on "Page Not Found".
 */
export type EntityRoute = Extract<Href, { pathname: string }>;

/**
 * Map an EntityRef to the expo-router target that renders it. The returned
 * shape is accepted directly by `router.push(...)`.
 *
 * Returns `null` when a nested kind arrives without the `projectId` its
 * screen is scoped by. Callers should fall back to the parent project in
 * that case.
 *
 * B4 review A8: every `params` key below is one the target screen actually
 * reads from useLocalSearchParams. Hints no screen read (`focusPhotoId`,
 * `punchItemId`, `warrantyId`, `documentId`, `permitId`, `taskId`,
 * `paymentId`, `subcontractorId`, `packetId`, `pinId`, `markupId`,
 * `contactId`, `openCommitmentId`) were dead weight in the URL and are
 * gone; the moment a screen starts reading an id is the moment to pass it.
 */
export function getEntityRoute(ref: EntityRef): EntityRoute | null {
  switch (ref.kind) {
    case 'project':
      return { pathname: '/project-detail', params: { id: ref.id } };

    case 'contact':
      // Contacts live inside /contacts — no per-contact route, and
      // app/contacts.tsx reads no search params.
      return { pathname: '/contacts' };

    case 'equipment':
      return { pathname: '/equipment-detail', params: { equipmentId: ref.id } };

    case 'invoice':
      if (!ref.projectId) return null;
      return {
        pathname: '/invoice',
        params: { projectId: ref.projectId, invoiceId: ref.id },
      };

    case 'changeOrder':
      if (!ref.projectId) return null;
      return {
        pathname: '/change-order',
        params: { projectId: ref.projectId, coId: ref.id },
      };

    case 'rfi':
      if (!ref.projectId) return null;
      return {
        pathname: '/rfi',
        params: { projectId: ref.projectId, rfiId: ref.id },
      };

    case 'submittal':
      if (!ref.projectId) return null;
      return {
        pathname: '/submittal',
        params: { projectId: ref.projectId, submittalId: ref.id },
      };

    case 'dailyReport':
      if (!ref.projectId) return null;
      return {
        pathname: '/daily-report',
        params: { projectId: ref.projectId, reportId: ref.id },
      };

    case 'punchItem':
      // No per-item screen; app/punch-list.tsx reads projectId (and the
      // photo prefill params) only.
      if (!ref.projectId) return null;
      return {
        pathname: '/punch-list',
        params: { projectId: ref.projectId },
      };

    case 'warranty':
      // warranties.tsx takes projectId only; the list pre-expands.
      if (!ref.projectId) return null;
      return {
        pathname: '/warranties',
        params: { projectId: ref.projectId },
      };

    case 'photo':
      // Photos live inside project-detail's Photos section. The screen reads
      // `id`, `tile` and `edit` (its deep-link effect opens the named
      // section), so the section key is the hint it can act on — the old
      // `focusPhotoId` was never read.
      if (!ref.projectId) return null;
      return {
        pathname: '/project-detail',
        params: { id: ref.projectId, tile: 'photos' },
      };

    case 'document':
      // app/documents.tsx is the all-projects document list and reads no
      // search params (it links out per row).
      return { pathname: '/documents' };

    case 'permit':
      // app/permits.tsx reads no search params; the project is picked in-form.
      return { pathname: '/permits' };

    case 'task':
      // Schedule tasks open inside schedule-pro, which reads projectId only.
      if (!ref.projectId) return null;
      return {
        pathname: '/schedule-pro',
        params: { projectId: ref.projectId },
      };

    case 'payment':
      // Payments are listed in /payments (no search params, no per-row detail yet).
      return { pathname: '/payments' };

    case 'subcontractor':
      // app/(tabs)/subs/index.tsx reads no search params.
      return { pathname: '/subs' };

    case 'commitment':
      // Contracts live in project-detail; no section reads a commitment id.
      if (!ref.projectId) return null;
      return {
        pathname: '/project-detail',
        params: { id: ref.projectId },
      };

    case 'planSheet':
      // app/plan-viewer.tsx reads `sheetId` (and `punchId`) only.
      return {
        pathname: '/plan-viewer',
        params: { sheetId: ref.id },
      };

    case 'commEvent':
      if (!ref.projectId) return null;
      return {
        pathname: '/activity-feed',
        params: { projectId: ref.projectId },
      };

    case 'portalMessage':
      // The GC-side thread lives at /client-messages (keyed by project `id`);
      // there is no /client-portal screen (UX-F8). app/client-messages.tsx
      // reads ONLY `id` from useLocalSearchParams and scrolls to the end of
      // the thread — it has no per-message focus, so a `messageId` param was
      // dead weight in the URL (B4 review A8).
      if (!ref.projectId) return null;
      return {
        pathname: '/client-messages',
        params: { id: ref.projectId },
      };

    case 'drawingPin':
    case 'planMarkup':
      // Pins and markups live on a plan sheet, but an EntityRef carries no
      // sheetId and app/plan-viewer.tsx reads only `sheetId` / `punchId` —
      // so the viewer opens without a sheet selected, as it always did (the
      // old `pinId` / `markupId` / `projectId` params were never read).
      // Focusing the pin needs a sheetId on the ref first.
      return { pathname: '/plan-viewer' };

    case 'prequalPacket':
      // Prequal lives in the sub-management surface; app/prequal-manager.tsx
      // reads no search params.
      return { pathname: '/prequal-manager' };

    case 'priceAlert':
      // Price alerts render inside the Materials tab (app/(tabs)/materials/
      // index.tsx `priceAlerts`, listed in its PRICE ALERTS section); there is
      // no /price-alerts screen (UX-F8). That screen reads NO search params
      // (only [category].tsx reads `category`/`loc`), so nothing is passed —
      // the old `alertId` was never read (B4 review A8).
      return { pathname: '/(tabs)/materials' };

    case 'delayEvent':
      // The delay register is project-scoped; deep-link the list with the
      // event pre-selected.
      if (!ref.projectId) return null;
      return {
        pathname: '/delay-events',
        params: { projectId: ref.projectId, delayEventId: ref.id },
      };

    default: {
      // Exhaustiveness guard — a new EntityKind added to types/index.ts will
      // surface a TS error here.
      const _exhaustive: never = ref.kind;
      void _exhaustive;
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Entity lookup
// ---------------------------------------------------------------------------

/**
 * Look up the concrete domain object behind an EntityRef. Returns `null` when
 * the store doesn't contain the entity (deleted, stale ref, or not yet loaded).
 */
export function resolveEntityObject(
  ref: EntityRef,
  store: EntityStore,
): unknown | null {
  switch (ref.kind) {
    case 'project':
      return store.projects.find(p => p.id === ref.id) ?? null;
    case 'contact':
      return store.contacts.find(c => c.id === ref.id) ?? null;
    case 'equipment':
      return store.equipment.find(e => e.id === ref.id) ?? null;
    case 'invoice':
      return store.invoices.find(i => i.id === ref.id) ?? null;
    case 'changeOrder':
      return store.changeOrders.find(c => c.id === ref.id) ?? null;
    case 'rfi':
      return store.rfis.find(r => r.id === ref.id) ?? null;
    case 'submittal':
      return store.submittals.find(s => s.id === ref.id) ?? null;
    case 'punchItem':
      return store.punchItems.find(p => p.id === ref.id) ?? null;
    case 'warranty':
      return store.warranties.find(w => w.id === ref.id) ?? null;
    case 'photo':
      return store.projectPhotos.find(p => p.id === ref.id) ?? null;
    case 'dailyReport': {
      if (!ref.projectId || !store.getDailyReportsForProject) return null;
      return (
        store.getDailyReportsForProject(ref.projectId).find(d => d.id === ref.id) ??
        null
      );
    }
    case 'task': {
      if (!ref.projectId) return null;
      const project = store.projects.find(p => p.id === ref.projectId);
      const tasks = (project?.schedule?.tasks ?? []) as ScheduleTask[];
      return tasks.find(t => t.id === ref.id) ?? null;
    }
    case 'document':
    case 'permit':
    case 'payment':
    case 'subcontractor':
    case 'commitment':
    case 'planSheet':
    case 'commEvent':
    case 'portalMessage':
    case 'drawingPin':
    case 'planMarkup':
    case 'prequalPacket':
    case 'priceAlert':
    case 'delayEvent':
      // These live outside the core projects store. Consumers that need the
      // object can pass a richer store; we return null for the default shape.
      return null;
    default: {
      const _exhaustive: never = ref.kind;
      void _exhaustive;
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Label formatting
// ---------------------------------------------------------------------------

const KIND_LABEL: Record<EntityKind, string> = {
  project: 'Project',
  task: 'Task',
  photo: 'Photo',
  rfi: 'RFI',
  submittal: 'Submittal',
  changeOrder: 'Change Order',
  invoice: 'Invoice',
  payment: 'Payment',
  dailyReport: 'Daily Report',
  punchItem: 'Punch Item',
  warranty: 'Warranty',
  contact: 'Contact',
  document: 'Document',
  permit: 'Permit',
  equipment: 'Equipment',
  subcontractor: 'Sub',
  commitment: 'Contract',
  planSheet: 'Sheet',
  commEvent: 'Activity',
  portalMessage: 'Message',
  drawingPin: 'Pin',
  planMarkup: 'Markup',
  prequalPacket: 'Prequal',
  priceAlert: 'Price Alert',
  delayEvent: 'Delay Event',
};

/**
 * Human-readable display string for a ref. Prefers in-ref label, then looks up
 * the underlying object's natural title, then falls back to a generic
 * "Kind #shortid" form so UI always has something to show.
 */
export function formatEntityLabel(ref: EntityRef, store?: EntityStore): string {
  if (ref.label && ref.label.trim().length > 0) return ref.label;

  if (store) {
    const obj = resolveEntityObject(ref, store);
    if (obj) {
      const label = extractNaturalLabel(ref.kind, obj);
      if (label) return label;
    }
  }

  const short = ref.id.length > 8 ? ref.id.slice(-6) : ref.id;
  return `${KIND_LABEL[ref.kind]} #${short}`;
}

function extractNaturalLabel(kind: EntityKind, obj: unknown): string | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;

  switch (kind) {
    case 'project':
    case 'equipment':
      return typeof o.name === 'string' ? o.name : null;
    case 'task':
    case 'submittal':
    case 'warranty':
    case 'document':
      return typeof o.title === 'string' ? o.title : null;
    case 'rfi': {
      const subject = typeof o.subject === 'string' ? o.subject : '';
      const num = typeof o.number === 'number' ? `#${o.number}` : '';
      return subject ? `RFI ${num} · ${subject}`.trim() : null;
    }
    case 'changeOrder': {
      const desc = typeof o.description === 'string' ? o.description : '';
      const num = typeof o.number === 'number' ? `#${o.number}` : '';
      return desc ? `CO ${num} · ${desc}`.trim() : null;
    }
    case 'invoice': {
      const num = typeof o.number === 'number' ? `Invoice #${o.number}` : null;
      return num;
    }
    case 'punchItem':
      return typeof o.description === 'string' ? o.description : null;
    case 'dailyReport':
      return typeof o.date === 'string' ? `Daily Report · ${o.date}` : null;
    case 'photo':
      return typeof o.tag === 'string' && o.tag.length > 0
        ? `Photo · ${o.tag}`
        : null;
    case 'contact': {
      const first = typeof o.firstName === 'string' ? o.firstName : '';
      const last = typeof o.lastName === 'string' ? o.lastName : '';
      const full = `${first} ${last}`.trim();
      return full || null;
    }
    case 'permit':
      return typeof o.permitNumber === 'string' ? o.permitNumber : null;
    case 'payment':
      return typeof o.description === 'string' ? o.description : null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// One-shot resolver
// ---------------------------------------------------------------------------

export interface ResolvedEntity {
  /** The domain object, or null if not found in the store. */
  entity: unknown | null;
  /** Display label. Always non-empty. */
  label: string;
  /** Router target, or null if this kind has no dedicated screen. */
  route: EntityRoute | null;
}

/**
 * Convenience: one call returns everything a consumer needs to render a chip
 * and wire navigation. Equivalent to calling the three helpers above.
 */
export function resolveEntity(ref: EntityRef, store: EntityStore): ResolvedEntity {
  const entity = resolveEntityObject(ref, store);
  const label = formatEntityLabel(ref, store);
  const route = getEntityRoute(ref);
  return { entity, label, route };
}

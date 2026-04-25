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

export interface EntityRoute {
  pathname: string;
  params?: Record<string, string | number>;
}

/**
 * Map an EntityRef to the expo-router target that renders it. The returned
 * shape is accepted directly by `router.push(...)`.
 *
 * Returns `null` when the kind doesn't have a dedicated detail screen
 * (e.g. `dailyReport` is only rendered inside project-detail's modal grid).
 * Callers should fall back to the parent project in that case.
 */
export function getEntityRoute(ref: EntityRef): EntityRoute | null {
  switch (ref.kind) {
    case 'project':
      return { pathname: '/project-detail', params: { id: ref.id } };

    case 'contact':
      // Contacts live inside /contacts — no per-contact route yet.
      return { pathname: '/contacts', params: { contactId: ref.id } };

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
      // No per-item screen; deep-link the list with a selected id.
      if (!ref.projectId) return null;
      return {
        pathname: '/punch-list',
        params: { projectId: ref.projectId, punchItemId: ref.id },
      };

    case 'warranty':
      // warranties.tsx takes projectId only; the list pre-expands.
      if (!ref.projectId) return null;
      return {
        pathname: '/warranties',
        params: { projectId: ref.projectId, warrantyId: ref.id },
      };

    case 'photo':
      // Photos live inside project-detail. Send the user to the parent project
      // with a hint the host screen can read.
      if (!ref.projectId) return null;
      return {
        pathname: '/project-detail',
        params: { id: ref.projectId, focusPhotoId: ref.id },
      };

    case 'document':
      if (!ref.projectId) return null;
      return {
        pathname: '/documents',
        params: { projectId: ref.projectId, documentId: ref.id },
      };

    case 'permit':
      if (!ref.projectId) return null;
      return {
        pathname: '/permits',
        params: { projectId: ref.projectId, permitId: ref.id },
      };

    case 'task':
      // Schedule tasks open inside schedule-pro.
      if (!ref.projectId) return null;
      return {
        pathname: '/schedule-pro',
        params: { projectId: ref.projectId, taskId: ref.id },
      };

    case 'payment':
      // Payments are listed in /payments, no per-row detail yet.
      return { pathname: '/payments', params: { paymentId: ref.id } };

    case 'subcontractor':
      return {
        pathname: '/subs',
        params: { subcontractorId: ref.id },
      };

    case 'commitment':
      if (!ref.projectId) return null;
      return {
        pathname: '/project-detail',
        params: { id: ref.projectId, openCommitmentId: ref.id },
      };

    case 'planSheet':
      if (!ref.projectId) return null;
      return {
        pathname: '/plan-viewer',
        params: { sheetId: ref.id, projectId: ref.projectId },
      };

    case 'commEvent':
      if (!ref.projectId) return null;
      return {
        pathname: '/activity-feed',
        params: { projectId: ref.projectId },
      };

    case 'portalMessage':
      if (!ref.projectId) return null;
      return {
        pathname: '/client-portal',
        params: { projectId: ref.projectId, messageId: ref.id },
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

// utils/punchExportCore.ts — the PURE half of "export the punch list".
//
// WHY. The founder, 2026-09-17: "make it a feature to export that punchlist
// please, allow me to export all items". He runs punch walks on real jobs
// (Watermark 9F: 63 items, every one with a photo). The export is a document a
// sub, an owner's rep and the GC each hold a copy of, so everything that makes
// two copies AGREE lives here and is executed by
// scripts/validate-punch-export.ts:
//
//   • numbers — one sequence over the WHOLE project (both lists, every status,
//     no filters), ordered by Date.parse(createdAt) then id, so a sub's
//     filtered copy says #14 where the GC's full copy says #14;
//   • refs — a stable 6-character slice of the item's uuid beside every
//     number, because deleting an item renumbers the ones after it;
//   • scope — "Everything" by default (both lists, every status), with the
//     crew list clearly labelled INTERNAL;
//   • dates — due dates are calendar days (never `new Date(due)`), created /
//     closed / updated are instants read as the LOCAL day;
//   • the CSV — RFC 4180, a formula-injection guard, stable columns.
//
// PURITY RULE (pinned by the guard): no react / react-native / expo / storage /
// supabase imports. Markup for each photo is resolved by the COMPONENT (it
// lives in a react-native module) and handed in as data.

import type {
  PhotoMarkup,
  PlanSheet,
  PunchItem,
  PunchItemPriority,
  PunchItemStatus,
  PunchListType,
} from '@/types';
import { punchListTypeOf } from '@/types';
import { stagesFor } from '@/utils/workflowPipelines';
import {
  calendarDayOf,
  daysUntilCalendarDay,
  parseCalendarDay,
  toCalendarDayString,
} from '@/utils/calendarDate';
import {
  groupPunchItemsByLocation,
  normalizeLocation,
  UNPLACED_LOCATION_GROUP,
  UNPLACED_LOCATION_LABEL,
} from '@/utils/punchLocations';
import { pinSheetLabel, sheetAspectRatio } from '@/utils/punchPlanPin';
import { planSheetImageState } from '@/utils/planSheetImageCore';
import { isDeviceLocalUri, isHttpUrl, looksLikeStoragePath } from '@/utils/photoUploadCore';
import { describeError } from '@/utils/errorCopy';

// ───────────────────────────────────────────────────────────────────────────
// Constants
// ───────────────────────────────────────────────────────────────────────────

/** Photos per PDF. Native numbers are MEASURED (spec 0a): expo-print embeds the
 *  source JPEG byte for byte and the app peaks at ~4.5x the PDF size, so 24
 *  full-size photos is ~63 MB of PDF and ~310 MB of app memory on iOS. Android
 *  is conservative and unmeasured (closeoutPacketGenerator records OOMs). */
export const PUNCH_EXPORT_PHOTO_CAP = { web: 100, ios: 24, android: 12 } as const;
/** All photo bytes in one native PDF. */
export const PUNCH_EXPORT_NATIVE_REMOTE_BUDGET_BYTES = { ios: 64_000_000, android: 32_000_000 } as const;
/** Local originals inlined as base64 (part of the budget above). */
export const PUNCH_EXPORT_NATIVE_INLINE_BUDGET_BYTES = { ios: 24_000_000, android: 12_000_000 } as const;
/** His average photo; used for the pre-press estimate only. */
export const PUNCH_EXPORT_TYPICAL_PHOTO_BYTES = 2_600_000;
/** When the server gives no length. */
export const PUNCH_EXPORT_UNKNOWN_PHOTO_BYTES = 3_000_000;
export const PUNCH_EXPORT_EMAIL_FRIENDLY_BYTES = 20_000_000;
export const PUNCH_EXPORT_WEB_THUMB_PX = 640;
export const PUNCH_EXPORT_WEB_THUMB_QUALITY = 0.72;
export const PUNCH_EXPORT_WEB_PLAN_MAX_PX = 2400;
export const PUNCH_EXPORT_WEB_PLAN_QUALITY = 0.88;
export const PUNCH_EXPORT_WEB_CONCURRENCY = 3;
export const PUNCH_EXPORT_NATIVE_CHECK_CONCURRENCY = 6;
/** One web photo's WHOLE pipeline (fetch + decode + canvas). */
export const PUNCH_EXPORT_FETCH_TIMEOUT_MS = 25_000;
/** One native HEAD / ranged GET. */
export const PUNCH_EXPORT_CHECK_TIMEOUT_MS = 15_000;
export const PUNCH_EXPORT_NATIVE_RENDER_TIMEOUT_MS = 240_000;
/** After this, a render that never settled is presumed dead (expo-print has no
 *  WebContent-termination handler, so a crash leaves its promise pending). */
export const PUNCH_EXPORT_NATIVE_BUSY_CEILING_MS = 480_000;
export const PUNCH_EXPORT_WEB_PRINT_WAIT_BASE_MS = 15_000;
export const PUNCH_EXPORT_WEB_PRINT_WAIT_PER_REMOTE_MS = 2_000;
export const PUNCH_EXPORT_WEB_PRINT_WAIT_MAX_MS = 90_000;
export const PUNCH_EXPORT_DIR_MAX_AGE_MS = 3_600_000;
/** Normalised sheet units, per axis. */
export const PUNCH_EXPORT_PIN_CLUSTER_EPS = 0.02;
export const PUNCH_EXPORT_PLAN_MAX_H_PX = 700;
export const PUNCH_EXPORT_PLAN_MAX_H_LANDSCAPE_PX = 600;
export const PUNCH_EXPORT_LANDSCAPE_MIN_ASPECT = 1.15;
export const PUNCH_EXPORT_LOGO_MAX_BYTES = 1_500_000;
/** Per-device convenience (format + photos). Under APP_STORAGE_PREFIXES. */
export const PUNCH_EXPORT_PREF_KEY = 'mageid_punch_export_pref';

export const PUNCH_STATUS_ORDER: PunchItemStatus[] = ['open', 'in_progress', 'ready_for_review', 'closed'];

export const PUNCH_EXPORT_CSV_COLUMNS = [
  'Item #', 'Ref', 'Location', 'Plan Sheet', 'Description', 'Assigned To', 'Status', 'Priority',
  'Due Date', 'Days Overdue', 'List', 'Created', 'Closed', 'Days Open', 'Rejection Note',
  'Linked Task', 'Has Photo', 'Photo GPS', 'Last Updated', 'Project', 'Item ID',
] as const;

export const PUNCH_EXPORT_PHOTO_TEXT = {
  unreachable: 'Photo not available (offline / not uploaded)',
  over_size: 'Photo not included — this PDF reached its size limit on a phone',
  over_offline_budget: 'Photo not added — no signal. Export again with signal to include it.',
  no_photo: 'No photo',
} as const;

export const PUNCH_EXPORT_NOT_PINNED = 'not pinned';
export const PUNCH_EXPORT_CREW_INTERNAL =
  'Crew list — internal working list. These items are not on the formal punch list and are never shown in the client portal.';
export const PUNCH_EXPORT_INTERNAL_STAMP = 'INTERNAL — includes the crew list. Not for the owner or client.';
export const PUNCH_EXPORT_DISCLAIMER =
  'Item numbers count every item on this project, on both lists, in the order it was logged, so a copy for one room or one sub uses the same numbers as the full list. Deleting an item renumbers the items logged after it; the 6-character ref beside each number never changes, so use it to match copies made on different days. Statuses are as recorded in MAGE ID when this report was generated.';

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

export type PunchExportScope = 'all' | 'filtered' | 'selected';
export type PunchExportFormat = 'pdf' | 'csv';
export type PunchExportTarget = 'web' | 'ios' | 'android';

export interface PunchExportFilters {
  status: PunchItemStatus | 'all';
  sub: string;
  priority: PunchItemPriority | 'all';
  locationKey: string;
  locationLabel: string;
}

export interface PunchExportScopeInput {
  allItems: readonly PunchItem[];
  filteredItems: readonly PunchItem[];
  selectedIds: readonly string[];
  activeList: PunchListType;
  filters: PunchExportFilters;
}

export interface PunchExportScopeOption {
  scope: PunchExportScope;
  label: string;
  detail: string;
  count: number;
  disabledReason: string | null;
}

export interface PunchExportListChoice { available: boolean; punchCount: number; crewCount: number }

export type PunchExportPlanRef =
  | { state: 'none' }
  | { state: 'pinned'; sheetId: string; sheetLabel: string; x: number; y: number }
  | { state: 'no-position'; sheetId: string; sheetLabel: string }
  | { state: 'sheet-missing' };

export interface PunchExportRow {
  id: string;
  number: number;
  ref: string;
  list: PunchListType;
  closed: boolean;
  status: PunchItemStatus;
  statusLabel: string;
  priority: PunchItemPriority;
  priorityLabel: string;
  description: string;
  typedLocation: string;
  groupKey: string;
  groupLabel: string;
  assignedTo: string;
  dueRaw: string;
  dueDay: string | null;
  daysOverdue: number | null;
  dueToday: boolean;
  createdDay: string | null;
  closedDay: string | null;
  updatedDay: string | null;
  daysOpen: number | null;
  rejectionNote: string;
  linkedTaskName: string;
  photoGps: string;
  hasPhoto: boolean;
  plan: PunchExportPlanRef;
  markup: readonly PhotoMarkup[];
}

export interface PunchExportSectionSummary {
  byStatus: Record<PunchItemStatus, number>;
  total: number;
  notDone: number;
  ready: number;
  overdue: number;
  withDueDate: number;
  closedPct: number;
}

export interface PunchExportGroup {
  key: string;
  label: string;
  kind: 'typed' | 'sheet' | 'unplaced';
  notDone: number;
  ready: number;
  total: number;
  rows: PunchExportRow[];
}

export interface PunchExportAreaRow { label: string; notDone: number; ready: number; total: number }

export interface PunchExportSection {
  list: PunchListType;
  label: string;
  internal: boolean;
  summary: PunchExportSectionSummary;
  groups: PunchExportGroup[];
  areas: PunchExportAreaRow[];
}

export interface PunchExportAssignee { label: string; byStatus: Record<PunchItemStatus, number>; total: number }

export interface PunchExportPhotoSlot {
  itemId: string;
  number: number;
  /** 0 = not closed (gets a slot first), 1 = closed. */
  priority: 0 | 1;
  storagePath?: string;
  localUri?: string;
  httpUri?: string;
}

export interface PunchExportPinMarker {
  key: string;
  x: number;
  y: number;
  numbers: number[];
  itemIds: string[];
  label: string;
  allClosed: boolean;
}

export interface PunchExportLegendRow {
  markerKey: string | null;
  markerLabel: string;
  firstOfMarker: boolean;
  number: number;
  ref: string;
  description: string;
  location: string;
  statusLabel: string;
  closed: boolean;
}

export interface PunchExportSheetPage {
  sheetId: string;
  label: string;
  superseded: boolean;
  aspect: number | null;
  storagePath?: string;
  imageUri?: string;
  imageState: 'durable' | 'device-only' | 'missing';
  markers: PunchExportPinMarker[];
  legend: PunchExportLegendRow[];
  pinnedCount: number;
}

export interface PunchExportModel {
  projectId: string;
  projectName: string;
  projectAddress: string;
  generatedAtIso: string;
  generatedAtLabel: string;
  generatedDay: string;
  scope: PunchExportScope;
  includeCrew: boolean;
  activeList: PunchListType;
  target: PunchExportTarget;
  photoCap: number;
  scopeLabel: string;
  totalCount: number;
  projectItemCount: number;
  hasCrew: boolean;
  internal: boolean;
  sections: PunchExportSection[];
  /** Ascending number = CSV order. */
  rows: PunchExportRow[];
  assignees: PunchExportAssignee[];
  /** Document order. */
  photoItemIds: string[];
  /** PRIORITY order (open first). */
  photoSlots: PunchExportPhotoSlot[];
  /** Document order. */
  photoOverCapIds: string[];
  sheetPages: PunchExportSheetPage[];
  includeSignOff: boolean;
}

export interface BuildPunchExportModelInput {
  scopeInput: PunchExportScopeInput;
  scope: PunchExportScope;
  includeCrew: boolean;
  target: PunchExportTarget;
  project: { id: string; name: string; location?: string | null };
  sheets: readonly PlanSheet[];
  markupByItemId: ReadonlyMap<string, readonly PhotoMarkup[]>;
  now: Date;
}

export type PunchExportImageMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | 'image/heic' | 'image/heif';
export type PunchExportUnavailableReason = 'unreachable' | 'over_cap' | 'over_size' | 'over_offline_budget';
export type PunchExportImageAsset =
  | { kind: 'image'; src: string; mime: PunchExportImageMime; width?: number; height?: number; bytes?: number; remote?: boolean }
  | { kind: 'unavailable'; reason: PunchExportUnavailableReason };

export interface PunchExportAssets {
  photos: ReadonlyMap<string, PunchExportImageAsset>;
  sheets: ReadonlyMap<string, PunchExportImageAsset>;
  approxBytes: number | null;
  remoteCount: number;
  includedPhotoCount: number;
}

export type PunchExportStage = 'photos' | 'render' | 'timeout' | 'write' | 'share-unavailable' | 'popup-blocked-twice' | 'busy';

export interface PunchExportProgress {
  step: 'signing' | 'photos' | 'plans' | 'building' | 'opening';
  done: number;
  total: number;
  approxBytes?: number | null;
  photoCount?: number;
}

export interface PunchExportPref { format: PunchExportFormat; photos: boolean }

export interface PunchExportPhotoEstimate { included: number; leftOut: number; approxBytes: number | null }

// ───────────────────────────────────────────────────────────────────────────
// Small helpers
// ───────────────────────────────────────────────────────────────────────────

function plural(n: number, one: string, many: string = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

function uniqueById<T extends { id: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const i of items) {
    if (!i || seen.has(i.id)) continue;
    seen.add(i.id);
    out.push(i);
  }
  return out;
}

/** "Hall 2" before "Hall 10". Copied from utils/punchLocations (private there);
 *  hand-rolled so CI and a laptop cannot disagree on ICU. */
function naturalCompare(a: string, b: string): number {
  const ax = a.match(/\d+|\D+/g) ?? [];
  const bx = b.match(/\d+|\D+/g) ?? [];
  const n = Math.min(ax.length, bx.length);
  for (let i = 0; i < n; i++) {
    const as = ax[i];
    const bs = bx[i];
    const an = /^\d/.test(as);
    const bn = /^\d/.test(bs);
    if (an && bn) {
      const d = Number(as) - Number(bs);
      if (d !== 0) return d;
    } else if (as !== bs) {
      return as < bs ? -1 : 1;
    }
  }
  return ax.length - bx.length;
}

/**
 * Photo GPS for the CSV: the stored coordinates when present
 * ("39.73920, -104.99030 (±8 m)"), then the label when it adds something
 * (photoGeoStamp swaps the "lat, lng" label for a street address when it has
 * signal). Falls back to the label alone.
 */
export function photoGpsText(item: Pick<PunchItem, 'photoLatitude' | 'photoLongitude' | 'photoLocationAccuracyMeters' | 'photoLocationLabel'>): string {
  const label = str(item.photoLocationLabel).replace(/\s+/g, ' ').trim();
  const lat = item.photoLatitude;
  const lng = item.photoLongitude;
  const ok = typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
  if (!ok) return label;
  const acc = item.photoLocationAccuracyMeters;
  const coords = `${(lat as number).toFixed(5)}, ${(lng as number).toFixed(5)}${
    typeof acc === 'number' && Number.isFinite(acc) && acc > 0 ? ` (±${Math.round(acc)} m)` : ''}`;
  if (!label) return coords;
  // A label that is itself the coordinates adds nothing.
  if (/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(label)) return coords;
  return `${coords} — ${label}`;
}

function emptyByStatus(): Record<PunchItemStatus, number> {
  return { open: 0, in_progress: 0, ready_for_review: 0, closed: 0 };
}

// ───────────────────────────────────────────────────────────────────────────
// Numbers and refs
// ───────────────────────────────────────────────────────────────────────────

/**
 * #1..#N over the WHOLE project list, ordered by Date.parse(createdAt) (an
 * unparseable one sorts last), ties by id with a plain `<` — a Photo walk
 * stamps one `now` on a whole batch, so ties are the normal case. Independent
 * of input order; duplicate ids keep their first occurrence.
 */
export function punchItemNumbers(items: readonly Pick<PunchItem, 'id' | 'createdAt'>[]): Map<string, number> {
  const unique = uniqueById(items);
  const keyed = unique.map(i => {
    const t = Date.parse(str(i.createdAt));
    return { id: i.id, t: Number.isFinite(t) ? t : Number.POSITIVE_INFINITY };
  });
  keyed.sort((a, b) => {
    if (a.t !== b.t) return a.t < b.t ? -1 : 1;
    if (a.id === b.id) return 0;
    return a.id < b.id ? -1 : 1;
  });
  const out = new Map<string, number>();
  keyed.forEach((k, i) => out.set(k.id, i + 1));
  return out;
}

/**
 * A short, stable ref per item: the first 6 characters of its id (lowercased,
 * [0-9a-z] only). While two items share a ref, every colliding ref grows by 2
 * characters, up to its full id. Computed over ALL items so a filtered copy
 * prints the same ref.
 */
export function shortRefs(items: readonly Pick<PunchItem, 'id'>[]): Map<string, string> {
  const unique = uniqueById(items);
  const base = new Map<string, string>();
  const len = new Map<string, number>();
  for (const i of unique) {
    const b = i.id.toLowerCase().replace(/[^0-9a-z]/g, '') || 'item';
    base.set(i.id, b);
    len.set(i.id, Math.min(6, b.length));
  }
  const refOf = (id: string) => (base.get(id) as string).slice(0, len.get(id) as number);
  for (;;) {
    const groups = new Map<string, string[]>();
    for (const i of unique) {
      const r = refOf(i.id);
      const g = groups.get(r);
      if (g) g.push(i.id);
      else groups.set(r, [i.id]);
    }
    let changed = false;
    for (const ids of groups.values()) {
      if (ids.length < 2) continue;
      for (const id of ids) {
        const b = base.get(id) as string;
        const cur = len.get(id) as number;
        const next = Math.min(cur + 2, b.length);
        if (next !== cur) { len.set(id, next); changed = true; }
      }
    }
    if (!changed) break;
  }
  const out = new Map<string, string>();
  for (const i of unique) out.set(i.id, refOf(i.id));
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// Labels
// ───────────────────────────────────────────────────────────────────────────

export function statusLabel(s: string): string {
  const stage = stagesFor('punch').find(st => st.key === s);
  if (stage) return stage.label;
  return str(s).replace(/_/g, ' ').replace(/\b[a-z]/g, c => c.toUpperCase());
}

export function priorityLabel(p: string): string {
  if (p === 'low') return 'Low';
  if (p === 'medium') return 'Medium';
  if (p === 'high') return 'High';
  return str(p);
}

export function listLabel(l: PunchListType): string {
  return l === 'crew' ? 'Crew list (internal)' : 'Punch list';
}

export function listChoice(allItems: readonly PunchItem[]): PunchExportListChoice {
  let punchCount = 0;
  let crewCount = 0;
  for (const i of uniqueById(allItems)) {
    if (punchListTypeOf(i) === 'crew') crewCount++;
    else punchCount++;
  }
  return { available: punchCount > 0 && crewCount > 0, punchCount, crewCount };
}

// ───────────────────────────────────────────────────────────────────────────
// Scope
// ───────────────────────────────────────────────────────────────────────────

export function itemsInScope(input: PunchExportScopeInput, scope: PunchExportScope, includeCrew: boolean): PunchItem[] {
  const all = uniqueById(input.allItems);
  if (scope === 'filtered') {
    const wanted = new Set(input.filteredItems.map(i => i.id));
    return all.filter(i => wanted.has(i.id));
  }
  if (scope === 'selected') {
    const wanted = new Set(input.selectedIds);
    return all.filter(i => wanted.has(i.id));
  }
  return includeCrew ? all : all.filter(i => punchListTypeOf(i) !== 'crew');
}

export function describeFilters(filters: PunchExportFilters, activeList: PunchListType): string {
  const parts: string[] = [listLabel(activeList)];
  if (filters.status !== 'all') parts.push(statusLabel(filters.status));
  if (filters.sub) parts.push(`Sub: ${filters.sub}`);
  if (filters.priority !== 'all') parts.push(`${priorityLabel(filters.priority)} priority`);
  if (filters.locationKey) {
    const loc = filters.locationLabel
      || (filters.locationKey === UNPLACED_LOCATION_GROUP ? UNPLACED_LOCATION_LABEL : filters.locationKey);
    parts.push(`Location: ${loc}`);
  }
  return parts.join(' · ');
}

export function describeScope(input: PunchExportScopeInput, scope: PunchExportScope, includeCrew: boolean): string {
  const all = uniqueById(input.allItems);
  const n = all.length;
  const choice = listChoice(all);
  if (scope === 'filtered') {
    const k = itemsInScope(input, 'filtered', includeCrew).length;
    return `Filtered: ${k} of ${plural(n, 'item')} — ${describeFilters(input.filters, input.activeList)}`;
  }
  if (scope === 'selected') {
    const sel = itemsInScope(input, 'selected', includeCrew);
    const lists = new Set(sel.map(i => punchListTypeOf(i)));
    const tail = sel.length > 0 && lists.size === 1 ? ` — ${listLabel([...lists][0])}` : '';
    return `Selected: ${sel.length} of ${plural(n, 'item')}${tail}`;
  }
  if (choice.available) {
    if (includeCrew) {
      return `All ${plural(n, 'item')} — ${choice.punchCount} on the punch list, ${choice.crewCount} on the crew list (internal)`;
    }
    return `All ${plural(choice.punchCount, 'punch list item')} — crew list left out`;
  }
  if (choice.crewCount > 0 && choice.punchCount === 0) return `All ${plural(n, 'item')} — crew list (internal)`;
  return `All ${plural(n, 'item')}`;
}

export function exportDisabledReason(args: { projectItemCount: number; scope: PunchExportScope; count: number }): string | null {
  if (args.projectItemCount === 0) return 'Nothing to export yet — add a punch item first.';
  if (args.count === 0) {
    if (args.scope === 'filtered') return 'Nothing matches the filters on screen. Choose Everything, or clear a filter.';
    if (args.scope === 'selected') return 'No items are selected. Choose Everything, or select items first.';
    return 'Nothing to export in this choice.';
  }
  return null;
}

export function scopeOptions(input: PunchExportScopeInput, includeCrew: boolean): PunchExportScopeOption[] {
  const all = uniqueById(input.allItems);
  const projectItemCount = all.length;
  const choice = listChoice(all);
  const out: PunchExportScopeOption[] = [];

  const allCount = itemsInScope(input, 'all', includeCrew).length;
  let allDetail = `${plural(allCount, 'item')} · every status`;
  if (choice.available) allDetail += includeCrew ? ' · punch and crew lists' : ' · punch list only';
  out.push({
    scope: 'all',
    label: 'Everything',
    detail: allDetail,
    count: allCount,
    disabledReason: exportDisabledReason({ projectItemCount, scope: 'all', count: allCount }),
  });

  if (input.filteredItems.length < all.length) {
    const k = itemsInScope(input, 'filtered', includeCrew).length;
    out.push({
      scope: 'filtered',
      label: "What's on screen",
      detail: `${plural(k, 'item')} · ${describeFilters(input.filters, input.activeList)}`,
      count: k,
      disabledReason: exportDisabledReason({ projectItemCount, scope: 'filtered', count: k }),
    });
  }

  const sel = itemsInScope(input, 'selected', includeCrew).length;
  if (sel > 0) {
    out.push({
      scope: 'selected',
      label: `Selected (${sel})`,
      detail: 'The items you ticked',
      count: sel,
      disabledReason: exportDisabledReason({ projectItemCount, scope: 'selected', count: sel }),
    });
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// Photos
// ───────────────────────────────────────────────────────────────────────────

export function photoCandidatesFor(item: Pick<PunchItem, 'photoUri' | 'photoStoragePath' | 'photoLocalUri'>): {
  storagePath?: string; localUri?: string; httpUri?: string;
} {
  const out: { storagePath?: string; localUri?: string; httpUri?: string } = {};
  const sp = str(item.photoStoragePath).trim();
  const pu = str(item.photoUri).trim();
  if (sp && looksLikeStoragePath(sp)) out.storagePath = sp;
  else if (pu && looksLikeStoragePath(pu)) out.storagePath = pu;
  for (const c of [str(item.photoLocalUri).trim(), pu]) {
    if (c && isDeviceLocalUri(c)) { out.localUri = c; break; }
  }
  if (pu && isHttpUrl(pu)) out.httpUri = pu;
  return out;
}

export function itemHasPhoto(item: Pick<PunchItem, 'photoUri' | 'photoStoragePath' | 'photoLocalUri'>): boolean {
  const c = photoCandidatesFor(item);
  return !!(c.storagePath || c.localUri || c.httpUri);
}

export function countPhotos(items: readonly PunchItem[]): number {
  return items.filter(itemHasPhoto).length;
}

export function photoCapFor(target: PunchExportTarget): number {
  return PUNCH_EXPORT_PHOTO_CAP[target];
}

export function overCapPhotoText(target: PunchExportTarget): string {
  const cap = photoCapFor(target);
  return target === 'web'
    ? `Photo not included — one PDF holds up to ${cap} photos`
    : `Photo not included — a PDF made on a phone holds up to ${cap} photos`;
}

export function nativePhotoEstimate(args: { photoCount: number; target: PunchExportTarget }): PunchExportPhotoEstimate {
  const n = Math.max(0, args.photoCount);
  const cap = photoCapFor(args.target);
  const included = Math.min(n, cap);
  return {
    included,
    leftOut: n - included,
    approxBytes: args.target === 'web' ? null : included * PUNCH_EXPORT_TYPICAL_PHOTO_BYTES,
  };
}

function mb(bytes: number): number {
  return Math.round(bytes / 1e6);
}

export function photoNotes(args: {
  target: PunchExportTarget; format: PunchExportFormat; includePhotos: boolean; photoCount: number;
}): string[] {
  if (args.format === 'csv') return [];
  if (!args.includePhotos) return ['The PDF lists every item in a compact table, without photos.'];
  const n = args.photoCount;
  if (n <= 0) return ['None of these items has a photo, so the PDF will be a compact table.'];
  const cap = photoCapFor(args.target);
  if (args.target === 'web') {
    const out = ['Each photo goes in as a small copy, so the PDF stays small enough to email.'];
    if (n > cap) {
      out.push(`One PDF holds up to ${cap} photos — the first ${cap} (open items first) go in and the other ${n - cap} print "Photo not included". Export one room or one sub at a time to get every photo.`);
    }
    return out;
  }
  const est = nativePhotoEstimate({ photoCount: n, target: args.target });
  const bytes = est.approxBytes ?? 0;
  if (n <= cap) {
    let line = `Photos go in at full size on a phone — about ${mb(bytes)} MB.`;
    if (bytes > PUNCH_EXPORT_EMAIL_FRIENDLY_BYTES) line += ' Too big for most email; AirDrop, Messages or Mail Drop will take it.';
    return [line];
  }
  return [
    `A PDF made on a phone carries up to ${cap} photos, at full size — about ${mb(bytes)} MB. Open items get them first; the other ${est.leftOut} print "Photo not included".`,
    `For all ${n} photos in one small file, export from app.mageid.app on a computer — or export one room or one sub at a time.`,
  ];
}

// ───────────────────────────────────────────────────────────────────────────
// Dates
// ───────────────────────────────────────────────────────────────────────────

/** Mirrors the screen's daysUntilDue: the due date is a CALENDAR DAY. */
export function dueInfo(item: Pick<PunchItem, 'dueDate' | 'status'>, now: Date): {
  dueRaw: string; dueDay: string | null; daysOverdue: number | null; dueToday: boolean;
} {
  const dueRaw = str(item.dueDate).trim();
  const dueDay = parseCalendarDay(dueRaw) ? dueRaw.slice(0, 10) : null;
  if (!dueDay || item.status === 'closed') return { dueRaw, dueDay, daysOverdue: null, dueToday: false };
  const d = daysUntilCalendarDay(dueDay, now);
  return {
    dueRaw,
    dueDay,
    daysOverdue: d !== null && d < 0 ? -d : null,
    dueToday: d === 0,
  };
}

/** Whole calendar days from day a to day b (both 'YYYY-MM-DD'). */
export function calendarDaysBetween(a: string | null | undefined, b: string | null | undefined): number | null {
  const da = parseCalendarDay(a);
  const db = parseCalendarDay(b);
  if (!da || !db) return null;
  const ua = Date.UTC(da.getFullYear(), da.getMonth(), da.getDate());
  const ub = Date.UTC(db.getFullYear(), db.getMonth(), db.getDate());
  return Math.round((ub - ua) / 86_400_000);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'Sep 17, 2026 at 3:42 PM (GMT-6)' from LOCAL getters — built by hand so the
 *  label never depends on the device's ICU. */
export function formatGeneratedAt(d: Date): string {
  const h24 = d.getHours();
  const h12 = h24 % 12 || 12;
  const ampm = h24 < 12 ? 'AM' : 'PM';
  const mins = String(d.getMinutes()).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  let tz = 'GMT';
  if (off !== 0) {
    const sign = off > 0 ? '+' : '-';
    const abs = Math.abs(off);
    const oh = Math.floor(abs / 60);
    const om = abs % 60;
    tz = `GMT${sign}${oh}${om ? `:${String(om).padStart(2, '0')}` : ''}`;
  }
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} at ${h12}:${mins} ${ampm} (${tz})`;
}

// ───────────────────────────────────────────────────────────────────────────
// File names
// ───────────────────────────────────────────────────────────────────────────

export function projectSlug(name: string | null | undefined): string {
  const slug = str(name)
    .normalize('NFKD')
    .replace(/[\u0300-\u036F]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug || 'project';
}

export function exportFileName(args: {
  projectName: string; scope: PunchExportScope; hasCrew: boolean; format: 'pdf' | 'csv' | 'html'; now: Date;
}): string {
  const scopePart = args.scope === 'all' ? '' : args.scope === 'filtered' ? '-filtered' : '-selected';
  const internalPart = args.hasCrew ? '-internal' : '';
  return `punch-list-${projectSlug(args.projectName)}${scopePart}${internalPart}-${toCalendarDayString(args.now)}.${args.format}`;
}

// ───────────────────────────────────────────────────────────────────────────
// Pins
// ───────────────────────────────────────────────────────────────────────────

/** '14–21', '3, 9–11, 30', '1, 3, 5 +2'. */
export function formatNumberRuns(nums: readonly number[], maxParts = 3): string {
  const sorted = [...new Set(nums.filter(n => Number.isFinite(n)))].sort((a, b) => a - b);
  const parts: { text: string; count: number }[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    const runLen = j - i + 1;
    if (runLen >= 3) parts.push({ text: `${sorted[i]}–${sorted[j]}`, count: runLen });
    else for (let k = i; k <= j; k++) parts.push({ text: String(sorted[k]), count: 1 });
    i = j + 1;
  }
  if (parts.length <= maxParts) return parts.map(p => p.text).join(', ');
  const shown = parts.slice(0, maxParts);
  const hidden = parts.slice(maxParts).reduce((s, p) => s + p.count, 0);
  return `${shown.map(p => p.text).join(', ')} +${hidden}`;
}

/**
 * One marker per spot. A pin joins the FIRST marker whose anchor (its first
 * pin) is within eps on BOTH axes, else starts its own. "Pin this room" gives a
 * whole burst identical coordinates; eight overlapping "14".."21" bubbles is an
 * unreadable blot, one bubble reading "14–21" is a list.
 */
export function clusterPins(
  pins: readonly { itemId: string; number: number; x: number; y: number; closed: boolean }[],
  eps: number = PUNCH_EXPORT_PIN_CLUSTER_EPS,
): PunchExportPinMarker[] {
  const sorted = [...pins].sort((a, b) => a.number - b.number);
  const groups: { x: number; y: number; pins: typeof sorted }[] = [];
  for (const p of sorted) {
    const g = groups.find(m => Math.abs(m.x - p.x) <= eps && Math.abs(m.y - p.y) <= eps);
    if (g) g.pins.push(p);
    else groups.push({ x: p.x, y: p.y, pins: [p] });
  }
  return groups.map((g, i) => {
    const numbers = g.pins.map(p => p.number);
    return {
      key: `m${i}`,
      x: g.x,
      y: g.y,
      numbers,
      itemIds: g.pins.map(p => p.itemId),
      label: formatNumberRuns(numbers),
      allClosed: g.pins.every(p => p.closed),
    };
  });
}

// ───────────────────────────────────────────────────────────────────────────
// The model
// ───────────────────────────────────────────────────────────────────────────

export function planRefFor(item: PunchItem, sheetsById: ReadonlyMap<string, PlanSheet>): PunchExportPlanRef {
  const sheetId = str(item.planSheetId);
  if (!sheetId) return { state: 'none' };
  const sheet = sheetsById.get(sheetId);
  if (!sheet) return { state: 'sheet-missing' };
  const sheetLabel = pinSheetLabel(sheet);
  const { pinX: x, pinY: y } = item;
  if (typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y)
    && x >= 0 && x <= 1 && y >= 0 && y <= 1) {
    return { state: 'pinned', sheetId, sheetLabel, x, y };
  }
  return { state: 'no-position', sheetId, sheetLabel };
}

function summarise(rows: readonly PunchExportRow[]): PunchExportSectionSummary {
  const byStatus = emptyByStatus();
  let overdue = 0;
  let withDueDate = 0;
  for (const r of rows) {
    if (r.status in byStatus) byStatus[r.status] += 1;
    if ((r.daysOverdue ?? 0) > 0) overdue += 1;
    if (r.dueDay) withDueDate += 1;
  }
  const total = rows.length;
  const closed = rows.filter(r => r.closed).length;
  return {
    byStatus,
    total,
    notDone: total - closed,
    ready: rows.filter(r => r.status === 'ready_for_review').length,
    overdue,
    withDueDate,
    closedPct: total > 0 ? Math.round((closed / total) * 100) : 0,
  };
}

export function buildPunchExportModel(input: BuildPunchExportModelInput): PunchExportModel {
  const { scopeInput, scope, includeCrew, target, project, now } = input;
  const allItems = uniqueById(scopeInput.allItems);
  // ALWAYS over the whole list — a filtered copy keeps full-list numbers.
  const numbers = punchItemNumbers(allItems);
  const refs = shortRefs(allItems);
  const sheetsById = new Map<string, PlanSheet>();
  for (const s of input.sheets) if (s && s.id) sheetsById.set(s.id, s);
  const todayDay = toCalendarDayString(now);

  const items = itemsInScope(scopeInput, scope, includeCrew)
    .sort((a, b) => (numbers.get(a.id) ?? 0) - (numbers.get(b.id) ?? 0));

  const toRow = (item: PunchItem): PunchExportRow => {
    const due = dueInfo(item, now);
    const closed = item.status === 'closed';
    const createdDay = calendarDayOf(item.createdAt);
    const closedDay = closed ? calendarDayOf(item.closedAt) : null;
    // A closed item with no closedAt (the StatusPipeline close path does not
    // stamp one) has an unknown end — blank, never a count that grows to today.
    const daysOpenRaw = !createdDay || (closed && !closedDay)
      ? null
      : calendarDaysBetween(createdDay, closedDay ?? todayDay);
    return {
      id: item.id,
      number: numbers.get(item.id) ?? 0,
      ref: refs.get(item.id) ?? '',
      list: punchListTypeOf(item),
      closed,
      status: item.status,
      statusLabel: statusLabel(item.status),
      priority: item.priority,
      priorityLabel: priorityLabel(item.priority),
      description: str(item.description),
      typedLocation: str(item.location).replace(/\s+/g, ' ').trim(),
      groupKey: '',
      groupLabel: '',
      assignedTo: str(item.assignedSub).trim(),
      dueRaw: due.dueRaw,
      dueDay: due.dueDay,
      daysOverdue: due.daysOverdue,
      dueToday: due.dueToday,
      createdDay,
      closedDay,
      updatedDay: calendarDayOf(item.updatedAt),
      daysOpen: daysOpenRaw === null ? null : Math.max(0, daysOpenRaw),
      rejectionNote: str(item.rejectionNote).trim(),
      linkedTaskName: str(item.linkedTaskName).trim(),
      photoGps: photoGpsText(item),
      hasPhoto: itemHasPhoto(item),
      plan: planRefFor(item, sheetsById),
      markup: input.markupByItemId.get(item.id) ?? [],
    };
  };

  const rowById = new Map<string, PunchExportRow>();
  for (const it of items) rowById.set(it.id, toRow(it));

  // ── Sections, with effective-location groups ──────────────────────────
  const sections: PunchExportSection[] = [];
  for (const list of ['punch', 'crew'] as PunchListType[]) {
    const sectionItems = items.filter(i => punchListTypeOf(i) === list);
    if (sectionItems.length === 0) continue;
    const located = groupPunchItemsByLocation(sectionItems, { order: 'alpha' });
    const ordered: PunchExportGroup[] = [];
    const sheetGroups = new Map<string, PunchExportGroup>();
    let unplaced: PunchExportGroup | null = null;
    const newGroup = (key: string, label: string, kind: PunchExportGroup['kind']): PunchExportGroup =>
      ({ key, label, kind, notDone: 0, ready: 0, total: 0, rows: [] });

    for (const sec of located) {
      if (!sec.isUnplaced) {
        const g = newGroup(`loc:${sec.key}`, sec.label, 'typed');
        for (const it of sec.items) g.rows.push(rowById.get(it.id) as PunchExportRow);
        ordered.push(g);
        continue;
      }
      for (const it of sec.items) {
        const row = rowById.get(it.id) as PunchExportRow;
        const plan = row.plan;
        if (plan.state === 'pinned' || plan.state === 'no-position') {
          let g = sheetGroups.get(plan.sheetId);
          if (!g) {
            const sheet = sheetsById.get(plan.sheetId);
            const label = `${plan.sheetLabel}${sheet?.superseded ? ' (older revision)' : ''} — pinned, no room typed`;
            g = newGroup(`sheet:${plan.sheetId}`, label, 'sheet');
            sheetGroups.set(plan.sheetId, g);
            ordered.push(g);
          }
          g.rows.push(row);
        } else {
          if (!unplaced) unplaced = newGroup(UNPLACED_LOCATION_GROUP, UNPLACED_LOCATION_LABEL, 'unplaced');
          unplaced.rows.push(row);
        }
      }
    }
    ordered.sort((a, b) => {
      const c = naturalCompare(normalizeLocation(a.label), normalizeLocation(b.label));
      if (c !== 0) return c;
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    });
    if (unplaced) ordered.push(unplaced);
    for (const g of ordered) {
      g.rows.sort((a, b) => a.number - b.number);
      g.total = g.rows.length;
      g.notDone = g.rows.filter(r => !r.closed).length;
      g.ready = g.rows.filter(r => r.status === 'ready_for_review').length;
      for (const r of g.rows) { r.groupKey = g.key; r.groupLabel = g.label; }
    }
    const sectionRows = ordered.flatMap(g => g.rows);
    sections.push({
      list,
      label: listLabel(list),
      internal: list === 'crew',
      summary: summarise(sectionRows),
      groups: ordered,
      areas: ordered.map(g => ({ label: g.label, notDone: g.notDone, ready: g.ready, total: g.total })),
    });
  }

  const docRows = sections.flatMap(s => s.groups.flatMap(g => g.rows));
  const rows = [...docRows].sort((a, b) => a.number - b.number);

  // ── Plan pages ────────────────────────────────────────────────────────
  const sheetPages: PunchExportSheetPage[] = [];
  const pinnedBySheet = new Map<string, PunchExportRow[]>();
  const noPosBySheet = new Map<string, PunchExportRow[]>();
  for (const r of rows) {
    if (r.plan.state === 'pinned') {
      const arr = pinnedBySheet.get(r.plan.sheetId) ?? [];
      arr.push(r);
      pinnedBySheet.set(r.plan.sheetId, arr);
    } else if (r.plan.state === 'no-position') {
      const arr = noPosBySheet.get(r.plan.sheetId) ?? [];
      arr.push(r);
      noPosBySheet.set(r.plan.sheetId, arr);
    }
  }
  const legendLocation = (r: PunchExportRow) => r.typedLocation || UNPLACED_LOCATION_LABEL;
  for (const [sheetId, pinned] of pinnedBySheet) {
    const sheet = sheetsById.get(sheetId) as PlanSheet;
    const markers = clusterPins(pinned.map(r => {
      const p = r.plan as Extract<PunchExportPlanRef, { state: 'pinned' }>;
      return { itemId: r.id, number: r.number, x: p.x, y: p.y, closed: r.closed };
    }));
    const legend: PunchExportLegendRow[] = [];
    for (const m of markers) {
      const mrows = m.itemIds.map(id => rowById.get(id) as PunchExportRow).sort((a, b) => a.number - b.number);
      mrows.forEach((r, i) => legend.push({
        markerKey: m.key,
        markerLabel: m.label,
        firstOfMarker: i === 0,
        number: r.number,
        ref: r.ref,
        description: r.description,
        location: legendLocation(r),
        statusLabel: r.statusLabel,
        closed: r.closed,
      }));
    }
    for (const r of noPosBySheet.get(sheetId) ?? []) {
      legend.push({
        markerKey: null,
        markerLabel: '—',
        firstOfMarker: true,
        number: r.number,
        ref: r.ref,
        description: r.description,
        location: legendLocation(r),
        statusLabel: r.statusLabel,
        closed: r.closed,
      });
    }
    const page: PunchExportSheetPage = {
      sheetId,
      label: pinSheetLabel(sheet),
      superseded: !!sheet.superseded,
      aspect: sheetAspectRatio(sheet),
      imageState: planSheetImageState(sheet),
      markers,
      legend,
      pinnedCount: pinned.length,
    };
    if (sheet.storagePath) page.storagePath = sheet.storagePath;
    if (sheet.imageUri) page.imageUri = sheet.imageUri;
    sheetPages.push(page);
  }
  sheetPages.sort((a, b) => {
    const c = naturalCompare(a.label.toLowerCase(), b.label.toLowerCase());
    if (c !== 0) return c;
    return a.sheetId < b.sheetId ? -1 : a.sheetId > b.sheetId ? 1 : 0;
  });

  // ── Photos: open items get the slots first ────────────────────────────
  const photoRows = docRows.filter(r => r.hasPhoto);
  const photoItemIds = photoRows.map(r => r.id);
  const cap = photoCapFor(target);
  const priorityOrder = [...photoRows.filter(r => !r.closed), ...photoRows.filter(r => r.closed)];
  const slotted = priorityOrder.slice(0, cap);
  const slottedIds = new Set(slotted.map(r => r.id));
  const itemById = new Map(items.map(i => [i.id, i]));
  const photoSlots: PunchExportPhotoSlot[] = slotted.map(r => ({
    itemId: r.id,
    number: r.number,
    priority: r.closed ? 1 : 0,
    ...photoCandidatesFor(itemById.get(r.id) as PunchItem),
  }));
  const photoOverCapIds = photoItemIds.filter(id => !slottedIds.has(id));

  // ── Assignees ─────────────────────────────────────────────────────────
  const buckets = new Map<string, PunchExportAssignee & { notDone: number }>();
  for (const r of rows) {
    const key = r.assignedTo.toLowerCase();
    let b = buckets.get(key);
    if (!b) {
      b = { label: key === '' ? 'Unassigned' : r.assignedTo, byStatus: emptyByStatus(), total: 0, notDone: 0 };
      buckets.set(key, b);
    }
    if (r.status in b.byStatus) b.byStatus[r.status] += 1;
    b.total += 1;
    if (!r.closed) b.notDone += 1;
  }
  let assignees: PunchExportAssignee[] = [];
  if (buckets.size >= 2) {
    const named = [...buckets.entries()].filter(([k]) => k !== '').map(([, b]) => b);
    named.sort((a, b) => (b.notDone - a.notDone) || naturalCompare(a.label.toLowerCase(), b.label.toLowerCase()));
    const un = buckets.get('');
    assignees = [...named, ...(un ? [un] : [])].map(b => ({ label: b.label, byStatus: b.byStatus, total: b.total }));
  }

  const hasCrew = rows.some(r => r.list === 'crew');
  const address = str(project.location).trim();

  return {
    projectId: project.id,
    projectName: str(project.name),
    projectAddress: address === 'United States' ? '' : address,
    generatedAtIso: now.toISOString(),
    generatedAtLabel: formatGeneratedAt(now),
    generatedDay: todayDay,
    scope,
    includeCrew,
    activeList: scopeInput.activeList,
    target,
    photoCap: cap,
    scopeLabel: describeScope(scopeInput, scope, includeCrew),
    totalCount: rows.length,
    projectItemCount: allItems.length,
    hasCrew,
    internal: hasCrew,
    sections,
    rows,
    assignees,
    photoItemIds,
    photoSlots,
    photoOverCapIds,
    sheetPages,
    includeSignOff: sections.some(s => s.list === 'punch') && !hasCrew,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// CSV
// ───────────────────────────────────────────────────────────────────────────

/**
 * One CSV cell. RFC 4180 quoting, plus the OWASP formula-injection guard: a
 * string starting with = + - @ TAB or CR gets a leading apostrophe so Excel /
 * Sheets do not run "=HYPERLINK(...)" typed into a description. Numbers are
 * never prefixed (a real negative number is data, not a formula).
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  let s = String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[,"\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * The ref as a spreadsheet cell: the same "ref 4e0123" text the PDF card
 * prints. A bare hex slice is read as a number by Excel/Sheets/Numbers about
 * 3% of the time ('052331' loses its zero, '4e0123' becomes 4E+123), which
 * breaks the match-copies-by-ref promise. A leading word can never parse.
 */
export function csvRefCell(ref: string): string {
  return ref ? `ref ${ref}` : '';
}

function planSheetCell(plan: PunchExportPlanRef): string {
  if (plan.state === 'pinned' || plan.state === 'no-position') return plan.sheetLabel;
  if (plan.state === 'sheet-missing') return '(sheet removed)';
  return '';
}

export function buildPunchExportCsv(model: PunchExportModel): string {
  const lines: string[] = [PUNCH_EXPORT_CSV_COLUMNS.map(c => csvCell(c)).join(',')];
  for (const r of model.rows) {
    const cells: (string | number | null)[] = [
      r.number,
      csvRefCell(r.ref),
      r.typedLocation,
      planSheetCell(r.plan),
      r.description,
      r.assignedTo,
      r.statusLabel,
      r.priorityLabel,
      r.dueDay ?? r.dueRaw,
      r.daysOverdue !== null && r.daysOverdue > 0 ? r.daysOverdue : null,
      listLabel(r.list),
      r.createdDay,
      r.closedDay,
      r.daysOpen,
      r.rejectionNote,
      r.linkedTaskName,
      r.hasPhoto ? 'Yes' : 'No',
      r.photoGps,
      r.updatedDay,
      model.projectName,
      r.id,
    ];
    lines.push(cells.map(c => csvCell(c)).join(','));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

// ───────────────────────────────────────────────────────────────────────────
// Copy
// ───────────────────────────────────────────────────────────────────────────

export function photoSummaryLine(model: PunchExportModel, assets: PunchExportAssets, includePhotos: boolean): string {
  if (!includePhotos || model.photoItemIds.length === 0) return '';
  const overCap = new Set(model.photoOverCapIds);
  const counts: Record<PunchExportUnavailableReason, number> = { unreachable: 0, over_cap: 0, over_size: 0, over_offline_budget: 0 };
  let k = 0;
  for (const id of model.photoItemIds) {
    const a = assets.photos.get(id);
    if (!overCap.has(id) && a && a.kind === 'image') { k++; continue; }
    const reason: PunchExportUnavailableReason = overCap.has(id)
      ? 'over_cap'
      : a && a.kind === 'unavailable' ? a.reason : 'unreachable';
    counts[reason] += 1;
  }
  const phrase: Record<PunchExportUnavailableReason, string> = {
    unreachable: 'not available (offline / not uploaded)',
    over_cap: model.target === 'web'
      ? `left out (one PDF holds up to ${model.photoCap})`
      : `left out (a PDF made on a phone holds up to ${model.photoCap})`,
    over_size: 'left out (size limit on a phone)',
    over_offline_budget: 'not added (no signal)',
  };
  const reasons = (['unreachable', 'over_cap', 'over_size', 'over_offline_budget'] as PunchExportUnavailableReason[])
    .filter(r => counts[r] > 0)
    .map(r => `${counts[r]} ${phrase[r]}`);
  const n = model.photoItemIds.length;
  return `Photos: ${k} of ${n} in this report${reasons.length ? ` — ${reasons.join('; ')}` : ''}.`;
}

export function exportProgressCopy(p: PunchExportProgress, target: PunchExportTarget): string {
  switch (p.step) {
    case 'signing':
      return 'Getting photo links…';
    case 'photos':
      return target === 'web'
        ? `Preparing photos — ${p.done} of ${p.total}`
        : `Checking photos — ${p.done} of ${p.total}`;
    case 'plans':
      return `Preparing plan sheets — ${p.done} of ${p.total}`;
    case 'building': {
      const n = p.photoCount ?? 0;
      if (target !== 'web' && n > 0) {
        const m = typeof p.approxBytes === 'number' ? mb(p.approxBytes) : 0;
        const size = m >= 1 ? ` (about ${m} MB)` : '';
        return `Building the PDF with ${plural(n, 'full-size photo')}${size} — the screen may pause for a few seconds.`;
      }
      return 'Building the PDF…';
    }
    case 'opening':
      return 'Opening the print tab…';
  }
  return 'Building the PDF…';
}

/** Told in an alert: the export sheet has already closed when the share sheet fails. */
export function shareFailureCopy(kind: 'pdf' | 'csv'): { title: string; body: string } {
  const what = kind === 'pdf' ? 'PDF' : 'spreadsheet';
  return {
    title: `The ${what} was made but could not be shared`,
    body: `The share sheet did not open for the ${what}. Export again from the Punch List; if it keeps happening, restart the app or export from app.mageid.app on a computer.`,
  };
}

export function exportFailureCopy(stage: PunchExportStage, err?: unknown): { title: string; body: string } {
  switch (stage) {
    case 'timeout':
      return {
        title: 'The PDF took too long',
        body: 'Building the PDF ran past 4 minutes — usually a slow connection while it downloads full-size photos. The phone may need a few more minutes to let go of that attempt before another PDF can start; meanwhile the spreadsheet (CSV) works, or try the PDF with photos off or one room at a time. Your punch list is unchanged.',
      };
    case 'busy':
      return {
        title: 'Still finishing the last PDF',
        body: 'This phone is still building the previous PDF (it can take a few minutes after a slow attempt). The spreadsheet (CSV) works meanwhile — your punch list is unchanged.',
      };
    case 'share-unavailable':
      return {
        title: 'Nothing to share with',
        body: 'The file was made, but this device has no share sheet to hand it to another app. Try again, or export from app.mageid.app on a computer.',
      };
    case 'popup-blocked-twice':
      return {
        title: 'Pop-ups are blocked',
        body: 'Your browser blocked the print tab, so the report downloaded as an HTML file instead. Open it and use Print → Save as PDF, or allow pop-ups for this site and try again.',
      };
    case 'photos': {
      const c = describeError(err, { action: 'prepare the photos for this PDF', keptLocally: true });
      return { title: c.title, body: c.body };
    }
    case 'write': {
      const c = describeError(err, { action: 'save the punch list spreadsheet', keptLocally: true });
      return { title: c.title, body: c.body };
    }
    case 'render':
    default: {
      const c = describeError(err, { action: 'build the punch list PDF', keptLocally: true });
      return { title: c.title, body: c.body };
    }
  }
}

export function primaryLabel(args: {
  format: PunchExportFormat; target: PunchExportTarget; blocked: boolean; approxBytes: number | null;
}): string {
  if (args.blocked) return 'Open PDF';
  if (args.format === 'csv') return args.target === 'web' ? 'Download spreadsheet' : 'Share spreadsheet';
  if (args.target === 'web') return 'Open PDF';
  if (typeof args.approxBytes === 'number' && args.approxBytes >= 1e6) return `Share PDF (about ${mb(args.approxBytes)} MB)`;
  return 'Share PDF';
}

export function internalNote(hasCrew: boolean): string | null {
  return hasCrew ? 'Includes the internal crew list — the PDF and its file name are marked INTERNAL.' : null;
}

export function webPrintWaitMs(remoteCount: number): number {
  const n = Math.max(0, Number.isFinite(remoteCount) ? remoteCount : 0);
  return Math.min(PUNCH_EXPORT_WEB_PRINT_WAIT_MAX_MS, PUNCH_EXPORT_WEB_PRINT_WAIT_BASE_MS + PUNCH_EXPORT_WEB_PRINT_WAIT_PER_REMOTE_MS * n);
}

export function parseExportPref(raw: string | null | undefined): PunchExportPref | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== 'object') return null;
    const o = v as { format?: unknown; photos?: unknown };
    return {
      format: o.format === 'csv' ? 'csv' : 'pdf',
      photos: typeof o.photos === 'boolean' ? o.photos : true,
    };
  } catch {
    return null;
  }
}

export function serializeExportPref(p: PunchExportPref): string {
  return JSON.stringify(p);
}

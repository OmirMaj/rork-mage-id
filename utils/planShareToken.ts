// utils/planShareToken.ts
//
// The CLIENT-FACING projection of the Living Floor Plan, encoded into a
// URL-safe base64 token. Mirrors utils/photoShareToken.ts (and
// utils/scheduleOps.ts before it) so the share UX is identical: one tap →
// /shared-plan?t=<token>. A homeowner opens the link and drags a scrubber to
// watch their floor plan fill in, week by week, with the site photos that were
// actually taken by that date.
//
// WHY A SHARE TOKEN AND NOT THE PORTAL SNAPSHOT
// ---------------------------------------------
// Plan zones are local-first (AsyncStorage `mageid_plan_zones`) — there is no
// `plan_zones` table, so zone data cannot reach the static portal today. The
// two ways out were (a) bolt zones onto PortalSnapshot, or (b) build the table.
// (a) is cheaper on paper, but the only consumer of PortalSnapshot is the
// static marketing/portal/index.html — 6.8k lines of vanilla JS — so "render
// the zones there" means REIMPLEMENTING LivingFloorPlan in plain DOM. That is
// a fork of the exact component whose behavior we need to keep honest, and it
// would drag PORTAL_SNAPSHOT_VERSION 10→11 (plus a plan image + every pinned
// photo) into every existing portal URL for a section most portals won't show.
// (b) is a table + sync + RLS, i.e. the separate scope the plan doc defers.
//
// So: the same trick the OTHER client-facing viewers already use. It is still
// snapshot-based — a frozen payload the GC produced at share time — it just
// travels in the URL instead of a row, needs no new table, bumps no existing
// version, and lets /shared-plan render the REAL LivingFloorPlan component
// rather than a lookalike.
//
// THE FIREWALL
// ------------
// This module IS the client-facing safety boundary, in the same sense as
// utils/clientEstimateView.ts. `PlanSharePayload` is a strict allowlist and
// `buildPlanSharePayload` is the only way to produce one: it copies fields ONE
// BY ONE out of the domain objects. It never spreads a ScheduleTask, a
// PlanZone, or a ProjectPhoto, because a spread is how a field nobody audited
// ends up in a homeowner's URL.
//
// What is deliberately NOT here, and must never be added:
//   * anything money-adjacent — cost, price, markup, margin, unit price,
//     supplier, vendor, allowance, invoice, budget. Absolute product rule.
//   * internal task detail — task TITLE (they carry sub names and internal
//     shorthand), crew / assignedSubName, notes, rationale, linkedEstimateItems.
//   * schedule internals a homeowner would misread as blame — float / slack,
//     isCriticalPath, baseline days, actual-vs-planned deltas.
// A homeowner must never be able to work out which sub is behind.
//
// Pure (no react-native imports) so scripts/validate-plan-share.ts can
// exercise it under Bun.

import type { PlanZone, PlanSheet, ScheduleTask, DrawingPin, ProjectPhoto } from '@/types';

/** Hard cap on photos in a single share link — keeps the URL inside what SMS
 *  and email clients will carry without mangling. */
export const PLAN_SHARE_MAX_PHOTOS = 40;

/** Synthetic plan-sheet id used on the viewer side. The payload only ever
 *  carries ONE sheet, so the real sheet id (an internal identifier) never
 *  needs to travel. */
export const SHARE_PLAN_SHEET_ID = 'shared-plan-sheet';

/**
 * v1 payload. Field names are intentionally short to keep tokens small — and
 * intentionally explicit in this type, because this interface is the
 * allowlist. Adding a property here is a product decision, not a refactor.
 */
export interface PlanSharePayload {
  v: 1;
  /** Project label shown in the header. */
  n: string;
  /** GC / company name for the footer. */
  gc?: string;
  /** Schedule anchor, yyyy-mm-dd. Day 0 of the scrubber. */
  sd: string;
  /** Plan sheet image URL. Must be public / CDN-served to render for a
   *  recipient — local file:// URIs are dropped at build time. */
  img: string;
  /** Pixel dimensions of the plan image (drives aspect ratio). */
  iw?: number;
  ih?: number;
  /** Sheet label the GC gave the drawing, e.g. "A-101 Floor Plan". */
  sn?: string;
  /** The drawn rooms, in normalized 0–1 plan coords. */
  zones: {
    id: string;
    x: number; y: number; w: number; h: number;
    /** Room label the GC drew, e.g. "Kitchen". */
    l: string;
    /** Linked task ids, resolved against `tasks` below. */
    t: string[];
  }[];
  /**
   * Client-safe task projection: an id, the TRADE, and the two planned dates
   * `zoneStateAsOf` needs to tint a room as of a scrubbed day. That is the
   * whole list. No title, no crew, no sub name, no notes, no progress, no
   * float, no critical-path flag — see the header.
   */
  tasks: {
    id: string;
    /** Trade / phase, e.g. "Framing". Drives the zone tint and the label. */
    ph: string;
    /** Planned start, 1-indexed working day from `sd`. */
    s: number;
    /** Planned duration in days. */
    d: number;
  }[];
  /**
   * Site photos pinned onto the plan, in normalized 0–1 plan coords. `ts` is
   * when the photo was taken — the viewer only shows a photo once the scrubber
   * has reached its date, which is the honest signal: these are the pictures
   * that existed by that day.
   */
  photos: {
    id: string;
    /** Image URL (public / CDN-served). */
    u: string;
    /** ISO timestamp the photo was taken. */
    ts: string;
    x: number; y: number;
  }[];
}

const isRemote = (uri: string | undefined): boolean => /^https?:\/\//i.test(uri ?? '');

/** Normalize a pin coordinate to 0–1. Pins are stored either normalized
 *  already or in image pixels, depending on when they were drawn. */
function normalizeCoord(value: number, extent: number | undefined): number {
  if (value > 1 && extent && extent > 0) return value / extent;
  return value;
}

export interface BuildPlanShareOpts {
  projectName: string;
  gcName?: string;
  /** Schedule anchor. Falls back to today when the project has no schedule. */
  scheduleStartDate?: string;
  sheet: PlanSheet;
  zones: PlanZone[];
  tasks: ScheduleTask[];
  /** Pins on this sheet — the photo→zone link. */
  pins: DrawingPin[];
  /** Project photos, for resolving `pin.linkedPhotoId`. */
  photos: ProjectPhoto[];
  maxPhotos?: number;
}

export interface BuildPlanShareResult {
  payload: PlanSharePayload;
  /** Photos skipped because they haven't synced to the CDN yet. */
  droppedLocal: number;
  /** Photos trimmed by the cap (oldest first). */
  droppedExcess: number;
  /** True when the plan image itself is still local — the link would render
   *  a blank plan, so callers should refuse to share. */
  planNotSynced: boolean;
}

/**
 * Project the GC's Living Floor Plan into the client-safe payload.
 *
 * Every field is copied explicitly. If you find yourself writing `...task` or
 * `...zone` in here, stop: that is the bug this function exists to prevent.
 */
export function buildPlanSharePayload(opts: BuildPlanShareOpts): BuildPlanShareResult {
  const {
    projectName, gcName, scheduleStartDate, sheet, zones, tasks, pins, photos,
    maxPhotos = PLAN_SHARE_MAX_PHOTOS,
  } = opts;

  // Only the tasks some zone actually links to — a homeowner has no use for
  // the rest of the schedule, and every task we don't ship is a task that
  // can't leak.
  const linkedIds = new Set<string>();
  for (const z of zones) for (const id of z.linkedTaskIds) linkedIds.add(id);

  const safeTasks: PlanSharePayload['tasks'] = tasks
    .filter((t) => linkedIds.has(t.id))
    .map((t) => ({
      id: t.id,
      ph: t.phase || 'Other',
      s: t.startDay ?? 1,
      d: Math.max(1, t.durationDays || 1),
    }));
  const shippedTaskIds = new Set(safeTasks.map((t) => t.id));

  const safeZones: PlanSharePayload['zones'] = zones.map((z) => ({
    id: z.id,
    x: z.x, y: z.y, w: z.w, h: z.h,
    l: z.label,
    // Drop links to tasks that didn't ship, so the viewer never holds a
    // dangling id.
    t: z.linkedTaskIds.filter((id) => shippedTaskIds.has(id)),
  }));

  // Photos: pinned on this sheet, resolvable, and already on the CDN.
  const photoById = new Map(photos.map((p) => [p.id, p]));
  const pinned = pins
    .filter((p) => p.planSheetId === sheet.id && !!p.linkedPhotoId)
    .map((p) => ({ pin: p, photo: photoById.get(p.linkedPhotoId as string) }))
    .filter((x): x is { pin: DrawingPin; photo: ProjectPhoto } => !!x.photo);

  const remote = pinned.filter((x) => isRemote(x.photo.uri));
  const droppedLocal = pinned.length - remote.length;

  // Newest first so the cap keeps the most recent slice.
  const sorted = [...remote].sort((a, b) =>
    (b.photo.timestamp ?? b.photo.createdAt ?? '').localeCompare(a.photo.timestamp ?? a.photo.createdAt ?? ''),
  );
  const capped = sorted.slice(0, maxPhotos);
  const droppedExcess = sorted.length - capped.length;

  const safePhotos: PlanSharePayload['photos'] = capped.map(({ pin, photo }) => ({
    id: photo.id,
    u: photo.uri,
    ts: photo.timestamp ?? photo.createdAt,
    x: normalizeCoord(pin.x, sheet.width),
    y: normalizeCoord(pin.y, sheet.height),
  }));

  const payload: PlanSharePayload = {
    v: 1,
    n: projectName,
    gc: gcName,
    sd: scheduleStartDate ?? new Date().toISOString().slice(0, 10),
    img: sheet.imageUri,
    iw: sheet.width,
    ih: sheet.height,
    sn: sheet.sheetNumber ?? sheet.name,
    zones: safeZones,
    tasks: safeTasks,
    photos: safePhotos,
  };

  return { payload, droppedLocal, droppedExcess, planNotSynced: !isRemote(sheet.imageUri) };
}

export function encodePlanShareToken(payload: PlanSharePayload): string {
  const json = JSON.stringify(payload);
  const bytes = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(json) : null;
  const ascii = bytes
    ? Array.from(bytes).map((b) => String.fromCharCode(b)).join('')
    : json;
  const b64 = typeof btoa === 'function'
    ? btoa(ascii)
    : Buffer.from(json, 'utf-8').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodePlanShareToken(token: string): PlanSharePayload | null {
  try {
    const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const ascii = typeof atob === 'function'
      ? atob(b64 + pad)
      : Buffer.from(b64 + pad, 'base64').toString('binary');
    const bytes = Uint8Array.from(ascii, (c) => c.charCodeAt(0));
    const json = typeof TextDecoder !== 'undefined'
      ? new TextDecoder().decode(bytes)
      : ascii;
    const parsed = JSON.parse(json) as PlanSharePayload;
    if (parsed.v !== 1 || !Array.isArray(parsed.zones) || !Array.isArray(parsed.tasks)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export interface HydratedPlanShare {
  zones: PlanZone[];
  tasks: ScheduleTask[];
  pins: DrawingPin[];
  photoById: (photoId: string) => { uri: string; createdAt: string } | undefined;
}

/**
 * Re-inflate the payload into the shapes LivingFloorPlan already consumes, so
 * the viewer renders the REAL component instead of a client-side fork.
 *
 * The structural fields the domain types demand but the payload deliberately
 * never carried (`title`, `crew`, `notes`, …) are filled with EMPTY values,
 * not placeholders. That is load-bearing: if some future edit renders
 * `task.title` in client mode it paints nothing, rather than leaking. The
 * validator asserts this.
 */
export function hydratePlanShare(p: PlanSharePayload): HydratedPlanShare {
  const stamp = p.sd;
  const zones: PlanZone[] = p.zones.map((z) => ({
    id: z.id,
    projectId: '',
    planSheetId: SHARE_PLAN_SHEET_ID,
    x: z.x, y: z.y, w: z.w, h: z.h,
    label: z.l,
    linkedTaskIds: z.t,
    createdAt: stamp,
    updatedAt: stamp,
  }));

  const tasks: ScheduleTask[] = p.tasks.map((t) => ({
    id: t.id,
    title: '',
    phase: t.ph,
    durationDays: t.d,
    startDay: t.s,
    progress: 0,
    crew: '',
    dependencies: [],
    notes: '',
    status: 'not_started',
  }));

  const pins: DrawingPin[] = p.photos.map((ph) => ({
    id: `pin-${ph.id}`,
    planSheetId: SHARE_PLAN_SHEET_ID,
    projectId: '',
    x: ph.x,
    y: ph.y,
    kind: 'photo',
    linkedPhotoId: ph.id,
    createdAt: ph.ts,
    updatedAt: ph.ts,
  }));

  const byId = new Map(p.photos.map((ph) => [ph.id, ph]));
  const photoById = (photoId: string) => {
    const ph = byId.get(photoId);
    return ph ? { uri: ph.u, createdAt: ph.ts } : undefined;
  };

  return { zones, tasks, pins, photoById };
}

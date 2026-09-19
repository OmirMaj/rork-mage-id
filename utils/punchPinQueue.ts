// utils/punchPinQueue.ts — the pure half of "Pin items" (pin AFTER the photo)
// and of the edit sheet's Pin on plan / Move pin / Remove pin.
//
// The founder, 2026-09-18: "i want to be able to pin the location of each item
// before and after taking photos where is that ability?" His 63 real items came
// from the Photo walk, which never pins, and nothing could pin an EXISTING
// item. app/punch-pin.tsx walks every unpinned item one at a time; this file
// decides which items, in which order, what each write sends, how Undo puts it
// back, and what happens to a plan-viewer marker linked to the item.
//
// PURE. No react, react-native, expo or supabase import:
// scripts/validate-punch-pin-items.ts executes every function here.
//
// "PINNED" MEANS WHAT THE EXPORT SAYS. The punch list PDF draws an item on a
// plan page only when planRefFor (utils/punchExportCore) calls it 'pinned'. A
// queue that used a looser rule would tell him "all 63 pinned" and hand the
// owner a PDF with half of them missing from the plan pages, so pinRefOf IS
// planRefFor, and the numbers are punchItemNumbers over the WHOLE project list
// — the same input the export numbers — so #14 here is #14 in the PDF.

import { planRefFor, punchItemNumbers, type PunchExportPlanRef } from '@/utils/punchExportCore';
import { punchPinFields, type WalkPin } from '@/utils/punchPlanPin';
import {
  punchListTypeOf,
  type DrawingPin, type DrawingPinKind, type PlanSheet, type PunchItem, type PunchListType,
} from '@/types';

export type PinFields = Pick<PunchItem, 'planSheetId' | 'pinX' | 'pinY'>;

/**
 * The patch that takes a pin OFF an item. Three OWN keys set to undefined:
 * spread onto the item they clear it locally, and ProjectContext turns a pin
 * column this edit took away into an explicit NULL on the wire (a bare
 * undefined is dropped by JSON and the server would keep the pin).
 */
export const CLEAR_PIN_PATCH: Readonly<{ planSheetId: undefined; pinX: undefined; pinY: undefined }> = Object.freeze({
  planSheetId: undefined,
  pinX: undefined,
  pinY: undefined,
});

export function sheetsByIdOf(sheets: readonly PlanSheet[]): Map<string, PlanSheet> {
  const out = new Map<string, PlanSheet>();
  for (const s of sheets) if (s && s.id) out.set(s.id, s);
  return out;
}

/** The export's verdict on where this item is. Identical to planRefFor. */
export function pinRefOf(item: PunchItem, sheetsById: ReadonlyMap<string, PlanSheet>): PunchExportPlanRef {
  return planRefFor(item, sheetsById);
}

export function isPinnedForExport(item: PunchItem, sheetsById: ReadonlyMap<string, PlanSheet>): boolean {
  return pinRefOf(item, sheetsById).state === 'pinned';
}

export function planPinStats(
  items: readonly PunchItem[],
  sheetsById: ReadonlyMap<string, PlanSheet>,
): { total: number; pinned: number; unpinned: number } {
  let pinned = 0;
  for (const i of items) if (isPinnedForExport(i, sheetsById)) pinned += 1;
  return { total: items.length, pinned, unpinned: items.length - pinned };
}

/**
 * The Pin items header's "N of M pinned": the WHOLE list that is showing (or
 * the whole batch when `ids` scopes it), not just this session's queue of
 * unpinned items — after a resume the punch list card says "20 of 63 pinned",
 * and a header reading "0 of 43" reads as "my 20 pins are gone". `missing`
 * counts scoped ids this device does not have (not synced yet, or deleted), so
 * the screen never calls a batch it cannot see "all pinned".
 */
export function pinScopeStats(args: {
  allItems: readonly PunchItem[];
  sheetsById: ReadonlyMap<string, PlanSheet>;
  list: PunchListType;
  ids?: readonly string[] | null;
}): { total: number; pinned: number; unpinned: number; missing: number } {
  if (args.ids) {
    const scope = new Set(args.ids);
    const found = args.allItems.filter(i => scope.has(i.id));
    const foundIds = new Set(found.map(i => i.id));
    return { ...planPinStats(found, args.sheetsById), missing: [...scope].filter(id => !foundIds.has(id)).length };
  }
  return { ...planPinStats(args.allItems.filter(i => punchListTypeOf(i) === args.list), args.sheetsById), missing: 0 };
}

// ── The queue ────────────────────────────────────────────────────────────────

export interface PinQueueEntry { id: string; number: number; state: 'none' | 'no-position' | 'sheet-missing' }

/**
 * Every item Pin items walks, in PDF-number order.
 *   • numbers come from the WHOLE project list (both lists, every status) —
 *     a crew queue still shows the numbers the PDF prints;
 *   • `ids` (a photo-walk batch or a deep link) scopes it to those items on
 *     any list; otherwise the list that is showing;
 *   • every status: a closed item still prints on the PDF's plan page (grey);
 *   • already-pinned items are left out.
 */
export function buildPinQueue(args: {
  allItems: readonly PunchItem[];
  sheets: readonly PlanSheet[];
  list: PunchListType;
  ids?: readonly string[] | null;
}): PinQueueEntry[] {
  const numbers = punchItemNumbers(args.allItems);
  const sheetsById = sheetsByIdOf(args.sheets);
  const scope = args.ids ? new Set(args.ids) : null;
  const seen = new Set<string>();
  const out: PinQueueEntry[] = [];
  for (const item of args.allItems) {
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    if (scope ? !scope.has(item.id) : punchListTypeOf(item) !== args.list) continue;
    const ref = pinRefOf(item, sheetsById);
    if (ref.state === 'pinned') continue;
    out.push({ id: item.id, number: numbers.get(item.id) ?? 0, state: ref.state });
  }
  out.sort((a, b) => a.number - b.number);
  return out;
}

const QUEUE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const PIN_QUEUE_MAX_IDS = 200;

/** `ids=a,b,c` from a deep link: junk dropped, deduped, capped. */
export function parsePinQueueIds(raw: string | string[] | undefined): string[] {
  const parts = (Array.isArray(raw) ? raw : [raw ?? '']).join(',').split(',');
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const id = p.trim();
    if (!QUEUE_ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= PIN_QUEUE_MAX_IDS) break;
  }
  return out;
}

// ── Seeds: where the step opens for an item ─────────────────────────────────

export interface PinSeed {
  initialPin: WalkPin | null;
  initialSheetId: string | null;
  source: 'item' | 'drawing-pin' | 'sheet-only' | 'none';
}

/** The plan-viewer marker linked to this item, if any. */
export function linkedDrawingPinFor(itemId: string, drawingPins: readonly DrawingPin[]): DrawingPin | undefined {
  return drawingPins.find(p => p.linkedPunchItemId === itemId);
}

function inUnit(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
}

/**
 * Pinned → its own pin. Else a linked plan-viewer marker on a listed sheet →
 * that spot (plan-viewer draws the marker INSTEAD of the item's pin, so this is
 * where he has been seeing it). Else filed to a sheet with no spot → open on
 * that sheet. Else nothing.
 */
export function pinSeedFor(
  item: PunchItem,
  sheetsById: ReadonlyMap<string, PlanSheet>,
  drawingPins: readonly DrawingPin[],
): PinSeed {
  const ref = pinRefOf(item, sheetsById);
  if (ref.state === 'pinned') {
    return { initialPin: { sheetId: ref.sheetId, x: ref.x, y: ref.y }, initialSheetId: ref.sheetId, source: 'item' };
  }
  const dp = linkedDrawingPinFor(item.id, drawingPins);
  if (dp && sheetsById.has(dp.planSheetId) && inUnit(dp.x) && inUnit(dp.y)) {
    return { initialPin: { sheetId: dp.planSheetId, x: dp.x, y: dp.y }, initialSheetId: dp.planSheetId, source: 'drawing-pin' };
  }
  if (ref.state === 'no-position') return { initialPin: null, initialSheetId: ref.sheetId, source: 'sheet-only' };
  return { initialPin: null, initialSheetId: null, source: 'none' };
}

// ── Patches ─────────────────────────────────────────────────────────────────

export function pinFieldsOf(item: PinFields): PinFields {
  return { planSheetId: item.planSheetId, pinX: item.pinX, pinY: item.pinY };
}

/** A pin the step could have placed: a sheet and finite x/y. */
export function walkPinOf(f: PinFields): WalkPin | null {
  if (!f.planSheetId || typeof f.pinX !== 'number' || typeof f.pinY !== 'number') return null;
  if (!Number.isFinite(f.pinX) || !Number.isFinite(f.pinY)) return null;
  return { sheetId: f.planSheetId, x: f.pinX, y: f.pinY };
}

export function pinsEqual(a: WalkPin | null, b: WalkPin | null, eps = 1e-9): boolean {
  if (!a || !b) return a === b;
  return a.sheetId === b.sheetId && Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;
}

function hasAnyPinField(f: PinFields): boolean {
  return f.planSheetId !== undefined || f.pinX !== undefined || f.pinY !== undefined;
}

/**
 * What to send for "this item is now at `after`" (or nowhere, when null).
 * An empty object means there is nothing to write — the caller skips it.
 */
export function pinPatchFor(before: PinFields, after: WalkPin | null): Partial<PunchItem> {
  if (!after) return hasAnyPinField(before) ? { ...CLEAR_PIN_PATCH } : {};
  if (!after.sheetId || !Number.isFinite(after.x) || !Number.isFinite(after.y)) return {};
  if (pinsEqual(walkPinOf(before), after)) return {};
  return punchPinFields(after);
}

// ── Linked plan-viewer markers (DrawingPins) ────────────────────────────────

export type DrawingPinSnapshot = Pick<
  DrawingPin,
  'planSheetId' | 'projectId' | 'x' | 'y' | 'kind' | 'label' | 'color' | 'linkedPhotoId' | 'linkedPunchItemId' | 'linkedRfiId'
>;

export function drawingPinSnapshotOf(dp: DrawingPin): DrawingPinSnapshot {
  return {
    planSheetId: dp.planSheetId, projectId: dp.projectId, x: dp.x, y: dp.y, kind: dp.kind,
    label: dp.label, color: dp.color, linkedPhotoId: dp.linkedPhotoId,
    linkedPunchItemId: dp.linkedPunchItemId, linkedRfiId: dp.linkedRfiId,
  };
}

/** The marker follows the item: same numbers as the item's own pin fields. */
export function drawingPinMoveFor(dp: DrawingPin, after: WalkPin): Partial<DrawingPin> {
  const f = punchPinFields(after);
  const x = f.pinX as number;
  const y = f.pinY as number;
  return dp.planSheetId === after.sheetId ? { x, y } : { planSheetId: after.sheetId, x, y };
}

export type DrawingPinRemoval =
  | { action: 'none' }
  | { action: 'delete' }
  | { action: 'unlink'; keptAs: DrawingPinKind; why: 'photo' | 'rfi' | 'label' | 'not-owner' };

/**
 * What Remove pin does to a linked marker. A marker that only ever marked this
 * item (no photo, no RFI, no label of its own) is deleted — but drawing_pins
 * DELETE is owner-or-author under RLS and the client cannot see the author, so
 * only the project owner deletes; anyone else unlinks it and it stays as a note.
 */
export function drawingPinRemovalFor(
  dp: DrawingPin | undefined,
  role: 'owner' | 'editor' | 'viewer' | 'field' | null,
): DrawingPinRemoval {
  if (!dp) return { action: 'none' };
  if (dp.linkedPhotoId) return { action: 'unlink', keptAs: 'photo', why: 'photo' };
  if (dp.linkedRfiId) return { action: 'unlink', keptAs: 'rfi', why: 'rfi' };
  if ((dp.label ?? '').trim()) return { action: 'unlink', keptAs: 'note', why: 'label' };
  if (role !== 'owner') return { action: 'unlink', keptAs: 'note', why: 'not-owner' };
  return { action: 'delete' };
}

/** The confirmation — what WILL happen, never a guessed reason. */
export function removePinConfirmCopy(
  r: DrawingPinRemoval,
  itemNumber: number,
): { title: string; body: string; confirmLabel: 'Remove pin' } {
  const title = `Remove the pin from #${itemNumber}?`;
  if (r.action === 'delete') {
    return {
      title,
      body: 'It comes off the plan, its marker in the plan viewer is deleted, and it leaves the export’s plan pages. You can pin it again any time.',
      confirmLabel: 'Remove pin',
    };
  }
  if (r.action === 'unlink') {
    const as = r.keptAs === 'photo' ? 'a photo pin' : r.keptAs === 'rfi' ? 'an RFI pin' : 'a note';
    return {
      title,
      body: `It comes off the export’s plan pages. Its marker in the plan viewer stays where it is, as ${as}, no longer linked to this item.`,
      confirmLabel: 'Remove pin',
    };
  }
  return {
    title,
    body: 'It comes off the plan here and off the plan pages of the punch list export. You can pin it again any time.',
    confirmLabel: 'Remove pin',
  };
}

// ── One write, and its undo ─────────────────────────────────────────────────

export interface PinWrite {
  itemId: string;
  before: PinFields;
  after: WalkPin | null;
  drawingPin?: { op: 'move' | 'unlink' | 'delete'; id: string; before: DrawingPinSnapshot };
}

/** Puts the item's three pin fields back exactly (own keys, undefined included). */
export function undoPatchFor(w: PinWrite): Partial<PunchItem> {
  return { planSheetId: w.before.planSheetId, pinX: w.before.pinX, pinY: w.before.pinY };
}

export function drawingPinUndoFor(w: PinWrite):
  | null
  | { kind: 'update'; id: string; patch: Partial<DrawingPin> }
  | { kind: 'add'; pin: DrawingPinSnapshot } {
  const dp = w.drawingPin;
  if (!dp) return null;
  if (dp.op === 'move') {
    return { kind: 'update', id: dp.id, patch: { planSheetId: dp.before.planSheetId, x: dp.before.x, y: dp.before.y } };
  }
  if (dp.op === 'unlink') {
    return { kind: 'update', id: dp.id, patch: { kind: dp.before.kind, linkedPunchItemId: dp.before.linkedPunchItemId } };
  }
  return { kind: 'add', pin: { ...dp.before } };
}

/** punch_items UPDATE needs field access or better under RLS. */
export function pinWriteBlockedReason(role: 'owner' | 'editor' | 'viewer' | 'field' | null): string | null {
  if (role === 'viewer') {
    return 'You have view-only access to this job, so a pin you place can’t be saved. Ask the project owner for editor or field access.';
  }
  return null;
}

// ── The Pin items cursor ────────────────────────────────────────────────────

/** A snapshot of the context at dispatch time. */
export interface PinQueueEnv { exists: ReadonlySet<string>; pinned: ReadonlySet<string> }

export interface PinQueueSession {
  ids: string[];
  /** Once he acts, the list stops following the live queue (it would shift under him). */
  frozen: boolean;
  index: number;
  history: PinWrite[];
  pinnedThisSession: string[];
  skipped: string[];
  lastSheetId: string | null;
}

export type PinQueueAction =
  | { type: 'live'; ids: readonly string[] }
  | { type: 'saved'; itemId: string; write: PinWrite; env: PinQueueEnv }
  | { type: 'kept'; itemId: string; sheetId: string; env: PinQueueEnv }
  | { type: 'skip'; itemId: string; env: PinQueueEnv }
  | { type: 'back'; env: PinQueueEnv }
  | { type: 'undo'; env: PinQueueEnv }
  | { type: 'current-gone'; env: PinQueueEnv }
  | { type: 'restart-skipped'; env: PinQueueEnv };

export function initialPinQueueSession(ids: readonly string[]): PinQueueSession {
  return { ids: [...ids], frozen: false, index: 0, history: [], pinnedThisSession: [], skipped: [], lastSheetId: null };
}

/** First index after `from` whose item is open; ids.length when there is none. */
export function nextOpenIndex(ids: readonly string[], from: number, isOpen: (id: string) => boolean): number {
  for (let i = Math.max(-1, from) + 1; i < ids.length; i++) if (isOpen(ids[i])) return i;
  return ids.length;
}

/** Last index before `from` whose item still exists (pinned or not); -1 when none. */
export function prevIndex(ids: readonly string[], from: number, exists: (id: string) => boolean): number {
  for (let i = Math.min(from, ids.length) - 1; i >= 0; i--) if (exists(ids[i])) return i;
  return -1;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function reducePinQueue(s: PinQueueSession, a: PinQueueAction): PinQueueSession {
  if (a.type === 'live') {
    if (s.frozen || sameIds(s.ids, a.ids)) return s;
    return { ...s, ids: [...a.ids], index: 0 };
  }
  const env = a.env;
  const openIn = (session: PinQueueSession) => (id: string) =>
    env.exists.has(id) && !env.pinned.has(id) && !session.pinnedThisSession.includes(id);
  const current = s.ids[s.index];
  switch (a.type) {
    case 'saved': {
      // A stale second tap (the item under the cursor has already moved on)
      // must be a no-op — never a skip of the NEXT item.
      if (a.itemId !== current) return s;
      const pinnedThisSession = a.write.after && !s.pinnedThisSession.includes(a.itemId)
        ? [...s.pinnedThisSession, a.itemId]
        : s.pinnedThisSession;
      const next: PinQueueSession = {
        ...s,
        frozen: true,
        history: [...s.history, a.write],
        pinnedThisSession,
        lastSheetId: a.write.after?.sheetId ?? s.lastSheetId,
      };
      const open = openIn(next);
      return { ...next, index: nextOpenIndex(s.ids, s.index, id => open(id) && id !== a.itemId) };
    }
    case 'kept': {
      if (a.itemId !== current) return s;
      const next: PinQueueSession = { ...s, frozen: true, lastSheetId: a.sheetId || s.lastSheetId };
      const open = openIn(next);
      return { ...next, index: nextOpenIndex(s.ids, s.index, id => open(id) && id !== a.itemId) };
    }
    case 'skip': {
      if (a.itemId !== current) return s;
      const next: PinQueueSession = {
        ...s,
        frozen: true,
        skipped: s.skipped.includes(a.itemId) ? s.skipped : [...s.skipped, a.itemId],
      };
      const open = openIn(next);
      return { ...next, index: nextOpenIndex(s.ids, s.index, id => open(id) && id !== a.itemId) };
    }
    case 'back': {
      const i = prevIndex(s.ids, s.index, id => env.exists.has(id));
      return i < 0 ? { ...s, frozen: true } : { ...s, frozen: true, index: i };
    }
    case 'undo': {
      const last = s.history[s.history.length - 1];
      if (!last) return { ...s, frozen: true };
      const at = s.ids.indexOf(last.itemId);
      const beforeHadPin = !!walkPinOf(last.before);
      return {
        ...s,
        frozen: true,
        history: s.history.slice(0, -1),
        index: at >= 0 ? at : s.index,
        pinnedThisSession: beforeHadPin ? s.pinnedThisSession : s.pinnedThisSession.filter(id => id !== last.itemId),
      };
    }
    case 'current-gone': {
      const open = openIn(s);
      return { ...s, frozen: true, index: nextOpenIndex(s.ids, s.index, open) };
    }
    case 'restart-skipped': {
      const open = openIn(s);
      return { ...s, frozen: true, ids: s.ids.filter(open), index: 0, skipped: [] };
    }
    default:
      return s;
  }
}

export function pinQueueProgress(
  s: PinQueueSession,
  env: PinQueueEnv,
): { total: number; pinned: number; position: number } {
  let total = 0;
  let pinned = 0;
  let position = 0;
  s.ids.forEach((id, i) => {
    if (!env.exists.has(id)) return;
    total += 1;
    if (i <= s.index) position += 1;
    if (env.pinned.has(id) || s.pinnedThisSession.includes(id)) pinned += 1;
  });
  return { total, pinned, position: Math.min(position, total) };
}

// ── Layout and the plan's height budget ─────────────────────────────────────
// The phone layout is held to numbers, not eyeballed: a photo big enough to
// recognise the defect, and a plan box that stays at least 300pt tall on an
// iPhone SE in the worst state (sheet chips + the first-item hint).

export const PIN_QUEUE_PHOTO = { compact: 104, regular: 128, collapsed: 56, compactBelowHeight: 700 } as const;
export const PIN_QUEUE_PANE = { minRootWidth: 900, share: 0.36, min: 320, max: 480 } as const;
export const PIN_CANVAS_FLOOR = 300;

/** Measured from PlanPinStep's makeStyles; re-measure when they change.
 *  header = 8+8 padding + 26 title + 1 + 16 subtitle + 1 border + 3 progress;
 *  footer = 10 + 48 (Button md) + 12 + 1 (+ inset);
 *  sheetChips = 8 + 32 + 8 + 1; hint = 16 + 8; strip = 2×10 padding + 1 border (+ photo). */
export const PIN_STEP_CHROME = { header: 63, footer: 71, sheetChips: 49, hint: 24, strip: 21 } as const;

export function pinQueueLayout(a: { windowHeight: number; rootWidth: number; isWeb: boolean; photoCollapsed: boolean }):
  { mode: 'strip' | 'pane'; photoSize: number; paneWidth: number | null } {
  if (a.isWeb && a.rootWidth >= PIN_QUEUE_PANE.minRootWidth) {
    const paneWidth = Math.max(PIN_QUEUE_PANE.min, Math.min(PIN_QUEUE_PANE.max, Math.round(a.rootWidth * PIN_QUEUE_PANE.share)));
    return { mode: 'pane', photoSize: paneWidth - 32, paneWidth };
  }
  const photoSize = a.photoCollapsed
    ? PIN_QUEUE_PHOTO.collapsed
    : a.windowHeight < PIN_QUEUE_PHOTO.compactBelowHeight ? PIN_QUEUE_PHOTO.compact : PIN_QUEUE_PHOTO.regular;
  return { mode: 'strip', photoSize, paneWidth: null };
}

/** The plan box height the phone strip layout leaves. */
export function pinCanvasHeight(a: {
  windowHeight: number; insetTop: number; insetBottom: number; photoSize: number; multiSheet: boolean; hint: boolean;
}): number {
  return a.windowHeight - a.insetTop - a.insetBottom
    - PIN_STEP_CHROME.header - PIN_STEP_CHROME.footer
    - (PIN_STEP_CHROME.strip + a.photoSize)
    - (a.multiSheet ? PIN_STEP_CHROME.sheetChips : 0)
    - (a.hint ? PIN_STEP_CHROME.hint : 0);
}

// utils/takeoff/aiSuggestions.ts — AI Takeoff rows offered in the desktop
// Conditions panel as SUGGESTIONS (lane TK-b, pure).
//
// Source: the AI Takeoff (/takeoff) saved on THIS browser under
// `mageid_takeoff::<projectId>` (utils/takeoffStorage). hooks/useSavedAiTakeoff
// reads the raw string; parseSavedAiTakeoff decides what it is. A suggestion is
// NOT a condition: it is never drawn (AI Takeoff has no bounding boxes —
// components/TakeoffPageInspector.tsx), never enters the rollup, the cost line
// or the push, until he accepts it — and then it is a condition whose aiRead
// labels it "AI read — not measured" everywhere, including the estimate line.
//
// Rows are keyed `${runId}|${section}:${id}` with the SAME `${section}:${id}`
// row key app/takeoff.tsx writes its overrides and rejections under
// (utils/takeoffPricing.takeoffRowKey), so his corrections carry over. runId
// is a fingerprint of the AI's `result` alone (aiRunId) — NOT savedAt:
// app/takeoff.tsx re-saves the blob with a fresh savedAt every time it is
// opened or a number is corrected, which would re-offer every row he already
// accepted (a second condition, the same quantity pushed twice) or dismissed.
// The result only changes when AI Takeoff is re-run, so a re-run offers its
// rows fresh and nothing else does.
//
// No React, no storage, no network — scripts/validate-takeoff-ai-suggestions.ts
// executes it. PersistedTakeoff is imported as a TYPE only.

import type { PersistedTakeoff } from '@/utils/takeoffStorage';
import type { CostDatabase } from '@/utils/costDatabase';
import { resolveStarterTrade } from '@/utils/takeoff/starterConditions';
import { takeoffRowKey, type TakeoffRowSection } from '@/utils/takeoffPricing';
import {
  KIND_UNIT, defaultConditionColor, type ConditionAiRead, type ConditionKind, type TakeoffCondition,
} from '@/utils/takeoff/conditions';

export interface AiSuggestion {
  key: string;
  section: string;
  itemId: string;
  name: string;
  kind: ConditionKind;
  unit: 'SF' | 'LF' | 'EA';
  qty: number;
  confidence: 'high' | 'medium' | 'low';
  pages: number[];
  citation: string;
  corrected: boolean;
  heightFt: number | null;
}

/** Plans get re-issued: the same 60 days utils/takeoffStorage.loadTakeoff ages out at. */
export const AI_TAKEOFF_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;

export type SavedAiTakeoffParse =
  | { state: 'none' }
  | { state: 'stale'; savedAt: string }
  | { state: 'failed' }
  | { state: 'ready'; saved: PersistedTakeoff };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * What is saved on this browser for this job. null/empty → 'none'; JSON that
 * throws or fails loadTakeoff's shape check (no result, or result.walls not an
 * array) → 'failed'; savedAt older than 60 days → 'stale'; else 'ready'.
 * Never clears anything — an aged takeoff stays where it is.
 */
export function parseSavedAiTakeoff(raw: string | null, nowMs: number): SavedAiTakeoffParse {
  if (!raw) return { state: 'none' };
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return { state: 'failed' }; }
  if (!isObj(v) || !isObj(v.result) || !Array.isArray(v.result.walls)) return { state: 'failed' };
  const savedAt = typeof v.savedAt === 'string' ? v.savedAt : '';
  const t = new Date(savedAt).getTime();
  if (Number.isFinite(t) && nowMs - t > AI_TAKEOFF_MAX_AGE_MS) return { state: 'stale', savedAt };
  const saved = { ...v, savedAt, overrides: isObj(v.overrides) ? v.overrides : {} } as unknown as PersistedTakeoff;
  return { state: 'ready', saved };
}

export type SavedForSuggestions = Pick<PersistedTakeoff, 'result' | 'overrides' | 'rejected' | 'fileName' | 'savedAt'>;

export type AiSkipCode = 'rejected' | 'bulk' | 'no_quantity' | 'unit';
export const AI_SKIP_REASON: Record<AiSkipCode, string> = {
  rejected: 'you rejected on AI Takeoff',
  bulk: 'bulk materials use units this panel doesn’t measure (CY, tons…). See AI Takeoff.',
  no_quantity: 'no quantity',
  unit: 'a unit this panel doesn’t measure. See AI Takeoff.',
};

export interface AiSkipped { code: AiSkipCode; reason: string; count: number }

const WALL_WORDS: Record<string, string> = {
  interior_partition: 'Interior partition',
  exterior_framed: 'Exterior framed wall',
  exterior_masonry: 'Exterior masonry wall',
  demising: 'Demising wall',
  shaft: 'Shaft wall',
  foundation: 'Foundation wall',
  other: 'Wall',
};

const join = (...parts: string[]): string => parts.filter(Boolean).join(' ');

/** JSON with object keys sorted, so the fingerprint never depends on key order. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (isObj(v)) {
    return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/**
 * Which AI run a saved takeoff came from: a 53-bit hash (cyrb53) of the
 * canonical `result`, as `r` + base-36. Overrides, rejections, the file name
 * and savedAt are outside `result`, so correcting a number on /takeoff or just
 * opening it keeps every key; a re-run (a new result) changes them all.
 */
export function aiRunId(result: unknown): string {
  const text = canonical(result ?? null);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `r${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}`;
}

export function aiCitation(pages: number[], fileName: string | null | undefined): string {
  if (!pages.length) return 'page not given';
  return `p.${pages.join(', p.')}${fileName ? ` · ${fileName}` : ''}`;
}

function pagesOf(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  const out: number[] = [];
  for (const p of v) if (isFiniteNum(p) && p > 0 && !out.includes(p)) out.push(p);
  return out;
}

const confOf = (v: unknown): AiSuggestion['confidence'] => (v === 'high' || v === 'medium' ? v : 'low');

/**
 * Every AI Takeoff row this panel can offer, minus the ones he has already
 * handled (`taken` = his dismissed keys ∪ the accepted conditions' aiRead.key).
 * Rows it cannot offer are COUNTED with a reason, never silently dropped.
 */
export function suggestionsFromTakeoff(
  saved: SavedForSuggestions,
  taken: ReadonlySet<string>,
): { rows: AiSuggestion[]; skipped: AiSkipped[] } {
  const rows: AiSuggestion[] = [];
  const counts: Record<AiSkipCode, number> = { rejected: 0, bulk: 0, no_quantity: 0, unit: 0 };
  const r = (saved.result ?? {}) as Partial<PersistedTakeoff['result']>;
  const overrides = saved.overrides ?? {};
  const rejected = saved.rejected ?? {};
  const runId = aiRunId(saved.result);
  const list = <T,>(v: T[] | undefined): T[] => (Array.isArray(v) ? v : []);

  const offer = (
    section: TakeoffRowSection, item: { id?: unknown; confidence?: unknown; sourcePages?: unknown },
    kind: ConditionKind | null, aiQty: unknown, name: string, heightFt: number | null,
  ) => {
    const itemId = str(item.id);
    const rowKey = takeoffRowKey(section, itemId);
    if (rejected[rowKey]) { counts.rejected++; return; }
    if (!kind) { counts.unit++; return; }
    const key = `${runId}|${rowKey}`;
    if (taken.has(key)) return;
    const o = overrides[rowKey];
    const corrected = isFiniteNum(o);
    const qty = corrected ? o : aiQty;
    if (!isFiniteNum(qty) || qty <= 0) { counts.no_quantity++; return; }
    const pages = pagesOf(item.sourcePages);
    rows.push({
      key, section, itemId, name, kind, unit: KIND_UNIT[kind], qty,
      confidence: confOf(item.confidence), pages, citation: aiCitation(pages, saved.fileName),
      corrected, heightFt: kind === 'linear' ? heightFt : null,
    });
  };

  for (const f of list(r.floorAreas)) {
    const code = str(f.finishCode);
    offer('floor', f, 'area', f.areaSqFt, `${str(f.roomName) || 'Room'}${code ? ` · ${code}` : ''}`, null);
  }
  for (const w of list(r.walls)) {
    const words = WALL_WORDS[str(w.category)] ?? 'Wall';
    const h = isFiniteNum(w.heightFt) && w.heightFt > 0 ? w.heightFt : null;
    offer('walls', w, 'linear', w.lengthFt, join(words, str(w.typeCode)), h);
  }
  for (const d of list(r.doors)) offer('doors', d, 'count', d.count, join(str(d.mark), str(d.description)) || 'Door', null);
  for (const w of list(r.windows)) offer('windows', w, 'count', w.count, join(str(w.mark), str(w.description)) || 'Window', null);
  for (const f of list(r.finishes)) {
    const kind: ConditionKind | null = f.unit === 'sqft' ? 'area' : f.unit === 'lf' ? 'linear' : f.unit === 'ea' ? 'count' : null;
    offer('finish', f, kind, f.quantity, join(str(f.code), str(f.description)) || 'Finish', null);
  }
  for (const x of list(r.fixtures)) offer('fixture', x, 'count', x.count, join(str(x.mark), str(x.description)) || 'Fixture', null);
  for (const b of list(r.bulkMaterials)) {
    if (rejected[takeoffRowKey('bulk', str(b.id))]) counts.rejected++;
    else counts.bulk++;
  }

  const skipped: AiSkipped[] = [];
  for (const code of ['rejected', 'bulk', 'no_quantity', 'unit'] as const) {
    if (counts[code]) skipped.push({ code, reason: AI_SKIP_REASON[code], count: counts[code] });
  }
  return { rows, skipped };
}

/** One muted line per skip reason, e.g. "3 bulk materials use units this panel doesn't measure (CY, tons…) — see AI Takeoff". */
export function aiSkippedLine(s: AiSkipped): string {
  const n = s.count;
  if (s.code === 'bulk') return `${n} ${n === 1 ? 'bulk material uses' : 'bulk materials use'} units this panel doesn’t measure (CY, tons…). See AI Takeoff.`;
  if (s.code === 'rejected') return `${n} ${n === 1 ? 'row' : 'rows'} ${s.reason}, not offered`;
  if (s.code === 'no_quantity') return `${n} ${n === 1 ? 'row has' : 'rows have'} no quantity, not offered`;
  return `${n} ${n === 1 ? 'row uses' : 'rows use'} ${s.reason}`;
}

/** The AI section's text filter: a case-insensitive name match; blank → every row. */
export function filterSuggestions(rows: AiSuggestion[], q: string | null | undefined): AiSuggestion[] {
  const needle = (q ?? '').trim().toLowerCase();
  return needle ? rows.filter((s) => s.name.toLowerCase().includes(needle)) : rows;
}

// ── trade (keys his cost book; null → "No rate yet — set one") ───────────
// A suggestion's words → the trade words his book may use. The first rule
// whose left side matches the name (then the section) wins. No rule, or no
// book entry for the unit whose trade matches → null. Never an invented rate.
// The book lookup is lane TK-a's resolveStarterTrade (the starter chips' own).
const NAME_HINTS: [RegExp, RegExp][] = [
  [/masonry|brick|cmu/i, /masonry|brick/i],
  [/exterior framed|siding/i, /siding|exterior/i],
  [/foundation/i, /concrete|foundation/i],
  [/paint|\bpt-?\d/i, /paint/i],
  [/tile/i, /tile/i],
  [/carpet/i, /carpet/i],
  [/lvt|vinyl|laminate/i, /floor|lvt|vinyl/i],
  [/hardwood|\bwood\b/i, /floor|wood/i],
  [/\bbase\b|trim|casing|crown|millwork/i, /trim|base|millwork/i],
  [/ceiling|\bact\b|acoustic/i, /ceiling|acoustic/i],
  [/drywall|gyp|gwb|partition|demising|shaft|stud/i, /drywall|gypsum|sheetrock/i],
  [/toilet|water closet|\bwc\b|sink|lav|urinal|faucet|shower|\btub\b|plumb/i, /plumb/i],
  [/light|receptacle|outlet|switch|electric/i, /electric/i],
  [/hvac|diffuser|duct|furnace|condenser|air handler|\brtu\b|\bahu\b/i, /hvac|mechanical|duct/i],
  [/cabinet/i, /cabinet/i],
  [/counter/i, /counter/i],
];
const SECTION_HINT: Partial<Record<string, RegExp>> = {
  floor: /floor|lvt|vinyl/i,
  walls: /drywall|gypsum|sheetrock/i,
  doors: /door/i,
  windows: /window/i,
};

/** The trade-words RegExp for a suggestion, or null when nothing in its section or name says one. */
export function suggestionTradeHint(s: Pick<AiSuggestion, 'section' | 'name'>): RegExp | null {
  // A door or window is a door or window, whatever its description says ("paint grade").
  if (s.section === 'doors' || s.section === 'windows') return SECTION_HINT[s.section] ?? null;
  for (const [when, hint] of NAME_HINTS) if (when.test(s.name)) return hint;
  return SECTION_HINT[s.section] ?? null;
}

export function resolveSuggestionTrade(db: CostDatabase, hint: RegExp | null, kind: ConditionKind): string | null {
  return hint ? resolveStarterTrade(db, hint, kind).trade : null;
}

/** The condition an accepted suggestion becomes: no invented rate, 0 waste, the AI number carried as aiRead. */
export function conditionFromSuggestion(
  s: AiSuggestion,
  db: CostDatabase,
  usedColors: readonly string[],
  id: string,
  nowIso: string,
): TakeoffCondition {
  const trade = resolveSuggestionTrade(db, suggestionTradeHint(s), s.kind);
  const aiRead: ConditionAiRead = {
    qty: s.qty, unit: s.unit, confidence: s.confidence, citation: s.citation, key: s.key, readAt: nowIso,
  };
  return {
    id,
    name: s.name,
    kind: s.kind,
    trade,
    rateOverride: null,
    wastePct: 0,
    heightFt: s.kind === 'linear' ? s.heightFt : null,
    color: defaultConditionColor(s.name, trade, usedColors),
    createdAt: nowIso,
    aiRead,
  };
}

/** The keys already handled: dismissed ∪ accepted (the conditions' aiRead.key). */
export function takenSuggestionKeys(doc: { aiDismissed?: string[]; conditions: TakeoffCondition[] }): Set<string> {
  const out = new Set<string>(doc.aiDismissed ?? []);
  for (const c of doc.conditions) if (c.aiRead) out.add(c.aiRead.key);
  return out;
}

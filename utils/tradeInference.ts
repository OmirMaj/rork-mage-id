// tradeInference.ts — infer a SubTrade from free-text punch-list
// descriptions. Deliberately unsophisticated: a keyword list beats a
// classifier for reliability on punch items, and the GC gets to confirm
// the suggestion before save.
//
// Returns the best-match trade and the keyword that matched, so the UI
// can show "Auto-routed to Drywall (matched 'sheetrock')" — this
// transparency is important, subs don't trust black-box assignments.

import type { SubTrade, Subcontractor } from '@/types';

/**
 * Keyword → trade map. Order within a trade doesn't matter; across
 * trades, the FIRST MATCH WINS when multiple apply (so "paint booth
 * electrical" still routes to Electrical because we check Electrical
 * earlier). This mirrors how a PM actually routes: the noun (outlet,
 * leak) beats the adjective.
 *
 * ORDER IS ONLY THE TIE-BREAKER. Matching picks the LONGEST keyword that
 * appears in the text, across every row, and falls back to array order only
 * when two keywords of equal length both hit. See `inferTradeFromText` for
 * why — in short, first-row-wins made a plain substring list unmaintainable,
 * because each new row could silently steal items from rows below it.
 *
 * THE BUG THIS ORDERING FIXES. 'sprinkler' used to live in the Landscaping
 * row and nowhere else. On a commercial punch list "sprinkler head painted
 * over" is one of the most common items there is — it is a code violation,
 * the fire-protection contractor fixes it, and the app routed it to the
 * landscaper. Bare 'sprinkler' now means fire protection. The irrigation
 * reading is still reachable, but it has to say so ('lawn sprinkler',
 * 'irrigation'), and Landscaping is checked first so it wins when it does.
 */
const TRADE_KEYWORDS: { trade: SubTrade; keywords: string[] }[] = [
  // ── Commercial systems ──────────────────────────────────────────────────
  // These are reached on specificity, not position: 'fire alarm' (10 chars)
  // beats Electrical's 'panel' (5) in "fire alarm panel not commissioned"
  // wherever either row happens to sit.
  { trade: 'Fire Alarm', keywords: ['fire alarm', 'smoke detector', 'smoke head', 'pull station', 'horn strobe', 'annunciator', 'duct detector', 'notification appliance'] },
  { trade: 'Low Voltage / Cabling', keywords: ['low voltage', 'data drop', 'data jack', 'network jack', 'patch panel', 'structured cabling', 'cat5', 'cat6', 'cat 6', 'fiber run', 'idf', 'mdf closet', 'telecom'] },
  { trade: 'AV', keywords: ['projector', 'av rack', 'video wall', 'display mount', 'tv mount', 'hdmi', 'ceiling speaker', 'sound masking'] },
  { trade: 'Security', keywords: ['card reader', 'access control', 'badge reader', 'cctv', 'security camera', 'door contact', 'maglock', 'mag lock', 'request to exit'] },
  { trade: 'Controls / BMS', keywords: ['bms', 'building automation', 'building management system', 'ddc', 'vav controller', 'control sequence', 'bas panel'] },

  // ── The original ten ────────────────────────────────────────────────────
  { trade: 'Electrical', keywords: ['electrical', 'outlet', 'switch', 'wiring', 'breaker', 'panel', 'circuit', 'gfci', 'receptacle', 'fixture', 'light', 'lamp', 'sconce'] },
  { trade: 'Plumbing',   keywords: ['plumb', 'leak', 'faucet', 'toilet', 'drain', 'sink', 'valve', 'pipe', 'supply line', 'p-trap', 'shutoff', 'water heater', 'sewer'] },
  { trade: 'HVAC',       keywords: ['hvac', 'vent', 'duct', 'thermostat', 'ac unit', 'air handler', 'register', 'return air', 'furnace', 'condenser', 'heat pump'] },
  { trade: 'Roofing',    keywords: ['roof', 'shingle', 'gutter', 'downspout', 'flashing', 'soffit', 'fascia'] },
  // 'ceiling tile' MOVED OUT of Drywall — a lay-in tile is not a drywall
  // scope and the ACT contractor is who replaces it.
  { trade: 'Drywall',    keywords: ['drywall', 'sheetrock', 'mud', 'tape', 'texture', 'orange peel', 'gypsum', 'joint compound', 'skim coat'] },
  // "ceiling tile painted over" routes here, not to Painting: the painter
  // caused it, the ACT sub fixes it, and 'ceiling tile' is the longer match.
  { trade: 'Acoustical Ceilings', keywords: ['ceiling tile', 'acoustical', 'act grid', 'ceiling grid', 'suspended ceiling', 'lay-in', 'tegular', 'ceiling panel'] },
  // 'wood trim' beats Flooring's 'trim'; 'cabinet' beats Painting's 'stain'.
  { trade: 'Millwork',   keywords: ['millwork', 'casework', 'cabinet', 'countertop', 'reception desk', 'wood trim', 'shelving unit', 'plastic laminate'] },
  { trade: 'Painting',   keywords: ['paint', 'caulk', 'primer', 'touch up', 'touch-up', 'stain', 'sealer', 'lacquer', 'finish coat'] },
  { trade: 'Flooring',   keywords: ['floor', 'tile', 'grout', 'vinyl', 'carpet', 'hardwood', 'lvp', 'lvt', 'baseboard', 'trim', 'transition strip'] },
  { trade: 'Concrete',   keywords: ['concrete', 'slab', 'foundation', 'rebar', 'cure', 'pour', 'crack seal', 'patio', 'sidewalk'] },
  { trade: 'Framing',    keywords: ['frame', 'framing', 'stud', 'joist', 'rafter', 'truss', 'header', 'shim', 'door rough-in', 'blocking'] },

  // ── Remaining commercial scopes ─────────────────────────────────────────
  { trade: 'Glazing',    keywords: ['glazing', 'glass', 'curtain wall', 'storefront', 'window', 'mirror', 'glazier', 'spandrel'] },
  { trade: 'Doors & Hardware', keywords: ['door closer', 'door hardware', 'hinge', 'lockset', 'strike plate', 'panic bar', 'exit device', 'threshold', 'astragal', 'push plate'] },
  { trade: 'Demolition', keywords: ['demolition', 'demo ', 'tear out', 'tear-out', 'selective demo'] },

  // 'lawn sprinkler' (14) beats Fire Protection's 'sprinkler' (9), so the
  // irrigation reading still wins whenever the text actually says so.
  { trade: 'Landscaping', keywords: ['landscap', 'garden', 'sod', 'mulch', 'grass', 'hedge', 'irrigation', 'lawn sprinkler', 'planter', 'tree'] },
  { trade: 'Fire Protection', keywords: ['sprinkler', 'standpipe', 'fire pump', 'fire protection', 'siamese connection', 'escutcheon', 'fdc'] },
];

export interface TradeInferenceResult {
  trade: SubTrade;
  /** The keyword that triggered this match, for transparency in the UI. */
  matchedKeyword?: string;
  /** 'keyword' when we found a hit, 'fallback' when defaulting to General. */
  method: 'keyword' | 'fallback';
}

/**
 * Route free text to the sub who fixes it.
 *
 * WHY LONGEST-MATCH AND NOT FIRST-ROW-WINS. This used to return on the first
 * row containing any matching keyword. That is fine for ten residential rows
 * and becomes a trap at twenty: every row is a set of bare substrings, so a
 * row placed above another silently steals its items, and the theft is
 * invisible from reading either row. Three real cases, all from live punch
 * vocabulary:
 *
 *   "sprinkler head painted over"  — Painting's 'paint' vs 'sprinkler'
 *   "patch panel not terminated"   — Electrical's 'panel' vs 'patch panel'
 *   "cabinet stain does not match" — Painting's 'stain' vs 'cabinet'
 *
 * In every one the correct trade is the one whose keyword is MORE SPECIFIC,
 * and on a substring list "more specific" is exactly "longer". So the rule is
 * the longest keyword that occurs anywhere in the text. Ordering still breaks
 * a genuine tie, which keeps the array's sequence meaningful without making
 * it load-bearing.
 *
 * This also means a new row can be added without auditing what sits above it
 * — the only way to break an existing route is to add a LONGER keyword that
 * matches the same text, which is a deliberate act rather than an accident of
 * placement.
 */
export function inferTradeFromText(text: string): TradeInferenceResult {
  const lc = (text ?? '').toLowerCase();

  let best: { trade: SubTrade; kw: string } | null = null;
  for (const { trade, keywords } of TRADE_KEYWORDS) {
    for (const kw of keywords) {
      if (!lc.includes(kw)) continue;
      // Strictly greater, so an equal-length keyword on a later row does not
      // displace an earlier one — array order remains the tie-breaker.
      if (!best || kw.length > best.kw.length) best = { trade, kw };
    }
  }

  if (best) return { trade: best.trade, matchedKeyword: best.kw, method: 'keyword' };
  return { trade: 'General', method: 'fallback' };
}

/**
 * The sub a walk item is PROPOSED to — only ever one of this trade who is
 * assigned to THIS project (assignedProjects includes projectId). Among
 * several, the most recently touched. null when none: the walk card then says
 * "No sub on this job" and the item saves unassigned (assignedSub '').
 *
 * There is deliberately no cross-job fallback. The old one returned the most
 * recently updated sub of the trade from ANY job, and the walk wrote it as the
 * assignment without showing it — so the list, the export and that company's
 * portal all presented a guess as fact. What the walk proposes is shown on the
 * card before Save, and he can change or clear it there.
 */
export function pickSubForTrade<S extends Pick<Subcontractor, 'id' | 'trade' | 'assignedProjects'> & { updatedAt?: string }>(
  trade: SubTrade,
  subs: readonly S[],
  projectId?: string,
): S | null {
  if (!projectId) return null;
  const onProject = subs.filter(s => s.trade === trade && (s.assignedProjects ?? []).includes(projectId));
  if (onProject.length === 0) return null;
  const at = (s: S) => { const t = s.updatedAt ? new Date(s.updatedAt).getTime() : 0; return Number.isFinite(t) ? t : 0; };
  return [...onProject].sort((a, b) => at(b) - at(a))[0] ?? null;
}

/**
 * Who the walk card's item will be saved to.
 *   'auto'   — the sub pickSubForTrade proposes for the card's trade (on this
 *              job only), shown on the card BEFORE save;
 *   'picked' — he tapped a sub in the sheet;
 *   'none'   — he cleared it: saves unassigned.
 * The walk resets it to 'auto' on every save and whenever the trade changes,
 * so a sub picked for an electrical item never rides onto the next one.
 */
export type WalkSubChoice<S = Pick<Subcontractor, 'id' | 'companyName' | 'trade' | 'assignedProjects'>> =
  | { mode: 'auto' } | { mode: 'picked'; sub: S } | { mode: 'none' };

/** The sub the card shows and Save writes — the same call, so they cannot differ. null = unassigned. */
export function walkProposedSub<S extends Pick<Subcontractor, 'id' | 'trade' | 'assignedProjects'> & { updatedAt?: string }>(
  choice: WalkSubChoice<S>, trade: SubTrade, subs: readonly S[], projectId: string,
): S | null {
  if (choice.mode === 'none') return null;
  if (choice.mode === 'picked') return choice.sub;
  return pickSubForTrade(trade, subs, projectId);
}

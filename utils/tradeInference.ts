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
 * trades, the first match wins when multiple apply (so "paint booth
 * electrical" still routes to Electrical because we check Electrical
 * earlier). This mirrors how a PM actually routes: the noun (outlet,
 * leak) beats the adjective.
 */
const TRADE_KEYWORDS: Array<{ trade: SubTrade; keywords: string[] }> = [
  { trade: 'Electrical', keywords: ['electrical', 'outlet', 'switch', 'wiring', 'breaker', 'panel', 'circuit', 'gfci', 'receptacle', 'fixture', 'light', 'lamp', 'sconce'] },
  { trade: 'Plumbing',   keywords: ['plumb', 'leak', 'faucet', 'toilet', 'drain', 'sink', 'valve', 'pipe', 'supply line', 'p-trap', 'shutoff', 'water heater', 'sewer'] },
  { trade: 'HVAC',       keywords: ['hvac', 'vent', 'duct', 'thermostat', 'ac unit', 'air handler', 'register', 'return air', 'furnace', 'condenser', 'heat pump'] },
  { trade: 'Roofing',    keywords: ['roof', 'shingle', 'gutter', 'downspout', 'flashing', 'soffit', 'fascia'] },
  { trade: 'Drywall',    keywords: ['drywall', 'sheetrock', 'mud', 'tape', 'texture', 'orange peel', 'gypsum', 'ceiling tile', 'joint compound', 'skim coat'] },
  { trade: 'Painting',   keywords: ['paint', 'caulk', 'primer', 'touch up', 'touch-up', 'stain', 'sealer', 'lacquer', 'finish coat'] },
  { trade: 'Flooring',   keywords: ['floor', 'tile', 'grout', 'vinyl', 'carpet', 'hardwood', 'lvp', 'lvt', 'baseboard', 'trim', 'transition strip'] },
  { trade: 'Concrete',   keywords: ['concrete', 'slab', 'foundation', 'rebar', 'cure', 'pour', 'crack seal', 'patio', 'sidewalk'] },
  { trade: 'Framing',    keywords: ['frame', 'framing', 'stud', 'joist', 'rafter', 'truss', 'header', 'shim', 'door rough-in', 'blocking'] },
  { trade: 'Landscaping', keywords: ['landscap', 'garden', 'sod', 'mulch', 'grass', 'hedge', 'irrigation', 'sprinkler', 'planter', 'tree'] },
];

export interface TradeInferenceResult {
  trade: SubTrade;
  /** The keyword that triggered this match, for transparency in the UI. */
  matchedKeyword?: string;
  /** 'keyword' when we found a hit, 'fallback' when defaulting to General. */
  method: 'keyword' | 'fallback';
}

export function inferTradeFromText(text: string): TradeInferenceResult {
  const lc = text.toLowerCase();
  for (const { trade, keywords } of TRADE_KEYWORDS) {
    for (const kw of keywords) {
      if (lc.includes(kw)) {
        return { trade, matchedKeyword: kw, method: 'keyword' };
      }
    }
  }
  return { trade: 'General', method: 'fallback' };
}

/**
 * Given an inferred trade and the GC's sub list, pick the best sub to
 * auto-assign. Preference: assigned to this project → trade match →
 * compliance status (compliant over expiring). Returns null if no
 * reasonable candidate; the UI will show the trade badge with "No sub
 * on file" and the PM can add one or leave it blank.
 */
export function pickSubForTrade(
  trade: SubTrade,
  subs: Subcontractor[],
  projectId?: string,
): Subcontractor | null {
  const tradeSubs = subs.filter(s => s.trade === trade);
  if (tradeSubs.length === 0) return null;

  // Prefer one already assigned to this project.
  if (projectId) {
    const onProject = tradeSubs.find(s => s.assignedProjects?.includes(projectId));
    if (onProject) return onProject;
  }

  // Sort by how recently we touched them — the PM's "warm" subs bubble up.
  const sorted = [...tradeSubs].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
  return sorted[0] ?? null;
}

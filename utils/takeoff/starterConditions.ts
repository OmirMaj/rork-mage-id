// utils/takeoff/starterConditions.ts — the six "Start with" chips an empty
// desktop takeoff shows (list-3 lane TK-a, takeoff spec §9). Pure; no React.
//
// WHY. A new takeoff opened on a blank panel and a "press N" line: he had to
// name, type and price a condition before he could click once. The chips are
// the six things a GC in his job type measures first, each already carrying
// the rate his own cost book holds for it — or saying "no history" honestly.
//
// THE JOB TYPE is read from the project's type LABEL (utils/projectTypes
// projectTypeLabel — his words for Other), never invented. Unknown / blank →
// the residential-remodel default set.
//
// THE RATE is his book's: resolveStarterTrade picks the first cost-book entry
// for the chip's unit whose trade matches the chip's hint. No match → no trade
// and no rate ("no history"), never a made-up number. Lane TK-b reuses
// resolveStarterTrade for AI-suggested conditions.

import type { CostBookEntry, CostDatabase } from '@/utils/costDatabase';
import { tradesForUnit } from '@/utils/takeoffEstimate';
import { KIND_UNIT, type ConditionKind } from '@/utils/takeoff/conditions';

export interface StarterCondition {
  key: string;
  name: string;
  kind: ConditionKind;
  tradeHint: RegExp;
}

const S = (key: string, name: string, kind: ConditionKind, tradeHint: RegExp): StarterCondition =>
  ({ key, name, kind, tradeHint });

const DEFAULT_SET: readonly StarterCondition[] = [
  S('lvt', 'LVT flooring', 'area', /floor|lvt|vinyl/),
  S('drywall', 'Drywall', 'linear', /drywall|gypsum|sheetrock/),
  S('paint', 'Paint', 'area', /paint/),
  S('doors', 'Doors', 'count', /door/),
  S('base-trim', 'Base trim', 'linear', /trim|base|millwork/),
  S('tile', 'Tile', 'area', /tile/),
];

const KITCHEN_BATH_SET: readonly StarterCondition[] = [
  S('cabinets', 'Cabinets', 'linear', /cabinet/),
  S('countertops', 'Countertops', 'area', /counter/),
  S('tile', 'Tile', 'area', /tile/),
  S('plumbing-fixtures', 'Plumbing fixtures', 'count', /plumb|fixture/),
  S('drywall', 'Drywall', 'linear', /drywall|gypsum|sheetrock/),
  S('paint', 'Paint', 'area', /paint/),
];

const ROOFING_EXTERIOR_SET: readonly StarterCondition[] = [
  S('roofing', 'Roofing', 'area', /roof|shingle/),
  S('drip-edge', 'Drip edge', 'linear', /drip|edge|gutter/),
  S('siding', 'Siding', 'area', /siding/),
  S('windows', 'Windows', 'count', /window/),
  S('trim', 'Trim', 'linear', /trim|base|millwork/),
  S('vents', 'Vents', 'count', /vent/),
];

const COMMERCIAL_SET: readonly StarterCondition[] = [
  // \bact\b: "ACT" the ceiling system, not the "act" inside "contract".
  S('acoustic-ceiling', 'Acoustic ceiling', 'area', /ceiling|\bact\b|acoustic/),
  S('drywall', 'Drywall', 'linear', /drywall|gypsum|sheetrock/),
  S('carpet-tile', 'Carpet tile', 'area', /carpet/),
  S('doors', 'Doors', 'count', /door/),
  S('paint', 'Paint', 'area', /paint/),
  S('base', 'Base', 'linear', /trim|base|millwork/),
];

/** The family a job-type label falls in; exported for the validator. */
export function starterFamily(projectType: string | null | undefined): 'kitchen-bath' | 'roofing-exterior' | 'commercial' | 'default' {
  const t = typeof projectType === 'string' ? projectType.toLowerCase() : '';
  if (/kitchen|bath/.test(t)) return 'kitchen-bath';
  if (/roof|exterior|siding/.test(t)) return 'roofing-exterior';
  if (/commercial|office|tenant|retail/.test(t)) return 'commercial';
  return 'default';
}

/** Exactly six starters, unique keys, for this job-type label. */
export function starterConditionsFor(projectType: string | null | undefined): StarterCondition[] {
  const fam = starterFamily(projectType);
  const set = fam === 'kitchen-bath' ? KITCHEN_BATH_SET
    : fam === 'roofing-exterior' ? ROOFING_EXTERIOR_SET
      : fam === 'commercial' ? COMMERCIAL_SET
        : DEFAULT_SET;
  return set.map((s) => ({ ...s }));
}

/** The first cost-book entry for this kind's unit whose trade matches the hint
 *  (case-insensitive). No match → { trade: null, entry: null }. */
export function resolveStarterTrade(
  db: CostDatabase,
  hint: RegExp,
  kind: ConditionKind,
): { trade: string | null; entry: CostBookEntry | null } {
  // A copy without the g/y flags, so .test() never carries lastIndex between entries.
  const flags = hint.flags.replace(/[gyi]/g, '');
  const re = new RegExp(hint.source, `${flags}i`);
  for (const e of tradesForUnit(db, KIND_UNIT[kind])) {
    if (typeof e.trade === 'string' && re.test(e.trade)) return { trade: e.trade, entry: e };
  }
  return { trade: null, entry: null };
}

/** The chip's second line, priceCondition-style:
 *  "$4.10/SF · from your jobs", "$4.10/SF · starter rate, not from your jobs",
 *  or "no history" (no entry, or an entry with no usable rate). */
export function starterRateLine(entry: CostBookEntry | null, kind: ConditionKind): string {
  const rate = entry ? entry.suggestedRate : null;
  if (!entry || rate == null || !Number.isFinite(rate) || rate <= 0) return 'no history';
  const cents = Math.round(rate * 100);
  if (cents <= 0) return 'no history';
  const money = `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const src = entry.provenance === 'seeded' ? 'starter rate, not from your jobs' : 'from your jobs';
  return `${money}/${KIND_UNIT[kind]} · ${src}`;
}

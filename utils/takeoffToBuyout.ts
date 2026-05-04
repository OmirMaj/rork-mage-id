// takeoffToBuyout — pure mapping from a TakeoffResult into a list of
// BidPackage draft objects, grouped by sub-trade.
//
// This is the bridge between the AI takeoff and the existing buyout
// flow (app/buyout.tsx). The user runs the takeoff, then taps "Generate
// buyout packages" and we produce 8-12 trade-specific drafts (Framing,
// Doors & Hardware, Plumbing, etc.) with auto-written scope descriptions
// containing the AI's quantities. The user reviews + edits each draft
// before sending out for sub bids.
//
// Two principles drive the grouping:
//   1. **Sub-trade alignment** — packages map to who actually bids them
//      in residential. Framing carpenter, doors-and-hardware vendor,
//      drywall sub, painter, plumber, electrician.
//   2. **Spec-aware scope writing** — when a spec book has been matched,
//      the scope text includes manufacturer + product + finish so subs
//      can quote against the actual spec, not a generic placeholder.
//
// Output is just data — no API calls. The caller pipes this into
// addBidPackage() from ProjectContext.

import type {
  TakeoffResult, SpecMatchResult, SpecEntry, SubTrade,
  TakeoffWall, TakeoffFinish,
} from '@/types';

export interface BuyoutPackageDraft {
  /** Suggested name (e.g. "Framing — Walls + Plates"). */
  name: string;
  trade: SubTrade;
  /** CSI MasterFormat division if known. */
  csiDivision?: string;
  /** Plain-English scope text the user can edit. */
  scopeDescription: string;
  /** Headline quantity for the package (used as the budget placeholder). */
  primaryQuantity?: { value: number; unit: string };
  /** Confidence rollup based on the items in this package. */
  confidence: 'high' | 'medium' | 'low';
  /** Source quantities — keyed by takeoff section. Used by the UI to
   *  show what's inside each draft before the user sends it. */
  itemRefs: Array<{
    section: string;
    description: string;
    quantity: number;
    unit: string;
    confidence: 'high' | 'medium' | 'low';
  }>;
}

const fmt = (n: number, decimals = 0) => {
  if (!Number.isFinite(n)) return '0';
  if (Math.abs(n) >= 1000) return Math.round(n).toLocaleString('en-US');
  return n.toFixed(decimals);
};

function rollupConfidence(items: { confidence: 'high' | 'medium' | 'low' }[]): 'high' | 'medium' | 'low' {
  if (items.some(i => i.confidence === 'low')) return 'low';
  if (items.some(i => i.confidence === 'medium')) return 'medium';
  return items.length === 0 ? 'medium' : 'high';
}

function specBlurb(code: string | undefined, lookup: Map<string, SpecEntry>): string {
  if (!code) return '';
  const e = lookup.get(code);
  if (!e) return '';
  const parts = [e.manufacturer, e.product, e.finish, e.sku].filter(Boolean);
  return parts.length > 0 ? `\n  ${code}: ${parts.join(' · ')}` : '';
}

export function buildBuyoutDrafts(
  takeoff: TakeoffResult,
  specMatch: SpecMatchResult | null,
  options: { overrides?: Record<string, number> } = {},
): BuyoutPackageDraft[] {
  const overrides = options.overrides ?? {};
  const lookup = new Map<string, SpecEntry>();
  if (specMatch) {
    for (const e of specMatch.entries) {
      if (!lookup.has(e.code)) lookup.set(e.code, e);
    }
  }

  const drafts: BuyoutPackageDraft[] = [];

  // ---- Concrete & Foundation -------------------------------------------
  const foundationWalls = takeoff.walls.filter(w => w.category === 'foundation');
  const concreteBulk = takeoff.bulkMaterials.filter(b =>
    /concrete|footing|slab|foundation/i.test(b.description),
  );
  if (foundationWalls.length > 0 || concreteBulk.length > 0) {
    const items = [
      ...foundationWalls.map(w => ({
        section: 'Walls',
        description: w.description,
        quantity: ovr(overrides, `walls:${w.id}`, w.lengthFt),
        unit: 'LF',
        confidence: w.confidence,
      })),
      ...concreteBulk.map(b => ({
        section: 'Bulk',
        description: b.description,
        quantity: ovr(overrides, `bulk:${b.id}`, b.quantity),
        unit: b.unit.toUpperCase(),
        confidence: b.confidence,
      })),
    ];
    const totalCY = concreteBulk.filter(b => b.unit === 'cy')
      .reduce((s, b) => s + ovr(overrides, `bulk:${b.id}`, b.quantity), 0);
    drafts.push({
      name: 'Concrete & Foundation',
      trade: 'Concrete',
      csiDivision: '03 3000',
      scopeDescription: foundationScope(items, totalCY),
      primaryQuantity: totalCY > 0 ? { value: totalCY, unit: 'CY' } : undefined,
      confidence: rollupConfidence(items),
      itemRefs: items,
    });
  }

  // ---- Framing ---------------------------------------------------------
  const framingWalls = takeoff.walls.filter(w =>
    w.category === 'interior_partition'
    || w.category === 'exterior_framed'
    || w.category === 'demising'
    || w.category === 'shaft',
  );
  if (framingWalls.length > 0) {
    const items = framingWalls.map(w => ({
      section: 'Walls',
      description: w.description,
      quantity: ovr(overrides, `walls:${w.id}`, w.lengthFt),
      unit: 'LF',
      confidence: w.confidence,
    }));
    const totalLF = items.reduce((s, w) => s + w.quantity, 0);
    drafts.push({
      name: 'Framing — Walls',
      trade: 'Framing',
      csiDivision: '06 1000',
      scopeDescription: framingScope(framingWalls, overrides),
      primaryQuantity: { value: totalLF, unit: 'LF' },
      confidence: rollupConfidence(items),
      itemRefs: items,
    });
  }

  // ---- Doors & Hardware ------------------------------------------------
  if (takeoff.doors.length > 0) {
    const items = takeoff.doors.map(d => ({
      section: 'Doors',
      description: d.mark ? `${d.mark} — ${d.description}` : d.description,
      quantity: ovr(overrides, `doors:${d.id}`, d.count),
      unit: 'EA',
      confidence: d.confidence,
    }));
    const totalEA = items.reduce((s, i) => s + i.quantity, 0);
    drafts.push({
      name: 'Doors, Frames & Hardware',
      trade: 'Other',
      csiDivision: '08 1000',
      scopeDescription: scopeWithSpecs(
        'Furnish and install all interior + exterior doors, frames, and hardware per the door schedule.',
        takeoff.doors.map(d => ({
          code: d.mark,
          line: `${d.mark ? d.mark + ': ' : ''}${d.description} — ${ovr(overrides, `doors:${d.id}`, d.count)} EA (${d.widthIn}"×${d.heightIn}")`,
        })),
        lookup,
      ),
      primaryQuantity: { value: totalEA, unit: 'EA' },
      confidence: rollupConfidence(items),
      itemRefs: items,
    });
  }

  // ---- Windows ---------------------------------------------------------
  if (takeoff.windows.length > 0) {
    const items = takeoff.windows.map(w => ({
      section: 'Windows',
      description: w.mark ? `${w.mark} — ${w.description}` : w.description,
      quantity: ovr(overrides, `windows:${w.id}`, w.count),
      unit: 'EA',
      confidence: w.confidence,
    }));
    const totalEA = items.reduce((s, i) => s + i.quantity, 0);
    drafts.push({
      name: 'Windows',
      trade: 'Other',
      csiDivision: '08 5000',
      scopeDescription: scopeWithSpecs(
        'Furnish and install all windows per the window schedule. Includes all flashing, screens, and operable hardware.',
        takeoff.windows.map(w => ({
          code: w.mark,
          line: `${w.mark ? w.mark + ': ' : ''}${w.description} — ${ovr(overrides, `windows:${w.id}`, w.count)} EA (${w.widthIn}"×${w.heightIn}")`,
        })),
        lookup,
      ),
      primaryQuantity: { value: totalEA, unit: 'EA' },
      confidence: rollupConfidence(items),
      itemRefs: items,
    });
  }

  // ---- Drywall + ceilings ---------------------------------------------
  const wallFinishes = takeoff.finishes.filter(f => f.surface === 'wall' || f.surface === 'ceiling');
  // Plus the finishable wall surface area (LF × HT × 2) gets called out as
  // a drywall scope even when no wall-finish callout was extracted.
  const drywallWalls = takeoff.walls.filter(w =>
    w.category !== 'foundation' && w.category !== 'exterior_masonry',
  );
  if (drywallWalls.length > 0 || wallFinishes.length > 0) {
    const totalSF = drywallWalls.reduce((s, w) => {
      const len = ovr(overrides, `walls:${w.id}`, w.lengthFt);
      return s + len * w.heightFt * 2;
    }, 0);
    const items = drywallWalls.map(w => ({
      section: 'Walls',
      description: `${w.description} — ${ovr(overrides, `walls:${w.id}`, w.lengthFt)} LF × ${w.heightFt} ft × 2 sides`,
      quantity: ovr(overrides, `walls:${w.id}`, w.lengthFt) * w.heightFt * 2,
      unit: 'SF',
      confidence: w.confidence,
    }));
    drafts.push({
      name: 'Drywall & Ceilings',
      trade: 'Drywall',
      csiDivision: '09 2000',
      scopeDescription: scopeWithSpecs(
        `Furnish and install drywall, taping, and finishing on all framed wall + ceiling surfaces. Approximately ${fmt(totalSF)} SF (both sides). Verify dimensions with the floor plan.`,
        wallFinishes.map(f => ({
          code: f.code,
          line: `${f.code ? f.code + ': ' : ''}${f.description} — ${fmt(ovr(overrides, `finish:${f.id}`, f.quantity))} ${f.unit.toUpperCase()}`,
        })),
        lookup,
      ),
      primaryQuantity: { value: totalSF, unit: 'SF' },
      confidence: rollupConfidence(items),
      itemRefs: items,
    });
  }

  // ---- Painting --------------------------------------------------------
  const paintFinishes = takeoff.finishes.filter(f =>
    /paint|PT-/i.test(f.description) || (f.code && /^PT/i.test(f.code)),
  );
  if (paintFinishes.length > 0) {
    const items = paintFinishes.map(f => ({
      section: 'Finishes',
      description: f.code ? `${f.code} — ${f.description}` : f.description,
      quantity: ovr(overrides, `finish:${f.id}`, f.quantity),
      unit: f.unit.toUpperCase(),
      confidence: f.confidence,
    }));
    const totalSF = paintFinishes.filter(f => f.unit === 'sqft')
      .reduce((s, f) => s + ovr(overrides, `finish:${f.id}`, f.quantity), 0);
    drafts.push({
      name: 'Painting',
      trade: 'Painting',
      csiDivision: '09 9000',
      scopeDescription: scopeWithSpecs(
        `Furnish all paint, primer, prep, and labor for interior + exterior surfaces per finish schedule. Approximately ${fmt(totalSF)} SF.`,
        paintFinishes.map(f => ({
          code: f.code,
          line: `${f.code ? f.code + ': ' : ''}${f.description} — ${fmt(ovr(overrides, `finish:${f.id}`, f.quantity))} ${f.unit.toUpperCase()}`,
        })),
        lookup,
      ),
      primaryQuantity: totalSF > 0 ? { value: totalSF, unit: 'SF' } : undefined,
      confidence: rollupConfidence(items),
      itemRefs: items,
    });
  }

  // ---- Flooring --------------------------------------------------------
  const floorFinishes = takeoff.finishes.filter(f => f.surface === 'floor' || f.surface === 'base' || f.surface === 'casing' || f.surface === 'crown' || f.surface === 'trim');
  if (floorFinishes.length > 0 || takeoff.floorAreas.length > 0) {
    const totalFloorSF = takeoff.floorAreas.reduce(
      (s, f) => s + ovr(overrides, `floor:${f.id}`, f.areaSqFt),
      0,
    );
    const items = [
      ...takeoff.floorAreas.map(f => ({
        section: 'Floor areas',
        description: f.finishCode ? `${f.roomName} (${f.finishCode})` : f.roomName,
        quantity: ovr(overrides, `floor:${f.id}`, f.areaSqFt),
        unit: 'SF',
        confidence: f.confidence,
      })),
      ...floorFinishes.map(f => ({
        section: 'Finishes',
        description: f.code ? `${f.code} — ${f.description}` : f.description,
        quantity: ovr(overrides, `finish:${f.id}`, f.quantity),
        unit: f.unit.toUpperCase(),
        confidence: f.confidence,
      })),
    ];
    drafts.push({
      name: 'Flooring & Trim',
      trade: 'Flooring',
      csiDivision: '09 6000',
      scopeDescription: scopeWithSpecs(
        `Furnish + install all floor finishes, base, casing, and trim per the finish schedule. Total floor area approximately ${fmt(totalFloorSF)} SF.`,
        [...takeoff.floorAreas, ...floorFinishes].map(item => {
          if ('roomName' in item) {
            return {
              code: item.finishCode,
              line: `${item.roomName}: ${fmt(ovr(overrides, `floor:${item.id}`, item.areaSqFt))} SF${item.finishCode ? ` (${item.finishCode})` : ''}`,
            };
          }
          const f = item as TakeoffFinish;
          return {
            code: f.code,
            line: `${f.code ? f.code + ': ' : ''}${f.description} — ${fmt(ovr(overrides, `finish:${f.id}`, f.quantity))} ${f.unit.toUpperCase()}`,
          };
        }),
        lookup,
      ),
      primaryQuantity: { value: totalFloorSF, unit: 'SF' },
      confidence: rollupConfidence(items),
      itemRefs: items,
    });
  }

  // ---- Plumbing / Electrical / HVAC / Appliances ----------------------
  const tradeMap: Array<{ category: 'plumbing' | 'electrical' | 'hvac' | 'appliance'; trade: SubTrade; csi: string; name: string }> = [
    { category: 'plumbing', trade: 'Plumbing', csi: '22 0000', name: 'Plumbing — Fixtures + Rough-in' },
    { category: 'electrical', trade: 'Electrical', csi: '26 0000', name: 'Electrical — Devices + Lighting' },
    { category: 'hvac', trade: 'HVAC', csi: '23 0000', name: 'HVAC — Equipment + Distribution' },
    { category: 'appliance', trade: 'Other', csi: '11 3000', name: 'Appliances' },
  ];
  for (const tm of tradeMap) {
    const fx = takeoff.fixtures.filter(f => f.category === tm.category);
    if (fx.length === 0) continue;
    const items = fx.map(f => ({
      section: 'Fixtures',
      description: f.mark ? `${f.mark} — ${f.description}` : f.description,
      quantity: ovr(overrides, `fixture:${f.id}`, f.count),
      unit: 'EA',
      confidence: f.confidence,
    }));
    const totalEA = items.reduce((s, i) => s + i.quantity, 0);
    drafts.push({
      name: tm.name,
      trade: tm.trade,
      csiDivision: tm.csi,
      scopeDescription: scopeWithSpecs(
        `Furnish + install all ${tm.category} fixtures per the schedule. Includes all rough-in and trim work to make systems operational.`,
        fx.map(f => ({
          code: f.mark,
          line: `${f.mark ? f.mark + ': ' : ''}${f.description} — ${ovr(overrides, `fixture:${f.id}`, f.count)} EA`,
        })),
        lookup,
      ),
      primaryQuantity: { value: totalEA, unit: 'EA' },
      confidence: rollupConfidence(items),
      itemRefs: items,
    });
  }

  return drafts;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function ovr(map: Record<string, number>, key: string, fallback: number): number {
  const v = map[key];
  return Number.isFinite(v) ? v : fallback;
}

function foundationScope(
  items: { description: string; quantity: number; unit: string; confidence: string }[],
  totalCY: number,
): string {
  const lines = items.map(i => `  - ${i.description}: ${fmt(i.quantity)} ${i.unit}`).join('\n');
  return [
    `Concrete + foundation work per structural drawings.${totalCY > 0 ? ` Approximately ${fmt(totalCY)} CY of concrete.` : ''}`,
    'Quantities (verify against structural before bidding):',
    lines,
  ].join('\n');
}

function framingScope(walls: TakeoffWall[], overrides: Record<string, number>): string {
  const byType = new Map<string, number>();
  for (const w of walls) {
    const key = w.category ?? 'other';
    const len = ovr(overrides, `walls:${w.id}`, w.lengthFt);
    byType.set(key, (byType.get(key) ?? 0) + len);
  }
  const summary = Array.from(byType.entries()).map(([cat, lf]) =>
    `  - ${cat.replace('_', ' ')}: ${fmt(lf)} LF`,
  ).join('\n');
  return [
    'Wood + cold-formed metal framing per the structural drawings.',
    'Wall lengths by category (verify with floor plan):',
    summary,
    'Includes all blocking, sheathing, and shear panels indicated on plans.',
  ].join('\n');
}

function scopeWithSpecs(
  intro: string,
  lines: { code?: string; line: string }[],
  lookup: Map<string, SpecEntry>,
): string {
  const out: string[] = [intro];
  if (lines.length > 0) {
    out.push('Quantities + spec callouts (verify before bidding):');
    for (const l of lines) {
      out.push(`  - ${l.line}${specBlurb(l.code, lookup)}`);
    }
  }
  return out.join('\n');
}

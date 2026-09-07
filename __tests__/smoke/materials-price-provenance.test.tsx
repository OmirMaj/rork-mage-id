/**
 * NAV-01 — the Materials tab must never present a price it cannot defend.
 *
 * WHAT WENT WRONG (runtime audit 2026-09-06, Release build, founder's account).
 * The screen showed a pulsing green dot reading "LIVE PRICING" and, under it,
 * "Prices updated 9:20 PM · New York City rates · Pull to refresh". There was
 * no feed. `getLivePrices()` multiplied a hardcoded table by
 * (1 + sin(Date.now() / 10000) * volatility); the screen re-rolled that sine
 * every five minutes, on pull-to-refresh and on every foreground, and stamped
 * the wall clock on the result. The same invented movements were compared
 * against the user's price alerts and fired "X is now $Y, below your $Z
 * target" for moves that never happened — writing the fabricated number back
 * to Supabase once per alert per re-roll.
 *
 * Those numbers are not decorative: the Materials cart feeds
 * MaterialCartContext, which feeds the Full Estimator and Review Estimate,
 * which feed bids sent to clients.
 *
 * WHAT THIS PINS.
 *   1. The pricing functions are DETERMINISTIC — no clock, no randomness. Two
 *      calls a second apart, or with different seeds, are byte-identical, and
 *      a catalog price is exactly the table price × the market factor.
 *   2. The screen states PROVENANCE — what the numbers are, when the book was
 *      compiled, which market factor is on them — and never states a "live"
 *      claim or an update time.
 *   3. Target status is DERIVED from the book, never read back from the
 *      poisoned `currentPrice`/`isTriggered` columns the old feed wrote.
 *   4. `resolvePricingMarket` does not invent a market: an unrecognised
 *      location yields the un-adjusted US average with `resolved: false`,
 *      rather than the +35% New York City default the screen used to open on.
 *
 * Both halves matter. The pure assertions cannot see the copy; the mounted
 * assertions cannot see a sine wave that happens to be flat this second.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import {
  BASE_MATERIALS,
  CATALOG_COMPILED_ON,
  CATALOG_NOT_A_FEED,
  CATALOG_STALE_AFTER_MONTHS,
  averageBulkDiscountPct,
  catalogAgeMonths,
  catalogCompiledLabel,
  catalogIsStale,
  catalogProvenanceLine,
  evaluatePriceTargets,
  getCatalogPrices,
  getLivePrices,
  getRegionMultiplier,
  marketForSelection,
  resolvePricingMarket,
  type MaterialItem,
} from '@/constants/materials';

const ROOT = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/** Strip comments so the WHY notes in these files can neither satisfy nor
 *  violate a source assertion — the old copy is quoted in several of them. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Flatten every string node in a rendered tree. */
function collectText(node: unknown, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === 'string') {
    out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((n) => collectText(n, out));
    return out;
  }
  const children = (node as { children?: unknown }).children;
  if (children) collectText(children, out);
  return out;
}

/**
 * The rendered text under `testID`, walked off the JSON tree.
 *
 * NOT `getByTestId(id).props.children`: that hands back the element's
 * UNRENDERED React children, whose text sits behind `.props.children` while
 * `collectText` walks `.children`. For any node whose children are elements
 * rather than bare strings it therefore yields '' — which silently satisfies
 * every `.not.toMatch` in this file and fails every positive one. The JSON
 * tree is already rendered, so there a node's `children` IS its subtree.
 */
function textUnderTestId(tree: { toJSON: () => unknown }, testID: string): string {
  const find = (node: unknown): unknown => {
    if (node == null || typeof node === 'string') return null;
    if (Array.isArray(node)) {
      for (const n of node) {
        const hit = find(n);
        if (hit) return hit;
      }
      return null;
    }
    const props = (node as { props?: Record<string, unknown> }).props;
    if (props && props.testID === testID) return node;
    return find((node as { children?: unknown }).children);
  };
  const node = find(tree.toJSON());
  if (node === null) throw new Error(`nothing rendered with testID "${testID}"`);
  // Joined with nothing: a <Text> split across three children ('+', '10', '%')
  // is one word on screen, and a separator would hide it from a regex.
  return collectText(node).join('');
}

const base = (id: string): MaterialItem => {
  const m = BASE_MATERIALS.find((x) => x.id === id);
  if (!m) throw new Error(`fixture drift: BASE_MATERIALS has no "${id}"`);
  return m;
};

describe('materials pricing is a dated book, not a feed', () => {
  it('getCatalogPrices is deterministic — the same multiplier, the same prices', () => {
    const a = getCatalogPrices(1.35);
    const b = getCatalogPrices(1.35);
    expect(a.length).toBe(b.length);
    expect(a.length).toBeGreaterThan(0);
    // Cheap full comparison: the whole price vector, in order.
    expect(a.map((m) => `${m.id}:${m.baseRetailPrice}:${m.baseBulkPrice}`)).toEqual(
      b.map((m) => `${m.id}:${m.baseRetailPrice}:${m.baseBulkPrice}`)
    );
  });

  it('a catalog price is exactly the table price × the market factor, in whole cents', () => {
    const stud = base('l1');
    const priced = getCatalogPrices(1.35).find((m) => m.id === 'l1');
    expect(priced).toBeTruthy();
    expect(priced!.baseRetailPrice).toBe(Number((stud.baseRetailPrice * 1.35).toFixed(2)));
    expect(priced!.baseBulkPrice).toBe(Number((stud.baseBulkPrice * 1.35).toFixed(2)));
    // Whole cents everywhere, not a float tail.
    for (const m of getCatalogPrices(1.11).slice(0, 500)) {
      expect(Math.round(m.baseRetailPrice * 100)).toBeCloseTo(m.baseRetailPrice * 100, 6);
    }
  });

  it('no multiplier means the un-adjusted national list price', () => {
    const priced = getCatalogPrices().find((m) => m.id === 'l1');
    expect(priced!.baseRetailPrice).toBe(base('l1').baseRetailPrice);
  });

  it('a nonsense multiplier falls back to 1 rather than producing a nonsense price', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(getCatalogPrices(bad).find((m) => m.id === 'l1')!.baseRetailPrice).toBe(
        base('l1').baseRetailPrice
      );
    }
  });

  it('getLivePrices IGNORES its seed — the sine wave is gone, not re-tuned', () => {
    // The two seeds the app used to pass: a fixed engine seed and the clock.
    const withEngineSeed = getLivePrices(100, 1.22);
    const withClock = getLivePrices(Date.now() / 10000, 1.22);
    expect(withEngineSeed.map((m) => m.baseRetailPrice)).toEqual(
      withClock.map((m) => m.baseRetailPrice)
    );
    // …and it agrees with the honest name, so the estimate screens that still
    // call the shim price identically to the Materials tab.
    expect(withClock.map((m) => m.baseRetailPrice)).toEqual(
      getCatalogPrices(1.22).map((m) => m.baseRetailPrice)
    );
  });

  it('constants/materials.ts has no clock and no randomness in its pricing', () => {
    const src = stripComments(read('constants/materials.ts'));
    expect(src).not.toMatch(/Math\.sin|Math\.random/);
    expect(src).not.toMatch(/Date\.now\(\)/);
    expect(src).not.toMatch(/applyPriceVariance|PRICE_VOLATILITY/);
  });
});

describe('the price book states its own provenance', () => {
  it('exposes a compile date that parses, and an age measured from it', () => {
    expect(CATALOG_COMPILED_ON).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(catalogCompiledLabel()).toMatch(/April 2026/);
    expect(catalogAgeMonths(new Date(2026, 3, 16))).toBe(0);
    expect(catalogAgeMonths(new Date(2026, 4, 15))).toBe(0); // day not come round yet
    expect(catalogAgeMonths(new Date(2026, 4, 16))).toBe(1);
    expect(catalogAgeMonths(new Date(2027, 3, 16))).toBe(12);
    // Never negative, even on a device with a wrong clock.
    expect(catalogAgeMonths(new Date(2020, 0, 1))).toBe(0);
  });

  it('goes stale on a stated threshold rather than ageing silently', () => {
    const compiled = new Date(2026, 3, 16);
    const justUnder = new Date(2026, 3 + CATALOG_STALE_AFTER_MONTHS - 1, 16);
    const atThreshold = new Date(2026, 3 + CATALOG_STALE_AFTER_MONTHS, 16);
    expect(catalogIsStale(compiled)).toBe(false);
    expect(catalogIsStale(justUnder)).toBe(false);
    expect(catalogIsStale(atThreshold)).toBe(true);
  });

  it('the provenance line names the book, its age and the market — never an update time', () => {
    const line = catalogProvenanceLine('Houston', new Date(2026, 8, 6));
    expect(line).toContain('List prices');
    expect(line).toContain('April 2026');
    expect(line).toContain('4 months old');
    expect(line).toContain('adjusted for Houston');
    expect(line).not.toMatch(/updated|live|refresh/i);
  });

  it('says plainly when it does not know the market', () => {
    expect(catalogProvenanceLine(null, new Date(2026, 8, 6))).toContain('US average — no market set');
  });

  it('the "not a feed" sentence tells the contractor what to do about it', () => {
    expect(CATALOG_NOT_A_FEED).toMatch(/not a live feed/i);
    expect(CATALOG_NOT_A_FEED).toMatch(/supplier/i);
  });
});

describe('resolvePricingMarket does not invent a market', () => {
  it('resolves the metro a contractor actually works in', () => {
    const houston = resolvePricingMarket('Houston, TX');
    expect(houston.resolved).toBe(true);
    expect(houston.city).toBe('Houston');
    expect(houston.multiplier).toBeLessThan(1);
  });

  it('falls back to the region when only a state is named', () => {
    const tx = resolvePricingMarket('Katy, TX');
    expect(tx.resolved).toBe(true);
    expect(tx.city).toBeNull();
    expect(tx.regionId).toBe('southwest');
  });

  it('does not price Portland, Maine as Portland, Oregon', () => {
    const me = resolvePricingMarket('Portland, ME');
    expect(me.city).toBeNull();
    expect(me.regionId).toBe('new_england');
    expect(resolvePricingMarket('Portland, OR').city).toBe('Portland');
  });

  it('the default settings value resolves to the un-adjusted US average, NOT New York City', () => {
    for (const location of ['United States', '', '   ', 'Somewhere', undefined]) {
      const m = resolvePricingMarket(location);
      expect(m.resolved).toBe(false);
      expect(m.multiplier).toBe(1);
      expect(m.city).toBeNull();
      expect(m.label).toBe('US average');
    }
  });

  it('a UI selection maps to the same shape, and clearing it returns to US average', () => {
    expect(marketForSelection(null, 'Denver')).toMatchObject({ city: 'Denver', resolved: true });
    expect(marketForSelection('midwest', null)).toMatchObject({ label: 'Midwest', resolved: true });
    expect(marketForSelection(null, null)).toMatchObject({ resolved: false, multiplier: 1 });
  });

  it('matches a metro through punctuation — "Washington, DC" is the DC metro', () => {
    // The metro key is 'Washington DC' with no comma, so a raw substring test
    // missed the way a contractor actually types it and quietly fell through
    // to the DC *region* factor (1.15) instead of the metro (1.18).
    const dc = resolvePricingMarket('Washington, DC');
    expect(dc.city).toBe('Washington DC');
    expect(dc.multiplier).toBe(1.18);
    // …without dragging unrelated punctuation into a false match.
    expect(resolvePricingMarket('Portland, ME').city).toBeNull();
  });
});

/**
 * ONE RESOLVER.
 *
 * `getRegionMultiplier` owned a second, private location→multiplier table,
 * matched by unbounded `String.includes` in `Object.entries` order — first key
 * wins — over keys that included the bare state codes 'ca', 'or', 'in', 'al'
 * and 'ma'. 'ca' was iterated first, so any city whose NAME contains those two
 * letters was priced as California. Measured on the shipped function before
 * the fix: Chicago 1.18, Cary NC 1.18, Ocala FL 1.18, Decatur GA 1.18,
 * Scarborough ME 1.18, Portland ME 1.08 (Oregon's factor).
 *
 * That is the multiplier the estimate path uses — app/(tabs)/estimate/full.tsx,
 * app/change-order.tsx, app/takeoff-estimate.tsx, app/area-takeoff.tsx — so a
 * Chicago GC's every material was 25.5% over the midwest factor the table
 * meant to give him, in a bid he sent to a client. A bigger error than the
 * ±6% sine wave NAV-01 removed, and it survived NAV-01 because it lived 160
 * lines above the honest resolver in the same file.
 */
describe('there is exactly one location resolver', () => {
  const locations = [
    'Chicago, IL', 'Cary, NC', 'Ocala, FL', 'Decatur, GA', 'Scarborough, ME',
    'Portland, ME', 'Portland, OR', 'New York, NY', 'Houston, TX', 'Katy, TX',
    'Alameda, CA', 'Malden, MA', 'Indianapolis, IN', 'Washington, DC',
    'Ocean City, MD', 'United States', '', 'Somewhere',
  ];

  it('getRegionMultiplier IS resolvePricingMarket — the two cannot drift apart', () => {
    for (const loc of locations) {
      expect([loc, getRegionMultiplier(loc)]).toEqual([loc, resolvePricingMarket(loc).multiplier]);
    }
  });

  it('no city is priced as another state because its NAME contains that state code', () => {
    // Asserted on the LABEL, not the number. New England's cost index is also
    // 1.18, so 'Scarborough, ME' → 1.18 is now RIGHT for a reason that has
    // nothing to do with why it was wrong before; a numeric assertion there
    // would pass on the old California bug too.
    const market = (loc: string) => [loc, resolvePricingMarket(loc).label];
    expect(market('Chicago, IL')).toEqual(['Chicago, IL', 'Chicago']);
    expect(market('Cary, NC')).toEqual(['Cary, NC', 'Southeast']);
    expect(market('Ocala, FL')).toEqual(['Ocala, FL', 'Southeast']);
    expect(market('Decatur, GA')).toEqual(['Decatur, GA', 'Southeast']);
    expect(market('Scarborough, ME')).toEqual(['Scarborough, ME', 'New England']);
    expect(market('Portland, ME')).toEqual(['Portland, ME', 'New England']);
    expect(market('Portland, OR')).toEqual(['Portland, OR', 'Portland']);
    // Nothing above resolves to California/West Coast, which is what all five
    // of the first group returned under the substring table.
    for (const loc of ['Chicago, IL', 'Cary, NC', 'Ocala, FL', 'Decatur, GA', 'Scarborough, ME']) {
      expect([loc, resolvePricingMarket(loc).regionId]).not.toEqual([loc, 'west_coast']);
    }
    expect(getRegionMultiplier('Chicago, IL')).toBe(1.12); // the Chicago metro
    expect(getRegionMultiplier('Portland, OR')).toBe(1.1); // the Portland metro
  });

  it('an unrecognised location is the un-adjusted list price, not a guess', () => {
    for (const loc of ['United States', '', 'Somewhere']) {
      expect(getRegionMultiplier(loc)).toBe(1);
    }
  });

  it('the private substring table is gone from the source, not merely unused', () => {
    const src = stripComments(read('constants/materials.ts'));
    // The tell-tale keys. Any of them back in a lookup means the second table
    // has been reintroduced.
    expect(src).not.toMatch(/'ca':\s*'california'/);
    expect(src).not.toMatch(/'or':\s*'northwest'/);
    expect(src).not.toMatch(/regionMap/);
  });

  it('the estimate screen reads the market from the resolver, label included', () => {
    // It used to reverse-engineer the label by searching REGIONAL_FACTORS for
    // a factor numerically equal to the multiplier, falling back to "National
    // Avg". No metro factor is in that list, so a Chicago user would have been
    // shown "National Avg ×1.12" — a stated market next to the proof he is not
    // in it.
    const src = stripComments(read('app/(tabs)/estimate/full.tsx'));
    expect(src).toMatch(/resolvePricingMarket\(settings\.location\)/);
    expect(src).not.toMatch(/getRegionMultiplier/);
    expect(src).not.toMatch(/REGIONAL_FACTORS/);
    // The reverse-lookup itself, not the string: 'National Avg' is also the
    // legitimate `region` field on an AI-found row, which is a different claim.
    expect(src).not.toMatch(/\?\?\s*'National Avg'/);
    // And the header no longer calls a hardcoded book "live".
    expect(src).not.toMatch(/materials · live/);
  });
});

describe('price targets are compared, not watched', () => {
  const catalog = getCatalogPrices(1);
  const studId = 'l1';
  const studPrice = catalog.find((m) => m.id === studId)!.baseRetailPrice;

  it('meets the target only when the book price actually crosses it', () => {
    const [under, over] = evaluatePriceTargets(
      [
        { id: 'a', materialId: studId, targetPrice: studPrice + 1, direction: 'below' },
        { id: 'b', materialId: studId, targetPrice: studPrice + 1, direction: 'above' },
      ],
      catalog
    );
    expect(under).toEqual({ id: 'a', catalogPrice: studPrice, meetsTarget: true });
    expect(over).toEqual({ id: 'b', catalogPrice: studPrice, meetsTarget: false });
  });

  it('a paused target reports no verdict rather than a stale one', () => {
    const [st] = evaluatePriceTargets(
      [{ id: 'a', materialId: studId, targetPrice: 9999, direction: 'below', isPaused: true }],
      catalog
    );
    expect(st.meetsTarget).toBeNull();
    expect(st.catalogPrice).toBe(studPrice);
  });

  it('a target on a material that left the book says so instead of guessing', () => {
    const [st] = evaluatePriceTargets(
      [{ id: 'a', materialId: 'no-such-material', targetPrice: 5, direction: 'below' }],
      catalog
    );
    expect(st).toEqual({ id: 'a', catalogPrice: null, meetsTarget: null });
  });
});

describe('the Materials screen source no longer claims a feed', () => {
  const src = stripComments(read('app/(tabs)/materials/index.tsx'));

  it('has no "LIVE PRICING" chip, no update time and no pull-to-refresh', () => {
    expect(src).not.toMatch(/LIVE PRICING/);
    expect(src).not.toMatch(/Prices updated/);
    expect(src).not.toMatch(/Pull to refresh/);
    expect(src).not.toMatch(/refreshControl=/);
    expect(src).not.toMatch(/MageRefreshControl/);
    expect(src).not.toMatch(/real-time/i);
  });

  it('does not re-price on a timer or on foreground', () => {
    expect(src).not.toMatch(/setInterval/);
    expect(src).not.toMatch(/AppState/);
  });

  it('fires no dialog and writes no price back to a stored target', () => {
    expect(src).not.toMatch(/showAlert\(/);
    expect(src).not.toMatch(/currentPrice/);
    expect(src).not.toMatch(/isTriggered/);
  });

  it('prices through the honest entry point and states provenance', () => {
    expect(src).toMatch(/getCatalogPrices\(market\.multiplier\)/);
    expect(src).toMatch(/catalogProvenanceLine\(/);
    expect(src).toMatch(/CATALOG_NOT_A_FEED/);
    expect(src).toMatch(/resolvePricingMarket\(settings\.location\)/);
    expect(src).not.toMatch(/'New York City'/);
  });

  it('paints its warning states in theme tokens, so the caution survives dark mode', () => {
    // Colors.warningLight (#FFF3E0) and Colors.successLight (#E8FAF0) are
    // single fixed hex values with NO dark variant. Under them this screen
    // painted Colors.warning (#FF9500 in dark) at roughly 2:1 — an unreadable
    // caution, which is the same as no caution.
    //
    // Two of the three were reachable the day this was written (a met target,
    // a paused target). The third — the stale-price-book banner — switches
    // ITSELF on at CATALOG_COMPILED_ON + CATALOG_STALE_AFTER_MONTHS, with no
    // code change and therefore no review, which is exactly why it is pinned
    // here rather than left for someone to notice.
    expect(src).not.toMatch(/Colors\.warningLight/);
    expect(src).not.toMatch(/Colors\.successLight/);
    expect(src).toMatch(/warningSoft/);
    expect(src).toMatch(/warningLabel/);
  });
});

/**
 * The category screen is where the contractor actually stands when he writes a
 * number down: it lists the prices, the supplier and the Set-Alert bell. The
 * NAV-01 fix landed one screen back, on the index, and left this one showing
 * bare prices with no provenance and promising a notification nothing can send.
 */
describe('the category screen keeps the same promises as the index', () => {
  const src = stripComments(read('app/(tabs)/materials/[category].tsx'));

  it('does not promise a notification no code can send', () => {
    // There is no price path in contexts/NotificationContext.tsx and none in
    // supabase/functions/notify. A target row is read by exactly one thing:
    // the Materials tab, at render, comparing it against the catalog. The one
    // piece of code that ever produced a price notification was the
    // sine-driven showAlert('Price Alert', …) NAV-01 deleted — so after that
    // deletion this promise was not merely optimistic, it was unbacked.
    expect(src).not.toMatch(/You'll be notified/);
    expect(src).not.toMatch(/notified when/);
    // …and says what does happen instead.
    expect(src).toMatch(/does not watch the market/);
  });

  it('prices through the deterministic entry point, with no clock in the call', () => {
    expect(src).toMatch(/getCatalogPrices\(locationMultiplier\)/);
    expect(src).not.toMatch(/getLivePrices/);
    expect(src).not.toMatch(/Date\.now\(\) \/ 10000/);
  });

  it('states on THIS screen what the prices are', () => {
    expect(src).toMatch(/CATALOG_NOT_A_FEED/);
    expect(src).toMatch(/catalogCompiledLabel\(\)/);
  });
});

describe('the catalog makes no claim it has not checked', () => {
  it('states no part numbers', () => {
    // One row of 274 carried a SKU ('161640', against 'Home Depot') and nobody
    // had ever checked it against that retailer. A part number is the most
    // checkable claim on the screen and the most expensive to get wrong — it
    // is what gets read out at a trade desk. One unverified SKU is a
    // copy-paste leftover, not a data set. If SKUs are wanted they arrive as a
    // checked column with a source, and this assertion is what you update when
    // they do.
    const withSku = BASE_MATERIALS.filter((m) => m.sku !== undefined);
    expect(withSku.map((m) => m.id)).toEqual([]);
  });

  it('every row still names its unit and a price, so nothing was hollowed out', () => {
    for (const m of BASE_MATERIALS) {
      expect(m.unit.length).toBeGreaterThan(0);
      expect(m.baseRetailPrice).toBeGreaterThan(0);
      expect(m.baseBulkPrice).toBeGreaterThan(0);
    }
    expect(BASE_MATERIALS.length).toBe(274);
  });
});

describe('the Materials screen renders what it is', () => {
  it('shows the price book, its date and the not-a-feed caution — and no live claim', async () => {
    await primeWorld('populated');
    const tree = await mountRouteChecked('/materials');
    const text = collectText(tree.toJSON()).join('   ');

    expect(text).toMatch(/REFERENCE PRICE BOOK/);
    expect(text).not.toMatch(/LIVE PRICING/i);
    expect(text).not.toMatch(/Prices updated/i);
    expect(text).not.toMatch(/Pull to refresh/i);

    expect(textUnderTestId(tree, 'materials-provenance')).toMatch(/List prices · April 2026/);
    expect(textUnderTestId(tree, 'materials-not-a-feed')).toMatch(/Not a live feed/);
    expect(textUnderTestId(tree, 'materials-source-note')).toMatch(/does not receive supplier feeds/);
  });

  it("opens on the contractor's own market, not a hardcoded New York City", async () => {
    // The fixture's settings.location is 'Portland, OR'. The screen used to
    // open on New York City (+35%) regardless — a Manhattan uplift a Portland
    // GC never chose, printed as "New York City rates".
    await primeWorld('populated');
    const tree = await mountRouteChecked('/materials');
    const banner = textUnderTestId(tree, 'materials-market-banner');
    expect(banner).toMatch(/Portland/);
    expect(banner).not.toMatch(/New York City/);
    // Pacific-NW metro factor, not the +35% the screen used to open on.
    expect(banner).toMatch(/\+10%/);
    expect(textUnderTestId(tree, 'materials-provenance')).toMatch(/adjusted for Portland/);
  });

  it('renders the same prices on two independent mounts', async () => {
    await primeWorld('populated');
    const first = collectText((await mountRouteChecked('/materials')).toJSON())
      .filter((t) => /^\$/.test(t) || /–/.test(t));
    await primeWorld('populated');
    const second = collectText((await mountRouteChecked('/materials')).toJSON())
      .filter((t) => /^\$/.test(t) || /–/.test(t));
    expect(first.length).toBeGreaterThan(0);
    expect(first).toEqual(second);
  });
});

describe('the bulk-savings claim is derived from the book, not asserted', () => {
  it('averageBulkDiscountPct is the real mean over the rows shown', () => {
    const items = getCatalogPrices(1).filter((m) => m.specTier === 'base');
    const manual = Math.round(
      (items.reduce((s, i) => s + (i.baseRetailPrice - i.baseBulkPrice) / i.baseRetailPrice, 0) /
        items.length) *
        100
    );
    expect(averageBulkDiscountPct(items)).toBe(manual);
  });

  it('is invariant under the market factor — a discount is a ratio', () => {
    const nat = getCatalogPrices(1).filter((m) => m.specTier === 'base');
    const nyc = getCatalogPrices(1.35).filter((m) => m.specTier === 'base');
    expect(averageBulkDiscountPct(nyc)).toBe(averageBulkDiscountPct(nat));
  });

  it('an empty list yields 0 rather than NaN', () => {
    expect(averageBulkDiscountPct([])).toBe(0);
  });
});

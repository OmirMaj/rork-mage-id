// validate-widget-estimate.ts — pins utils/widgetEstimate.ts (the embeddable
// "Instant Estimate" widget engine).
//
// This engine ships to third-party websites, so its two jobs are (a) never
// print an inverted or absurd range and (b) never pretend to know something it
// doesn't. Both are asserted here, plus a drift guard against the hand-ported
// copy inside supabase/functions/widget-estimate (Deno can't import `@/`).
//
// Path is relative to the repo root — ship-check runs validators from there.
// Run: bun run scripts/validate-widget-estimate.ts
import { readFileSync } from 'node:fs';
import {
  estimateWidgetRange,
  formatWidgetRange,
  normalizeProjectType,
  normalizeQuality,
  regionFactorForZip,
  WIDGET_PROJECT_TYPES,
  WIDGET_QUALITY_MULTIPLIERS,
} from '../utils/widgetEstimate';
import type { WidgetQuality } from '../utils/widgetEstimate';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const okEq = JSON.stringify(got) === JSON.stringify(want);
  if (okEq) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got: ', JSON.stringify(got), '\n      want:', JSON.stringify(want)); }
}
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

const NOW = Date.parse('2026-02-01T00:00:00Z');
const QUALITIES: WidgetQuality[] = ['budget', 'standard', 'premium', 'luxury'];

console.log('\ninstant estimate widget (embeddable ballpark engine):');

// ── range ordering: low <= likely <= high, everywhere ─────────────────────
{
  let bad = 0, checked = 0, firstBad = '';
  for (const t of WIDGET_PROJECT_TYPES) {
    for (const q of QUALITIES) {
      // typical size, both edges of the priced band, and outside it both ways
      for (const size of [t.minSizeSqft, t.typicalSizeSqft, t.maxSizeSqft, t.minSizeSqft / 2, t.maxSizeSqft * 2]) {
        for (const region of [0.7, 1, 1.6]) {
          const e = estimateWidgetRange({ projectType: t.id, sizeSqft: size, quality: q, regionFactor: region });
          if (!e.priceable || !e.range) continue;
          checked++;
          const r = e.range;
          const good = r.low <= r.likely && r.likely <= r.high && r.low > 0 && Number.isFinite(r.high);
          if (!good) { bad++; if (!firstBad) firstBad = `${t.id}/${q}/${size}sf/${region}× → ${JSON.stringify(r)}`; }
        }
      }
    }
  }
  ok(`range ordering low<=likely<=high across ${checked} combinations`, bad === 0, firstBad);
  ok('exercised every project type × quality', checked >= WIDGET_PROJECT_TYPES.length * QUALITIES.length);
}

// ── all outputs are whole, roundable dollars (nothing like "$41,237.4") ──
{
  const e = estimateWidgetRange({ projectType: 'kitchen_remodel', sizeSqft: 200, quality: 'standard', regionFactor: 1 });
  const r = e.range!;
  ok('range values are integers', [r.low, r.likely, r.high].every(v => Number.isInteger(v)), JSON.stringify(r));
  ok('perSqft is derived from the rounded range', Math.abs(r.likely / 200 - e.perSqft!.likely) < 0.01);
}

// ── size scaling ──────────────────────────────────────────────────────────
{
  const small = estimateWidgetRange({ projectType: 'whole_home_remodel', sizeSqft: 1000, quality: 'standard', regionFactor: 1 });
  const mid = estimateWidgetRange({ projectType: 'whole_home_remodel', sizeSqft: 2000, quality: 'standard', regionFactor: 1 });
  const big = estimateWidgetRange({ projectType: 'whole_home_remodel', sizeSqft: 4000, quality: 'standard', regionFactor: 1 });
  ok('bigger job costs more in total', small.range!.likely < mid.range!.likely && mid.range!.likely < big.range!.likely,
    `${small.range!.likely} → ${mid.range!.likely} → ${big.range!.likely}`);
  ok('$/sf falls as the job grows (economies of scale)',
    small.perSqft!.likely > mid.perSqft!.likely && mid.perSqft!.likely > big.perSqft!.likely,
    `${small.perSqft!.likely} → ${mid.perSqft!.likely} → ${big.perSqft!.likely}`);
  ok('doubling size does NOT double the price', big.range!.likely < mid.range!.likely * 2,
    `2000sf=${mid.range!.likely} 4000sf=${big.range!.likely}`);
  ok('doubling size still moves the price a lot', big.range!.likely > mid.range!.likely * 1.6);

  // Small jobs are not a linear extrapolation of the headline $/sf: the size
  // curve lifts the rate, and below a point the mobilization floor takes over.
  const tinyBath = estimateWidgetRange({ projectType: 'bathroom_remodel', sizeSqft: 25, quality: 'standard', regionFactor: 1 });
  ok('smallest bathroom still clears the mobilization minimum', tinyBath.range!.likely >= 9000,
    `got ${tinyBath.range!.likely}`);
  ok('small job carries a higher $/sf than the headline rate', tinyBath.perSqft!.likely > 380,
    `got ${tinyBath.perSqft!.likely}/sf vs headline 380`);

  const tinyFloor = estimateWidgetRange({ projectType: 'flooring', sizeSqft: 100, quality: 'standard', regionFactor: 1 });
  ok('below the minimum, the floor drives the number', tinyFloor.range!.likely >= 2500,
    `got ${tinyFloor.range!.likely}`);
  ok('...and the floor is explained in the assumptions',
    tinyFloor.assumptions.some(a => /mobilize/i.test(a)), tinyFloor.assumptions.join(' | '));
  ok('...and the band still brackets it', tinyFloor.range!.low <= tinyFloor.range!.likely && tinyFloor.range!.likely <= tinyFloor.range!.high,
    JSON.stringify(tinyFloor.range));
}

// ── quality tiers ─────────────────────────────────────────────────────────
{
  const at = (q: WidgetQuality) =>
    estimateWidgetRange({ projectType: 'kitchen_remodel', sizeSqft: 200, quality: q, regionFactor: 1 }).range!.likely;
  const [b, s, p, l] = [at('budget'), at('standard'), at('premium'), at('luxury')];
  ok('budget < standard < premium < luxury', b < s && s < p && p < l, `${b} / ${s} / ${p} / ${l}`);
  ok('luxury is roughly the modelled 1.85× of standard', Math.abs(l / s - 1.85) < 0.06, `ratio ${(l / s).toFixed(3)}`);
  expect('multipliers are the four documented tiers', Object.keys(WIDGET_QUALITY_MULTIPLIERS),
    ['budget', 'standard', 'premium', 'luxury']);
  expect('standard is the 1.0 anchor', WIDGET_QUALITY_MULTIPLIERS.standard, 1);
}

// ── region factor ─────────────────────────────────────────────────────────
{
  const cheap = estimateWidgetRange({ projectType: 'home_addition', sizeSqft: 600, quality: 'standard', regionFactor: 0.88 });
  const nat = estimateWidgetRange({ projectType: 'home_addition', sizeSqft: 600, quality: 'standard', regionFactor: 1 });
  const dear = estimateWidgetRange({ projectType: 'home_addition', sizeSqft: 600, quality: 'standard', regionFactor: 1.35 });
  ok('higher regional factor → higher price', cheap.range!.likely < nat.range!.likely && nat.range!.likely < dear.range!.likely,
    `${cheap.range!.likely} / ${nat.range!.likely} / ${dear.range!.likely}`);

  const wild = estimateWidgetRange({ projectType: 'home_addition', sizeSqft: 600, quality: 'standard', regionFactor: 9 });
  expect('absurd regional factor is clamped, not obeyed', wild.regionFactor, 1.6);
  ok('clamping is disclosed', wild.assumptions.some(a => /clamped/i.test(a)));
  ok('clamping costs confidence', wild.confidence !== 'high');
}

// ── unknown / thin input handling ─────────────────────────────────────────
{
  const unknown = estimateWidgetRange({ projectType: 'underwater basket weaving', sizeSqft: 200, quality: 'standard', regionFactor: 1 });
  expect('unknown project type is not priceable', unknown.priceable, false);
  expect('...and returns no range rather than a made-up one', unknown.range, null);
  ok('...and says why', !!unknown.cannotPriceReason && unknown.cannotPriceReason.length > 20, String(unknown.cannotPriceReason));

  const nothing = estimateWidgetRange({});
  expect('empty input is not priceable', nothing.priceable, false);
  ok('empty input asks for the project type', /what kind of project/i.test(nothing.cannotPriceReason ?? ''));

  const absurd = estimateWidgetRange({ projectType: 'kitchen_remodel', sizeSqft: 40000, quality: 'standard', regionFactor: 1 });
  expect('absurd size refuses rather than extrapolating', absurd.priceable, false);
  ok('...and names the band it can price', /60–800 sq ft/.test(absurd.cannotPriceReason ?? ''), String(absurd.cannotPriceReason));

  const noSize = estimateWidgetRange({ projectType: 'kitchen_remodel', quality: 'standard', regionFactor: 1 });
  expect('missing size still prices (typical job)', noSize.priceable, true);
  expect('...at the type\'s typical size', noSize.sizeSqft, 180);
  expect('...with low confidence', noSize.confidence, 'low');
  ok('...and says the size was assumed', noSize.assumptions.some(a => /No size given/i.test(a)));

  const sized = estimateWidgetRange({ projectType: 'kitchen_remodel', sizeSqft: 180, quality: 'standard', regionFactor: 1 });
  const widthOf = (e: typeof sized) => (e.range!.high - e.range!.low) / e.range!.likely;
  ok('a guessed size widens the band vs. a known one', widthOf(noSize) > widthOf(sized),
    `noSize=${widthOf(noSize).toFixed(3)} sized=${widthOf(sized).toFixed(3)}`);

  const clamped = estimateWidgetRange({ projectType: 'kitchen_remodel', sizeSqft: 1200, quality: 'standard', regionFactor: 1 });
  expect('moderately-oversized job clamps to the priced band', clamped.sizeSqft, 800);
  ok('...and discloses the clamp', clamped.assumptions.some(a => /outside our priced band/i.test(a)));

  const noQuality = estimateWidgetRange({ projectType: 'kitchen_remodel', sizeSqft: 180, regionFactor: 1 });
  expect('missing quality defaults to standard', noQuality.quality, 'standard');
  ok('...and says so', noQuality.assumptions.some(a => /mid-range finishes/i.test(a)));

  const noRegion = estimateWidgetRange({ projectType: 'kitchen_remodel', sizeSqft: 180, quality: 'standard' });
  expect('missing region defaults to national', noRegion.regionFactor, 1);
  ok('...and says so', noRegion.assumptions.some(a => /national average/i.test(a)));

  const junk = estimateWidgetRange({ projectType: 'kitchen_remodel', sizeSqft: Number.NaN, quality: 'gold-plated', regionFactor: Number.NaN });
  expect('NaN size / bogus quality / NaN region still produce a usable band', junk.priceable, true);
  expect('...at lowest confidence', junk.confidence, 'low');
}

// ── honesty: the disclaimer is unconditional ──────────────────────────────
{
  let missing = 0;
  for (const t of WIDGET_PROJECT_TYPES) {
    const e = estimateWidgetRange({ projectType: t.id, sizeSqft: t.typicalSizeSqft, quality: 'standard', regionFactor: 1 });
    if (!e.assumptions.some(a => /not a quote/i.test(a))) missing++;
  }
  expect('every priceable result carries the "not a quote" line', missing, 0);

  const best = estimateWidgetRange({ projectType: 'kitchen_remodel', sizeSqft: 180, quality: 'standard', regionFactor: 1 });
  expect('all four inputs supplied → high confidence', best.confidence, 'high');
  ok('even the best case keeps a wide band (>=45% of likely)',
    (best.range!.high - best.range!.low) / best.range!.likely >= 0.45,
    `${((best.range!.high - best.range!.low) / best.range!.likely * 100).toFixed(0)}%`);
}

// ── purity: no clock unless the caller hands one over ─────────────────────
{
  const noClock = estimateWidgetRange({ projectType: 'flooring', sizeSqft: 900, quality: 'standard', regionFactor: 1 });
  expect('asOf is null when the caller passes no nowMs', noClock.asOf, null);
  const clocked = estimateWidgetRange({ projectType: 'flooring', sizeSqft: 900, quality: 'standard', regionFactor: 1, nowMs: NOW });
  expect('asOf stamps the caller-supplied clock', clocked.asOf, '2026-02-01T00:00:00.000Z');
  expect('the clock does not touch the math', clocked.range, noClock.range);

  const a = estimateWidgetRange({ projectType: 'adu', sizeSqft: 700, quality: 'premium', regionFactor: 1.12 });
  const b = estimateWidgetRange({ projectType: 'adu', sizeSqft: 700, quality: 'premium', regionFactor: 1.12 });
  expect('same inputs → identical output (deterministic)', a, b);
}

// ── input normalization ───────────────────────────────────────────────────
{
  expect('id matches', normalizeProjectType('kitchen_remodel')?.id, 'kitchen_remodel');
  expect('label matches', normalizeProjectType('Kitchen remodel')?.id, 'kitchen_remodel');
  expect('hyphens/spaces match', normalizeProjectType('  Kitchen-Remodel ')?.id, 'kitchen_remodel');
  expect('synonym matches', normalizeProjectType('bath')?.id, 'bathroom_remodel');
  expect('roofing synonym matches', normalizeProjectType('roofing')?.id, 'roof_replacement');
  expect('garbage returns null (not a default)', normalizeProjectType('zzz'), null);
  expect('empty returns null', normalizeProjectType(''), null);
  expect('quality synonym', normalizeQuality('high-end'), 'premium');
  expect('quality garbage returns null so the caller can widen', normalizeQuality('shiny'), null);
  expect('project type ids are unique',
    new Set(WIDGET_PROJECT_TYPES.map(t => t.id)).size, WIDGET_PROJECT_TYPES.length);
  ok('every type has a coherent rate band (low < likely < high)',
    WIDGET_PROJECT_TYPES.every(t => t.rateLow < t.rateLikely && t.rateLikely < t.rateHigh));
  ok('every type has a coherent size band', WIDGET_PROJECT_TYPES.every(t =>
    t.minSizeSqft < t.typicalSizeSqft && t.typicalSizeSqft < t.maxSizeSqft));
}

// ── zip → regional factor ─────────────────────────────────────────────────
{
  expect('Manhattan zip resolves to the NYC metro factor', regionFactorForZip('10001'), { factor: 1.35, label: 'New York City', basis: 'metro' });
  expect('SF zip resolves to the SF metro factor', regionFactorForZip('94103').label, 'San Francisco');
  expect('upstate NY falls back to the regional bucket', regionFactorForZip('14201'), { factor: 1.22, label: 'Mid-Atlantic', basis: 'region' });
  expect('Austin TX → Southwest', regionFactorForZip('78701'), { factor: 0.92, label: 'Southwest', basis: 'region' });
  expect('short/garbage zip → national, no invented label', regionFactorForZip('abc'), { factor: 1, label: null, basis: 'national' });
  expect('missing zip → national', regionFactorForZip(null), { factor: 1, label: null, basis: 'national' });
  expect('zip+4 is tolerated', regionFactorForZip('30301-1234').label, 'Atlanta');
  ok('every metro factor stays inside the model band',
    ['10001', '94103', '02108', '98101', '77002'].every(z => {
      const f = regionFactorForZip(z).factor;
      return f >= 0.7 && f <= 1.6;
    }));
}

// ── display helper ────────────────────────────────────────────────────────
{
  expect('formats a range for the widget headline', formatWidgetRange({ low: 42000, likely: 58000, high: 78000 }), '$42,000 – $78,000');
  expect('formats nothing as an em dash', formatWidgetRange(null), '—');
}

// ── drift guard: the Deno port must match the TS engine ───────────────────
{
  const src = (() => { try { return readFileSync('supabase/functions/widget-estimate/index.ts', 'utf8'); } catch { return ''; } })();
  ok('edge function source loaded', src.length > 0, 'expected supabase/functions/widget-estimate/index.ts');
  ok('edge function is public (documents --no-verify-jwt)', /--no-verify-jwt/.test(src));
  ok('edge function serves from std@0.177.0', /deno\.land\/std@0\.177\.0\/http\/server\.ts/.test(src));
  ok('edge function allows cross-origin (it runs on third-party sites)',
    /"Access-Control-Allow-Origin":\s*"\*"/.test(src));
  ok('edge function rate-limits the anonymous endpoint', /rateLimitCount\(/.test(src));
  ok('edge function keeps the honeypot convention', /company_website/.test(src));
  ok('edge function records the lead', /sbInsert\("leads"/.test(src));

  let drift = 0; const driftDetail: string[] = [];
  for (const t of WIDGET_PROJECT_TYPES) {
    const row = src.match(new RegExp(`\\{ id: "${t.id}",[^}]*\\}`));
    if (!row) { drift++; driftDetail.push(`${t.id}: missing from edge function`); continue; }
    const nums: [string, number][] = [
      ['rateLow', t.rateLow], ['rateLikely', t.rateLikely], ['rateHigh', t.rateHigh],
      ['typicalSizeSqft', t.typicalSizeSqft], ['minSizeSqft', t.minSizeSqft], ['maxSizeSqft', t.maxSizeSqft],
      ['floorTotal', t.floorTotal], ['sizeExponent', t.sizeExponent],
    ];
    for (const [field, want] of nums) {
      const m = row[0].match(new RegExp(`${field}:\\s*([0-9.]+)`));
      if (!m || Number(m[1]) !== want) { drift++; driftDetail.push(`${t.id}.${field}: edge=${m?.[1]} ts=${want}`); }
    }
  }
  expect('edge-function rate table matches utils/widgetEstimate.ts', drift, 0);
  if (drift > 0) console.log('      ' + driftDetail.slice(0, 8).join('\n      '));

  for (const [q, mult] of Object.entries(WIDGET_QUALITY_MULTIPLIERS)) {
    const m = src.match(new RegExp(`\\n\\s*${q}:\\s*([0-9.]+),`));
    ok(`edge-function ${q} multiplier matches (${mult})`, !!m && Number(m[1]) === mult, `edge=${m?.[1]}`);
  }

  // The embed script is what actually ships to contractors' sites — it must not
  // leak globals and must keep the attribution link.
  const embed = (() => { try { return readFileSync('marketing/widget/embed.js', 'utf8'); } catch { return ''; } })();
  ok('embed.js loaded', embed.length > 0, 'expected marketing/widget/embed.js');
  // Strip the banner comment first — the very next thing must open an IIFE, so
  // nothing can be declared at script scope on somebody else's page.
  const embedCode = embed.replace(/^\s*(\/\*[\s\S]*?\*\/|\/\/.*\n)\s*/g, '');
  ok('embed.js opens with an IIFE (nothing at script scope)',
    /^;?\s*\(function\s*\(/.test(embedCode), embedCode.slice(0, 60));
  ok('embed.js runs in strict mode', /['"]use strict['"]/.test(embed));
  ok('embed.js declares no top-level var/let/const/function outside the IIFE',
    !/^\s*(var|let|const|function|class)\s/m.test(embedCode.replace(/^;?\s*\(function\s*\([\s\S]*/, '')));
  ok('embed.js exposes exactly one namespaced global',
    (embed.match(/window\.[A-Za-z_$][\w$]*\s*=/g) ?? []).every(m => /window\.MageInstantEstimate\s*=/.test(m)),
    (embed.match(/window\.[A-Za-z_$][\w$]*\s*=/g) ?? []).join(', '));
  ok('embed.js stamps "Powered by MAGE ID"', /Powered by\s*(<[^>]*>\s*)?MAGE ID/.test(embed));
  ok('embed.js points at the widget-estimate endpoint', /functions\/v1\/widget-estimate/.test(embed));
  ok('embed.js keeps the honeypot field', /company_website/.test(embed));
  ok('embed.js supports demo mode (docs page must not harvest contacts)',
    /data-mage-demo/.test(embed) && /cfg\.demo/.test(embed));
  ok('embed.js ships no third-party analytics onto customer sites',
    !/posthog|googletagmanager|google-analytics|segment\.com|hotjar/i.test(embed));

  // The docs/demo page must actually mount the real script in demo mode.
  const docs = (() => { try { return readFileSync('marketing/widget/index.html', 'utf8'); } catch { return ''; } })();
  ok('docs page loaded', docs.length > 0, 'expected marketing/widget/index.html');
  ok('docs page mounts the real embed script', /src="\/widget\/embed\.js"/.test(docs));
  ok('docs page runs its live demo in demo mode', /data-mage-demo="1"/.test(docs));
  ok('docs page shows the copy-paste snippet', /data-mage-contractor="your-company-slug"/.test(docs));
}

// ── Embed-snippet parity ────────────────────────────────────────────────────
// The snippet a contractor copies exists in TWO places: the in-app setup screen
// (via utils/widgetEmbed) and the public docs page. If they drift, somebody
// pastes a block that doesn't work and has no way to tell why.
{
  const { buildEmbedSnippet, WIDGET_SLUG_PLACEHOLDER, WIDGET_NAME_PLACEHOLDER } =
    await import('../utils/widgetEmbed');
  const canonical = buildEmbedSnippet(WIDGET_SLUG_PLACEHOLDER, WIDGET_NAME_PLACEHOLDER);
  const docs = readFileSync('marketing/widget/index.html', 'utf8');
  for (const line of canonical.split('\n')) {
    const needle = line.trim();
    ok(`docs page contains snippet line: ${needle.slice(0, 44)}`,
      docs.includes(needle) || docs.includes(needle.replace(/</g, '&lt;').replace(/>/g, '&gt;')),
      `missing from marketing/widget/index.html: ${needle}`);
  }
  ok('snippet carries the contractor slug attribute',
    canonical.includes('data-mage-contractor="'));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

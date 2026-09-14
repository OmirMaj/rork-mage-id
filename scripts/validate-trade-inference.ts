// scripts/validate-trade-inference.ts — the punch-list router sends items to
// the sub who FIXES them.
//
// utils/tradeInference.ts is a keyword list matched by plain substring, so
// several rows can match one item and only one can win. It resolves that by
// LONGEST KEYWORD, with array order as the tie-breaker. Every assertion below
// is a case where two rows genuinely compete — the kind of thing that reads as
// correct row-by-row and is wrong as a whole.
//
// These cases are not hypothetical. Three of them failed on the first draft of
// the twenty-row map, under the first-row-wins rule it replaced.
//
// The item this file exists for: "sprinkler head painted over" — one of the
// most common commercial punch items there is, and a code violation. Bare
// 'sprinkler' used to live only in the Landscaping row, so the app routed a
// fire-protection defect to the landscaper.

import { inferTradeFromText } from '../utils/tradeInference';
import { SUB_TRADES } from '../types';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
function routes(text: string, want: string, why?: string) {
  const got = inferTradeFromText(text);
  if (got.trade === want) { pass++; console.log('  ✓', `"${text}" → ${want}`); }
  else {
    fail++;
    console.log('  ✗', `"${text}"`, `\n      got  ${got.trade} (matched "${got.matchedKeyword ?? '—'}")`,
      `\n      want ${want}`, why ? `\n      ${why}` : '');
  }
}
function ok(n: string, cond: boolean, why?: string) {
  if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, why ? `\n      ${why}` : ''); }
}

console.log('\nTHE SPRINKLER CASE — a fire item must not reach the landscaper');
routes('Sprinkler head painted over in corridor', 'Fire Protection',
  'this is the whole reason the row moved');
routes('Escutcheon missing at sprinkler drop', 'Fire Protection');
routes('Standpipe valve not labeled', 'Fire Protection');
routes('FDC cap missing', 'Fire Protection');
// ...and the irrigation reading is still reachable when the text says so.
routes('Lawn sprinkler head broken near the walk', 'Landscaping',
  'Landscaping is checked first precisely so this still works');
routes('Irrigation line cut during excavation', 'Landscaping');

console.log('\nrows that would eat each other — Electrical is greedy');
routes('Fire alarm panel not commissioned', 'Fire Alarm', "Electrical owns 'panel'");
routes('Patch panel not terminated', 'Low Voltage / Cabling', "Electrical owns 'panel'");
routes('Smoke detector missing cover', 'Fire Alarm');
routes('Card reader not reading badges', 'Security');
routes('BMS not reporting VAV position', 'Controls / BMS', "HVAC owns 'thermostat'");
// The original behaviour this file must not break:
routes('Outlet loose at north wall', 'Electrical');
routes('Light fixture flickering', 'Electrical');
routes('Paint booth electrical rough-in incomplete', 'Electrical',
  'the pre-existing comment cites this exact case');

console.log('\nceilings and millwork vs the trades that own their words');
routes('Ceiling tile stained near VAV', 'Acoustical Ceilings', "Flooring owns 'tile'");
routes('Ceiling tile painted over', 'Acoustical Ceilings',
  "Painting owns 'paint' — but the painter caused it, the ACT sub fixes it");
routes('Ceiling grid out of level', 'Acoustical Ceilings');
routes('Cabinet stain does not match sample', 'Millwork', "Painting owns 'stain'");
routes('Wood trim at reception damaged', 'Millwork', "Flooring owns 'trim'");
// ...without stealing the residential items those rows were built for:
routes('Baseboard trim gapped at corner', 'Flooring');
routes('Touch-up paint needed at door frame', 'Painting');
routes('Floor tile grout cracked', 'Flooring');

console.log('\nthe tie-break — equal specificity falls back to array order');
{
  // This pins the RULE, not a routing opinion: 'sheetrock' (Drywall) and
  // 'sprinkler' (Fire Protection) are both nine characters, so neither is more
  // specific and the earlier row must win. Without this, flipping the
  // comparison to >= — which reads as harmless — would silently hand every
  // equal-length tie to whichever row happens to sit last.
  const r = inferTradeFromText('sprinkler drop penetrates the sheetrock soffit');
  ok('two 9-character keywords tie', (r.matchedKeyword ?? '').length === 9, r.matchedKeyword);
  ok('  ...and the row listed FIRST wins', r.trade === 'Drywall',
    `got ${r.trade} (matched "${r.matchedKeyword}") — Drywall is listed above Fire Protection`);
}

console.log('\nthe rest of the commercial scopes route somewhere real');
routes('Storefront glass scratched', 'Glazing');
routes('Curtain wall sealant failed', 'Glazing');
routes('Door closer slams', 'Doors & Hardware');
routes('Panic bar sticks on the stair door', 'Doors & Hardware');
routes('Selective demo not complete in suite 200', 'Demolition');
routes('Projector mount not centered', 'AV');

console.log('\nthe original ten still route as they did');
routes('Leak under the sink', 'Plumbing');
routes('Duct register rattling', 'HVAC');
routes('Roof flashing lifted', 'Roofing');
routes('Sheetrock seam showing', 'Drywall');
routes('Slab crack at the entry', 'Concrete');
routes('Stud bowed at the north wall', 'Framing');
ok('unmatched text falls back to General, flagged as a fallback',
  inferTradeFromText('please advise').trade === 'General'
  && inferTradeFromText('please advise').method === 'fallback');

console.log('\nstructural — the map cannot name a trade that does not exist');
{
  const src = readFileSync('utils/tradeInference.ts', 'utf-8');
  const named = Array.from(src.matchAll(/\{\s*trade:\s*'([^']+)'/g)).map(m => m[1]);
  ok(`the map has ${named.length} rows`, named.length > 0);
  const unknown = named.filter(t => !(SUB_TRADES as readonly string[]).includes(t));
  ok('every row names a real SubTrade', unknown.length === 0, unknown.join(', '));
  ok('no trade is listed twice', new Set(named).size === named.length,
    'two rows for one trade means the lower one is unreachable for its own words');

  // 'ceiling tile' must be gone from Drywall, not merely present in the new
  // row — a leftover copy above would make the new row unreachable.
  const drywallRow = src.match(/trade: 'Drywall',\s*keywords: \[[^\]]*\]/s)?.[0] ?? '';
  ok("'ceiling tile' no longer sits in the Drywall row", !/ceiling tile/.test(drywallRow), drywallRow);
  const landRow = src.match(/trade: 'Landscaping',\s*keywords: \[[^\]]*\]/s)?.[0] ?? '';
  ok("bare 'sprinkler' no longer sits in the Landscaping row",
    !/'sprinkler'/.test(landRow), landRow);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

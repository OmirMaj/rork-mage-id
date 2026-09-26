// validate-takeoff-ai-suggestions.ts — pins lane TK-b: AI Takeoff rows offered
// as suggestions in the desktop takeoff's Conditions panel
// (utils/takeoff/aiSuggestions), read from this browser without loadTakeoff
// (hooks/useSavedAiTakeoff), never drawn, never counted until accepted.
// Run: bun run scripts/validate-takeoff-ai-suggestions.ts
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseSavedAiTakeoff, suggestionsFromTakeoff, conditionFromSuggestion, aiSkippedLine, filterSuggestions,
  takenSuggestionKeys, aiCitation, aiRunId, AI_SKIP_REASON, type SavedForSuggestions,
} from '../utils/takeoff/aiSuggestions';
import { rollup, EMPTY_TAKEOFF_DOC, type TakeoffDoc } from '../utils/takeoff/conditions';
import { pushLinesFrom } from '../utils/takeoff/conditionPush';
import type { CostBookEntry, CostDatabase } from '../utils/costDatabase';
import type { TakeoffResult } from '../types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
const eq = <T,>(name: string, got: T, want: T) =>
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');

// ── fixture ────────────────────────────────────────────────────────────────
const SAVED_AT = '2026-09-20T15:00:00.000Z';
const NOW = Date.parse('2026-09-26T12:00:00.000Z');
const result = {
  summary: 'x', scale: {}, drawingsSeen: [],
  walls: [
    { id: 'w1', typeCode: 'W1', category: 'interior_partition', description: '2x4, 5/8 GWB', lengthFt: 212.5, heightFt: 9, confidence: 'medium', sourcePages: [2, 3] },
    { id: 'w2', category: 'exterior_framed', description: 'ext', lengthFt: 0, heightFt: 9, confidence: 'low', sourcePages: [] },
  ],
  floorAreas: [{ id: 'f1', roomName: 'Kitchen', finishCode: 'T-1', areaSqFt: 180, ceilingHeightFt: 9, confidence: 'high', sourcePages: [4] }],
  doors: [{ id: 'd1', mark: 'D-1', description: '3\'-0" SC paint grade', widthIn: 36, heightIn: 80, count: 6, confidence: 'high', sourcePages: [5] }],
  windows: [{ id: 'n1', mark: 'W-2', description: 'Double hung', widthIn: 36, heightIn: 60, count: 4, confidence: 'low', sourcePages: [5] }],
  finishes: [
    { id: 'fin1', surface: 'wall', code: 'PT-1', description: 'Eggshell paint', quantity: 1500, unit: 'sqft', confidence: 'medium', sourcePages: [7] },
    { id: 'fin2', surface: 'base', code: 'B-1', description: 'Rubber base', quantity: 320, unit: 'lf', confidence: 'medium', sourcePages: [7] },
    { id: 'fin3', surface: 'other', code: 'X', description: 'Corner guards', quantity: 12, unit: 'ea', confidence: 'high', sourcePages: [] },
  ],
  fixtures: [{ id: 'x1', category: 'plumbing', mark: 'WC-1', description: 'Water closet', count: 3, confidence: 'high', sourcePages: [8] }],
  bulkMaterials: [
    { id: 'b1', description: 'Concrete slab', quantity: 12, unit: 'cy', confidence: 'medium', sourcePages: [1] },
    { id: 'b2', description: 'Gravel', quantity: 3, unit: 'tons', confidence: 'low', sourcePages: [1] },
  ],
  concerns: [], doubleCheck: [], missingScopes: [], confidenceOverall: 'medium', confidenceExplanation: '',
} as unknown as TakeoffResult;
const RUN = aiRunId(result);
const saved = (over: Partial<SavedForSuggestions> = {}): SavedForSuggestions => ({
  result, overrides: {}, rejected: {}, fileName: 'plans.pdf', savedAt: SAVED_AT, ...over,
});

// ── 1. parseSavedAiTakeoff ───────────────────────────────────────────────
console.log('\nparseSavedAiTakeoff:');
eq('null → none', parseSavedAiTakeoff(null, NOW).state, 'none');
eq('empty → none', parseSavedAiTakeoff('', NOW).state, 'none');
eq("'{' → failed (never none)", parseSavedAiTakeoff('{', NOW).state, 'failed');
eq('a missing walls array → failed', parseSavedAiTakeoff(JSON.stringify({ result: { floorAreas: [] }, savedAt: SAVED_AT }), NOW).state, 'failed');
eq('a missing result → failed', parseSavedAiTakeoff(JSON.stringify({ savedAt: SAVED_AT }), NOW).state, 'failed');
const old = new Date(NOW - 61 * 24 * 3600 * 1000).toISOString();
const st = parseSavedAiTakeoff(JSON.stringify({ result, overrides: {}, savedAt: old }), NOW);
eq('61 days old → stale, with its savedAt', st, { state: 'stale', savedAt: old });
const fresh = parseSavedAiTakeoff(JSON.stringify({ result, overrides: { 'floor:f1': 175 }, savedAt: SAVED_AT, fileName: 'plans.pdf' }), NOW);
ok('valid → ready with the saved takeoff', fresh.state === 'ready' && fresh.saved.savedAt === SAVED_AT && fresh.saved.overrides['floor:f1'] === 175);
eq('59 days old is still ready', parseSavedAiTakeoff(JSON.stringify({ result, savedAt: new Date(NOW - 59 * 86400000).toISOString() }), NOW).state, 'ready');

// ── 2. mapping ─────────────────────────────────────────────────────────────
console.log('\nsuggestionsFromTakeoff — the mapping per section:');
const S = suggestionsFromTakeoff(saved(), new Set());
const by = (k: string) => S.rows.find((r) => r.key === `${RUN}|${k}`);
eq('floor → area SF, room · finish code', [by('floor:f1')?.kind, by('floor:f1')?.unit, by('floor:f1')?.qty, by('floor:f1')?.name], ['area', 'SF', 180, 'Kitchen · T-1']);
eq('walls → linear LF, category words + type code, carries the height',
  [by('walls:w1')?.kind, by('walls:w1')?.unit, by('walls:w1')?.qty, by('walls:w1')?.name, by('walls:w1')?.heightFt], ['linear', 'LF', 212.5, 'Interior partition W1', 9]);
eq('doors → count EA, mark + description', [by('doors:d1')?.kind, by('doors:d1')?.qty, by('doors:d1')?.name], ['count', 6, 'D-1 3\'-0" SC paint grade']);
eq('windows → count EA', [by('windows:n1')?.kind, by('windows:n1')?.unit, by('windows:n1')?.qty], ['count', 'EA', 4]);
eq('finishes: sqft → area, lf → linear, ea → count',
  ['fin1', 'fin2', 'fin3'].map((i) => [by(`finish:${i}`)?.kind, by(`finish:${i}`)?.unit]), [['area', 'SF'], ['linear', 'LF'], ['count', 'EA']]);
eq('fixtures → count EA', [by('fixture:x1')?.kind, by('fixture:x1')?.qty, by('fixture:x1')?.name], ['count', 3, 'WC-1 Water closet']);
eq('heightFt is null off linear', by('doors:d1')?.heightFt, null);
eq('the key is the run fingerprint + app/takeoff.tsx\'s `${section}:${id}` row key', by('floor:f1')?.key, `${RUN}|floor:f1`);
eq('citation: pages + file', by('walls:w1')?.citation, 'p.2, p.3 · plans.pdf');
eq('citation: no pages → "page not given"', by('finish:fin3')?.citation, 'page not given');
eq('citation with no file name', aiCitation([4], null), 'p.4');
eq('confidence carried', [by('floor:f1')?.confidence, by('windows:n1')?.confidence], ['high', 'low']);
eq('a 0 LF wall is skipped as "no quantity", counted', S.skipped.find((s) => s.code === 'no_quantity')?.count, 1);
eq('bulkMaterials → skipped with a count and the reason', S.skipped.find((s) => s.code === 'bulk'),
  { code: 'bulk', reason: AI_SKIP_REASON.bulk, count: 2 });
ok('no bulk material becomes a row', !S.rows.some((r) => r.section === 'bulk'));
eq('the bulk line reads in words', aiSkippedLine(S.skipped.find((s) => s.code === 'bulk')!),
  '2 bulk materials use units this panel doesn’t measure (CY, tons…) — see AI Takeoff');
eq('8 rows offered (the 0 LF wall and both bulk rows are not)', S.rows.length, 8);

// overrides / rejected
const O = suggestionsFromTakeoff(saved({ overrides: { 'floor:f1': 175.5, 'doors:d1': 7 }, rejected: { 'windows:n1': true, 'bulk:b2': true } }), new Set());
const ob = (k: string) => O.rows.find((r) => r.key === `${RUN}|${k}`);
eq('an override on /takeoff replaces qty and sets corrected', [ob('floor:f1')?.qty, ob('floor:f1')?.corrected, ob('doors:d1')?.qty], [175.5, true, 7]);
eq('an uncorrected row is not corrected', ob('walls:w1')?.corrected, false);
ok('a row rejected on /takeoff is not offered', !ob('windows:n1'));
eq('…and is skipped with its reason and counted (a rejected bulk row counts there too)',
  O.skipped.find((s) => s.code === 'rejected'), { code: 'rejected', reason: 'you rejected on AI Takeoff', count: 2 });
eq('…the bulk count drops by the rejected one', O.skipped.find((s) => s.code === 'bulk')?.count, 1);
eq('an override of 0 is "no quantity"', suggestionsFromTakeoff(saved({ overrides: { 'doors:d1': 0 } }), new Set()).rows.some((r) => r.itemId === 'd1'), false);

// taken + stable keys
const again = suggestionsFromTakeoff(saved(), new Set());
eq('keys are stable across calls', again.rows.map((r) => r.key), S.rows.map((r) => r.key));
const taken = new Set([`${RUN}|floor:f1`, `${RUN}|doors:d1`]);
const T = suggestionsFromTakeoff(saved(), taken);
ok('taken keys are excluded', T.rows.length === 6 && !T.rows.some((r) => taken.has(r.key)));
eq('taken rows are not counted as skipped', T.skipped, S.skipped);
// app/takeoff.tsx re-saves the blob (a fresh savedAt) every time it is opened
// or a number is corrected: that must NOT re-offer what he accepted/dismissed.
const reSaved = suggestionsFromTakeoff(saved({ savedAt: '2026-09-25T00:00:00.000Z', overrides: { 'walls:w1': 200 } }), taken);
ok('a re-save on /takeoff (new savedAt, a new correction) keeps every key — taken rows stay taken',
  reSaved.rows.length === 6 && !reSaved.rows.some((r) => taken.has(r.key)), `got ${reSaved.rows.length} rows`);
eq('…and the corrected row keeps its key', reSaved.rows.find((r) => r.itemId === 'w1')?.key, `${RUN}|walls:w1`);
const reParsed = JSON.parse(JSON.stringify(result)) as TakeoffResult;
eq('the fingerprint survives a JSON round-trip (the stored blob)', aiRunId(reParsed), RUN);
const reordered = Object.fromEntries(Object.entries(result as unknown as Record<string, unknown>).reverse());
eq('…and a different key order', aiRunId(reordered), RUN);
const rerun = { ...result, doors: [{ ...result.doors[0], count: 7 }] } as TakeoffResult;
ok('a re-run (a different result) changes the fingerprint', aiRunId(rerun) !== RUN);
eq('a re-run offers its rows fresh', suggestionsFromTakeoff(saved({ result: rerun }), taken).rows.length, 8);
ok('the fingerprint is "r" + base-36, never empty', /^r[0-9a-z]+$/.test(RUN));
eq('filter: a case-insensitive name match; blank → all', [filterSuggestions(S.rows, 'KITCH').map((r) => r.itemId), filterSuggestions(S.rows, '  ').length], [['f1'], 8]);

// ── 3. conditionFromSuggestion ─────────────────────────────────────────────
console.log('\nconditionFromSuggestion:');
const entry = (trade: string, unit: string, rate: number): CostBookEntry => ({
  key: `${trade.toLowerCase()}|${unit.toLowerCase()}`, trade, unit, sampleCount: 6, jobCount: 3,
  personalRate: rate, variability: 0.1, spreadMeaningful: true, bidBias: 0, baseline: rate,
  suggestedRate: rate, confidence: 'high', totalActual: rate * 100, lastSeen: '2026-01-01', samples: [], provenance: 'earned',
} as unknown as CostBookEntry);
const DB: CostDatabase = {
  entries: [entry('Drywall', 'LF', 14), entry('Flooring', 'SF', 6), entry('Doors', 'EA', 450), entry('Plumbing', 'EA', 900)],
  jobsAnalyzed: 3, tradesTracked: 4, overallBidAccuracy: null, asOf: '2026-09-26',
};
const NOW_ISO = '2026-09-26T12:00:00.000Z';
const c1 = conditionFromSuggestion(by('walls:w1')!, DB, [], 'c-new', NOW_ISO);
eq('rateOverride null, waste 0, linear keeps the wall height', [c1.rateOverride, c1.wastePct, c1.heightFt, c1.kind, c1.name], [null, 0, 9, 'linear', 'Interior partition W1']);
eq('aiRead carries the exact citation, qty, unit, confidence and key',
  c1.aiRead, { qty: 212.5, unit: 'LF', confidence: 'medium', citation: 'p.2, p.3 · plans.pdf', key: `${RUN}|walls:w1`, readAt: NOW_ISO });
eq('trade resolved from his book (partition → Drywall|LF)', c1.trade, 'Drywall');
eq('a door keys Doors|EA even when its description says "paint"', conditionFromSuggestion(by('doors:d1')!, DB, [], 'c2', NOW_ISO).trade, 'Doors');
eq('a water closet keys Plumbing|EA', conditionFromSuggestion(by('fixture:x1')!, DB, [], 'c3', NOW_ISO).trade, 'Plumbing');
const noMatch = conditionFromSuggestion(by('windows:n1')!, DB, [], 'c4', NOW_ISO);
eq('no book match → a null trade (the row says "No rate yet — set one")', [noMatch.trade, noMatch.rateOverride], [null, null]);
eq('heightFt is null off linear', conditionFromSuggestion(by('floor:f1')!, DB, [], 'c5', NOW_ISO).heightFt, null);
ok('a colour is picked', typeof c1.color === 'string' && c1.color.startsWith('#'));
eq('takenSuggestionKeys = dismissed ∪ accepted aiRead keys',
  [...takenSuggestionKeys({ aiDismissed: ['k1'], conditions: [c1, noMatch] })].sort(), [`${RUN}|walls:w1`, `${RUN}|windows:n1`, 'k1'].sort());

// ── 4. never counted until it is a condition ───────────────────────────────
console.log('\nnever counted until accepted:');
const empty: TakeoffDoc = { ...EMPTY_TAKEOFF_DOC, conditions: [], measurements: [], pushed: {} };
const R0 = rollup(empty, DB, () => null);
eq('suggestions alone: no rollup rows, no cost, no push lines', [R0.rows.length, R0.costCents, pushLinesFrom(R0.rows).lines.length], [0, 0, 0]);
const accepted: TakeoffDoc = { ...empty, conditions: [conditionFromSuggestion(by('doors:d1')!, DB, [], 'c-door', NOW_ISO)] };
const R1 = rollup(accepted, DB, () => null);
const P1 = pushLinesFrom(R1.rows);
eq('once accepted it is a condition: one line, aiRead, the AI quantity at his book rate',
  P1.lines.map((l) => [l.conditionId, l.quantity, l.rate, l.aiRead ?? null]), [['c-door', 6, 450, true]]);

// ── 5. source pins ──────────────────────────────────────────────────────────
console.log('\nsource pins:');
const storageSrc = read('utils/takeoffStorage.ts');
const hookSrc = read('hooks/useSavedAiTakeoff.ts');
const storagePrefix = /const KEY_PREFIX = '([^']+)'/.exec(storageSrc)?.[1] ?? null;
const hookPrefix = /const AI_TAKEOFF_KEY_PREFIX = '([^']+)'/.exec(hookSrc)?.[1] ?? null;
ok(`the hook's prefix literal equals takeoffStorage's KEY_PREFIX (${hookPrefix})`, !!storagePrefix && hookPrefix === storagePrefix);
ok('the hook reads only (one getItem, no setItem / removeItem / clear)',
  (hookSrc.match(/AsyncStorage\.getItem/g) ?? []).length === 1 && !/AsyncStorage\.(setItem|removeItem|clear|multiRemove)/.test(hookSrc));
ok('the hook guards the read in try/catch', /try \{\s*AsyncStorage\.getItem/.test(hookSrc));
for (const f of ['components/takeoff/TakeoffWorkspace.tsx', 'hooks/useSavedAiTakeoff.ts']) {
  const src = read(f);
  ok(`${f} never calls loadTakeoff( / analyzeTakeoff / removeItem`, !/loadTakeoff\(|analyzeTakeoff|removeItem/.test(src));
}
const secSrc = read('components/takeoff/AiSuggestionsSection.tsx');
for (const must of ['not measured', 'Nothing here counts until you accept it', 'saved on this browser']) {
  ok(`AiSuggestionsSection says "${must}"`, secSrc.includes(must));
}
ok('AiSuggestionsSection never claims "measured by AI" / "exact" / "verified"', !/\b(measured by AI|exact|verified)\b/i.test(secSrc));
ok('TakeoffCanvas never references AiSuggestion (AI rows are never drawn)', !/AiSuggestion/.test(read('components/takeoff/TakeoffCanvas.tsx')));
const aiSrc = read('utils/takeoff/aiSuggestions.ts');
ok('aiSuggestions imports PersistedTakeoff as a TYPE only', /import type \{ PersistedTakeoff \} from '@\/utils\/takeoffStorage'/.test(aiSrc)
  && !/^import \{[^}]*\} from '@\/utils\/takeoffStorage'/m.test(aiSrc));
ok('aiSuggestions imports no react / react-native / storage', !/from '(react|react-native|@react-native-async-storage\/async-storage)'/.test(aiSrc));

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} validate-takeoff-ai-suggestions: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

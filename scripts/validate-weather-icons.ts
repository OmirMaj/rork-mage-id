// validate-weather-icons.ts — the jobsite forecast uses lucide, like the rest
// of the app, and the emoji it used to use can only go away.
//
// WHY. The house rule is one icon vocabulary: lucide-react-native. The audit on
// 2026-09-07 found utils/weatherService.ts mapping every weather condition to
// an EMOJI and rendering it through getConditionIcon() into real <Text> on the
// Schedule tab, Today view, Lookahead, the vertical Gantt and both weather-
// reschedule surfaces. It survived because scripts/validate-app-slop.ts walks
// app/, components/ and constants/ — and weatherService is in utils/, one
// directory outside that walk. Its own check-1 comment says so and names the
// order of operations: retint FIRST, then widen the roots.
//
// This guard holds the first half of that, and it holds it as a RATCHET
// because the retint cannot land in one commit: getConditionIcon returns a
// string that six other files render inside <Text>, so the map can only be
// deleted once the last of them takes a component instead. So:
//
//   0. weatherService keeps zero runtime imports, so the guard that imports it
//      can still start. (Review 2026-09-07: the retint's first draft put the
//      lucide import IN weatherService and took validate-weather-provenance.ts
//      from 109 checks to a parse error.)
//   1. CONDITION_ICON exists — in utils/weatherIcons.ts — and maps all six
//      conditions to lucide components.
//      Without this the migration has no target and the retint can be reverted
//      by deleting three lines.
//   2. The number of files importing the deprecated getConditionIcon may only
//      FALL. This is the migration counter — it is what makes "finish it later"
//      a measurable claim rather than a comment.
//   3. The emoji in weatherService may only FALL, and must reach zero in the
//      same commit that takes the importer count to zero.
//
// Ceilings only ever go down; the script prints the number to write in.
// This is the convention in validate-app-slop.ts, and it exists so a guard
// never goes red when someone FIXES something.
//
// Run: bun run scripts/validate-weather-icons.ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

// fileURLToPath + join, not a bare relative path: the repo root contains a
// space, and that has produced a green build that could not find its own
// files before (see the iOS checkout-path note in the runtime audit).
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

console.log('\nweather icons are lucide, not emoji:');

const SERVICE = 'utils/weatherService.ts';
const ICONS = 'utils/weatherIcons.ts';
const src = readFileSync(join(ROOT, SERVICE), 'utf8');
const iconSrc = readFileSync(join(ROOT, ICONS), 'utf8');

// ── 0. weatherService keeps NO runtime imports ──────────────────────────────
// This is why CONDITION_ICON lives in utils/weatherIcons.ts and not next to
// the emoji map it replaces. scripts/validate-weather-provenance.ts imports
// getSimulatedForecast() from weatherService to exercise the real function;
// the first version of the retint put `import { Sun, … } from
// 'lucide-react-native'` in weatherService, which dragged react-native's
// Flow-typed index.js into that script's module graph and killed all 109 of
// its checks at parse time ("Unexpected typeof") before one of them ran.
// A guard that cannot start is worse than no guard: it reports nothing and
// looks like a tooling problem. Type-only imports are erased and are fine.
const runtimeImports = src.split('\n')
  .map((text, i) => ({ text: text.trim(), line: i + 1 }))
  .filter((l) => /^import\s/.test(l.text) && !/^import\s+type\s/.test(l.text));
ok(`${SERVICE} has no runtime imports (validate-weather-provenance imports it)`,
  runtimeImports.length === 0,
  runtimeImports.map((l) => `${SERVICE}:${l.line}  ${l.text}`).join('\n      ') +
  `\n      Move it to ${ICONS} (or another UI-side module). A runtime import here ` +
  `\n      pulls react-native into a bun script and validate-weather-provenance.ts ` +
  `\n      dies before its first check.`);

// ── 1. The lucide map exists and is complete ────────────────────────────────
// Complete matters: a five-of-six map sends one condition back to the emoji
// path, and 'storm' / 'snow' are exactly the two that stop work on a jobsite.
const CONDITIONS = ['clear', 'cloudy', 'rain', 'storm', 'snow', 'wind'] as const;
// Read CODE, not prose. Caught in review 2026-09-07: this check went red
// because utils/weatherIcons.ts's own header quotes the import line it is
// explaining, and the regex matched the sentence instead of the statement.
// The same leak runs the other way — a file with the import DELETED and a
// comment still describing it would have passed. Same lesson as the
// apostrophe bug in validate-a11y-roles.ts: a guard that reads comments is
// measuring documentation.
const stripComments = (t: string): string =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
const iconCode = stripComments(iconSrc);
const mapBody = iconCode.match(/export const CONDITION_ICON\s*:[^=]*=\s*\{([\s\S]*?)\n\};/)?.[1] ?? '';
const lucideImport = iconCode.match(/import\s*\{([^}]*)\}\s*from\s*'lucide-react-native'/)?.[1] ?? '';
const mapped = CONDITIONS.map((c) => ({
  condition: c,
  component: mapBody.match(new RegExp(`\\b${c}\\s*:\\s*(\\w+)`))?.[1],
}));
const missing = mapped
  .filter((m) => !m.component || !new RegExp(`\\b${m.component}\\b`).test(lucideImport))
  .map((m) => m.condition);
// Distinct, not just present. The first version of this check passed a map with
// `snow: Sun` in it — Sun IS a lucide import, so "all six map to lucide" was
// true and a jobsite in a blizzard read as a clear day. Six conditions, six
// different glyphs: that is the whole point of drawing them.
const duplicated = mapped
  .filter((m) => m.component && mapped.filter((o) => o.component === m.component).length > 1)
  .map((m) => `${m.condition}=${m.component}`);
ok('CONDITION_ICON maps all six conditions to distinct lucide components',
  mapBody.length > 0 && missing.length === 0 && duplicated.length === 0,
  mapBody.length === 0
    ? `${ICONS} no longer exports CONDITION_ICON — the forecast strips have ` +
      'nothing to render but the deprecated emoji.'
    : missing.length
      ? `not mapped to a component imported from lucide-react-native: ${missing.join(', ')}`
      : `two conditions share one glyph and are indistinguishable on the strip: ${duplicated.join(', ')}`);

// ── 2. The migration counter ────────────────────────────────────────────────
function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

const importers = walk(join(ROOT, 'app'))
  .concat(walk(join(ROOT, 'components')), walk(join(ROOT, 'utils')), walk(join(ROOT, 'hooks')))
  .filter((f) => relative(ROOT, f) !== SERVICE && relative(ROOT, f) !== ICONS)
  .filter((f) => /\bgetConditionIcon\b/.test(readFileSync(f, 'utf8')))
  .map((f) => relative(ROOT, f))
  .sort();

// Measured 2026-09-07. Each of these renders the emoji string inside a <Text>;
// the fix per file is `const Icon = CONDITION_ICON[f.condition]` and an
// <Icon size={…} color={…} strokeWidth={1.75} /> in its place. Two of them
// (GanttChart via weatherRisk.icon, WeatherReschedulePrompt:141) read the
// baked DayForecast.icon field instead of calling the function, so that field
// goes when they do.
const IMPORTER_CEILING = 6;
ok(`no NEW caller of the deprecated getConditionIcon (${importers.length} ≤ ${IMPORTER_CEILING})`,
  importers.length <= IMPORTER_CEILING,
  `${importers.length - IMPORTER_CEILING} new file(s) took the emoji instead of ` +
  `CONDITION_ICON:\n      ${importers.join('\n      ')}`);
if (importers.length < IMPORTER_CEILING) {
  console.log(`        ↓ lower IMPORTER_CEILING to ${importers.length}`);
}

// ── 3. The emoji itself ─────────────────────────────────────────────────────
// Same narrow range validate-app-slop.ts uses for its own emoji check, so the
// two agree on what an emoji is when its roots are finally widened to utils/.
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
const emojiLines = src.split('\n')
  .map((text, i) => ({ text: text.trim(), line: i + 1 }))
  .filter((l) => EMOJI.test(l.text));

// 7: the six CONDITION_ICONS entries plus getConditionIcon's `?? '☀️'` fallback.
const EMOJI_CEILING = 7;
ok(`no NEW emoji in ${SERVICE} (${emojiLines.length} ≤ ${EMOJI_CEILING})`,
  emojiLines.length <= EMOJI_CEILING,
  emojiLines.map((l) => `${SERVICE}:${l.line}  ${l.text.slice(0, 80)}`).join('\n      '));
if (emojiLines.length < EMOJI_CEILING) {
  console.log(`        ↓ lower EMOJI_CEILING to ${emojiLines.length}`);
}

// The two counters have to reach zero together. An emoji map with no callers is
// dead code that the next person will render again; callers with no map is a
// build break. Whichever you delete first, delete the other in the same commit.
ok('the emoji map and its callers are retired together',
  (emojiLines.length === 0) === (importers.length === 0),
  importers.length === 0
    ? `nothing calls getConditionIcon any more — delete it, CONDITION_ICONS and ` +
      `the \`icon\` field on DayForecast, then widen the roots of ` +
      `validate-app-slop.ts's emoji check to include utils/.`
    : `${SERVICE} has no emoji left but ${importers.length} file(s) still call ` +
      `getConditionIcon, which now returns nothing to draw.`);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

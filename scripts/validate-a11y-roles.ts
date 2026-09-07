// validate-a11y-roles.ts — the app must honour the platform's accessibility
// contracts: a control says it is a control, and a system display preference
// the user already set is not overridden by a brand preference.
//
// WHY. The hands-on UI pass on 2026-09-07 read the live accessibility tree off
// a simulator and found Payments exposing exactly ONE Button: "Open MAGE
// Brain", the global FAB. "Collect Oldest Unpaid" — the primary action on a
// money screen — was a GenericElement, as were the All/Pending/Completed
// segmented control and every invoice row. VoiceOver never said any of them
// could be tapped. Home, by comparison, exposed 21 Buttons on the same build,
// so this is inconsistency, not a platform limit.
//
// The cause is always the same: a TouchableOpacity/Pressable with an onPress
// and no `accessibilityRole`. React Native does not infer one.
//
// This guard holds three lines:
//   1. SWEPT files are certified at zero and must stay there.
//   2. The repo-wide count is a ceiling that may only fall (the ceiling
//      convention from validate-app-slop.ts: going UP fails, going DOWN prints
//      the new number to write in).
//   3. The theme preference defaults to 'system', so a phone already in dark
//      mode is not overridden. Finding 6 of the same pass: the default was
//      'light' "to match the marketing site", which is a brand preference
//      beating a setting the user had already made.
//
// Run: bun run scripts/validate-a11y-roles.ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

console.log('\naccessibility roles on pressables:');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const PRESSABLES = [
  'TouchableOpacity', 'TouchableHighlight', 'TouchableWithoutFeedback',
  'Pressable', 'AnimatedPressable',
];

/**
 * Every `<Tag ... >` opening tag in `src`, with its 1-based line.
 *
 * A regex alone can't find the end of the tag: props hold JSX, arrow functions
 * and generics, all of which contain `>`. Walk forward instead, tracking brace
 * depth and string state, and stop at the first `>` outside both.
 *
 * Comments have to be skipped BEFORE the quote tracker sees them. This file
 * comments its props heavily, and one apostrophe in a `//` line — "doesn't",
 * "user's" — opened a string the tracker then hunted for a closing quote to,
 * swallowing the rest of the tag and often the next element's props with it.
 * `ANSWERED` then matched a role belonging to a DIFFERENT control and the
 * violation vanished. Review pass 2026-09-07 found exactly one hiding that way
 * (app/(tabs)/settings/index.tsx), which is one more than a guard gets to hide.
 */
function openingTags(src: string, tag: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  const re = new RegExp(`<${tag}(?=[\\s/>])`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let i = m.index, depth = 0, quote: string | null = null;
    for (; i < src.length; i++) {
      const c = src[i];
      if (quote) { if (c === quote && src[i - 1] !== '\\') quote = null; continue; }
      if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
      if (c === '/' && src[i + 1] === '*') {
        i += 2;
        while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
        i++;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    out.push({ text: src.slice(m.index, i + 1), line: src.slice(0, m.index).split('\n').length });
  }
  return out;
}

// Declaring a role, or removing the element from the tree entirely, both count
// as answering the question. `role` is the RN 0.71+ alias for accessibilityRole.
const ANSWERED = /accessibilityRole|\brole=|accessibilityElementsHidden|importantForAccessibility|accessible=\{false\}/;

const perFile = new Map<string, { line: number }[]>();
for (const file of [...walk('app'), ...walk('components')]) {
  const src = readFileSync(file, 'utf8');
  const rel = file;
  for (const tag of PRESSABLES) {
    for (const t of openingTags(src, tag)) {
      // No onPress means it isn't a control — a Pressable used purely for
      // hover/press visuals has nothing to announce.
      if (!/\bonPress\b/.test(t.text)) continue;
      if (ANSWERED.test(t.text)) continue;
      const list = perFile.get(rel) ?? [];
      list.push({ line: t.line });
      perFile.set(rel, list);
    }
  }
}

const total = [...perFile.values()].reduce((s, l) => s + l.length, 0);

// ── 1. Screens swept and certified. Adding one back here is a regression. ──
//
// Grows one screen at a time, as each is swept. Payments went first because the
// audit measured it: 1 Button on the whole screen before, every control after.
const SWEPT: readonly string[] = [
  'app/payments.tsx',
];

for (const rel of SWEPT) {
  const hits = perFile.get(rel) ?? [];
  ok(`${rel} — every pressable declares a role`, hits.length === 0,
    hits.length ? `role-less onPress at line(s): ${hits.map(h => h.line).join(', ')}` : '');
}

// ── 2. Repo-wide ceiling ──
//
// Measured 2026-09-07 across app/ and components/. It is a big number and it is
// meant to be: the point is that it can never grow, so new UI ships announcing
// itself even while the backlog is worked down a screen at a time.
//
// Re-baseline it deliberately, never reflexively: the script prints the number
// to write in whichever direction it moved. The figure below was taken while a
// multi-agent fix wave was still landing screens, so it moved twice in an hour
// — if it is off by a handful on the first run after that wave, read the named
// files before you raise it.
//
// 1791, not the 1790 first measured: hardening the tag walker against comments
// (above) un-hid one role-less pressable in app/(tabs)/settings/index.tsx that
// the first version of this guard could not see. Not this wave's file — it is
// the first entry of the backlog this ceiling now holds.
const CEILING = 1791;

ok(`no NEW role-less pressables (${total} ≤ ceiling ${CEILING})`, total <= CEILING,
  total > CEILING
    ? `${total - CEILING} new pressable(s) with onPress and no accessibilityRole.\n      ` +
      [...perFile.entries()]
        .sort((a, b) => b[1].length - a[1].length).slice(0, 8)
        .map(([f, l]) => `${l.length}  ${f}:${l[0].line}`).join('\n      ') +
      `\n      Add accessibilityRole="button" (plus an accessibilityLabel when the` +
      `\n      visible text alone doesn't say what tapping does).` +
      `\n      If the new controls are genuinely exempt, re-baseline: CEILING = ${total}.`
    : '');

if (total < CEILING) {
  console.log(`        ↓ lower CEILING to ${total}`);
}

// ── 3. The theme preference honours the OS ──
//
// One word, and it has been flipped once already. Pin it: `resolve()` reads
// Appearance only when the pref is 'system', so a 'light' default silently
// disconnects the whole dark palette from the phone's own setting.
const theme = readFileSync('contexts/ThemeContext.tsx', 'utf8');
const themeDefault = theme.match(/useState<ThemePref>\('(\w+)'\)/)?.[1];
ok("ThemeContext defaults ThemePref to 'system', not a fixed palette",
  themeDefault === 'system',
  `useState<ThemePref>('${themeDefault ?? '?'}') — a contractor whose phone is in dark ` +
  `mode gets the light app and has to find Settings → Appearance to undo it.`);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

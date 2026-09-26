// validate-web-polish.ts — the web app stops cutting (slicker pass, lane D).
//
//   bun run scripts/validate-web-polish.ts        (package.json: test:web-polish)
//
// On app.mageid.app the side panel, its sections, the menus and a filter
// change used to be hard cuts. This lane made them move — all CSS, all off
// under prefers-reduced-motion, and NONE of it in the tree at rest: every
// motion is armed by a change the GC makes after mount, so the goldens and
// the phone paths are untouched. This guard holds those rules, text-only on
// comment-stripped source:
//
//   1. SidePanel: the slide is behind an armed ref (open false → true), the
//      body swap (useWebSwap) is gated on isDesktop, and the phone Modal
//      branch is still animationType="slide" presentationStyle="pageSheet".
//   2. app/_layout.tsx still gives every root Stack screen the round-1 page
//      fade (`contentStyle: webMotion('fadeIn')`) — this lane relies on it.
//   3. DataTable fades only keys in an `entering` set derived from the
//      PREVIOUS visibleKeys; its stagger delays are strings and capped
//      (≤ 8 steps, < 30 rows); the phone early return is untouched.
//   4. The three popovers (Schedule Pro More, the ⋯ menu, the job switcher)
//      drop in.
//   5. The two chevron sites (Schedule Pro More, the sidebar groups) rotate
//      with rotateGlide behind an armed ref, and keep the bare icon unarmed.
//   6. attention.tsx calls layoutNext() before setSeverity.
//   7. No file here contains animationKeyframes, fill mode 'both', or a
//      bare-number duration or delay.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

let failures = 0;
function ok(name: string, condition: boolean, detail?: string) {
  if (condition) { console.log('  PASS  ' + name); return; }
  failures += 1;
  console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : ''));
}

/** Blank out // and /* *\/ comments (strings kept, newlines kept). */
function stripComments(src: string): string {
  const out = src.split('');
  let i = 0;
  type Mode = 'code' | 'line' | 'block' | 'sq' | 'dq' | 'tpl';
  let mode: Mode = 'code';
  const blank = (at: number) => { if (out[at] !== '\n') out[at] = ' '; };
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (mode === 'code') {
      if (two === '//') { mode = 'line'; blank(i); blank(i + 1); i += 2; continue; }
      if (two === '/*') { mode = 'block'; blank(i); blank(i + 1); i += 2; continue; }
      if (src[i] === "'") mode = 'sq';
      else if (src[i] === '"') mode = 'dq';
      else if (src[i] === '`') mode = 'tpl';
      i++; continue;
    }
    if (mode === 'line') {
      if (src[i] === '\n') { mode = 'code'; i++; continue; }
      blank(i); i++; continue;
    }
    if (mode === 'block') {
      if (two === '*/') { mode = 'code'; blank(i); blank(i + 1); i += 2; continue; }
      blank(i); i++; continue;
    }
    if (src[i] === '\\') { i += 2; continue; }
    if ((mode === 'sq' && src[i] === "'") || (mode === 'dq' && src[i] === '"') || (mode === 'tpl' && src[i] === '`')) mode = 'code';
    else if ((mode === 'sq' || mode === 'dq') && src[i] === '\n') mode = 'code';
    i++;
  }
  return out.join('');
}

function code(rel: string): string {
  try { return stripComments(readFileSync(join(ROOT, rel), 'utf8')); } catch { return ''; }
}

const FILES = {
  sidePanel: 'components/desktop/SidePanel.tsx',
  layout: 'app/_layout.tsx',
  dataTable: 'components/desktop/DataTable.tsx',
  schedToolbar: 'components/schedule/desktop/ScheduleProToolbar.tsx',
  toolbarActions: 'components/desktop/ToolbarActions.tsx',
  jobSwitcher: 'components/desktop/JobSwitcher.tsx',
  sidebar: 'components/DesktopSidebar.tsx',
  attention: 'app/(tabs)/(home)/attention.tsx',
} as const;
const src = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, code(p)])) as Record<keyof typeof FILES, string>;

console.log('validate-web-polish');
for (const [k, p] of Object.entries(FILES)) ok(`${p} is readable`, src[k as keyof typeof FILES].length > 0);

// ── 1. SidePanel ─────────────────────────────────────────────────────────────
{
  const s = src.sidePanel;
  const phoneAt = s.indexOf('if (!isDesktop)');
  const before = phoneAt >= 0 ? s.slice(0, phoneAt) : '';
  const after = phoneAt >= 0 ? s.slice(phoneAt) : '';
  ok('SidePanel: the slide arms on open false → true (a ref), and the hooks sit above the phone return',
    /const\s+slideArmed\s*=\s*useRef\(false\)/.test(before)
    && /if\s*\(\s*!prevOpen\.current\s*&&\s*open\s*\)\s*slideArmed\.current\s*=\s*true/.test(before)
    && /useWebSwap\(/.test(before));
  ok("SidePanel: webMotion('slideInRight') only behind slideArmed.current",
    /slideArmed\.current\s*\?\s*webMotion\('slideInRight'\)\s*:\s*null/.test(after)
    && (s.match(/slideInRight/g) ?? []).length === 1);
  ok('SidePanel: the body swap is gated on isDesktop (the body is shared with the phone sheet)',
    /const\s+bodySwap\s*=\s*isDesktop\s*\?\s*swap\s*:\s*null/.test(before)
    && /bodySwap\s*\?\s*\[styles\.body,\s*bodySwap\]\s*:\s*styles\.body/.test(before));
  const modal = after.match(/<Modal\b[^>]*>/)?.[0] ?? '';
  ok('SidePanel: the phone Modal branch is unchanged (slide + pageSheet)',
    /animationType="slide"/.test(modal) && /presentationStyle="pageSheet"/.test(modal) && !/webMotion|bodySwap|slide\b(?!")/.test(after.slice(0, after.indexOf('</Modal>'))),
    modal || '(no <Modal> after the isDesktop check)');
}

// ── 2. the round-1 page fade ─────────────────────────────────────────────────
ok("app/_layout.tsx still passes contentStyle: webMotion('fadeIn') (the page fade)",
  /contentStyle:\s*webMotion\('fadeIn'\)/.test(src.layout));

// ── 3. DataTable ─────────────────────────────────────────────────────────────
{
  const s = src.dataTable;
  const phone = s.match(/if \(!isDesktop\) \{[\s\S]*?return <DesktopDataTable \{\.\.\.props\} \/>;/)?.[0] ?? '';
  ok('DataTable: the phone early return is untouched (rows → renderCard, nothing else)',
    phone.length > 0 && !/webMotion|enter/i.test(phone));
  ok('DataTable: `entering` is derived from the PREVIOUS visibleKeys (keys not seen before)',
    /const\s+prev\s*=\s*new Set\(enterRef\.current\.keys\)/.test(s)
    && /entering:\s*new Set\(visibleKeys\.filter\(\(k\)\s*=>\s*!prev\.has\(k\)\)\)/.test(s)
    && /useRef<\{\s*keys:\s*readonly string\[\];\s*entering:\s*ReadonlySet<string>\s*\}>\(\{\s*keys:\s*visibleKeys,\s*entering:\s*EMPTY_SET\s*\}\)/.test(s));
  ok("DataTable: the fade is applied only to keys in `entering`",
    /entering\.has\(/.test(s) && (s.match(/webMotion\('fadeIn'\)/g) ?? []).length === 1
    && /entering\.size\s*>\s*0\s*\?\s*webMotion\('fadeIn'\)\s*:\s*null/.test(s));
  const steps = Number((s.match(/const\s+ENTER_STAGGER_STEPS\s*=\s*(\d+)/) ?? [])[1]);
  const maxRows = Number((s.match(/const\s+ENTER_MAX_ROWS\s*=\s*(\d+)/) ?? [])[1]);
  const stagger = Number((s.match(/const\s+ENTER_STAGGER_MS\s*=\s*(\d+)/) ?? [])[1]);
  ok(`DataTable: the stagger is capped (steps ${steps} ≤ 8, rows ${maxRows} ≤ 30, ${stagger} ms × steps ≤ 128 ms)`,
    steps > 0 && steps <= 8 && maxRows > 0 && maxRows <= 30 && stagger > 0 && stagger * steps <= 128
    && /Math\.min\(n,\s*ENTER_STAGGER_STEPS\)/.test(s) && /n\s*>=\s*ENTER_MAX_ROWS/.test(s));
  ok('DataTable: the stagger delay is a CSS string (`${…}ms`)',
    /animationDelay:\s*`\$\{[^`]*\}ms`/.test(s));
  ok('DataTable: DataRow appends the enter style only when it is set',
    /\.\.\.\(enter\s*\?\s*\[enter\]\s*:\s*\[\]\)/.test(s));
}

// ── 4. popovers drop in ──────────────────────────────────────────────────────
ok('Schedule Pro More menu drops in', /const\s+menuDrop\s*=\s*webMotion\('dropIn'\)/.test(src.schedToolbar)
  && /menuDrop\s*\?\s*\[styles\.menu,[^\]]*menuDrop\]/.test(src.schedToolbar));
ok('ToolbarActions ⋯ menu drops in', /const\s+menuDrop\s*=\s*webMotion\('dropIn'\)/.test(src.toolbarActions)
  && /menuDrop\s*\?\s*\[styles\.menu,[^\]]*\},\s*menuDrop\]/.test(src.toolbarActions));
ok('JobSwitcher popover drops in', /const\s+drop\s*=\s*webMotion\('dropIn'\)/.test(src.jobSwitcher)
  && /drop\s*\?\s*\[styles\.popover,\s*popoverPlace,\s*drop\]/.test(src.jobSwitcher));

// ── 5. chevrons rotate behind an armed ref ───────────────────────────────────
ok('Schedule Pro More chevron: armed in openMore, rotateGlide once armed, bare icon before',
  /moreChevronArmed\s*=\s*useRef\(false\)/.test(src.schedToolbar)
  && /const\s+openMore\s*=\s*\(\)\s*=>\s*\{\s*moreChevronArmed\.current\s*=\s*true;/.test(src.schedToolbar)
  && /moreChevronArmed\.current\s*\?\s*\(\s*<View style=\{\[\{\s*transform:\s*\[\{\s*rotate:\s*moreOpen\s*\?\s*'180deg'\s*:\s*'0deg'\s*\}\]\s*\},\s*webMotion\('rotateGlide'\)\]\}>/.test(src.schedToolbar));
ok('Sidebar group chevrons: touched in onPress before the state change, rotateGlide once touched, today\'s pair untouched',
  /touchedToggles\s*=\s*useRef\(new Set<string>\(\)\)/.test(src.sidebar)
  && /onPress=\{\(\)\s*=>\s*\{\s*touchedToggles\.current\.add\(toggle\);/.test(src.sidebar)
  && /touchedToggles\.current\.has\(toggle\)\s*\?\s*\(\s*<View style=\{\[\{\s*transform:\s*\[\{\s*rotate:\s*open\s*\?\s*'0deg'\s*:\s*'-90deg'\s*\}\]\s*\},\s*webMotion\('rotateGlide'\)\]\}>/.test(src.sidebar)
  && /:\s*open\s*\?\s*<ChevronDown[^>]*\/>\s*:\s*<ChevronRight[^>]*\/>/.test(src.sidebar));

// ── 6. attention ─────────────────────────────────────────────────────────────
ok('attention: layoutNext() runs on the line before setSeverity',
  /onChange=\{\(v\)\s*=>\s*\{\s*layoutNext\(\);\s*setSeverity\(v\);\s*\}\}/.test(src.attention)
  && /import\s*\{\s*layoutNext\s*\}\s*from\s*'@\/components\/ui\/motion'/.test(src.attention));

// ── 7. the web rules, in every file this lane touched ────────────────────────
for (const [k, p] of Object.entries(FILES)) {
  const s = src[k as keyof typeof FILES];
  const bad: string[] = [];
  if (/\banimationKeyframes\b/.test(s)) bad.push('animationKeyframes');
  if (/animationFillMode\s*:\s*['"]both['"]/.test(s)) bad.push("fill mode 'both'");
  if (/\b(?:transitionDuration|animationDuration|transitionDelay|animationDelay)\s*:\s*-?[\d.]/.test(s)) bad.push('a bare-number duration/delay');
  ok(`${p}: no inline keyframes, no 'both', no bare-number duration`, bad.length === 0, bad.join(', '));
}

if (failures > 0) {
  console.log(`\n✗ validate-web-polish: ${failures} failing check(s)`);
  process.exit(1);
}
console.log('\n✓ validate-web-polish: the web moves on change, never at rest, and never under Reduce Motion');

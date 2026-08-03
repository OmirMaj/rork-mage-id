// Visual-regression guard — pins three founder-reported rendering bugs at
// SOURCE level, because you cannot unit-test pixels.
//
//   1. The BrandSplash overlay never dismissed on a deep-link cold start.
//      Its ONLY exit was an Animated completion callback guarded by
//      `if (!finished) return;`. Animated.parallel defaults to stopTogether,
//      so any interrupted leg reported finished:false for the whole group —
//      and because the splash is a full-screen overlay ABOVE a live app
//      rather than a gate, that stranded a translucent "MAGE ID" wordmark
//      permanently over the home feed. Pinned: the interrupted case still
//      dismisses, and a wall-clock failsafe bounds the overlay's lifetime.
//
//   2. The Estimate hub under Discover rendered in a different typeface and
//      scale from the rest of the app — <Card> gave every row a Fraunces
//      serif title over a JetBrains Mono subtitle. Both are real Type tokens
//      so validate-app-slop.ts never saw it. Pinned: Card body slots stay on
//      the sans ladder, and the estimate screens carry no rogue fontFamily
//      or off-ladder fontWeight.
//
//   3. Faint vertical + horizontal rules showed through behind empty states.
//      components/EmptyState.tsx painted a decorative "blueprint" grid behind
//      the icon and copy — and every one of the app's 60+ empty states routes
//      through it, so it was everywhere. Founder: "i dont want that anywhere
//      in the app." Pinned: no hairline grid in EmptyState, none in the login
//      hero, and no screen that renders <EmptyState> may declare grid-line
//      styles of its own.
//
// Pure node:fs — no bundler, no react-native import (those crash bun).
// fileURLToPath + join because the repo path contains a space.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === 'node_modules') continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.tsx') || name.endsWith('.ts')) out.push(full);
  }
  return out;
}

function collectFiles(dirs: string[]): string[] {
  const files: string[] = [];
  for (const d of dirs) files.push(...walk(join(ROOT, d)));
  return files;
}

const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

let failures = 0;
function ok(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log('  PASS  ' + name);
    return;
  }
  failures += 1;
  console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : ''));
}

console.log('\nvisual regression validation:');

// ── 1. Brand splash always dismisses ────────────────────────────────────────
const splash = read('components/BrandSplash.tsx');

ok(
  'BrandSplash: has a wall-clock lifetime ceiling constant',
  /SPLASH_MAX_LIFETIME_MS\s*=\s*\d+/.test(splash),
  'Define SPLASH_MAX_LIFETIME_MS — the overlay must have a bounded lifetime.',
);

ok(
  'BrandSplash: failsafe timer calls finish() independently of Animated',
  /setTimeout\(\s*finish\s*,\s*SPLASH_MAX_LIFETIME_MS\s*\)/.test(splash),
  'Expected setTimeout(finish, SPLASH_MAX_LIFETIME_MS). An Animated callback ' +
    'is not a guarantee (stopTogether, JS-thread starvation, dropped bridge ' +
    'callback) — the splash needs a dismiss path that depends on nothing.',
);

ok(
  'BrandSplash: does NOT bail out of dismissal when the animation is interrupted',
  !/if\s*\(\s*!\s*finished\s*\)\s*return/.test(splash),
  'Found `if (!finished) return` — this was the deep-link cold-start bug. A ' +
    'stopped animation reports finished:false; skipping onDone() there left ' +
    'the wordmark painted over the home feed forever.',
);

ok(
  'BrandSplash: the animation end callback calls finish()',
  /anim\.start\(\s*\(\{\s*finished\s*\}\)\s*=>\s*\{[\s\S]{0,900}?finish\(\)/.test(splash),
  'The Animated completion handler must call finish() on every end.',
);

ok(
  'BrandSplash: finish() zeroes the overlay opacity before handing back',
  /doneRef\.current\s*=\s*true;[\s\S]{0,600}?overlayOpacity\.setValue\(0\)/.test(splash),
  'An interrupted/failsafed dismiss leaves overlayOpacity part-way; snap it ' +
    'to 0 so the wordmark is not painted for the frame before unmount.',
);

const layout = read('app/_layout.tsx');
ok(
  '_layout: BrandSplash is unmounted by brandSplashDone',
  /!brandSplashDone\s*&&[\s\S]{0,200}?<BrandSplash\s+onDone=/.test(layout),
  'The splash must still be mounted conditionally so onDone() actually removes it.',
);

// ── 2. Estimate screens stay on the Type ladder ─────────────────────────────
// Discover's estimate route is a re-export of app/(tabs)/estimate/index.tsx,
// and that hub is the only screen in the app that renders <Card>.
const estimateFiles = collectFiles(['app/(tabs)/estimate']).concat([
  join(ROOT, 'app/(tabs)/discover/estimate.tsx'),
  join(ROOT, 'components/ui/Card.tsx'),
]);

const fontFamilyHits: string[] = [];
for (const file of estimateFiles) {
  readFileSync(file, 'utf8').split('\n').forEach((text, i) => {
    // A literal fontFamily. Type.serif*/Type.mono* carry their own families
    // and are the sanctioned way to reach Fraunces / JetBrains Mono.
    if (/\bfontFamily\s*:/.test(text)) {
      fontFamilyHits.push(relative(ROOT, file) + ':' + (i + 1) + '  ' + text.trim().slice(0, 80));
    }
  });
}
ok(
  'estimate screens: no rogue literal fontFamily',
  fontFamilyHits.length === 0,
  fontFamilyHits.join('\n        '),
);

// The off-ladder-weight pin is scoped to the screens on the founder's path —
// the Discover → Estimate hub, its Review sibling, and the <Card> primitive
// they render. app/(tabs)/estimate/full.tsx is deliberately NOT in this list:
// it is a 5,700-line legacy estimator carrying ~10 pre-existing `fontWeight:
// '800'` declarations that predate this fix and are a separate cleanup. This
// list is the honest boundary of what was actually brought onto the ladder —
// widen it when full.tsx is migrated, don't quietly delete the check.
const HUB_FILES = [
  'app/(tabs)/estimate/index.tsx',
  'app/(tabs)/estimate/review.tsx',
  'app/(tabs)/discover/estimate.tsx',
  'components/ui/Card.tsx',
];

const weightHits: string[] = [];
for (const rel of HUB_FILES) {
  read(rel).split('\n').forEach((text, i) => {
    // constants/typography.ts documents exactly four weights: 400/500/600/700.
    if (/fontWeight\s*:\s*['"](800|900)['"]/.test(text)) {
      weightHits.push(rel + ':' + (i + 1) + '  ' + text.trim().slice(0, 80));
    }
  });
}
ok(
  'estimate hub + Card: no off-ladder fontWeight (800/900)',
  weightHits.length === 0,
  weightHits.join('\n        '),
);

const card = read('components/ui/Card.tsx');
ok(
  'Card: title/meta body slots are NOT serif or mono',
  !/(CardTitle|CardMeta)[\s\S]{0,300}?Type\.(serif|mono)/.test(card),
  'Card rows are body UI. Fraunces (Type.serif*) is for screen-level display ' +
    'titles and JetBrains Mono (Type.mono*) for micro/numeric labels — using ' +
    'them for every card row is what made the Estimate hub read as a ' +
    'different typeface from the rest of the app.',
);
ok(
  'Card: title/meta use sans ladder tokens',
  /CardTitle[\s\S]{0,300}?Type\.headline/.test(card) && /CardMeta[\s\S]{0,300}?Type\.footnote/.test(card),
  'Expected Type.headline for Card.Title and Type.footnote for Card.Meta.',
);

// ── 3. No structural lines behind empty states ──────────────────────────────
const emptyState = read('components/EmptyState.tsx');

ok(
  'EmptyState: no grid backdrop layer',
  !/gridBackdrop|gridLineV|gridLine/.test(emptyState),
  'The decorative blueprint grid is gone and must stay gone — it read as a ' +
    'chart grid bleeding through, on every empty state in the app.',
);

ok(
  'EmptyState: renders no hairline rules',
  !/(height|width)\s*:\s*(1|0\.5)\s*,/.test(emptyState),
  'A 1px absolutely-positioned View inside EmptyState is a rule behind the ' +
    'copy. Empty states get no structural lines.',
);

const login = read('app/login.tsx');
ok(
  'login hero: no concrete-grid hairlines',
  !/heroGrid/.test(login),
  'The login hero drew the same four faint rules behind its copy.',
);

// Repo-wide: a screen that renders an empty state must not draw its own grid.
const GRID_STYLE_RE = /\b(grid(Line|Lines|Backdrop|Rule)V?|heroGrid[A-Z0-9]*|blueprintGrid|ruledBackdrop)\b/;
const combined: string[] = [];
for (const file of collectFiles(['app', 'components'])) {
  const src = readFileSync(file, 'utf8');
  if (!/<EmptyState[\s/>]/.test(src)) continue;
  src.split('\n').forEach((text, i) => {
    if (GRID_STYLE_RE.test(text)) {
      combined.push(relative(ROOT, file) + ':' + (i + 1) + '  ' + text.trim().slice(0, 80));
    }
  });
}
ok(
  'no screen renders <EmptyState> over its own grid layer',
  combined.length === 0,
  combined.join('\n        '),
);

console.log('');
process.exit(failures === 0 ? 0 : 1);

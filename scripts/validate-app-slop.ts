// Anti-slop regression guard for the React Native app source.
//
// Fails the build if any of the AI-slop tells we just cleaned up creep
// back in:
//   1. Emoji used as icons (we use lucide-react-native throughout).
//   2. Hardcoded purple/pink/violet hex (theme via constants/colors.ts only).
//   3. The "Inter" font token (we ship Fraunces / JetBrains Mono / system).
//
// Pure node:fs — no bundler, no react-native import (those crash bun).
// fileURLToPath + join because the repo path contains a space.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

type Hit = { file: string; line: number; text: string };

function walk(dir: string, exts: string[]): string[] {
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
    if (st.isDirectory()) {
      out.push(...walk(full, exts));
    } else if (exts.some((e) => name.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

function collectFiles(dirs: string[]): string[] {
  const files: string[] = [];
  for (const d of dirs) files.push(...walk(join(ROOT, d), ['.tsx', '.ts']));
  return files;
}

function scan(files: string[], test: (line: string) => boolean): Hit[] {
  const hits: Hit[] = [];
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((text, i) => {
      if (test(text)) {
        hits.push({ file: relative(ROOT, file), line: i + 1, text: text.trim() });
      }
    });
  }
  return hits;
}

function report(name: string, hits: Hit[]): number {
  if (hits.length === 0) {
    console.log('  PASS  ' + name);
    return 0;
  }
  console.log('  FAIL  ' + name + ' — ' + hits.length + ' hit(s):');
  for (const h of hits) {
    console.log('        ' + h.file + ':' + h.line + '  ' + h.text.slice(0, 100));
  }
  return 1;
}

console.log('\napp anti-slop validation:');

let failures = 0;

// ── Check 1: no emoji-as-icons ──────────────────────────────────────────────
// Narrow range: pictographic emoji + dingbats + variation selector. Does NOT
// match plain ASCII arrows, check marks, ×, or • punctuation.
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
failures += report(
  'no emoji-as-icons (app/ components/ constants/)',
  scan(collectFiles(['app', 'components', 'constants']), (l) => EMOJI.test(l)),
);

// ── Check 2: no purple/pink/violet hex ──────────────────────────────────────
// constants/ is excluded — constants/colors.ts intentionally defines Apple
// system purple (#5856D6) and a `purple` token.
const PURPLE_HEXES = [
  '#8B5CF6', '#7C3AED', '#A78BFA', '#9333EA', '#A855F7', '#6366F1',
  '#6D28D9', '#4F46E5', '#818CF8', '#EC4899', '#F472B6', '#C026D3', '#7E22CE',
];
const PURPLE_RE = new RegExp('(' + PURPLE_HEXES.join('|') + ')', 'i');
failures += report(
  'no purple/pink/violet hex (app/ components/)',
  scan(collectFiles(['app', 'components']), (l) => PURPLE_RE.test(l)),
);

// ── Check 3: no "Inter" font reference ───────────────────────────────────────
// Matches only the quoted standalone font token — not "Interaction",
// "Internal", "interface", "Interval", etc.
const INTER_RE = /["']Inter["']/;
failures += report(
  'no "Inter" font reference (app/ components/ constants/)',
  scan(collectFiles(['app', 'components', 'constants']), (l) => INTER_RE.test(l)),
);

// ── Check 4: fontWeight '800' ratchet ────────────────────────────────────────
// constants/typography.ts documents a FOUR-weight ladder (400/500/600/700) and
// its own header names `fontWeight: '800'` — then used 378 times — as part of
// the problem the Type scale was created to solve. The 2026-08-03 UX audit
// found 877. The drift has more than DOUBLED since that fix shipped.
//
// Rewriting 877 call sites blind would risk visual regressions across the app
// for a polish issue, so this is a RATCHET, not a ban: the count may fall,
// never rise. Lower CEILING as screens migrate. Never raise it.
//
// Failing here means you added a new one. Use Type.eyebrow (11/700/uppercase)
// for small loud labels, or Type.headline / Type.title* for real headings.
const WEIGHT_800_CEILING = 877;
const weight800 = scan(collectFiles(['app', 'components']), (l) => /fontWeight: '800'/.test(l));
if (weight800.length > WEIGHT_800_CEILING) {
  failures += report(
    `fontWeight '800' did not grow (${weight800.length} <= ${WEIGHT_800_CEILING})`,
    weight800.slice(0, 5),
  );
} else {
  console.log(`  PASS  fontWeight '800' ratchet — ${weight800.length} of ${WEIGHT_800_CEILING} allowed`);
  if (weight800.length < WEIGHT_800_CEILING) {
    console.log(`        ↓ lower WEIGHT_800_CEILING to ${weight800.length}`);
  }
}

console.log('');
process.exit(failures === 0 ? 0 : 1);


// validate-type-identity.ts — the app must read as ONE product.
//
// WHY THIS EXISTS. MAGE ID ships four weights of Fraunces and, before the
// 2026-08-26 pass, used the serif on 20 of ~165 screens — `serifHero` in
// exactly one place. Every other screen hand-rolled its own header title in
// system sans at whatever size that screen's author picked: headline/700,
// title3/800, title2/800, subheadline/700, body/700.
//
// That inconsistency IS the "vibe coded" read. Not any single ugly screen — the
// fact that 55 screens open with an anonymous bold-sans title and a handful
// open with a designed one. Fixing screens individually never moved the needle
// because the surrounding 55 kept resetting the impression.
//
// THE RULE (constants/typography.ts):
//   • Fraunces (Type.serifHeadline) for SCREEN TITLES and numbers that matter.
//   • System sans for everything else.
//
// This guard is a RATCHET. It does not demand perfection on day one — it pins
// the count of non-conforming screen headers and fails when that count RISES,
// so a new screen cannot quietly reintroduce the drift.
//
// WHAT IT WAS BLIND TO UNTIL 2026-09-07. It walked only `app/` and detected a
// header by the literal KEY NAME `headerTitle:` — so it reported PASS at
// ceiling 0 while 32 screen headers opened in anonymous bold sans, which is the
// exact drift the paragraph above says it exists to stop. Two shapes escaped:
//
//   • a screen that names its title style `title:` / `screenTitle:` /
//     `pageTitle:` (app/reports.tsx:472, app/handover.tsx, app/lien-waivers.tsx
//     and ~20 more) — the ROLE is the same, only the spelling differs;
//   • the three SHARED header components, which live in `components/` and were
//     outside the walk entirely, and between them dress ~30 screens.
//
// So the header is matched by ROLE now, in both roots, and the ceiling is the
// honest number this reports rather than an aspiration. Lower it as headers
// convert; the three shared components are the cheapest first move.
//
// Run via: bun run test:type-identity

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/** Lower this as headers are converted. NEVER raise it — a rise means a new
 *  screen hand-rolled a sans header instead of using Type.serifHeadline.
 *  Was 0 while the check could only see `headerTitle:` in app/; 32 is what the
 *  role-based match over app/ + components/ actually finds (2026-09-07). */
const SANS_HEADER_CEILING = 32;

/** A fontWeight on a Fraunces style makes the platform synthesise a fake bold
 *  over a real one. Always zero — there is no legitimate case. */
const FAKE_BOLD_CEILING = 0;

/**
 * Hero figures — a screen's ONE big number (margin %, coverage %, money total)
 * rendered at largeTitle or bigger — carry the serif too. That is the second
 * half of the rule: Fraunces for screen titles AND numbers that matter.
 *
 * Deliberately narrow. Stat rows, KPI grids and small metric values stay SANS:
 * serif everywhere would flatten the hierarchy the hero depends on, which is a
 * worse look than plain sans. If this ceiling starts climbing, someone is
 * adding big sans numbers instead of using Type.serifLargeTitle / serifHero.
 */
const SANS_HERO_NUMBER_CEILING = 0;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(entry)) out.push(p);
  }
  return out;
}

interface Hit { file: string; line: number; snippet: string }

const sansHeaders: Hit[] = [];
const fakeBold: Hit[] = [];
const sansHeroNumbers: Hit[] = [];

/** The header's ROLE, not one spelling of it: `headerTitle`, `title`,
 *  `screenTitle`, `pageTitle`. Deliberately excludes `cardTitle`, `rowTitle`,
 *  `sectionTitle` and friends — those are content, not the screen's masthead. */
const HEADER_ROLE_KEY = /^\s*((?:header)?(?:title|screenTitle|pageTitle))\s*:\s*\{/i;

/** What makes a file a SCREEN SHELL rather than a card: it owns a back
 *  affordance, or it suppresses the native header and draws its own. Without
 *  this the role match would sweep in every list row that has a `title` style. */
const SCREEN_SHELL = /<(ChevronLeft|ArrowLeft)\b|headerShown:\s*false/;

/** The shared header components draw the title INLINE from a prop
 *  (`<Text style={[Type.title2, …]}>{title}</Text>` in components/
 *  FeatureHeader.tsx), so no style key exists for the rule above to match —
 *  and that one component dresses eleven screens. */
const INLINE_PROP_TITLE = /style=\{\[\s*Type\.(largeTitle|title1|title2|title3)\b[\s\S]{0,300}?>\s*\{\s*(?:title|screenTitle|pageTitle)\s*\}/g;

for (const file of [...walk('app'), ...walk('components')]) {
  const src = readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const isScreenShell = SCREEN_SHELL.test(src);

  for (const m of src.matchAll(INLINE_PROP_TITLE)) {
    if (/serif/i.test(m[0])) continue;
    const line = src.slice(0, m.index!).split('\n').length;
    sansHeaders.push({ file, line, snippet: `renders {title} at Type.${m[1]} — sans` });
  }

  lines.forEach((ln, i) => {
    const trimmed = ln.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;

    // A screen header title that does NOT use the serif.
    const isHeaderStyle = isScreenShell && HEADER_ROLE_KEY.test(ln);
    if (isHeaderStyle && !ln.includes('serif')) {
      // Multi-line style objects: look ahead a few lines for the serif token
      // before calling it non-conforming.
      const lookahead = lines.slice(i, i + 6).join(' ');
      if (!lookahead.includes('serif')) {
        sansHeaders.push({ file, line: i + 1, snippet: trimmed.slice(0, 100) });
      }
    }

    // Fraunces + fontWeight on the same style object.
    if (ln.includes('serif') && /fontWeight/.test(ln)) {
      fakeBold.push({ file, line: i + 1, snippet: trimmed.slice(0, 100) });
    }

    // A hero-sized number style still in system sans. Matched on the naming
    // convention (heroValue/kpiValue/…) AND a largeTitle/title1 size, so stat
    // rows and small KPI values — which SHOULD stay sans — never trip it.
    const isHeroNumber = /^\s*(heroValue|kpiValue|metricValue|summaryValue|bigValue)\s*:/.test(ln);
    if (isHeroNumber && /Type\.(largeTitle|title1)\b/.test(ln) && !ln.includes('serif')) {
      sansHeroNumbers.push({ file, line: i + 1, snippet: trimmed.slice(0, 100) });
    }
  });
}

let failed = false;

console.log('\ntype identity guard (one product, not 165 screens):');

console.log(`  screen headers still in system sans: ${sansHeaders.length} (ceiling ${SANS_HEADER_CEILING})`);
if (sansHeaders.length > SANS_HEADER_CEILING) {
  failed = true;
  console.error(`  FAIL  ${sansHeaders.length - SANS_HEADER_CEILING} over the ceiling.`);
  console.error('        Screen titles use Type.serifHeadline — see constants/typography.ts.');
  console.error('        If you lowered the count, lower SANS_HEADER_CEILING to match.\n');
  for (const h of sansHeaders.slice(0, 25)) {
    console.error(`        ${h.file}:${h.line}  ${h.snippet}`);
  }
} else if (sansHeaders.length < SANS_HEADER_CEILING) {
  console.log(`  NOTE  below the ceiling — lower SANS_HEADER_CEILING to ${sansHeaders.length} to lock the gain in.`);
} else if (sansHeaders.length === 0) {
  console.log('  PASS  every screen header uses the serif');
} else {
  // Do not print PASS here. Sitting ON a non-zero ceiling is a held line, not a
  // clean bill — the old wording said "every screen header uses the serif" while
  // the count was 32, which is how this guard came to certify the drift it was
  // written to stop.
  console.log(`  HELD  ${sansHeaders.length} screen headers are still anonymous bold sans (at the ceiling, not under it).`);
  console.log('        Cheapest move: convert components/FeatureHeader.tsx and components/ToolScreenChrome.tsx — two edits cover ~28 screens.');
}

console.log(`  fake-bold (fontWeight on a Fraunces style): ${fakeBold.length} (ceiling ${FAKE_BOLD_CEILING})`);
if (fakeBold.length > FAKE_BOLD_CEILING) {
  failed = true;
  console.error('  FAIL  Fraunces_700Bold already carries its weight; an override synthesises');
  console.error('        a fake bold on top of a real one. Remove the fontWeight.\n');
  for (const h of fakeBold.slice(0, 15)) {
    console.error(`        ${h.file}:${h.line}  ${h.snippet}`);
  }
} else {
  console.log('  PASS  no fake-bold on serif styles');
}

console.log(`  hero numbers still in system sans: ${sansHeroNumbers.length} (ceiling ${SANS_HERO_NUMBER_CEILING})`);
if (sansHeroNumbers.length > SANS_HERO_NUMBER_CEILING) {
  failed = true;
  console.error('  FAIL  a screen\'s hero figure should carry the serif (Type.serifLargeTitle');
  console.error('        or serifHero). Stat rows and small KPI values stay sans on purpose.\n');
  for (const h of sansHeroNumbers.slice(0, 15)) {
    console.error(`        ${h.file}:${h.line}  ${h.snippet}`);
  }
} else {
  console.log('  PASS  hero figures carry the serif');
}

if (failed) process.exit(1);

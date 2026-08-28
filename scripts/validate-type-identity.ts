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
// Run via: bun run test:type-identity

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/** Lower this as headers are converted. NEVER raise it — a rise means a new
 *  screen hand-rolled a sans header instead of using Type.serifHeadline. */
const SANS_HEADER_CEILING = 0;

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

for (const file of walk('app')) {
  const src = readFileSync(file, 'utf8');
  const lines = src.split('\n');

  lines.forEach((ln, i) => {
    const trimmed = ln.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;

    // A screen header title that does NOT use the serif.
    const isHeaderStyle = /^\s*headerTitle\s*:\s*\{/.test(ln);
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
} else {
  console.log('  PASS  every screen header uses the serif');
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

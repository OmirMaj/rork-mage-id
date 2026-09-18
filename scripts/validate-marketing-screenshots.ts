// scripts/validate-marketing-screenshots.ts — a public page must not show a
// screenshot we know to be broken.
//
// WHY (audit 2026-09-18, #31). validate-marketing-claims skips /screenshots/
// as internal, yet 19 public pages embed images from it — so nothing checked
// what those images SHOW. Three selling pages (buildertrend-alternative,
// features/vs-takeoff, demo) embedded 24-estimate-hero.png: a Cost Breakdown
// sheet with 0.0% on every row and line items $140k short of its headline
// total, captioned as a proposal, a takeoff estimate and the AI drawing
// analyzer. The demo hero used 16-ai-estimator.png, which has a red
// "Maximum update depth exceeded" error toast across the bottom.
//
// A pixel check is out of reach here; a RETIRED list is not. Each entry says
// what is wrong with the capture. A page that references one fails, and so
// does a page that references a screenshot file that does not exist. Take a
// capture off this list only by replacing the file with a re-shoot.
//
// Run via: bun run scripts/validate-marketing-screenshots.ts

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MARKETING = join(ROOT, 'marketing');

export const RETIRED_SCREENSHOTS: Record<string, string> = {
  '24-estimate-hero.png':
    'Cost Breakdown of a seeded estimate with no subtotal: 0.0% on every row, rows that do not reconcile to the $511,863 total, a hardcoded "savings applied" chip, pre-rebrand orange',
  '16-ai-estimator.png':
    'Quick Estimate step 1 with a red "Maximum update depth exceeded" error toast over the footer — not a priced estimate',
  '25-generating.jpg':
    'the old Quick Estimate overlay reading "Pulling materials, labor, and 2025 pricing for your project" — a lookup the app withdrew as false (components/AIQuickEstimate.tsx)',
};

// Pages that still show a retired capture and belong to another lane. Printed
// as a warning so this guard can land now; delete an entry when its page is
// fixed (and never add one — a new reference to a retired capture must fail).
const PENDING_ELSEWHERE: Record<string, readonly string[]> = {};

// Same notion of "public" as validate-marketing-claims: not the build output,
// not the internal screenshot tooling pages.
const SKIP = new Set(['dist', 'screenshots', 'app-store-screenshots', 'node_modules']);
function pages(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (SKIP.has(e) || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) pages(p, out);
    else if (e.endsWith('.html')) out.push(p);
  }
  return out;
}

let fail = 0, refs = 0;
const all = pages(MARKETING);
for (const file of all) {
  const html = readFileSync(file, 'utf8');
  // Only real references (src / srcset / url()), never an HTML comment that
  // explains why an image was removed.
  const noComments = html.replace(/<!--[\s\S]*?-->/g, '');
  const re = /\/screenshots\/screens\/([A-Za-z0-9._-]+\.(?:png|jpe?g|webp))/g;
  for (const m of noComments.matchAll(re)) {
    refs++;
    const name = m[1]!;
    const where = relative(ROOT, file);
    if (RETIRED_SCREENSHOTS[name] && PENDING_ELSEWHERE[name]?.includes(where)) {
      console.log(`  ! ${where} still shows ${name} (pending, owned elsewhere) — ${RETIRED_SCREENSHOTS[name]}`);
    } else if (RETIRED_SCREENSHOTS[name]) {
      fail++;
      console.log(`  ✗ ${where} shows ${name} — ${RETIRED_SCREENSHOTS[name]}`);
    } else if (!existsSync(join(MARKETING, 'screenshots', 'screens', name))) {
      fail++;
      console.log(`  ✗ ${where} references ${name}, which does not exist`);
    }
  }
}
// Post-ship review: removing a capture from a two-column .feature-row leaves
// the text in the left half beside an empty column. A row left with a single
// child must collapse itself to one column (inline, as the fixed pages do).
for (const file of all) {
  const html = readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  // Either collapse counts: the inline style, or a `solo` class the page itself
  // defines as one column (field.html and friends).
  const soloDefined = /\.feature-row\.solo\s*\{\s*grid-template-columns:\s*1fr/.test(html);
  for (const m of html.matchAll(/<div class="feature-row([^"]*)"([^>]*)>/g)) {
    let depth = 1, i = m.index! + m[0].length;
    const tag = /<(\/?)div\b/g;
    tag.lastIndex = i;
    let t: RegExpExecArray | null;
    while (depth > 0 && (t = tag.exec(html))) { depth += t[1] ? -1 : 1; i = tag.lastIndex; }
    // The row's body minus its closing tag. A row whose only child is one
    // block (the text) is the stranded case; rows with a mockup, a figure or
    // an svg as their second child are real two-column layouts.
    const inner = html.slice(m.index! + m[0].length, i).replace(/<\/div>\s*$/, '').trim();
    let rest = inner;
    if (rest.startsWith('<div')) {
      let d = 0, j = 0;
      const t2 = /<(\/?)div\b[^>]*>/g;
      let u: RegExpExecArray | null;
      while ((u = t2.exec(rest))) { d += u[1] ? -1 : 1; if (d === 0) { j = t2.lastIndex; break; } }
      rest = rest.slice(j).trim();
    }
    const singleChild = inner.startsWith('<div') && !/<[a-z]/i.test(rest);
    const collapsed = /grid-template-columns:\s*1fr/.test(m[2]!) || (soloDefined && /\bsolo\b/.test(m[1]!));
    if (singleChild && !collapsed) {
      fail++;
      console.log(`  ✗ ${relative(ROOT, file)}: a .feature-row with one child still has two columns (add style="grid-template-columns: 1fr; max-width: 760px;")`);
    }
  }
}
const INDEX = readFileSync(join(MARKETING, 'index.html'), 'utf8');
if (!/\.brain-detail\.no-shot\{grid-template-columns:1fr\}/.test(INDEX) || !/'<div class="brain-detail'\+\(d\.shot \? '' : ' no-shot'\)/.test(INDEX)) {
  fail++;
  console.log('  ✗ marketing/index.html: a brain-detail card with no shot must render one column (.no-shot)');
}
console.log(fail
  ? `\n✗ validate-marketing-screenshots: ${fail} failure(s)`
  : `\nall marketing screenshot checks passed (${refs} references across ${all.length} public pages)`);
if (fail) process.exit(1);

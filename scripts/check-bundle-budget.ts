// scripts/check-bundle-budget.ts — fail the OTA if the JS bundle got heavier
// (IDEAS-1 · SPEED S4).
//
// Reads an EXISTING export directory — the one `npx expo export --platform ios
// --platform web` writes (the same export `eas update` makes) — and sums:
//   iOS: <dir>/_expo/static/js/ios/*.hbc   (the Hermes bytecode bundle)
//   web: <dir>/_expo/static/js/web/*.js    (every web JS chunk; .map excluded)
// then compares them with the recorded baseline.
//
// Budget file format (perf/bundle-budget.json):
//   {
//     "baseline": null | {
//       "iosBytes": <number>,     // summed .hbc bytes at the recorded commit
//       "webBytes": <number>,     // summed web .js bytes at the recorded commit
//       "recordedAt": "<ISO date>",
//       "commit": "<git sha>"
//     },
//     "tolerancePct": 2           // allowed growth before the check fails
//   }
// A platform missing from the export is reported and skipped (a web-only
// export does not fail the iOS budget). A baseline of null passes with
// "No baseline recorded yet."
//
// Usage (the OTA recipe runs it right after the export, before `eas update`):
//   bun run scripts/check-bundle-budget.ts [--dir dist] [--budget perf/bundle-budget.json]
//   bun run scripts/check-bundle-budget.ts --write-baseline --commit <sha>   # ORCHESTRATOR ONLY
// Exit 0 = within budget (or no baseline); 1 = over budget; 2 = bad input.

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export interface BundleBaseline { iosBytes: number; webBytes: number; recordedAt: string; commit: string }
export interface BundleBudget { baseline: BundleBaseline | null; tolerancePct?: number }
export interface BundleSizes { iosBytes: number | null; webBytes: number | null }

export const DEFAULT_TOLERANCE_PCT = 2;

/** Sum the bytes of files in `dir` whose names end in `ext`; null when the folder is absent or empty. */
export function sumDir(dir: string, ext: string): number | null {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith(ext));
  if (files.length === 0) return null;
  return files.reduce((n, f) => n + statSync(join(dir, f)).size, 0);
}

export function measureExport(exportDir: string): BundleSizes {
  const js = join(exportDir, '_expo', 'static', 'js');
  return { iosBytes: sumDir(join(js, 'ios'), '.hbc'), webBytes: sumDir(join(js, 'web'), '.js') };
}

const kb = (n: number) => `${Math.round(n / 1024).toLocaleString('en-US')} KB`;

/** Pure comparison. Returns the lines to print and whether the check passed. */
export function compareToBudget(sizes: BundleSizes, budget: BundleBudget): { pass: boolean; lines: string[] } {
  const lines: string[] = [];
  if (!budget.baseline) {
    return { pass: true, lines: ['No baseline recorded yet.'] };
  }
  const tol = typeof budget.tolerancePct === 'number' && budget.tolerancePct >= 0 ? budget.tolerancePct : DEFAULT_TOLERANCE_PCT;
  let pass = true;
  const check = (label: string, now: number | null, base: number) => {
    if (now === null) { lines.push(`${label}: not in this export, skipped.`); return; }
    const limit = base * (1 + tol / 100);
    const pct = base > 0 ? ((now - base) / base) * 100 : 0;
    const delta = now - base;
    if (now > limit) {
      pass = false;
      lines.push(`${label} bundle grew ${pct.toFixed(1)}% (+${kb(delta)}) since the recorded baseline. `
        + 'Look for a new heavy import, or record a new baseline on purpose.');
    } else {
      const sign = delta >= 0 ? '+' : '−';
      lines.push(`${label} bundle ${kb(now)} (${sign}${kb(Math.abs(delta))}, ${pct.toFixed(1)}% vs baseline; limit +${tol}%).`);
    }
  };
  check('iOS', sizes.iosBytes, budget.baseline.iosBytes);
  check('Web', sizes.webBytes, budget.baseline.webBytes);
  return { pass, lines };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): number {
  const exportDir = resolve(arg('--dir') ?? join(ROOT, 'dist'));
  const budgetPath = resolve(arg('--budget') ?? join(ROOT, 'perf', 'bundle-budget.json'));
  const sizes = measureExport(exportDir);
  if (sizes.iosBytes === null && sizes.webBytes === null) {
    console.log(`No iOS or web bundle found under ${exportDir}/_expo/static/js. Run the export first:`);
    console.log('  npx expo export --platform ios --platform web');
    return 2;
  }
  let budget: BundleBudget;
  try {
    budget = JSON.parse(readFileSync(budgetPath, 'utf8')) as BundleBudget;
  } catch (err) {
    console.log(`Cannot read the budget file ${budgetPath}: ${(err as Error).message}`);
    return 2;
  }

  if (process.argv.includes('--write-baseline')) {
    const commit = arg('--commit');
    if (!commit) { console.log('--write-baseline needs --commit <sha>.'); return 2; }
    if (sizes.iosBytes === null || sizes.webBytes === null) {
      console.log('--write-baseline needs both the iOS and the web bundle in the export.');
      return 2;
    }
    const next: BundleBudget = {
      baseline: { iosBytes: sizes.iosBytes, webBytes: sizes.webBytes, recordedAt: new Date().toISOString(), commit },
      tolerancePct: budget.tolerancePct ?? DEFAULT_TOLERANCE_PCT,
    };
    writeFileSync(budgetPath, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`Baseline recorded: iOS ${kb(sizes.iosBytes)}, web ${kb(sizes.webBytes)} at ${commit}.`);
    return 0;
  }

  const { pass, lines } = compareToBudget(sizes, budget);
  for (const l of lines) console.log(l);
  return pass ? 0 : 1;
}

if (import.meta.main) process.exit(main());

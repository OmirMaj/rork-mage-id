// validate-filesystem-legacy.ts — never import the throwing FileSystem entry.
//
// WHY THIS EXISTS. In Expo SDK 54, expo-file-system's ROOT entry re-exports
// ./legacyWarnings (src/index.ts:14), where the classic file APIs are stubs
// that throw:
//
//     export async function readAsStringAsync(...) {
//       throw errorOnLegacyMethodUse('readAsStringAsync');
//     }
//     // @deprecated ... This method will throw in runtime.
//
// It throws on EVERY platform. This was never a web problem — five files were
// importing the root entry and calling readAsStringAsync, so on iOS, the
// primary target:
//   • Cost X-Ray's "Detect & price" always failed, and the catch blamed the
//     user: "they may have been moved. Retake and try again."
//   • the safety hazard scan always reported "Network issue — could not scan"
//   • COI AI validation swallowed it into console.warn, so the spinner simply
//     stopped and nothing said validation never ran
//   • photoAnalyzer — behind AI Punch, Photo Triage, receipt scan and plan
//     intelligence — failed for every photo
//
// Fourteen other files had already been migrated to `expo-file-system/legacy`,
// which is what makes this the dangerous kind of bug: the codebase looked
// migrated. Nothing failed at build time, tsc was happy (the stub has the right
// signature), and every failure surfaced as a plausible domain-specific error
// message pointing somewhere else.
//
// THE RULE: import from 'expo-file-system/legacy' for the classic API. The root
// entry is allowed ONLY for the new File/Directory/Paths API, which does not
// route through legacyWarnings.
//
// Run via: bun run test:filesystem-legacy

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN = ['app', 'components', 'utils', 'hooks', 'contexts', 'lib'];

/** Every symbol the root entry re-exports from legacyWarnings — i.e. every one
 *  that throws at runtime. Mirrors expo-file-system/src/legacyWarnings.ts. */
const THROWING = [
  'readAsStringAsync', 'writeAsStringAsync', 'deleteAsync', 'moveAsync',
  'copyAsync', 'makeDirectoryAsync', 'readDirectoryAsync', 'downloadAsync',
  'uploadAsync', 'getInfoAsync', 'getContentUriAsync', 'createDownloadResumable',
  'createUploadTask',
];

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

interface Violation { file: string; line: number; symbol: string }
const violations: Violation[] = [];
let scanned = 0;
let legacyUsers = 0;

for (const root of SCAN) {
  for (const file of walk(join(ROOT, root))) {
    const src = readFileSync(file, 'utf8');
    if (!src.includes('expo-file-system')) continue;
    scanned++;

    if (/from ['"]expo-file-system\/legacy['"]/.test(src)) { legacyUsers++; continue; }

    // Root-entry import. Fine on its own (the new File/Paths API lives there);
    // only a call into a throwing legacy symbol is a bug.
    const rootImport = src.match(/import\s+\*\s+as\s+(\w+)\s+from\s+['"]expo-file-system['"]/)
                    ?? src.match(/import\s+\{([^}]*)\}\s+from\s+['"]expo-file-system['"]/);
    if (!rootImport) continue;

    const ns = src.includes('* as') ? rootImport[1] : null;
    src.split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return; // comments, incl. this guard's own notes
      for (const sym of THROWING) {
        const hit = ns
          ? new RegExp(`\\b${ns}\\.${sym}\\s*\\(`).test(line)
          : new RegExp(`\\b${sym}\\s*\\(`).test(line) && rootImport[1].includes(sym);
        if (hit) violations.push({ file: relative(ROOT, file), line: i + 1, symbol: sym });
      }
    });
  }
}

if (scanned === 0) {
  console.error('✗ validate-filesystem-legacy: found ZERO files importing expo-file-system.');
  console.error('  The guard stopped matching — fix it, do not delete it.');
  process.exit(1);
}

if (violations.length > 0) {
  console.error('\n✗ validate-filesystem-legacy: root-entry FileSystem calls that THROW at runtime\n');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  FileSystem.${v.symbol}(...)`);
  }
  console.error('\n  expo-file-system\'s root entry re-exports these as stubs that throw on');
  console.error('  EVERY platform, iOS included. tsc cannot see it — the stub has the right');
  console.error('  signature — and the failure surfaces as a plausible domain error.');
  console.error("\n  Fix:  import * as FileSystem from 'expo-file-system/legacy';\n");
  process.exit(1);
}

console.log(
  `✓ validate-filesystem-legacy: ${scanned} file(s) use expo-file-system, ` +
  `${legacyUsers} on /legacy, 0 throwing root-entry calls`,
);

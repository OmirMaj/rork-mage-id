// scripts/validate-native-surface.ts — the JS bundle must not carry a native
// module the app does not declare. Audit 2026-09-03 APPSTORE-F2: build #12
// rolled back silently because react-native-reanimated's JS half was bundled
// into an OTA while the installed binary had no native half. The "fix" removed
// it from package.json only; bun.lock and node_modules still resolved 4.1.7 and
// every `expo export` bundled "Native part of Reanimated" again. A guard that
// greps package.json cannot see that. This one exports the real bundle.
//
// Slow (~1-2 min) because it runs a real `expo export`. It is wired as
// `test:native-surface` AND into the ship-check chain — `validate-guard-coverage`
// requires every validator to be reachable from that gate, and a guard that only
// runs when someone remembers it is the exact failure mode that let build #12
// ship. Run it directly before every `eas update` as well; the OTA is the moment
// the bundle's native surface has to match the installed binary.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
const declared = new Set(Object.keys(pkg.dependencies));

/** Native modules with a known bundle fingerprint. Add a row when a new one is removed from package.json. */
const NATIVE_FINGERPRINTS: Array<{ pkg: string; markers: string[] }> = [
  { pkg: 'react-native-reanimated', markers: ['Native part of Reanimated', 'initializeReanimatedModule', '__reanimatedModuleProxy'] },
  { pkg: 'react-native-maps', markers: ['AIRMap', 'RNMapsAirModule'] },
];

let failed = 0;
function ok(label: string, cond: boolean, detail?: string) {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${cond || !detail ? '' : `\n      ${detail}`}`);
  if (!cond) failed++;
}

const out = mkdtempSync(join(tmpdir(), 'mageid-native-surface-'));
try {
  console.log('native surface: exporting the iOS bundle (this takes a minute)…');
  execFileSync('npx', ['expo', 'export', '--platform', 'ios', '--output-dir', out], {
    cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, CI: '1', EXPO_NO_TELEMETRY: '1' },
  });
  const bundles: string[] = [];
  (function walk(d: string) {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(hbc|js)$/.test(n)) bundles.push(p);
    }
  })(out);
  ok('export produced at least one bundle', bundles.length > 0, out);
  const text = bundles.map(b => readFileSync(b, 'latin1')).join('\n');
  for (const { pkg: name, markers } of NATIVE_FINGERPRINTS) {
    const hits = markers.filter(m => text.includes(m));
    if (declared.has(name)) {
      ok(`${name} is declared in package.json (bundle markers: ${hits.length}/${markers.length})`, true);
    } else {
      ok(`${name} is absent from the bundle because it is not declared in package.json`, hits.length === 0,
        `markers found: ${hits.join(', ') || '(none)'} — purge it from bun.lock and node_modules (rm -rf node_modules && bun install --frozen-lockfile)`);
    }
  }
  // Generic: any package under node_modules with an iOS podspec that package.json does not declare and that
  // appears by name in the bundle is a native module riding along undeclared.
  const nm = join(ROOT, 'node_modules');
  const undeclaredNative: string[] = [];
  for (const n of readdirSync(nm)) {
    if (n.startsWith('.') || n.startsWith('@')) continue;
    const dir = join(nm, n);
    let hasPodspec = false;
    try { hasPodspec = readdirSync(dir).some(f => f.endsWith('.podspec')); } catch { /* not a dir */ }
    if (hasPodspec && !declared.has(n) && text.includes(`node_modules/${n}/`)) undeclaredNative.push(n);
  }
  ok('no undeclared native module (podspec) is referenced by the bundle', undeclaredNative.length === 0, undeclaredNative.join(', '));
} finally {
  rmSync(out, { recursive: true, force: true });
}
console.log(`\n${failed === 0 ? 'native surface matches package.json' : `${failed} check(s) failed`}`);
process.exit(failed === 0 ? 0 : 1);

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
  // The phone's 3D drawing surface (lane PHONE3D). Declared since the build after 22. If it is ever taken out of
  // package.json while its JS still resolves, the bundle would name a native view the next binary does not have.
  { pkg: 'expo-gl', markers: ['ExponentGLObjectManager', 'ExponentGLView'] },
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

  // The Living Model's 3D view is drawn on the phone too (lane PHONE3D): the SAME scene the web draws
  // (components/livingModel/threeScene.ts, with `three`), on expo-gl's drawing surface. A phone bundle is one
  // file, so the library's code is now IN the phone bundle. That is allowed on ONE condition, checked here on the
  // real export: expo-gl, the native half that code draws on, is a declared dependency, and its optional lookup
  // (components/livingModel/phone3d/engine.ts) is in the same bundle. The library with no surface to draw on is
  // the old failure: megabytes of code the phone cannot run. What a built bundle cannot show is WHEN the library
  // runs. That it is read lazily, behind the lookup, and never at start-up, is held by static read in
  // scripts/validate-living-model.ts (E1 to E3) and scripts/validate-phone-3d.ts (B1, B2).
  const PHONE_3D_ENGINE = 'expo-gl';
  const LIB_3D = ['WebGLRenderer', 'MeshLambertMaterial', 'createJobScene', 'PCFSoftShadowMap'];
  const hits3d = LIB_3D.filter(m => text.includes(m));
  if (declared.has(PHONE_3D_ENGINE)) {
    ok('the phone bundle carries the 3D library and the scene builder, with expo-gl declared and its lookup beside them',
      hits3d.length === LIB_3D.length && text.includes('ExponentGLObjectManager') && text.includes('requireOptionalNativeModule'),
      `3D markers found: ${hits3d.join(', ') || '(none)'}; lookup name present: ${text.includes('ExponentGLObjectManager')}`);
  } else {
    ok('the phone bundle carries no three.js and no 3D view, because expo-gl is not declared', hits3d.length === 0, `found: ${hits3d.join(', ')}`);
  }
  // One engine only. A second way to draw 3D (a React wrapper, a webview, Skia) is a second native surface nobody approved.
  const OTHER_3D = ['@react-three/fiber', 'expo-three', 'RNSkiaModule', 'RNCWebView'];
  const others = OTHER_3D.filter(m => text.includes(m));
  ok('the phone bundle carries no second 3D engine', others.length === 0, `found: ${others.join(', ')}`);
  // The simulator check (app/dev-phone-3d.tsx) is switched by a variable set only in a builder's own shell. A
  // release export must not have it written in: the bundle would then draw the check for everyone.
  ok('the export was not made with the simulator check switched on', process.env.EXPO_PUBLIC_PHONE3D_SPIKE !== '1',
    'EXPO_PUBLIC_PHONE3D_SPIKE=1 is set in this shell: unset it before any export or update');
} finally {
  rmSync(out, { recursive: true, force: true });
}
console.log(`\n${failed === 0 ? 'native surface matches package.json' : `${failed} check(s) failed`}`);
process.exit(failed === 0 ? 0 : 1);

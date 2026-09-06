// validate-ios-space-paths.ts — a checkout path with a space must still build.
//
// WHY THIS EXISTS. This repo lives at "…/MAGE ID - CLAUDE". FIVE separate build
// scripts interpolate an absolute path into a shell command WITHOUT quoting it.
// Under /bin/sh that word-splits, and the failures range from loud to silent:
//
//   • loud   — `/bin/sh: /Users/omirmajeed/Desktop/MAGE: No such file or directory`
//   • SILENT — expo-updates' `basename $PROJECT_DIR` returns garbage, fails an
//     `!= "Pods"` guard, exits 0, never writes app.manifest. THE BUILD SUCCEEDS.
//     The app then dies at launch in Release with "The embedded manifest is
//     invalid or could not be read." That is the class docs/START-HERE.md meant
//     by "a Release build has never been run" — nobody had, so nobody saw it.
//
// EAS never hits any of this: it checks out to a path with no spaces. So the
// only thing standing between this repo and a dead local Release build is the
// plugin + postinstall this guard pins.
//
// Run via: bun run test:ios-space-paths
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(join(ROOT, 'package.json'));
let failed = 0;
function ok(label: string, cond: boolean, detail?: string) {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${cond || !detail ? '' : `\n      ${detail}`}`);
  if (!cond) failed++;
}

console.log('\nios space-path safety:');

// ── the config plugin ────────────────────────────────────────────────────────
const plugin = require_(join(ROOT, 'plugins/withQuotedXcodeScriptPaths.js'));
const SAMPLE =
  `/bin/sh \`"$NODE_BINARY" --print "a + '/scripts/sentry-xcode.sh'"\`` +
  ` \`"$NODE_BINARY" --print "b + '/scripts/react-native-xcode.sh'"\``;

const backticked = plugin.quoteBacktickSubstitutions(SAMPLE);
ok('backtick substitutions become "$( … )"', !backticked.includes('`') && backticked.includes('"$('));

const quoted = plugin.singleQuoteReactNativeXcodeArg(backticked);
ok("the react-native-xcode.sh argument is single-quoted for `sh -c` re-parsing",
  quoted.includes(`"'$(`) && quoted.trimEnd().endsWith(`)'"`),
  'sentry-xcode.sh runs `/bin/sh -c "$REACT_NATIVE_XCODE"`, which re-parses it');
ok('…and it wrapped the LAST substitution, not the sentry one',
  quoted.indexOf(`"'$(`) > quoted.indexOf('sentry-xcode.sh'));
ok('both transforms are idempotent',
  plugin.quoteBacktickSubstitutions(backticked) === backticked &&
  plugin.singleQuoteReactNativeXcodeArg(quoted) === quoted,
  'a second prebuild must not wrap the wrong argument');
ok('a script with nothing to fix is returned unchanged',
  plugin.singleQuoteReactNativeXcodeArg('echo hi') === 'echo hi' &&
  plugin.quoteBacktickSubstitutions('echo hi') === 'echo hi');
ok('the plugin patches the Podfile too (bash -l -c phases live in Pods.xcodeproj)',
  readFileSync(join(ROOT, 'plugins/withQuotedXcodeScriptPaths.js'), 'utf8')
    .includes('bash -l -c "$PODS_TARGET_SRCROOT'),
  'pod install regenerates Pods.xcodeproj, so prebuild alone cannot fix those');

// ── app.json wiring ──────────────────────────────────────────────────────────
const appJson = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8'));
const plugins: unknown[] = appJson.expo?.plugins ?? [];
const names = plugins.map(p => (Array.isArray(p) ? p[0] : p));
const iPlugin = names.indexOf('./plugins/withQuotedXcodeScriptPaths');
const iSentry = names.indexOf('@sentry/react-native/expo');
ok('withQuotedXcodeScriptPaths is registered in app.json', iPlugin !== -1);
ok('…and runs AFTER the Sentry plugin that injects the unquoted script',
  iSentry === -1 || iPlugin > iSentry,
  `sentry at ${iSentry}, quoting plugin at ${iPlugin}`);

// ── the node_modules half ────────────────────────────────────────────────────
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
ok('postinstall re-applies the node_modules quoting',
  (pkg.scripts?.postinstall ?? '').includes('patch-ios-space-paths'),
  'expo-updates/expo-constants ship `basename $PROJECT_DIR` unquoted; a reinstall brings it back');
ok('scripts/patch-ios-space-paths.sh exists', existsSync(join(ROOT, 'scripts/patch-ios-space-paths.sh')));

for (const rel of [
  'node_modules/expo-updates/scripts/create-updates-resources-ios.sh',
  'node_modules/expo-constants/scripts/get-app-config-ios.sh',
]) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) { ok(`${rel} — not installed, skipped`, true); continue; }
  const src = readFileSync(abs, 'utf8');
  ok(`${rel.split('/')[1]}: basename "$PROJECT_DIR" is quoted`,
    !/basename \$PROJECT_DIR/.test(src),
    'unquoted here means: build succeeds, no app.manifest, app crashes at launch');
}

if (failed > 0) {
  console.error(`\n✗ validate-ios-space-paths: ${failed} failure(s)`);
  console.error('  A space in the checkout path must not produce a green build that crashes.\n');
  process.exit(1);
}
console.log('\nios space-path safety: all checks passed');

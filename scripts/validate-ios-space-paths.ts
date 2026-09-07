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
import { readFileSync, existsSync, writeFileSync, mkdtempSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
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

  // THE PATCH MUST NOT COST THE EXECUTABLE BIT. These are Xcode build-phase
  // scripts; Xcode runs them directly. 2026-09-07: the first portable rewrite
  // of patch-ios-space-paths.sh replaced `sed -i` with write-temp-then-`mv`,
  // and `mv` installs a fresh file at the default umask (644). Both the local
  // Release build and EAS build #15 then died with
  //     bash: .../create-updates-resources-ios.sh: Permission denied
  // The script now writes back in place (`cat > "$f"`), which keeps the inode
  // and therefore the mode. This asserts the outcome, not the technique.
  const mode = statSync(abs).mode & 0o777;
  ok(`${rel.split('/')[1]}: still executable after patching (mode ${mode.toString(8)})`,
    (mode & 0o111) !== 0,
    'Xcode executes this directly — without +x the build phase fails "Permission denied"');
}

// ── the Podfile snippet the plugin WRITES must be valid Ruby ────────────────
// This is the one that actually bit. The plugin injects a Ruby block into the
// Podfile on every `expo prebuild`, built from a JS template literal — four
// levels of escaping (JS -> Ruby -> regex -> shell). The first version shipped
// with an UNTERMINATED Ruby string:
//
//     'bash -l -c "\\"\1\\""       <- no closing quote
//
// Every local build kept working, because ios/ already existed and was never
// regenerated. EAS regenerates it, so EAS got a Podfile that would not parse
// and build #15 died in "Install pods" — a failure mode invisible to every
// local check. Parse it here, the way CocoaPods will.
{
  const pluginSrc = readFileSync(join(ROOT, 'plugins/withQuotedXcodeScriptPaths.js'), 'utf8');
  const m = pluginSrc.match(/const PODFILE_SNIPPET = `([\s\S]*?)`;/);
  ok('the plugin still defines PODFILE_SNIPPET', !!m,
    'if this moved, re-point the parse check below rather than deleting it');

  if (m) {
    // Resolve the template literal's escapes the same way node would.
    const snippet = m[1]
      .replace(/\$\{PODFILE_MARKER\}/g, '# withQuotedXcodeScriptPaths: quote bash -l -c paths')
      .replace(/\\`/g, '`')
      .replace(/\\\\/g, '\\');

    let ruby = '';
    try {
      ruby = execFileSync('ruby', ['-e', 'print 1'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch { /* ruby absent */ }

    if (ruby === '1') {
      const dir = mkdtempSync(join(tmpdir(), 'mageid-podfile-'));
      const rb = join(dir, 'snippet.rb');
      writeFileSync(rb, `post_install do |installer|\n${snippet}\nend\n`);
      let parsed = false;
      let why = '';
      try {
        execFileSync('ruby', ['-c', rb], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        parsed = true;
      } catch (e: unknown) {
        why = String((e as { stderr?: Buffer }).stderr ?? e).split('\n')[0];
      }
      ok('the injected Podfile block parses as Ruby', parsed,
        why || 'CocoaPods evaluates the Podfile as Ruby; a syntax error fails "Install pods" on EAS only');
    } else {
      // No ruby: fall back to the specific defect — a replacement string that
      // opens a quote and never closes it before the line ends.
      const bad = snippet
        .split('\n')
        .some((l) => /^\s*'bash -l -c/.test(l) && !/'\s*$/.test(l));
      ok('the injected Podfile replacement string is closed (ruby not installed — textual check)', !bad,
        "an unterminated Ruby literal fails `pod install` on EAS while every local build keeps working");
    }
  }
}

// ── the postinstall script must be PORTABLE ─────────────────────────────────
// It runs on every `bun install`, including Linux CI and the Netlify build
// image. The first version used `sed -i ''` (BSD-only) under `set -e`: GNU sed
// exits non-zero, `set -e` propagated it, and Netlify's "Install dependencies"
// stage failed before the build command ran — every app.mageid.app deploy from
// 2026-09-06 on. A macOS-only convenience must never fail an install on a
// machine that will never build iOS.
{
  const shPath = join(ROOT, 'scripts/patch-ios-space-paths.sh');
  const sh = existsSync(shPath) ? readFileSync(shPath, 'utf8') : '';
  const code = sh.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');

  ok('patch script does not use BSD-only `sed -i`',
    !/\bsed\s+-i\b/.test(code),
    "`sed -i ''` is BSD syntax; GNU sed exits non-zero and fails the install");
  ok('patch script does not use `set -e`',
    !/^\s*set\s+-e\s*$/m.test(code),
    'any failure inside a postinstall must be a no-op, never a failed install');
  ok('patch script ends with an explicit exit 0',
    /\bexit 0\s*$/.test(code.trimEnd()),
    'postinstall must always succeed');
}

if (failed > 0) {
  console.error(`\n✗ validate-ios-space-paths: ${failed} failure(s)`);
  console.error('  A space in the checkout path must not produce a green build that crashes.\n');
  process.exit(1);
}
console.log('\nios space-path safety: all checks passed');

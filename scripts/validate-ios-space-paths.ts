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

// ── every path on the line, the way the build really leaves it ─────────────
// 2026-10-09. A local build failed in "Bundle React Native code and images"
// with the plugin in place. The generated project read (SENTRY_LEFT below):
//   /bin/sh `"$NODE_BINARY" --print "… sentry-xcode.sh'"` "'$("$NODE_BINARY" --print "… react-native-xcode.sh'")'"
// The second path was quoted, the FIRST was a bare backtick. Config mods run
// last-listed-first, so this plugin (listed after Sentry) ran BEFORE Sentry put
// its own path in front. The plugin now also quotes the finished project file
// in a finalized mod, which runs after every other mod whatever the order.
{
  const SENTRY_LEFT =
    `/bin/sh \`"$NODE_BINARY" --print "a + '/scripts/sentry-xcode.sh'"\`` +
    ` "'$("$NODE_BINARY" --print "b + '/scripts/react-native-xcode.sh'")'"`;
  const UPLOAD_LEFT = `/bin/sh \`\${NODE_BINARY:-node} --print "a + '/scripts/sentry-xcode-debug-files.sh'"\``;
  const pbxOf = (...scripts: string[]) => scripts.map((x) => `\t\t\tshellScript = ${JSON.stringify(x)};`).join('\n');
  const scriptsOf = (pbx: string): string[] =>
    [...pbx.matchAll(/^\s*shellScript = (".*");$/gm)].map((m) => JSON.parse(m[1]) as string);
  /** The words on a line that are a path worked out by node, and whether each sits inside double quotes. */
  const everyPathQuoted = (quoteProject: (pbx: string) => string): string[] => {
    const out: string[] = [];
    for (const script of scriptsOf(quoteProject(pbxOf(`echo first\n${SENTRY_LEFT}\n`, UPLOAD_LEFT)))) {
      out.push(...plugin.unquotedPathSubstitutions(script));
      // Said a second way, with no help from the plugin: no backtick is left, and
      // every `$(` on a --print line sits straight after a double quote.
      for (const line of script.split('\n')) {
        if (!line.includes('--print')) continue;
        if (line.includes('`')) out.push(`backtick left: ${line}`);
        const subs = line.match(/.{0,2}\$\(/g) ?? [];
        for (const sub of subs) if (!/"'?\$\($/.test(sub)) out.push(`bare $(: ${line}`);
      }
    }
    return out;
  };
  const real = everyPathQuoted(plugin.quoteProjectShellScripts);
  ok('EVERY path on the bundle line is quoted, the first one too (the line Sentry leaves behind)', real.length === 0, real[0]);
  const after = plugin.quoteProjectShellScripts(pbxOf(SENTRY_LEFT));
  ok('…the first path is "$( … sentry-xcode.sh … )" and the second keeps its single quotes',
    scriptsOf(after)[0].startsWith(`/bin/sh "$("$NODE_BINARY" --print "a + '/scripts/sentry-xcode.sh'")" "'$(`) && scriptsOf(after)[0].endsWith(`)'"`),
    scriptsOf(after)[0]);
  ok('…and a second pass over the project file changes nothing', plugin.quoteProjectShellScripts(after) === after);
  ok('…a script that names no helper script is left alone, backticks and all',
    plugin.quoteProjectShellScripts(pbxOf('echo `date`')) === pbxOf('echo `date`'));
  // PLANTED: the plugin as it behaved before (the first path left as Sentry wrote it). The check above must go red.
  const FIRST_QUOTED = `"$("$NODE_BINARY" --print "a + '/scripts/sentry-xcode.sh'")"`;
  const onScripts = (pbx: string, fn: (script: string) => string): string => pbxOf(...scriptsOf(plugin.quoteProjectShellScripts(pbx)).map(fn));
  const leavesFirstBare = (pbx: string): string =>
    onScripts(pbx, (x) => x.replace(FIRST_QUOTED, `\`"$NODE_BINARY" --print "a + '/scripts/sentry-xcode.sh'"\``));
  ok('planted: a plugin that leaves the FIRST path unquoted turns that check red',
    leavesFirstBare(pbxOf(SENTRY_LEFT)) !== plugin.quoteProjectShellScripts(pbxOf(SENTRY_LEFT)) && everyPathQuoted(leavesFirstBare).length > 0,
    'the planted break was not caught, or was not planted');
  // PLANTED: the same break written with $( ) and no quotes round it.
  const bareDollar = (pbx: string): string => onScripts(pbx, (x) => x.replace(FIRST_QUOTED, FIRST_QUOTED.slice(1, -1)));
  ok('planted: a bare $( … ) round the first path turns it red too',
    bareDollar(pbxOf(SENTRY_LEFT)) !== plugin.quoteProjectShellScripts(pbxOf(SENTRY_LEFT)) && everyPathQuoted(bareDollar).length > 0);
  const pluginSrc = readFileSync(join(ROOT, 'plugins/withQuotedXcodeScriptPaths.js'), 'utf8');
  ok('the quoting runs in a finalized mod, after every other plugin (order in app.json cannot undo it)',
    /withFinalizedMod\(config, \[\s*'ios'/.test(pluginSrc) && /withQuotedFinalProject\(/.test(pluginSrc.split('const withQuotedXcodeScriptPaths = config =>')[1] ?? ''));
}

// ── a config with NO Sentry plugin: the path is the command itself ─────────
// 2026-10-09, review. With no Sentry plugin the template's bundle line is the
// substitution alone (TEMPLATE below): the path node prints IS the command.
// The plugin used to single-quote it as it does the argument to
// sentry-xcode.sh, leaving  "'$( … )'"  : a command named with a literal quote
// at each end, which no shell can find. Both lines are RUN here, under
// /bin/sh, from a folder with a space in its name.
{
  const TEMPLATE = `\`"$NODE_BINARY" --print "require('path').dirname(require.resolve('react-native/package.json')) + '/scripts/react-native-xcode.sh'"\`\n`;
  const noSentry = plugin.quoteScriptPaths(TEMPLATE) as string;
  ok('with no Sentry plugin the bundle line is the path quoted ONCE: "$( … )", no single quotes round it',
    noSentry.startsWith('"$("$NODE_BINARY" --print ') && noSentry.trimEnd().endsWith(`react-native-xcode.sh'")"`) && !noSentry.includes(`"'$(`) && !noSentry.includes('`'),
    noSentry);
  ok('…every path on it is quoted, and a second pass changes nothing',
    plugin.unquotedPathSubstitutions(noSentry).length === 0 && plugin.quoteScriptPaths(noSentry) === noSentry);
  ok('…the withXcodeProject pass and the project-file pass agree on it',
    plugin.singleQuoteReactNativeXcodeArg(plugin.quoteBacktickSubstitutions(TEMPLATE)) === noSentry
    && JSON.parse((plugin.quoteProjectShellScripts(`\t\t\tshellScript = ${JSON.stringify(TEMPLATE)};`).match(/shellScript = (".*");/) ?? [])[1] ?? '""') === noSentry);
  // Run it. A stand-in for node prints a path inside a folder with a space; the script there says it ran.
  const dir = join(mkdtempSync(join(tmpdir(), 'mage space path ')), 'MAGE ID - CLAUDE', 'scripts');
  execFileSync('/bin/mkdir', ['-p', dir]);
  const mark = (name: string) => `#!/bin/sh\necho "ran ${name} with $# argument(s)"\n[ $# -eq 0 ] || /bin/sh -c "$1"\n`;
  for (const name of ['react-native-xcode.sh', 'sentry-xcode.sh']) writeFileSync(join(dir, name), mark(name), { mode: 0o755 });
  // The stand-in: `fake-node --print "<expression>"` prints the folder plus the script the expression names.
  const fakeNode = join(dir, 'fake node');
  writeFileSync(fakeNode, `#!/bin/sh\ncase "$2" in\n  *sentry-xcode.sh*) echo "${dir}/sentry-xcode.sh" ;;\n  *) echo "${dir}/react-native-xcode.sh" ;;\nesac\n`, { mode: 0o755 });
  const run = (line: string): { out: string; okExit: boolean } => {
    try { return { out: String(execFileSync('/bin/sh', ['-c', line], { env: { ...process.env, PATH: '/usr/bin:/bin', NODE_BINARY: fakeNode }, stdio: ['ignore', 'pipe', 'pipe'] })), okExit: true }; }
    catch (e) { return { out: String((e as { stderr?: unknown }).stderr ?? e), okExit: false }; }
  };
  const ranPlain = run(noSentry);
  ok('RUN from a folder with a space: the no-Sentry line is a command the shell finds, and it runs react-native-xcode.sh',
    ranPlain.okExit && ranPlain.out.trim() === 'ran react-native-xcode.sh with 0 argument(s)', ranPlain.out.trim().slice(0, 300));
  const withSentry = plugin.quoteScriptPaths(
    `/bin/sh \`"$NODE_BINARY" --print "a + '/scripts/sentry-xcode.sh'"\` \`"$NODE_BINARY" --print "b + '/scripts/react-native-xcode.sh'"\`\n`) as string;
  const ranSentry = run(withSentry);
  ok('RUN from a folder with a space: the Sentry line runs sentry-xcode.sh, and its `sh -c` re-parse still finds react-native-xcode.sh',
    ranSentry.okExit && ranSentry.out.trim() === 'ran sentry-xcode.sh with 1 argument(s)\nran react-native-xcode.sh with 0 argument(s)', ranSentry.out.trim().slice(0, 300));
  // PLANTED: the old behaviour (single quotes whether or not Sentry is in front). The run must fail.
  const old = noSentry.replace(/^"(\$\(.*\))"$/m, `"'$1'"`);
  const ranOld = run(old);
  ok('planted: single-quoting the no-Sentry path (the old behaviour) is not a command, and the run check goes red',
    old !== noSentry && old.startsWith(`"'$(`) && !ranOld.okExit, `exit ok: ${ranOld.okExit}; ${ranOld.out.trim().slice(0, 200)}`);
  // PLANTED: the template's own bare backticks, from the same folder: word-split at the space.
  ok('planted: the template line as written, unquoted, dies at the space', !run(TEMPLATE).okExit);
  // PLANTED the other way: without the single quotes, the Sentry line's second parse loses the path at the space.
  const ranBare = run(withSentry.replace(`"'$(`, '"$(').replace(`)'"`, ')"'));
  ok('planted: the Sentry line with no single quotes round its argument dies in the `sh -c` re-parse',
    !ranBare.okExit || !ranBare.out.includes('ran react-native-xcode.sh'), ranBare.out.trim().slice(0, 200));
}

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

// ── The OUTPUT, not just the patcher ───────────────────────────────────────
//
// Every check above reads the patch SCRIPT and the plugin SOURCE. None of them
// read what those actually produce, and on 2026-09-10 that gap cost a whole
// build: `ios/MAGEID.xcodeproj/project.pbxproj` still contained
//
//     /bin/sh `"$NODE_BINARY" --print "… sentry-xcode.sh"`
//
// an UNQUOTED backtick substitution, so a checkout at
// "/Users/<user>/Desktop/MAGE ID - CLAUDE" word-split and the phase died with
//     /bin/sh: /Users/<user>/Desktop/MAGE: No such file or directory
// before a single framework was embedded. The app installed and then crashed on
// launch with "Library not loaded: @rpath/React.framework/React".
//
// plugins/withQuotedXcodeScriptPaths.js is written correctly and IS listed after
// "@sentry/react-native/expo" in app.json — but Expo mods compose as a chain
// rather than running in array order, so Sentry re-injected its wrapper after
// the quoter had already run. A guard that only reads the patcher cannot see
// that; one that reads the GENERATED project can.
//
// Skipped entirely when ios/ is absent — it is gitignored and regenerated by
// prebuild, so CI and a fresh clone legitimately have no project to inspect.
// This is a check that only bites on the machine that actually builds.
{
  const pbxPath = join(ROOT, 'ios', 'MAGEID.xcodeproj', 'project.pbxproj');
  if (!existsSync(pbxPath)) {
    console.log('  ·  ios/ not generated — skipping the generated-project check');
  } else {
    const pbx = readFileSync(pbxPath, 'utf8');
    const bare = [...pbx.matchAll(/^\s*shellScript = (".*");$/gm)].flatMap((m) => {
      try { return plugin.unquotedPathSubstitutions(JSON.parse(m[1]) as string) as string[]; } catch { return []; }
    });
    ok('the GENERATED Xcode project quotes every path its script lines work out',
      bare.length === 0,
      `${bare.length} line(s) in ios/MAGEID.xcodeproj/project.pbxproj still carry an unquoted path: ${bare[0] ?? ''}`);
    const backticks = pbx.match(/\/bin\/sh `/g) ?? [];
    ok('the GENERATED Xcode project has no unquoted `/bin/sh \`…\`` substitution',
      backticks.length === 0,
      `${backticks.length} found in ios/MAGEID.xcodeproj/project.pbxproj. A backtick ` +
      'substitution is re-split by the shell, so any checkout path containing a space ' +
      'dies mid-build. Re-run prebuild; if it comes back, the quoting plugin is being ' +
      'overwritten by a plugin that runs after it.');
  }
}

if (failed > 0) {
  console.error(`\n✗ validate-ios-space-paths: ${failed} failure(s)`);
  console.error('  A space in the checkout path must not produce a green build that crashes.\n');
  process.exit(1);
}
console.log('\nios space-path safety: all checks passed');

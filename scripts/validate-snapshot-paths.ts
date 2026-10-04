// validate-snapshot-paths.ts — a stored golden never carries the path of the
// machine, or the worktree, that recorded it.
//
// WHY. On 2026-10-03 main went red on GitHub CI (run 37138504488, commit
// 0890777b) in exactly six goldens: desktop-page-frame /signup, slick3-front-door
// (a)–(d), slick3-first-run (b). The login-ui wave had re-recorded them inside an
// agent worktree, and every one of them had absorbed that worktree's absolute
// path through the auth logo's image source:
//   "testUri": "../../../../../../../private/tmp/claude-501/login-ui/assets/images/brand/mage-mark-on-dark.png"
// They passed in that one folder and nowhere else. Five of the six store only a
// line count and a sha256 of the dump, so the path was not even visible in the
// diff a reviewer reads.
//
// ROOT CAUSE. jest-expo inherits React Native's asset transformer, which turns
// `require('x.png')` into `{ testUri: path.relative(<react-native's install
// dir>, file) }`. In a checkout with a real node_modules that is a tidy
// `../../../assets/...`; in a worktree whose node_modules is a symlink to the
// main checkout it climbs out to the filesystem root and names the worktree.
//
// THE FIX, AND WHAT THIS GUARDS. jest.config.js now routes image requires
// through __tests__/setup/asset-transformer.js, which names an asset by where it
// lives in the PROJECT (`<rootDir>/assets/...`, `<node_modules>/pkg/...`). This
// validator holds all three parts in place:
//   1. no stored .snap under __tests__/ contains a machine path — the visible
//      half (it cannot see inside a sha256, which is why 2 and 3 exist);
//   2. both jest configs (native smoke, web) send every image extension to that
//      transformer first, ahead of the preset's stock one;
//   3. the transformer's output is identical across checkout layouts — main
//      checkout, agent worktree with a symlinked node_modules, CI runner,
//      Windows separators, hoisted vs nested packages — and never holds a
//      machine path. That is what keeps the HASHED goldens honest.
// --self-test plants each failure mode and requires it to be caught.
//
// Run: bun run scripts/validate-snapshot-paths.ts [--self-test]

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(import.meta.url);

type Check = { name: string; ok: boolean; detail?: string };

// ── 1. The stored snapshots ────────────────────────────────────────────────
// A fragment that only a particular disk produces. `(../){4,}` is the stock RN
// transformer's escape out of a checkout (seven levels, in the login-ui case);
// a repo-relative id never climbs at all.
const MACHINE_PATH: { label: string; re: RegExp }[] = [
  { label: '/private/tmp/', re: /\/private\/tmp\// },
  { label: '/private/var/', re: /\/private\/var\// },
  { label: '/var/folders/', re: /\/var\/folders\// },
  { label: '/Users/', re: /\/Users\// },
  { label: '/home/<user>/', re: /(?:^|[\s"'`=(:])\/home\/[^/\s"'`]+\// },
  { label: 'claude-501', re: /claude-501/ },
  { label: 'a relative path climbing 4+ levels', re: /(?:\.\.\/){4,}/ },
  { label: 'a Windows drive path', re: /\b[A-Za-z]:(?:\\\\|\/)[A-Za-z_.]/ },
];

const SNAP_DIR = '__tests__/smoke/__snapshots__';
// A floor, not an equality: today there are 47 files here. If the scan ever
// finds a handful, the folder moved and this check went vacuous.
const SNAP_FLOOR = 20;

function walkSnaps(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkSnaps(p, out);
    else if (name.endsWith('.snap')) out.push(p);
  }
  return out;
}

function checkSnapshots(snaps: Record<string, string>): Check[] {
  const checks: Check[] = [];
  const files = Object.keys(snaps);
  const inSmoke = files.filter(f => f.startsWith(`${SNAP_DIR}/`)).length;
  checks.push({
    name: `the scan reaches the smoke goldens (${inSmoke} .snap in ${SNAP_DIR}, floor ${SNAP_FLOOR})`,
    ok: inSmoke >= SNAP_FLOOR,
    detail: `found ${inSmoke}; a scan of almost nothing passes by default.`,
  });
  const hits: string[] = [];
  for (const f of files) {
    const lines = snaps[f].split('\n');
    lines.forEach((line, i) => {
      for (const { label, re } of MACHINE_PATH) {
        if (re.test(line)) hits.push(`${f}:${i + 1} [${label}] ${line.trim().slice(0, 160)}`);
      }
    });
  }
  checks.push({
    name: `no stored snapshot carries a machine path (${files.length} .snap files scanned)`,
    ok: hits.length === 0,
    detail: `${hits.slice(0, 12).join('\n      ')}${hits.length > 12 ? `\n      … and ${hits.length - 12} more` : ''}\n` +
      `      A golden that names a disk passes only on that disk. Fix the source of the path (see ` +
      `__tests__/setup/asset-transformer.js), then re-record and prove the delta is path-only.`,
  });
  return checks;
}

// ── 2. Both jest configs route images to the stable transformer ────────────
const TRANSFORMER = '<rootDir>/__tests__/setup/asset-transformer.js';
// Every extension the stock RN transformer claims (it is the one that emitted
// testUri). jest-expo's own asset transformer emits a bare `1` for the rest.
const IMAGE_EXTS = ['bmp', 'gif', 'jpg', 'jpeg', 'mp4', 'png', 'psd', 'svg', 'webp'];

type JestLike = { transform?: Record<string, unknown> };

function firstTransformFor(cfg: JestLike, file: string): string | null {
  // jest merges a preset's `transform` UNDER the config's own keys (config keys
  // first), and ScriptTransformer takes the first pattern that matches. So the
  // first matching key in the config's own map is the one that runs.
  for (const [pattern, value] of Object.entries(cfg.transform ?? {})) {
    if (new RegExp(pattern).test(file)) return Array.isArray(value) ? String(value[0]) : String(value);
  }
  return null;
}

function checkConfigs(configs: Record<string, JestLike>): Check[] {
  const checks: Check[] = [];
  for (const [name, cfg] of Object.entries(configs)) {
    const wrong = IMAGE_EXTS
      .map(ext => ({ ext, got: firstTransformFor(cfg, `/x/assets/a.${ext}`) }))
      .filter(({ got }) => got !== TRANSFORMER);
    checks.push({
      name: `${name} sends every image extension to the stable asset transformer`,
      ok: wrong.length === 0,
      detail: wrong.map(({ ext, got }) => `.${ext} → ${got ?? '(no config entry: the preset\'s stock RN transformer runs, which writes the install path)'}`).join('\n      '),
    });
  }
  return checks;
}

// ── 3. The transformer's output does not depend on the checkout ────────────
type Transformer = { process: (src: string, filename: string, options: { config: { rootDir: string } }) => { code: string } };

const REPO_ASSET = 'assets/images/brand/mage-mark-on-dark.png';
const PKG_ASSET = '@react-navigation/elements/lib/module/assets/back-icon.png';
// The layouts this repo is actually run in. The worktree rows are the ones that
// broke: jest resolves through the node_modules symlink, so a package asset's
// filename is the MAIN checkout's real path while rootDir is the worktree.
const MAIN = '/Users/dev/Desktop/MAGE ID - CLAUDE';
const LAYOUTS: { name: string; rootDir: string; repoFile: string; pkgFile: string }[] = [
  { name: 'main checkout', rootDir: MAIN, repoFile: `${MAIN}/${REPO_ASSET}`, pkgFile: `${MAIN}/node_modules/${PKG_ASSET}` },
  { name: 'agent worktree, symlinked node_modules', rootDir: '/private/tmp/claude-501/login-ui', repoFile: `/private/tmp/claude-501/login-ui/${REPO_ASSET}`, pkgFile: `${MAIN}/node_modules/${PKG_ASSET}` },
  { name: 'nested .claude worktree', rootDir: `${MAIN}/.claude/worktrees/abc123`, repoFile: `${MAIN}/.claude/worktrees/abc123/${REPO_ASSET}`, pkgFile: `${MAIN}/node_modules/${PKG_ASSET}` },
  { name: 'GitHub CI runner', rootDir: '/home/runner/work/mage-id/mage-id', repoFile: `/home/runner/work/mage-id/mage-id/${REPO_ASSET}`, pkgFile: `/home/runner/work/mage-id/mage-id/node_modules/${PKG_ASSET}` },
  { name: 'nested (non-hoisted) package install', rootDir: '/srv/app', repoFile: `/srv/app/${REPO_ASSET}`, pkgFile: `/srv/app/node_modules/expo-router/node_modules/${PKG_ASSET}` },
  { name: 'Windows separators', rootDir: 'C:\\a\\mage', repoFile: `C:\\a\\mage\\${REPO_ASSET.replace(/\//g, '\\')}`, pkgFile: `C:\\a\\mage\\node_modules\\${PKG_ASSET.replace(/\//g, '\\')}` },
];

function machinePathIn(s: string): string | null {
  for (const { label, re } of MACHINE_PATH) if (re.test(s)) return label;
  if (/(?:^|["'\s])\//.test(s.replace(/<[a-z_A-Z-]+>\//g, ''))) return 'an absolute path';
  return null;
}

function checkTransformer(t: Transformer): Check[] {
  const checks: Check[] = [];
  for (const [kind, pick] of [['a repo asset', 'repoFile'], ['a package asset', 'pkgFile']] as const) {
    const outs = LAYOUTS.map(l => {
      try { return { l, code: t.process('', l[pick], { config: { rootDir: l.rootDir } }).code }; }
      catch (e) { return { l, code: `THREW ${String(e)}` }; }
    });
    const distinct = [...new Set(outs.map(o => o.code))];
    checks.push({
      name: `${kind} transforms to the same module in all ${LAYOUTS.length} checkout layouts`,
      ok: distinct.length === 1,
      detail: outs.map(o => `${o.l.name}: ${o.code}`).join('\n      '),
    });
    const dirty = outs.map(o => ({ o, why: machinePathIn(o.code) })).filter(x => x.why);
    checks.push({
      name: `${kind}'s id never carries a machine path`,
      ok: dirty.length === 0,
      detail: dirty.map(({ o, why }) => `${o.l.name} [${why}]: ${o.code}`).join('\n      '),
    });
    const want = kind === 'a repo asset' ? `<rootDir>/${REPO_ASSET}` : `<node_modules>/${PKG_ASSET}`;
    checks.push({
      name: `${kind}'s id still names the file (${want})`,
      ok: outs.every(o => o.code.includes(JSON.stringify(want)) && o.code.includes('testUri')),
      detail: `want every output to contain {testUri: ${JSON.stringify(want)}}; got ${distinct.join(' | ')}`,
    });
  }
  return checks;
}

// ── report / self-test / main ──────────────────────────────────────────────
function report(title: string, checks: Check[]): number {
  console.info(`\n${title}`);
  let bad = 0;
  for (const c of checks) {
    console.info(`  ${c.ok ? '✓' : '✗'} ${c.name}${c.ok || !c.detail ? '' : `\n      ${c.detail}`}`);
    if (!c.ok) bad++;
  }
  return bad;
}

function selfTest(configs: Record<string, JestLike>, t: Transformer): number {
  const caught = (checks: Check[]) => checks.some(c => !c.ok);
  // Planted into a CLEAN synthetic set at the floor, so the self-test proves the
  // checks themselves whatever state the real goldens are in today.
  const clean: Record<string, string> = {};
  for (let i = 0; i < SNAP_FLOOR; i++) clean[`${SNAP_DIR}/s${i}.test.tsx.snap`] = 'exports[`s 1`] = `\n<View testID="s" style={{"width":390}}>\n`;\n';
  const plant = (line: string) => ({ ...clean, [`${SNAP_DIR}/s0.test.tsx.snap`]: `${clean[`${SNAP_DIR}/s0.test.tsx.snap`]}${line}\n` });
  const native = configs['jest.config.js'];
  const path = require_('node:path') as typeof import('node:path');
  const stockRn: Transformer = {
    // What react-native/jest/assetFileTransformer.js does, installed at a fixed spot.
    process: (_s, f) => ({ code: `module.exports = { testUri: ${JSON.stringify(path.relative('/Users/dev/Desktop/MAGE ID - CLAUDE/node_modules/react-native/jest', f.replace(/\\/g, '/')))} };` }),
  };
  const mutations: [string, boolean][] = [
    ['the login-ui golden line, verbatim', caught(checkSnapshots(plant('"testUri": "../../../../../../../private/tmp/claude-501/login-ui/assets/images/brand/mage-mark-on-dark.png",')))],
    ['a bare /private/tmp worktree path', caught(checkSnapshots(plant('source={"uri":"/private/tmp/x/assets/a.png"}')))],
    ['a macOS home path', caught(checkSnapshots(plant('"/Users/someone/project/assets/a.png"')))],
    ['a Linux CI home path', caught(checkSnapshots(plant('"/home/runner/work/mage/mage/assets/a.png"')))],
    ['a claude-501 fragment alone', caught(checkSnapshots(plant('recorded in claude-501/login-ui')))],
    ['a Windows drive path, JSON-escaped', caught(checkSnapshots(plant('"testUri": "C:\\\\a\\\\mage\\\\assets\\\\a.png",')))],
    ['a Windows drive path, forward slashes', caught(checkSnapshots(plant('"testUri": "D:/build/mage/assets/a.png",')))],
    ['a deep relative escape with no absolute part', caught(checkSnapshots(plant('"testUri": "../../../../../srv/app/assets/a.png"')))],
    ['NOT flagged: the clean synthetic set itself', !caught(checkSnapshots(clean))],
    ['a scan that found no goldens', caught(checkSnapshots({}))],
    ['a scan that found too few goldens', caught(checkSnapshots(Object.fromEntries(Object.entries(clean).slice(0, SNAP_FLOOR - 1))))],
    ['NOT flagged: a clean <rootDir> id', !caught(checkSnapshots(plant('"testUri": "<rootDir>/assets/images/brand/mage-mark-on-dark.png",')))],
    ['NOT flagged: a package id', !caught(checkSnapshots(plant('"testUri": "<node_modules>/@react-navigation/elements/lib/module/assets/back-icon.png",')))],
    ['the png entry removed from jest.config.js', caught(checkConfigs({ x: { ...native, transform: {} } }))],
    ['jest.config.js without any transform key', caught(checkConfigs({ x: { ...native, transform: undefined } }))],
    ['the stock RN transformer listed ahead of ours', caught(checkConfigs({ x: { transform: { '^.+\\.(png|jpg)$': 'react-native/jest/assetFileTransformer.js', ...(native.transform ?? {}) } } }))],
    ['svg routed elsewhere', caught(checkConfigs({ x: { transform: { '\\.svg$': 'svg-jest', ...(native.transform ?? {}) } } }))],
    ['the stock RN transformer (install-relative path)', caught(checkTransformer(stockRn))],
    ['a transformer that emits the absolute filename', caught(checkTransformer({ process: (_s, f) => ({ code: `module.exports = { testUri: ${JSON.stringify(f)} };` }) }))],
    ['a transformer that names only the basename', caught(checkTransformer({ process: (_s, f) => ({ code: `module.exports = { testUri: ${JSON.stringify(f.split(/[\\/]/).pop())} };` }) }))],
    ['a transformer that throws', caught(checkTransformer({ process: () => { throw new Error('boom'); } }))],
    ['NOT flagged: the real transformer', !caught(checkTransformer(t))],
  ];
  console.info('\nself-test (each planted failure must be caught; NOT rows must stay clean)');
  let bad = 0;
  for (const [name, ok] of mutations) {
    console.info(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}`);
    if (!ok) bad++;
  }
  return bad;
}

const snaps: Record<string, string> = {};
for (const f of walkSnaps(join(ROOT, '__tests__'))) snaps[relative(ROOT, f).replace(/\\/g, '/')] = readFileSync(f, 'utf8');

const configs: Record<string, JestLike> = {
  'jest.config.js': require_(join(ROOT, 'jest.config.js')) as JestLike,
  '__tests__/web/jest.web.config.js': require_(join(ROOT, '__tests__/web/jest.web.config.js')) as JestLike,
};
const transformer = require_(join(ROOT, '__tests__/setup/asset-transformer.js')) as Transformer;

let failed = 0;
console.info('validate-snapshot-paths');
failed += report('1. stored goldens', checkSnapshots(snaps));
failed += report('2. jest configs', checkConfigs(configs));
failed += report('3. the asset transformer', checkTransformer(transformer));
if (process.argv.includes('--self-test')) failed += selfTest(configs, transformer);
console.info(`\n${failed === 0 ? 'PASS' : `FAIL (${failed})`}`);
if (failed > 0) process.exit(1);

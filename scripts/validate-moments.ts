// validate-moments.ts: the commit moments' guard (moments wave, lanes CAPSULE + SIGNLINE).
//
//   bun run scripts/validate-moments.ts        (package.json: test:moments)
//
// The founder asked for slide-to-complete and signing to be "very nice and
// animation heavy". The approved design (morph: one shape, never cut) is only
// premium while its rules hold: springs inside ζ [0.75, 1.05], transform and
// opacity on the native driver, success ONLY on a confirmed write, a legal
// record never queued, an unknown outcome that never claims "nothing was
// saved", sentence-case copy with no em dash and cents on every amount.
//
// This file is only the RUNNER. Each lane owns one check module in
// scripts/moments-checks/*.ts, each exporting
//   export default function run(ctx: MomentsCtx): void | Promise<void>
// The runner imports every module in that folder and hands it the shared
// helpers below; check modules never import each other.
//
// Discovery: EVERY *.ts module directly in scripts/moments-checks/ is run
// (W2/W3 lanes add signing-sites, money-sites, field-sites, portal: they are
// picked up with no change here). Required modules: capsule, signline, and
// Step 0's adapters, step0, rules. A missing one FAILS, unless
// MOMENTS_PARTIAL=1 (a lane's own run while another lane is still building);
// the orchestrator's gate runs without the flag. Helpers a module needs live
// in a sub-folder (scripts/moments-checks/<name>/), which is never run.
//
// Text-only reads for anything that imports react-native (bun cannot load
// it); the pure utils (utils/moments/*) are imported and executed for real.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '..');
const REQUIRED = ['capsule', 'signline', 'adapters', 'step0', 'rules'];

export interface MomentsCtx {
  ok(name: string, cond: boolean, detail?: string): void;
  read(rel: string): string;
  stripComments(src: string): string;
  listFiles(dir: string, exts: string[]): string[];
  root: string;
}

let failures = 0;

export function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) { console.log('  PASS  ' + name); return; }
  failures += 1;
  console.log('  FAIL  ' + name + (detail ? '\n        ' + detail.split('\n').join('\n        ') : ''));
}

/** A repo-relative file's text, or '' when it does not exist. */
export function read(rel: string): string {
  try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return ''; }
}

/** Blank out // and /* *\/ comments (strings kept, newlines kept). The validate-motion tokenizer. */
export function stripComments(src: string): string {
  const out = src.split('');
  let i = 0;
  type Mode = 'code' | 'line' | 'block' | 'sq' | 'dq' | 'tpl';
  let mode: Mode = 'code';
  const blank = (at: number) => { if (out[at] !== '\n') out[at] = ' '; };
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (mode === 'code') {
      if (two === '//') { mode = 'line'; blank(i); blank(i + 1); i += 2; continue; }
      if (two === '/*') { mode = 'block'; blank(i); blank(i + 1); i += 2; continue; }
      if (src[i] === "'") mode = 'sq';
      else if (src[i] === '"') mode = 'dq';
      else if (src[i] === '`') mode = 'tpl';
      i++; continue;
    }
    if (mode === 'line') {
      if (src[i] === '\n') { mode = 'code'; i++; continue; }
      blank(i); i++; continue;
    }
    if (mode === 'block') {
      if (two === '*/') { mode = 'code'; blank(i); blank(i + 1); i += 2; continue; }
      blank(i); i++; continue;
    }
    if (src[i] === '\\') { i += 2; continue; }
    if ((mode === 'sq' && src[i] === "'") || (mode === 'dq' && src[i] === '"') || (mode === 'tpl' && src[i] === '`')) mode = 'code';
    else if ((mode === 'sq' || mode === 'dq') && src[i] === '\n') mode = 'code';
    i++;
  }
  return out.join('');
}

/** Every file under a repo-relative dir with one of `exts` (e.g. ['.ts', '.tsx']), as repo-relative posix paths. */
export function listFiles(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  const walk = (abs: string) => {
    let entries: string[] = [];
    try { entries = readdirSync(abs); } catch { return; }
    for (const e of entries.sort()) {
      if (e === 'node_modules' || e.startsWith('.')) continue;
      const p = join(abs, e);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p);
      else if (exts.some((x) => e.endsWith(x)) && !e.endsWith('.d.ts')) out.push(relative(ROOT, p).split(sep).join('/'));
    }
  };
  walk(join(ROOT, dir));
  return out;
}

async function main(): Promise<void> {
  console.log('validate-moments');
  const dir = join(ROOT, 'scripts', 'moments-checks');
  let files: string[] = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.ts')).sort(); } catch { files = []; }
  const names = files.map((f) => f.replace(/\.ts$/, ''));
  const partial = process.env.MOMENTS_PARTIAL === '1';
  for (const req of REQUIRED) {
    if (!names.includes(req) && partial) { console.log(`  SKIP  scripts/moments-checks/${req}.ts (MOMENTS_PARTIAL=1)`); continue; }
    ok(`scripts/moments-checks/${req}.ts is present`, names.includes(req),
      'Each lane owns one check module; the gate runs without MOMENTS_PARTIAL.');
  }
  const ctx: MomentsCtx = { ok, read, stripComments, listFiles, root: ROOT };
  for (const f of files) {
    console.log(`\n[moments-checks/${f}]`);
    try {
      const mod = await import(pathToFileURL(join(dir, f)).href);
      if (typeof mod.default !== 'function') { ok(`${f} exports a default run(ctx)`, false); continue; }
      await mod.default(ctx);
    } catch (e) {
      ok(`${f} ran without throwing`, false, String((e as Error)?.stack ?? e));
    }
  }
  console.log(failures ? `\nvalidate-moments: ${failures} FAIL` : '\nvalidate-moments: all PASS');
  process.exit(failures ? 1 : 0);
}

// Run only as the entry point (a check module importing a TYPE from here must not re-run it).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}

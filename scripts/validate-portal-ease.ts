// validate-portal-ease.ts — lane PORTALEASE's guard.
//
//   bun run scripts/validate-portal-ease.ts        (package.json: test:portal-ease)
//
// The client portal (marketing/portal/index.html) is excluded from
// validate-marketing-motion's page list, so its motion is held here:
//
//   PE1 no overshoot curve: validate-marketing-motion's own cssMotionProblems,
//       run on every <style> block of the page, reports zero V6 problems;
//   PE2 one prefers-reduced-motion: reduce block sets `animation: none` on all
//       four selectors that used the overshoot curve (.activity-react.pulse,
//       .gantt-milestone, .confirm-card, .esign-card);
//   PE3 @keyframes heartPulse never scales past the kit's pushMax (1.06).
//
// MUTATION PROOF: set PORTAL_EASE_MUT_DIR to a directory that mirrors repo
// paths; a file found there is read INSTEAD of the repo copy.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cssMotionProblems, parseCss } from './validate-marketing-motion';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MUT = process.env.PORTAL_EASE_MUT_DIR;
const PAGE = 'marketing/portal/index.html';
const PUSH_MAX = 1.06;
const REDUCE_SELECTORS = ['.activity-react.pulse', '.gantt-milestone', '.confirm-card', '.esign-card'];

function read(rel: string): string {
  if (MUT && existsSync(join(MUT, rel))) return readFileSync(join(MUT, rel), 'utf8');
  try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return ''; }
}

function lineAt(text: string, idx: number): number {
  let n = 1;
  for (let i = 0; i < idx && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/** Each <style> body with the page line its body starts on. */
export function styleBlocks(html: string): { css: string; baseLine: number }[] {
  const out: { css: string; baseLine: number }[] = [];
  const stripped = html.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' '));
  for (const m of stripped.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    const bodyStart = (m.index || 0) + m[0].indexOf('>') + 1;
    out.push({ css: m[1], baseLine: lineAt(stripped, bodyStart) - 1 });
  }
  return out;
}

export function portalEaseProblems(html: string): { pass: string[]; fail: string[] } {
  const pass: string[] = [], fail: string[] = [];
  const blocks = styleBlocks(html);
  if (!blocks.length) { fail.push(`P0 ${PAGE} has no <style> block`); return { pass, fail }; }

  // PE1 — no overshoot curve (V6 from the site's own rule)
  const v6 = blocks.flatMap(b => cssMotionProblems(b.css, PAGE, { baseLine: b.baseLine }).filter(p => p.startsWith('V6')));
  if (v6.length) fail.push(...v6.map(p => `PE1 ${p}`));
  else pass.push(`PE1 no overshoot cubic-bezier in ${blocks.length} <style> block(s)`);

  // PE2 — the reduce block turns the four animations off, and wins the cascade:
  // a media query adds no specificity, so the override must be !important or
  // come after every plain rule that animates the same selector.
  const sels = (sel: string) => sel.split(',').map(s => s.trim().replace(/\s+/g, ' '));
  const isAnim = (prop: string) => prop === 'animation' || prop === 'animation-name';
  const off = new Map<string, { line: number; important: boolean }>();
  const lastAnim = new Map<string, number>();
  for (const b of blocks) {
    for (const r of parseCss(b.css, b.baseLine).rules) {
      const reduce = r.ctx.some(c => /prefers-reduced-motion\s*:\s*reduce/.test(c));
      for (const d of r.decls) {
        if (!isAnim(d.prop)) continue;
        if (reduce && /^none\b/i.test(d.value)) {
          for (const s of sels(r.sel)) off.set(s, { line: r.line, important: /!important\s*$/i.test(d.value) });
        } else if (!reduce && !/^none\b/i.test(d.value)) {
          for (const s of sels(r.sel)) lastAnim.set(s, Math.max(lastAnim.get(s) || 0, r.line));
        }
      }
    }
  }
  const missing = REDUCE_SELECTORS.filter(s => !off.has(s));
  const losing = REDUCE_SELECTORS.filter(s => {
    const o = off.get(s);
    return o && !o.important && (lastAnim.get(s) || 0) > o.line;
  });
  if (missing.length) fail.push(`PE2 prefers-reduced-motion: reduce does not set animation:none on ${missing.join(', ')}`);
  else if (losing.length) fail.push(`PE2 the reduce override loses the cascade (a later rule re-animates, no !important) for ${losing.join(', ')}`);
  else pass.push(`PE2 reduce block sets animation:none on ${REDUCE_SELECTORS.join(', ')} and wins the cascade`);

  // PE3 — heartPulse stays within pushMax
  const kfs = blocks.flatMap(b => parseCss(b.css, b.baseLine).keyframes.filter(k => k.name === 'heartPulse'));
  if (!kfs.length) fail.push('PE3 @keyframes heartPulse not found');
  else {
    const scales: number[] = [];
    for (const k of kfs) for (const r of k.rules) for (const d of r.decls) {
      if (d.prop !== 'transform') continue;
      for (const m of d.value.matchAll(/scale\(\s*([-\d.]+)/g)) scales.push(parseFloat(m[1]));
    }
    const over = scales.filter(s => !(s <= PUSH_MAX));
    if (!scales.length) fail.push('PE3 @keyframes heartPulse has no scale() stops');
    else if (over.length) fail.push(`PE3 @keyframes heartPulse scales to ${over.join(', ')} (max ${PUSH_MAX})`);
    else pass.push(`PE3 heartPulse peaks at scale(${Math.max(...scales)}) <= ${PUSH_MAX}`);
  }
  return { pass, fail };
}

function main(): number {
  const html = read(PAGE);
  if (!html) { console.error(`FAIL ${PAGE} not found`); return 1; }
  const { pass, fail } = portalEaseProblems(html);
  for (const p of pass) console.log(`PASS ${p}`);
  for (const f of fail) console.error(`FAIL ${f}`);
  console.log(fail.length ? `validate-portal-ease: ${fail.length} problem(s)` : `validate-portal-ease: ${pass.length}/3 checks green`);
  return fail.length ? 1 : 0;
}

if (import.meta.main) process.exit(main());

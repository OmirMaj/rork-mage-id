// Contrast regression guard — pins the two defect CLASSES from
// docs/audits/2026-08-17-web-audit.md, both of which made real text unreadable
// and both of which had already been fixed once somewhere else in the app.
//
// This is a SOURCE-TEXT check. It cannot compute a real contrast ratio — that
// needs a renderer, a composited backdrop and a resolved theme, none of which
// exist in a bun script. What it CAN do is catch the exact textual shapes that
// produced both bugs, which is what actually recurred:
//
//   1. foreground === background.  A status chip / button / card that paints its
//      label in the SAME token as its own fill, e.g.
//
//          case 'sent': return { bg: t.info, text: t.info };
//
//      renders as a featureless coloured blob at contrast 1.00. Found in
//      punch-list.tsx (fixed #134), then again in invoice.tsx, cash-flow.tsx,
//      change-order.tsx, daily-report.tsx and project-detail.tsx. It is a
//      "someone dropped the alpha suffix" typo — `t.danger + '1F'` becoming
//      `t.danger` — and it is invisible in review because both halves read as
//      the right *semantic* colour.
//
//      Legitimate exception: a solid fill with a LITERAL contrasting label
//      ('#FFFFFF' on t.accent) is fine and common. Only fg === bg is flagged.
//
//   2. on-ink hero foregrounds detached from the ink field.  The estimate
//      heroes draw cream (#F4EFE6) type that is only legible because the same
//      View renders <BrandBackdrop />, an opaque #0B0D10 → #14181D gradient.
//      The 2026-08-17 audit read those as 1.08:1 because a computed-style walk
//      sees `background-color` on ancestors and never sees a sibling gradient —
//      so the hero LOOKS like hardcoded light text on a light theme bg. It is
//      not (measured 15.56:1 on the ink), but the coupling was implicit: delete
//      the <BrandBackdrop /> and the text really does vanish, in both themes.
//      Check 2 makes that coupling load-bearing.
//
// Pure node:fs — no bundler, no react-native import (those crash bun).
// fileURLToPath + join because the repo path contains a space.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === 'node_modules') continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.tsx') || name.endsWith('.ts')) out.push(full);
  }
  return out;
}

function collectFiles(dirs: string[]): string[] {
  return dirs.flatMap((d) => walk(join(ROOT, d)));
}

const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/**
 * Blank out comments, preserving offsets and line count.
 *
 * Check 2 asks "does this file RENDER <BrandBackdrop />?", and the files that
 * do also *describe* it in a comment. Without this, a screen that deleted the
 * element but kept the comment explaining it still passed — which is exactly
 * the regression the check exists to catch, so it is not hypothetical.
 */
function stripComments(src: string): string {
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
    // Inside a string: honour escapes, exit on the matching quote.
    if (src[i] === '\\') { i += 2; continue; }
    if ((mode === 'sq' && src[i] === "'") || (mode === 'dq' && src[i] === '"') || (mode === 'tpl' && src[i] === '`')) {
      mode = 'code';
    }
    i++;
  }
  return out.join('');
}

let failures = 0;
function ok(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log('  PASS  ' + name);
    return;
  }
  failures += 1;
  console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : ''));
}

console.log('\ncontrast validation:');

// ── Check 1: no foreground token === background token ───────────────────────
//
// Scoped to a single object literal so that two unrelated StyleSheet entries
// that happen to share a token are not flagged. Both the invoice and punch-list
// bugs, and all four others, are single-literal `{ bg: X, text: X }` shapes or
// adjacent `foo`/`fooText` style pairs (check 1b).

const BG_KEYS = ['backgroundColor', 'bg', 'bgColor', 'background', 'fill', 'chipBg', 'pillBg', 'badgeBg'];
// `ink` is a foreground synonym (label/text colour) — job-costing.tsx's status
// chips destructure `{ fill, ink, mark }`, so without `ink` here a `{ fill: X,
// ink: X }` literal (fg === bg, contrast 1.00) sailed past this check. Verified
// by injecting exactly that and watching this guard still exit 0.
const FG_KEYS = ['color', 'text', 'textColor', 'fg', 'labelColor', 'iconColor', 'chipText', 'ink'];
const KEY_RE = new RegExp(`(?:^|[{,\\s])(${[...BG_KEYS, ...FG_KEYS].join('|')})\\s*:\\s*`, 'g');

/** Read a property value from `src` at `start`, stopping at the top-level `,`. */
function readValue(src: string, start: number): string {
  let depth = 0;
  let end = start;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{' || ch === '(' || ch === '[') depth++;
    else if (ch === '}' || ch === ')' || ch === ']') {
      if (depth === 0) { end = i; break; }
      depth--;
    } else if ((ch === ',' || ch === '\n') && depth === 0) { end = i; break; }
    end = i + 1;
  }
  return src.slice(start, end).trim().replace(/\s+/g, ' ');
}

/** Values that carry no colour meaning, or that are legitimately shared. */
function isInert(v: string): boolean {
  return (
    v === '' ||
    /^(string|any|undefined|null)$/.test(v) ||
    /transparent/.test(v) ||
    // A type annotation (`bg: string;`) rather than a value.
    /^[A-Za-z]+(\s*\|\s*[A-Za-z]+)*;?$/.test(v)
  );
}

type Hit = { file: string; line: number; expr: string; key: string };
const sameTokenHits: Hit[] = [];

for (const file of collectFiles(['app', 'components'])) {
  const src = readFileSync(file, 'utf8');
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== '{') continue;
    // Find this literal's matching close brace.
    let depth = 0;
    let end = -1;
    for (let j = i; j < Math.min(i + 4000, src.length); j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (depth === 0) { end = j; break; } }
    }
    if (end < 0) continue;
    const body = src.slice(i, end + 1);

    // Collect only DEPTH-1 keys — properties of THIS literal, not of a nested one.
    const pairs: { key: string; val: string; at: number }[] = [];
    KEY_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = KEY_RE.exec(body))) {
      let d = 0;
      for (let k = 0; k < m.index; k++) {
        if (body[k] === '{') d++;
        else if (body[k] === '}') d--;
      }
      if (d !== 1) continue;
      const at = m.index + m[0].length;
      pairs.push({ key: m[1], val: readValue(body, at), at });
    }

    for (const p of pairs) {
      if (!BG_KEYS.includes(p.key)) continue;
      if (isInert(p.val)) continue;
      for (const q of pairs) {
        if (!FG_KEYS.includes(q.key) || q.val !== p.val) continue;
        sameTokenHits.push({
          file: relative(ROOT, file),
          line: src.slice(0, i + p.at).split('\n').length,
          expr: p.val,
          key: `${p.key}/${q.key}`,
        });
      }
    }
  }
}

const uniqSame = [...new Map(sameTokenHits.map((h) => [h.file + h.line + h.expr, h])).values()];
ok(
  'no object literal paints a foreground in its own background token',
  uniqSame.length === 0,
  uniqSame
    .map((h) => `${h.file}:${h.line}  ${h.key} = ${h.expr}  — invisible; use a soft fill (X + '1F' / XSoft) with a label foreground`)
    .join('\n        '),
);

// ── Check 1b: adjacent StyleSheet pairs (`foo` fill + `fooText` label) ──────
//
// project-detail.tsx's `deleteButton` / `deleteButtonText`, change-order.tsx's
// `addFromBtn` / `addFromBtnText` and daily-report.tsx's `refreshBtn` /
// `refreshBtnText` are the same bug split across two style entries, which
// check 1 cannot see. The naming convention makes the pairing unambiguous.

const LABEL_SUFFIX = /^(Text|Label|Title|Value|Name|Txt|Sub|Caption)$/;
const pairHits: string[] = [];

for (const file of collectFiles(['app', 'components'])) {
  const src = readFileSync(file, 'utf8');
  const entries = [...src.matchAll(/^\s{2}(\w+):\s*\{/gm)];
  const bgOf = new Map<string, string>();
  const fgOf = new Map<string, string>();
  const lineOf = new Map<string, number>();

  for (const e of entries) {
    const name = e[1];
    const bodyStart = e.index! + e[0].length;
    let depth = 1;
    let bodyEnd = bodyStart;
    for (let j = bodyStart; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (depth === 0) { bodyEnd = j; break; } }
    }
    const body = src.slice(bodyStart, bodyEnd);
    lineOf.set(name, src.slice(0, e.index!).split('\n').length);
    const mbg = /backgroundColor\s*:\s*/.exec(body);
    if (mbg) bgOf.set(name, readValue(body, mbg.index + mbg[0].length));
    const mfg = /(?<!background)(?<![A-Za-z])color\s*:\s*/.exec(body);
    if (mfg) fgOf.set(name, readValue(body, mfg.index + mfg[0].length));
  }

  for (const [container, bgv] of bgOf) {
    if (isInert(bgv)) continue;
    for (const [label, fgv] of fgOf) {
      if (label === container || fgv !== bgv) continue;
      if (!label.startsWith(container)) continue;
      if (!LABEL_SUFFIX.test(label.slice(container.length))) continue;
      pairHits.push(
        `${relative(ROOT, file)}:${lineOf.get(container)}  styles.${container} fill === styles.${label} colour (${bgv})`,
      );
    }
  }
}

ok(
  'no StyleSheet container/label pair shares one colour token',
  pairHits.length === 0,
  pairHits.join('\n        '),
);

// ── Check 2: the on-ink hero palette stays bound to BrandBackdrop ───────────
//
// `OnInk` is only legible on the opaque ink field BrandBackdrop paints. A file
// that uses it without rendering the backdrop is light-on-light in the light
// theme — the exact bug the audit believed it had found.

const backdrop = read('components/BrandBackdrop.tsx');
ok(
  'BrandBackdrop exports the OnInk palette it is contrast-matched against',
  /export const OnInk\b/.test(backdrop) && /title:\s*'#F4EFE6'/.test(backdrop),
  'components/BrandBackdrop.tsx must own the on-ink foregrounds; screens must not re-declare them.',
);

const orphanedOnInk: string[] = [];
for (const file of collectFiles(['app'])) {
  const code = stripComments(readFileSync(file, 'utf8'));
  if (!/\bOnInk\./.test(code)) continue;
  if (/<BrandBackdrop\s*\/>/.test(code)) continue;
  orphanedOnInk.push(relative(ROOT, file));
}
ok(
  'every screen using OnInk also renders <BrandBackdrop />',
  orphanedOnInk.length === 0,
  orphanedOnInk.map((f) => `${f}  uses OnInk.* but paints no ink field — light-on-light in the light theme`).join('\n        '),
);

// The inverse: a hero that renders the backdrop must not colour its own type
// with theme tokens, which invert and go near-black on the ink in light mode.
const themedOnInk: string[] = [];
for (const file of collectFiles(['app'])) {
  const src = stripComments(readFileSync(file, 'utf8'));
  if (!/<BrandBackdrop\s*\/>/.test(src)) continue;
  src.split('\n').forEach((line, i) => {
    if (!/^\s*hero\w*\s*:/.test(line)) return;
    if (/color:\s*(t|c|themeColors|colors)\.(text|textSecondary|textMuted)\b/.test(line)) {
      themedOnInk.push(`${relative(ROOT, file)}:${i + 1}  ${line.trim().slice(0, 90)}`);
    }
  });
}
ok(
  'no hero style on the ink field uses an inverting theme text token',
  themedOnInk.length === 0,
  themedOnInk.join('\n        '),
);

// Bare on-ink hexes must not reappear in the estimate hero styles now that the
// palette is shared — that is how the coupling got lost in the first place.
const BARE_ONINK = /#(F4EFE6|C9C3B8)\b/;
const bareHexHeroes: string[] = [];
for (const rel of ['app/(tabs)/estimate/index.tsx', 'app/(tabs)/estimate/review.tsx', 'app/estimate-wizard.tsx']) {
  read(rel).split('\n').forEach((line, i) => {
    if (/^\s*hero\w*\s*:/.test(line) && BARE_ONINK.test(line)) {
      bareHexHeroes.push(`${rel}:${i + 1}  ${line.trim().slice(0, 90)}`);
    }
    if (/^\s*color:\s*'#(F4EFE6|C9C3B8)'/.test(line)) {
      bareHexHeroes.push(`${rel}:${i + 1}  ${line.trim().slice(0, 90)}`);
    }
  });
}
ok(
  'estimate heroes carry no bare on-ink hex (they import OnInk instead)',
  bareHexHeroes.length === 0,
  bareHexHeroes.map((h) => h + '  — use OnInk.title / OnInk.subtitle').join('\n        '),
);

console.log('');
process.exit(failures === 0 ? 0 : 1);

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
// Check 12 measures the REAL derived palette, not a regex of it. Both modules
// are import-free leaves (no react-native, no bundler), so bun loads them the
// same way scripts/validate-schedule-colors.ts already loads constants/colors.
import { Theme, deriveAccentPalette, BRAND_ACCENT } from '../constants/colors';
import { THEME_PRESETS } from '../types';

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

/**
 * Roots for the COLOUR passes (checks 1, 1b, 1c, 3).
 *
 * They walked ['app','components'] until the 2026-09-07 audit: a palette does
 * not stop being a palette because it lives in a helper, and utils/ ships
 * several (scheduleEngine's PHASE_COLORS, summaryBriefing's project colours,
 * scheduleReportHtml's inline CSS) straight into rendered screens and PDFs.
 * The SHAPE passes below (BrandBackdrop coupling, the FAB corner, header
 * titles, identity tiles) stay on app/components on purpose — they are about
 * rendered screens, and a util has none.
 */
const COLOR_ROOTS = ['app', 'components', 'utils', 'hooks', 'contexts', 'lib'];

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

for (const file of collectFiles(COLOR_ROOTS)) {
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

/**
 * The two-space-indented `name: { … }` entries of a file's StyleSheet(s), split
 * into fills, label colours and line numbers.
 *
 * Checks 1b and 1c(a)/(b) each built this inline; pass 1c(c) did not have it at
 * all, which is the whole reason six white-on-accent buttons shipped past this
 * guard (audit 2026-09-07): their fill is inline JSX and their label is a
 * StyleSheet entry, so neither half could see the other. One table, three
 * callers.
 */
function styleTable(src: string) {
  const bgOf = new Map<string, string>();
  const fgOf = new Map<string, string>();
  const lineOf = new Map<string, number>();
  for (const e of src.matchAll(/^\s{2}(\w+):\s*\{/gm)) {
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
  return { bgOf, fgOf, lineOf };
}

for (const file of collectFiles(COLOR_ROOTS)) {
  const src = readFileSync(file, 'utf8');
  const { bgOf, fgOf, lineOf } = styleTable(src);

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

// ── Check 1c: white TEXT on the RAW accent FILL (founder decision #1) ────────
//
// The brand hue #FF6A1A is KEPT for large non-text chrome under WCAG's 3:1 rule
// (icon tiles, progress bars, burn bars). But WHITE/near-white TEXT on that raw
// fill measures 2.87:1 — below AA 4.5:1 — and the 2026-08-17 web audit shipped a
// dozen buttons doing exactly that ("Pick a plan", "Add to estimate", "Enable",
// "Send preview", the reports action, the POPULAR badge, quick-quote's send). The
// accessible fill is `accentFill` (#BC440C → white 5.29:1). This check FAILS any
// solid raw-accent fill (no alpha suffix) whose label resolves to white.
//
// Why the other guards miss it: validate-brand-orange.ts only checks the token
// HEXES, and check 1 above EXEMPTS '#FFFFFF' on t.accent as a legitimate solid
// fill + contrasting label (true for contrast > 4.5, FALSE for the orange hue).
// So a white-on-accent button is invisible to both — this check closes that gap.
//
// Scope is deliberately narrow to avoid false positives:
//   • FILL must be the RAW `accent` token only — `t.accent` / `Colors.accent`
//     etc. Alpha-suffixed tints (`t.accent + '18'`), `accentSoft`, `accentHot`,
//     `accentLight`, `accentMuted`, `accentLabel`, and the AA-safe `accentFill`
//     are all excluded (they are not a solid brand-hue text field).
//   • FOREGROUND must be WHITE/near-white or the cream `bg` used as a label
//     (cream-on-accent is 2.70:1, strictly worse). Dark labels (t.text) are a
//     different concern and ignored here.
//   • Only TEXT foregrounds are flagged. Non-text accent chrome (icon tiles,
//     bars) never has a paired `...Text`/`...Label` colour, so it never trips.

/** Is `v` exactly the raw brand-accent token (a solid fill), not a tint/companion? */
function isRawAccentFill(v: string): boolean {
  return /^(t|themeColors|colors|c|Colors|C|theme|colours)\.accent$/.test(v.trim());
}
/** Does `v` resolve to white / near-white / the cream bg used as a label colour? */
function isWhiteish(v: string): boolean {
  const s = v.trim().replace(/;$/, '');
  // Both quote styles: app/punch-list.tsx:1070 writes `color: "#FFFFFF"` and
  // escaped this check for years on the quote character alone (audit 2026-09-07).
  if (/^["']#(FFF|FFFFFF|FEFEFE|FEFFFE|FFFFFE|FDFDFD)["']$/i.test(s)) return true;
  if (/\.textOnAccent$/.test(s)) return true;            // token = #FFFFFF
  if (/^(t|themeColors|colors|c|Colors|C|theme|colours)\.bg$/.test(s)) return true; // cream, 2.70:1 — worse
  return false;
}

/**
 * The source range of the JSX element whose OPEN TAG contains `at` — its own
 * subtree, and nothing after it.
 *
 * Pass (c) used a 400-character window ending at the first `</`, which is both
 * too loose (it can run into the next sibling) and too tight (it stops before a
 * label that sits behind a self-closing icon). Returns null when `at` is not
 * inside a JSX open tag at all, e.g. a plain object literal in a util.
 */
function jsxElementRange(src: string, at: number): { start: number; end: number } | null {
  let start = -1;
  for (let i = at; i >= 0; i--) {
    if (src[i] === '<' && /[A-Za-z]/.test(src[i + 1] ?? '')) { start = i; break; }
  }
  if (start < 0) return null;
  const tag = /^<([A-Za-z][\w.]*)/.exec(src.slice(start, start + 60))?.[1];
  if (!tag) return null;
  // End of the open tag = the first `>` at brace depth 0, so the `>` inside an
  // arrow function in a prop expression (`onPress={() => …}`) does not end it.
  let depth = 0;
  let openEnd = -1;
  for (let i = start + 1; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === '>' && depth === 0) { openEnd = i; break; }
  }
  if (openEnd < 0 || openEnd < at) return null;
  if (src[openEnd - 1] === '/') return { start, end: openEnd };
  // Balanced close, counting nested same-name tags.
  const re = new RegExp(`<(/?)${tag.replace(/\./g, '\\.')}\\b`, 'g');
  re.lastIndex = openEnd;
  let nest = 1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    nest += m[1] === '/' ? -1 : 1;
    if (nest === 0) return { start, end: m.index };
  }
  return { start, end: src.length };
}

const whiteOnAccentHits: string[] = [];

// (a) StyleSheet pairs — a `fooBtn` fill on raw accent + its `fooBtnText` label
//     coloured white. Reuse the same container/label pairing as check 1b, but
//     match ACROSS tokens (fill=accent, label=white) rather than fill===label.
for (const file of collectFiles(COLOR_ROOTS)) {
  const rel = relative(ROOT, file);
  const src = readFileSync(file, 'utf8');
  const { bgOf, fgOf, lineOf } = styleTable(src);

  for (const [container, bgv] of bgOf) {
    if (!isRawAccentFill(bgv)) continue;
    for (const [label, fgv] of fgOf) {
      if (label === container || !isWhiteish(fgv)) continue;
      if (!label.startsWith(container)) continue;
      if (!LABEL_SUFFIX.test(label.slice(container.length))) continue;
      whiteOnAccentHits.push(
        `${rel}:${lineOf.get(container)}  styles.${container} fill = ${bgv} with white label styles.${label} (${fgv}) — 2.87:1; use accentFill`,
      );
    }
  }

  // (b) A single style entry that BOTH fills on raw accent AND colours its own
  //     text white (e.g. `permTitle: { backgroundColor: t.accent, color: '#FFF' }`
  //     — rare, but the fg===bg check would miss it since the tokens differ).
  for (const name of lineOf.keys()) {
    const bg = bgOf.get(name);
    const fg = fgOf.get(name);
    if (bg && fg && isRawAccentFill(bg) && isWhiteish(fg)) {
      whiteOnAccentHits.push(
        `${rel}:${lineOf.get(name)}  styles.${name} fills ${bg} and colours its own text ${fg} — 2.87:1; use accentFill`,
      );
    }
  }
}

// (c) Inline JSX — `<Foo style={[.., { backgroundColor: t.accent }]}>` whose
//     label is white. This pass scans ONLY the JSX regions (everything OUTSIDE
//     the file's `StyleSheet.create({...})` blocks — those are handled precisely
//     by (a)/(b), so scanning them here would double-report and mis-pair
//     unrelated style entries).
//
//     TWO GAPS CLOSED 2026-09-07, both found by hand while this check printed
//     PASS on six shipping buttons:
//
//     • The label may live in the StyleSheet while the fill is inline —
//       `style={[styles.btn, { backgroundColor: t.accent }]}` with
//       `<Text style={styles.btnText}>` and `btnText: { color: '#FFF' }`. That
//       split falls between (a) (needs a StyleSheet fill) and (c) (used to need
//       an inline label), which is exactly where app/accept-invite.tsx's two
//       buttons — the first screen an invited collaborator ever sees — sat.
//       The style table is now resolved for this pass too.
//
//     • The window was "from the fill to the next `</`, max 400 chars", which
//       cannot tell a child from a downstream sibling and stops short of a
//       label sitting behind a self-closing icon (app/bid-detail.tsx's "Apply"
//       renders <ExternalLink /> before its <Text>). It is now the element's
//       own subtree, resolved by tag.
for (const file of collectFiles(COLOR_ROOTS)) {
  const rel = relative(ROOT, file);
  const raw = stripComments(readFileSync(file, 'utf8'));
  const { bgOf, fgOf } = styleTable(raw);

  // Blank out every `StyleSheet.create( … )` body so the inline scan can't see
  // StyleSheet properties (preserve offsets/line count by overwriting with spaces).
  const chars = raw.split('');
  const scRe = /StyleSheet\.create\s*\(/g;
  let sc: RegExpExecArray | null;
  while ((sc = scRe.exec(raw))) {
    let depth = 0;
    let started = false;
    for (let i = sc.index + sc[0].length - 1; i < raw.length; i++) {
      const ch = raw[i];
      if (ch === '(') { depth++; started = true; }
      else if (ch === ')') { depth--; if (started && depth === 0) { break; } }
      if (started && chars[i] !== '\n') chars[i] = ' ';
    }
  }
  const src = chars.join('');

  // Read the WHOLE value, not just the leading token: `t.accent + '20'` is an
  // 8% tint, not a solid brand-hue field, and a regex that stopped at the token
  // read it as one (app/(tabs)/materials/index.tsx:289 false-failed on exactly
  // that while this check was being repaired).
  const bgRe = /backgroundColor\s*:\s*/g;
  let m: RegExpExecArray | null;
  while ((m = bgRe.exec(src))) {
    const fill = readValue(src, m.index + m[0].length);
    if (!isRawAccentFill(fill)) continue;
    const range = jsxElementRange(src, m.index);
    // No resolvable element (a plain object literal outside JSX) keeps the old
    // conservative 400-char window rather than scanning to end of file.
    const win = src.slice(m.index, range ? range.end : Math.min(src.length, m.index + 400));

    // A `color:` STYLE PROPERTY (colon) is a TEXT label. A bare `color=` JSX
    // attribute is an ICON prop (lucide `<Check color={...}/>`), which is
    // non-text chrome governed by the 3:1 rule, not this text check — excluding
    // it is what keeps active-state checkbox/icon toggles from false-failing.
    let label: string | null = null;
    for (const f of win.matchAll(/(?<!background)(?<![A-Za-z])color\s*:\s*([^,\n}]+)/g)) {
      if (isWhiteish(f[1])) { label = f[1].trim(); break; }
    }
    // …or the label is a StyleSheet entry referenced somewhere in this element.
    if (!label) {
      for (const sm of win.matchAll(/styles\.(\w+)/g)) {
        const fg = fgOf.get(sm[1]);
        if (fg && isWhiteish(fg)) { label = `styles.${sm[1]} (${fg})`; break; }
      }
    }
    if (label) {
      const line = src.slice(0, m.index).split('\n').length;
      whiteOnAccentHits.push(
        `${rel}:${line}  inline backgroundColor: ${fill} with white foreground ${label} — 2.87:1; use accentFill`,
      );
    }
  }

  // (d) The MIRROR IMAGE of (c): the fill is a StyleSheet entry and the label is
  //     written inline — `<View style={styles.badge}><Text style={{ color:'#FFF' }}>`
  //     with `badge: { backgroundColor: t.accent }`. Pass (a) pairs a StyleSheet
  //     fill only with a StyleSheet label named `<container><Suffix>`, and (c)
  //     needs the fill inline, so this split fell between all three — the same
  //     shape as the split that let app/accept-invite.tsx ship two illegible
  //     CTAs, just the other way round (found reviewing that repair 2026-09-07).
  //     Scoped to the element's own subtree, so a white label on an unrelated
  //     sibling is not swept in.
  for (const sm of src.matchAll(/styles\.(\w+)/g)) {
    const fill = bgOf.get(sm[1]);
    if (!fill || !isRawAccentFill(fill)) continue;
    const range = jsxElementRange(src, sm.index!);
    if (!range) continue;   // not a JSX usage — a bare reference in code
    const win = src.slice(sm.index!, range.end);
    let label: string | null = null;
    for (const f of win.matchAll(/(?<!background)(?<![A-Za-z])color\s*:\s*([^,\n}]+)/g)) {
      if (isWhiteish(f[1])) { label = f[1].trim(); break; }
    }
    if (!label) continue;
    const line = src.slice(0, sm.index!).split('\n').length;
    whiteOnAccentHits.push(
      `${rel}:${line}  styles.${sm[1]} fills on ${fill} with inline white foreground ${label} — 2.87:1; use accentFill`,
    );
  }
}

const uniqWhiteAccent = [...new Map(whiteOnAccentHits.map((h) => [h, h])).values()];

// There is no quarantine list any more. app/coi-vault.tsx and app/(tabs)/
// settings/** were carved out while another branch's integrator owned them, and
// the carve-out outlived the ownership: both are clean, so the exemption was
// doing nothing except standing ready to swallow the next defect in those two
// paths. Every hit fails, everywhere (audit 2026-09-07).
ok(
  'no white/near-white TEXT sits on the raw accent fill (use accentFill, AA 4.5:1)',
  uniqWhiteAccent.length === 0,
  uniqWhiteAccent.join('\n        '),
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

// ── Check 3: no rgba FOREGROUND token is alpha-suffixed as a FILL ───────────
//
// `textSecondary` and `textMuted` are rgba() strings in at least one theme
// (light: rgba(43,48,56,0.6)/0.4; dark textMuted: rgba(154,163,173,0.6)).
// Alpha-suffixing them the way a 6-digit hex token is suffixed —
// `t.textMuted + '14'` or `${t.textSecondary}22` — is a silent bug: RN's
// normalizeColor keeps the rgba() prefix and DROPS the trailing hex, so the
// intended ~8% tint renders as the FULL ~40-60% opacity token — an opaque grey
// slab, and where same-token text sits on it, invisible. Five sites shipped
// this; all now use the real rgba token `neutralSoft` directly. This check
// pins that: it fails if either rgba foreground token is alpha-suffixed
// anywhere the app draws from — the same COLOR_ROOTS as checks 1/1b/1c. It was
// left on ['app','components'] when they were widened on 2026-09-07, which is
// the identical blind spot one check over (review, same day).
//
// PRECISE by construction: only textSecondary and textMuted are rgba foreground
// tokens. Every other suffixable token (accent, danger, success, info, …) is a
// 6-digit hex where `+ 'NN'` is the legitimate way to add alpha, so this must
// NOT be broadened to all tokens. Verified zero false positives app-wide (the
// only other textual hit is a comment in job-costing.tsx, blanked by
// stripComments before matching).
const RGBA_FG_SUFFIX = [
  // t.textSecondary + '22'  /  themeColors.textMuted +'14'
  /\b(?:textSecondary|textMuted)\s*\+\s*['"][0-9A-Fa-f]{2}['"]/,
  // `${...textSecondary}22`  /  `${theme.textMuted}60`
  /\$\{[^}]*\b(?:textSecondary|textMuted)\b[^}]*\}[0-9A-Fa-f]{2}/,
];
const suffixHits: string[] = [];
for (const file of collectFiles(COLOR_ROOTS)) {
  const src = stripComments(readFileSync(file, 'utf8'));
  src.split('\n').forEach((line, i) => {
    if (RGBA_FG_SUFFIX.some((re) => re.test(line))) {
      suffixHits.push(`${relative(ROOT, file)}:${i + 1}  ${line.trim().slice(0, 90)}`);
    }
  });
}
ok(
  'no rgba foreground token (textSecondary/textMuted) is alpha-suffixed as a fill (use neutralSoft)',
  suffixHits.length === 0,
  suffixHits.join('\n        '),
);


// ═══════════════════════════════════════════════════════════════════════════
// Runtime audit 2026-09-06 — the visual defects a Release build on the
// founder's real account exposed. Everything above is a SOURCE-SHAPE check;
// checks 4 and 5 below are the first REAL contrast maths in this repo: they
// parse the token tables out of constants/colors.ts, composite the rgba()
// foregrounds onto each of that theme's own grounds, and compute the WCAG
// 2.x relative-luminance ratio. A token that drops below AA fails the build
// with the measured number, so nobody has to sample pixels off a screenshot
// again (which is how VIS-04 / VIS-06 / VIS-17 were actually found).
// ═══════════════════════════════════════════════════════════════════════════

type RGB = readonly [number, number, number];
type RGBA = { rgb: RGB; a: number };

/** '#RGB' | '#RRGGBB' | '#RRGGBBAA' | 'rgba(r,g,b,a)' | 'rgb(r,g,b)' → RGBA. */
function parseColor(v: string): RGBA | null {
  const s = v.trim();
  const rgba = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s);
  if (rgba) {
    return {
      rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])] as const,
      a: rgba[4] === undefined ? 1 : Number(rgba[4]),
    };
  }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(s);
  if (!hex) return null;
  let h = hex[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return { rgb: [n(0), n(2), n(4)] as const, a: h.length === 8 ? n(6) / 255 : 1 };
}

/** Source-over composite of `fg` (with alpha) onto an opaque `bg`. */
function composite(fg: RGBA, bg: RGB): RGB {
  return [0, 1, 2].map((i) => fg.rgb[i] * fg.a + bg[i] * (1 - fg.a)) as unknown as RGB;
}

/** WCAG 2.x relative luminance. */
function luminance(c: RGB): number {
  const ch = (x: number) => {
    const v = x / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2]);
}

function contrast(a: RGB, b: RGB): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Ratio of a possibly-translucent foreground rendered on an opaque ground. */
function ratioOn(fg: string, ground: string): number | null {
  const f = parseColor(fg);
  const g = parseColor(ground);
  if (!f || !g || g.a < 1) return null;
  return contrast(composite(f, g.rgb), g.rgb);
}

const AA = 4.5;
const round2 = (n: number) => Math.round(n * 100) / 100;

// ── token tables, read out of the real source ───────────────────────────────

const colorsSrc = read('constants/colors.ts');

/** `Theme.light` / `Theme.dark` string properties. */
function themeTable(which: 'light' | 'dark'): Record<string, string> {
  const themeAt = colorsSrc.indexOf('export const Theme');
  const start = colorsSrc.indexOf(`${which}: {`, themeAt);
  if (themeAt < 0 || start < 0) return {};
  let depth = 0;
  let end = start;
  for (let i = colorsSrc.indexOf('{', start); i < colorsSrc.length; i++) {
    if (colorsSrc[i] === '{') depth++;
    else if (colorsSrc[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  const body = stripComments(colorsSrc.slice(start, end));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(\w+):\s*'([^']+)'/g)) out[m[1]] = m[2];
  return out;
}

/**
 * The theme-aware getters on the static `Colors` module:
 *   get textMuted() { return _currentTheme === 'dark' ? 'A' : 'B'; }
 * Returns { dark, light } per token name.
 */
function colorsGetters(): Record<string, { light: string; dark: string }> {
  const out: Record<string, { light: string; dark: string }> = {};
  const re = /get\s+(\w+)\s*\(\)\s*\{\s*return\s+_currentTheme === 'dark'\s*\?\s*'([^']+)'\s*:\s*'([^']+)'/g;
  for (const m of stripComments(colorsSrc).matchAll(re)) out[m[1]] = { dark: m[2], light: m[3] };
  return out;
}

/**
 * The STATIC (non-getter) string properties on the `Colors` object literal —
 * the signal fills (`success: '#34C759'`) as opposed to the theme-aware label
 * getters. Read from the object body between `export const Colors = {` and the
 * `Theme` declaration, so a token moved into or out of a getter is picked up.
 */
function colorsStatics(): Record<string, string> {
  const start = colorsSrc.indexOf('export const Colors = {');
  const end = colorsSrc.indexOf('export type ThemeColors');
  if (start < 0) return {};
  const body = stripComments(colorsSrc.slice(start, end < 0 ? undefined : end));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(?:^|[{,\n])\s*(\w+):\s*'(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))'/g)) out[m[1]] = m[2];
  return out;
}

const THEME = { light: themeTable('light'), dark: themeTable('dark') } as const;
const GETTERS = colorsGetters();
const STATIC_FILLS = colorsStatics();

// ── Check 4: body/caption text tokens clear AA on every ground they land on ─
//
// VIS-04 / VIS-17. Sampled off the Release build: textMuted rendered at
// 2.20:1 ("3 active", "CASH · 4WK", "Nothing scheduled on site today.") and
// textSecondary at 3.82:1 — every explanatory line in the product. Both carry
// REAL CONTENT here, not decoration, so both are held to AA 4.5:1, not to the
// 3:1 large-text floor. Checked against the WORST ground in each theme.

const textFailures: string[] = [];
const GROUNDS = ['bg', 'surface', 'surfaceAlt'] as const;

for (const theme of ['light', 'dark'] as const) {
  for (const token of ['text', 'textSecondary', 'textMuted'] as const) {
    const fg = THEME[theme][token];
    if (!fg) { textFailures.push(`Theme.${theme}.${token} is missing from constants/colors.ts`); continue; }
    for (const g of GROUNDS) {
      const bg = THEME[theme][g];
      const r = bg ? ratioOn(fg, bg) : null;
      if (r === null) { textFailures.push(`Theme.${theme}.${token} on ${g}: unparseable (${fg} on ${bg})`); continue; }
      if (r < AA) textFailures.push(`Theme.${theme}.${token} (${fg}) on ${g} ${bg} = ${round2(r)}:1  — needs ${AA}:1`);
    }
  }
}

// The static Colors module carries the same two tokens for screens that have
// not migrated to useTheme(); its grounds are `background` / `surface`.
const COLORS_GROUNDS = ['background', 'surface', 'surfaceAlt'] as const;
for (const theme of ['light', 'dark'] as const) {
  for (const token of ['text', 'textSecondary', 'textMuted'] as const) {
    const fg = GETTERS[token]?.[theme];
    if (!fg) { textFailures.push(`Colors.${token} is not a theme-aware getter in constants/colors.ts`); continue; }
    for (const g of COLORS_GROUNDS) {
      const bg = GETTERS[g]?.[theme];
      const r = bg ? ratioOn(fg, bg) : null;
      if (r === null) continue;
      if (r < AA) textFailures.push(`Colors.${token} (${fg}) on ${g} ${bg} [${theme}] = ${round2(r)}:1  — needs ${AA}:1`);
    }
  }
}

ok(
  'text tokens clear WCAG AA 4.5:1 on every surface of their own theme',
  textFailures.length === 0,
  textFailures.join('\n        '),
);

// ── Check 5: a status-chip LABEL is legible on a tint of ITSELF ────────────
//
// VIS-06. The app's chip idiom is `backgroundColor: c + '15'` with
// `color: c` — the label painted on an 8% wash of the same hue. Measured in
// the Release build, the Subs compliance badge (#34C759 on its own tint) came
// out at 2.07:1: the single most load-bearing label on that screen was the
// least readable text on it. Every token that is used as a chip LABEL is
// therefore held to AA under exactly that composite.
//
// This checks the LABEL INKS only (`successLabel` / `warningLabel` /
// `dangerLabel` / `infoLabel`), NOT the signal fills they pair with. The first
// pass at this fix darkened the FILLS instead and made a yellow health dot
// indistinguishable from a red one — check 5b below exists so that trade can
// never be made again silently.
//
// Deliberately NOT in this set:
//   • `accent` / `primary` — founder decision #1 keeps the brand hue #FF6A1A
//     for large non-text chrome under the 3:1 rule; its text companions are
//     `accentLabel` and `accentFill`, which since 2026-09-07 are DERIVED per
//     hue rather than frozen in Theme.light/dark and are measured for all nine
//     presets by check 12 below. Leaving `accentLabel` in the list here would
//     have been worse than removing it: THEME[theme].accentLabel is now
//     undefined and the loop's `if (!fg) continue` would have skipped it in
//     silence, which is the failure mode this whole file exists to prevent.
//   • `Theme.*.danger` and `Colors.success/warning/error/info` — the SOLID
//     signal hues for dots, bars and icons. Their text companions are the
//     *Label tokens, which ARE checked.
const CHIP_TINT = 0x15 / 255; // the '15' suffix the chips actually ship

function chipRatio(label: string, ground: string): number | null {
  const fg = parseColor(label);
  const g = parseColor(ground);
  if (!fg || !g || fg.a < 1 || g.a < 1) return null;
  const tint = composite({ rgb: fg.rgb, a: CHIP_TINT }, g.rgb);
  return contrast(fg.rgb, tint);
}

const chipFailures: string[] = [];
const THEME_CHIP_TOKENS = ['success', 'info', 'successLabel', 'warningLabel', 'dangerLabel'] as const;
for (const theme of ['light', 'dark'] as const) {
  const surface = THEME[theme].surface;
  for (const token of THEME_CHIP_TOKENS) {
    const fg = THEME[theme][token];
    if (!fg || !surface) continue;
    const r = chipRatio(fg, surface);
    if (r !== null && r < AA) {
      chipFailures.push(`Theme.${theme}.${token} (${fg}) as a label on its own 8% tint over surface = ${round2(r)}:1  — needs ${AA}:1`);
    }
  }
}
for (const theme of ['light', 'dark'] as const) {
  const surface = GETTERS.surface?.[theme];
  for (const token of ['successLabel', 'warningLabel', 'dangerLabel', 'infoLabel'] as const) {
    const fg = GETTERS[token]?.[theme];
    if (!fg) {
      chipFailures.push(`Colors.${token} must be a theme-aware getter — a single literal cannot be legible in both themes`);
      continue;
    }
    if (!surface) continue;
    const r = chipRatio(fg, surface);
    if (r !== null && r < AA) {
      chipFailures.push(`Colors.${token} (${fg}) as a label on its own 8% tint over surface [${theme}] = ${round2(r)}:1  — needs ${AA}:1`);
    }
  }
}

// A chip painted on the SIGNAL's tint but labelled with the INK is the shape
// app/(tabs)/subs/index.tsx and app/reports.tsx actually ship. Hold that
// composite to AA too, or the two halves can drift apart.
const SIGNAL_INK: readonly (readonly [string, string])[] = [
  ['success', 'successLabel'], ['warning', 'warningLabel'],
  ['error', 'dangerLabel'], ['info', 'infoLabel'],
];
for (const theme of ['light', 'dark'] as const) {
  const surface = GETTERS.surface?.[theme];
  for (const [fillTok, inkTok] of SIGNAL_INK) {
    const fill = STATIC_FILLS[fillTok];
    const ink = GETTERS[inkTok]?.[theme];
    if (!fill || !ink || !surface) continue;
    const f = parseColor(fill);
    const g = parseColor(surface);
    const k = parseColor(ink);
    if (!f || !g || !k || g.a < 1) continue;
    const tint = composite({ rgb: f.rgb, a: CHIP_TINT }, g.rgb);
    const r = contrast(k.rgb, tint);
    if (r < AA) {
      chipFailures.push(`Colors.${inkTok} (${ink}) on a Colors.${fillTok} 8% tint over surface [${theme}] = ${round2(r)}:1  — needs ${AA}:1`);
    }
  }
}

ok(
  'status-chip colours stay legible painted on a tint of themselves',
  chipFailures.length === 0,
  chipFailures.join('\n        '),
);

// ── Check 5b: the SIGNAL fills stay distinguishable from one another ───────
//
// The counterpart to check 5, and the reason it exists: the FIRST attempt at
// VIS-06 fixed chip legibility by darkening the fills themselves — re-tinting
// `Colors.warning` from #FF9500 to #B84A00 for the whole app. That is correct
// for text and catastrophic for a colour used as a bare SIGNAL, where the
// requirement is not AA-against-a-ground but being unmistakable from the
// sibling states beside it. Concretely, with no text anywhere in the row:
//
//   app/reports.tsx healthTone()      a 10pt dot: yellow #B84A00 vs red
//                                     #C84038 = 1.06:1, hue 20.8° apart
//   app/compare-drawings.tsx changeBg()  Modified and Removed became one colour
//   ...impactBg()/severityHero()      moderate rgb(245,229,218) vs major
//                                     rgb(247,227,226) — 1.00:1, one swatch
//
// So: for every pair of DIFFERENT semantics in the signal palette, require
// either a real hue separation or a real luminance separation. Same-semantic
// pairs (Colors.error vs Theme.light.danger — two spellings of "red") are
// skipped; they are never siblings in a comparison.
//
// Thresholds are set from the palette that actually shipped for years, not
// fitted to pass: its tightest cross-role pair is warning vs error at
// 31.9° / 1.61:1, and the regression above scored 20.8° / 1.06:1.

function hueOf(hex: string): number | null {
  const c = parseColor(hex);
  if (!c) return null;
  const [r, g, b] = [c.rgb[0] / 255, c.rgb[1] / 255, c.rgb[2] / 255];
  const mx = Math.max(r, g, b);
  const d = mx - Math.min(r, g, b);
  if (d === 0) return 0;
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return (h + 360) % 360;
}
function hueDelta(a: string, b: string): number | null {
  const ha = hueOf(a);
  const hb = hueOf(b);
  if (ha === null || hb === null) return null;
  const d = Math.abs(ha - hb);
  return Math.min(d, 360 - d);
}

const MIN_HUE_SEP = 30;      // degrees
const MIN_LUM_SEP = 1.6;     // WCAG contrast between the two fills

const signalFailures: string[] = [];
for (const theme of ['light', 'dark'] as const) {
  const roles: Record<string, [string, string][]> = {
    success: [['Colors.success', STATIC_FILLS.success], [`Theme.${theme}.success`, THEME[theme].success]],
    warning: [['Colors.warning', STATIC_FILLS.warning]],
    danger: [['Colors.error', STATIC_FILLS.error], [`Theme.${theme}.danger`, THEME[theme].danger]],
    info: [['Colors.info', STATIC_FILLS.info], [`Theme.${theme}.info`, THEME[theme].info]],
  };
  const names = Object.keys(roles);
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      for (const [an, av] of roles[names[i]]) {
        for (const [bn, bv] of roles[names[j]]) {
          if (!av || !bv) {
            signalFailures.push(`${!av ? an : bn} is missing from constants/colors.ts — a signal fill must be a static hex`);
            continue;
          }
          const a = parseColor(av);
          const b = parseColor(bv);
          if (!a || !b) continue;
          const c = contrast(a.rgb, b.rgb);
          const h = hueDelta(av, bv);
          if (h === null) continue;
          if (h < MIN_HUE_SEP && c < MIN_LUM_SEP) {
            signalFailures.push(
              `${an} (${av}) and ${bn} (${bv}) are indistinguishable as bare signals: ` +
              `${round2(h)}° apart at ${round2(c)}:1 — needs ${MIN_HUE_SEP}° or ${MIN_LUM_SEP}:1. ` +
              `A label-less dot/bar in one state now reads as the other.`,
            );
          }
        }
      }
    }
  }
}

ok(
  'signal fills for different states stay distinguishable from each other',
  signalFailures.length === 0,
  signalFailures.join('\n        '),
);

// ── Check 6: the Summary greeting is honest and cannot clip the name ────────
//
// VIS-07: the hero said "Good morning" at every hour — the capture that
// caught it was taken at 9:20 PM. MONEY-04 / VIS-15: at 34pt/800 in a row
// that also reserved a 38pt button, iOS ellipsised the greeting to
// "Good morning, O…" on a stock iPhone 17 Pro at default text size.

const hero = read('components/summary/BriefingHero.tsx');
const heroCode = stripComments(hero);
const heroChecks: string[] = [];
if (!/export function greetingFor\s*\(/.test(heroCode)) {
  heroChecks.push('BriefingHero must export greetingFor() so the salutation is one testable ladder');
}
if (!/getHours\(\)/.test(heroCode)) {
  heroChecks.push('BriefingHero never reads the hour — the greeting is wrong for two thirds of the working day');
}
if (/['"`]Good morning[,`]/.test(heroCode.replace(/if \(h < 12\) return 'Good morning';/, ''))) {
  heroChecks.push("BriefingHero interpolates a hardcoded 'Good morning' — route it through greetingFor()");
}
// Native: shrink-to-fit. Web: react-native-web implements no
// adjustsFontSizeToFit at all (zero occurrences in its dist tree), so the
// greeting needs a second line there or it ellipsises exactly as before.
if (!/adjustsFontSizeToFit/.test(heroCode)) {
  heroChecks.push('the greeting can still ellipsise the user\'s name on native — it needs adjustsFontSizeToFit');
}
if (!/numberOfLines=\{Platform\.OS === 'web' \? 2 : 1\}/.test(heroCode)) {
  heroChecks.push('the greeting is capped at one line on WEB, where adjustsFontSizeToFit is a no-op — it needs a two-line fallback there');
}
if (/wrap:\s*\{[^}]*flexDirection: 'row'/.test(heroCode)) {
  heroChecks.push('the hero row squeezes the greeting against the tools button again — give the greeting the full width');
}
ok(
  'the Summary greeting matches the clock and keeps the user\'s name whole',
  heroChecks.length === 0,
  heroChecks.join('\n        '),
);

// ── Check 7: the crash screen shows its whole error and offers a way out ────
//
// MISS-03. Three defects on the one screen a customer sees when the app
// breaks: the message was clipped mid-sentence at maxHeight 80, the single
// button re-rendered the identical subtree on the identical route (a
// deterministic update loop just re-crashes), and it was painted in the
// RETIRED forest-green brand.

const eb = read('components/ErrorBoundary.tsx');
const ebCode = stripComments(eb);
const ebChecks: string[] = [];
const boxHeight = /errorBox:\s*\{[\s\S]*?maxHeight:\s*(\d+)/.exec(ebCode);
if (!boxHeight || Number(boxHeight[1]) < 160) {
  ebChecks.push(`errorBox maxHeight is ${boxHeight ? boxHeight[1] : 'unset'} — the captured message needed ~6 lines and was cut mid-sentence`);
}
if (!/testID="error-boundary-home"/.test(ebCode)) {
  ebChecks.push('the crash screen offers only Try Again — a deterministic crash loops straight back; it needs a route out');
}
if (/#1A6B3C/i.test(ebCode)) {
  ebChecks.push('the crash screen still paints the retired forest-green brand (#1A6B3C)');
}
// The card is ~552pt with both buttons, and `fallbackMessage` is caller-
// supplied — on a 667pt device a long message would push "Try Again" off the
// bottom of a centred View. The exits must always be reachable.
if (!/<ScrollView[\s\S]{0,200}contentContainerStyle=\{fallbackStyles\.container\}/.test(ebCode)) {
  ebChecks.push('the crash-screen card does not scroll — a long fallbackMessage pushes the exit buttons off a small screen');
}
ok(
  'the crash screen shows the whole error and offers more than a re-crash',
  ebChecks.length === 0,
  ebChecks.join('\n        '),
);

// ── Check 8: nothing else parks a floating circle in the Brain FAB's corner ─
//
// VIS-02. components/brain/BrainFab.tsx mounts ONE 56pt circle at right:20,
// bottom `insets.bottom + 70` — so it occupies x[20,76] y[70,126] measured
// from the safe-area origin. It is mounted ABOVE the router, so its inset is
// the raw home-indicator inset while a TAB screen's also includes the tab bar;
// the Equipment screen's own "+" therefore landed ~21pt inside it, was painted
// over, and taps in the overlap opened the AI assistant.
//
// This is real geometry, not a name match. A second floating button is
// LEGITIMATE when it is stacked clear of that band — components/
// UniversalMicButton.tsx does exactly that at `insets.bottom + 70 + 52 + 12`
// (y[134,180], 8pt above the Brain FAB's top) and must not be flagged. So the
// check resolves each candidate's inline `bottom` offset and fails only on an
// actual overlap. An offset it cannot resolve statically is its own FAILURE
// below — it was a WARN until 2026-09-07, and the one circle it could not
// measure is precisely the one that went a release unmeasured.

const BRAIN_BOTTOM = 70;   // BrainFab.tsx fabWrap: insets.bottom + 70 + lift
const BRAIN_HEIGHT = 56;
const BRAIN_TOP = BRAIN_BOTTOM + BRAIN_HEIGHT;

type Corner = { where: string; style: string; height: number; offset: number | null; raw: string };

/**
 * Every static value a bare identifier term can hold: its `= N` default in the
 * component's own props destructuring, plus every `name={N}` passed by a caller.
 * Null when any of them is not a literal number — then the geometry genuinely
 * is not computable from source and the check must say so.
 */
function identifierValues(name: string, src: string, callers: string[]): number[] | null {
  const vals: number[] = [];
  const def = new RegExp(`[{,]\\s*${name}\\s*=\\s*([^,}]+)`).exec(src);
  if (def) {
    if (!/^\d+$/.test(def[1].trim())) return null;
    vals.push(Number(def[1].trim()));
  }
  // Only props passed to a component THIS file exports count. `bottomOffset` is
  // also a VoiceFieldButton prop, and app/(tabs)/schedule/index.tsx passes it a
  // non-literal there — a name-only scan folded that in and declared HelpFab's
  // geometry uncomputable.
  const tags = [...src.matchAll(/export\s+(?:default\s+)?(?:const|function|class)\s+([A-Z]\w*)/g)].map((m) => m[1]);
  if (tags.length === 0) return vals.length > 0 ? vals : null;
  for (const f of callers) {
    const s = readFileSync(f, 'utf8');
    for (const tag of tags) {
      const tagRe = new RegExp(`<${tag}\\b`, 'g');
      let t: RegExpExecArray | null;
      while ((t = tagRe.exec(s))) {
        // The open tag ends at the first `>` at brace depth 0 (an arrow in a
        // prop expression must not close it early).
        let depth = 0;
        let end = -1;
        for (let i = t.index + t[0].length; i < s.length; i++) {
          if (s[i] === '{') depth++;
          else if (s[i] === '}') depth--;
          else if (s[i] === '>' && depth === 0) { end = i; break; }
        }
        if (end < 0) continue;
        const prop = new RegExp(`\\b${name}=\\{([^}]*)\\}`).exec(s.slice(t.index, end));
        if (!prop) continue;
        const v = prop[1].trim();
        if (!/^\d+$/.test(v)) return null;
        vals.push(Number(v));
      }
    }
  }
  return vals.length > 0 ? vals : null;
}

/**
 * Sum a `bottom:` expression of the form `insets.bottom + 70 + 52 + 12`.
 *
 * A bare identifier term is resolved through `identifierValues` and folded in
 * at its SMALLEST value, because the smallest offset is the worst case for an
 * overlap. That is not a nicety: components/HelpFab.tsx writes
 * `insets.bottom + bottomOffset + 16`, which this could not sum, and the check
 * reported it as an unresolved WARN and passed the build — so the one floating
 * circle it could not measure was the one it never measured (audit 2026-09-07).
 */
const MAX_BOTTOM_INSET = 34;   // iPhone home-indicator portrait inset

function resolveBottomOffset(expr: string, src: string, callers: string[]): number | null {
  const e = expr.trim().replace(/\s+/g, ' ');
  // A sum with no `insets.bottom` is measured from the SCREEN edge while this
  // check's band is measured from the safe-area origin, so it converts by
  // subtracting the biggest inset in the fleet — the worst case, the one that
  // can collide. Returning null for it made the hard failure below reject
  // `bottom: 200` as "not a static sum", which is the most static sum there is
  // (review 2026-09-07).
  const hasInset = /insets\.bottom/.test(e);
  const rest = hasInset ? e.slice(e.indexOf('insets.bottom') + 'insets.bottom'.length) : e;
  if (rest.trim() === '') return hasInset ? 0 : null;
  let total = hasInset ? 0 : -MAX_BOTTOM_INSET;
  const terms = rest.split('+');
  if (hasInset && terms[0].trim() !== '') return null;
  for (const t of hasInset ? terms.slice(1) : terms) {
    const v = t.trim().replace(/[,\]}]+$/, '');
    if (/^\d+$/.test(v)) { total += Number(v); continue; }
    // A platform/branch bump such as `(Platform.OS === 'web' ? 48 : 0)` only
    // ever pushes the button FURTHER from the corner, so take the smaller
    // branch: the worst case for an overlap is the one we must clear.
    const tern = /^\(.*\?\s*(\d+)\s*:\s*(\d+)\s*\)$/.exec(v);
    if (tern) { total += Math.min(Number(tern[1]), Number(tern[2])); continue; }
    if (/^[A-Za-z_]\w*$/.test(v)) {
      const vals = identifierValues(v, src, callers);
      if (!vals) return null;
      total += Math.min(...vals);
      continue;
    }
    return null;
  }
  return Math.max(0, total);
}

function floatingCorner(files: string[], callers: string[]): Corner[] {
  const found: Corner[] = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/^\s{2}(\w+):\s*\{/gm)) {
      const bodyStart = m.index! + m[0].length;
      let depth = 1;
      let bodyEnd = bodyStart;
      for (let j = bodyStart; j < src.length; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') { depth--; if (depth === 0) { bodyEnd = j; break; } }
      }
      const body = src.slice(bodyStart, bodyEnd);
      if (!/position:\s*'absolute'/.test(body)) continue;
      const right = /(?:^|[{,\s])right:\s*(\d+)/.exec(body);
      const width = /(?:^|[{,\s])width:\s*(\d+)/.exec(body);
      const height = /(?:^|[{,\s])height:\s*(\d+)/.exec(body);
      const radius = /borderRadius:\s*(\d+)/.exec(body);
      if (!right || !width || !radius) continue;
      // x-overlap with the Brain FAB's x[20,76] is implied by right <= 24 on a
      // 40-72pt circle, so the horizontal test stays a simple bound.
      if (Number(right[1]) > 24) continue;
      if (Number(width[1]) < 40 || Number(width[1]) > 72) continue;
      if (Number(radius[1]) < 20) continue;

      // Find where this style is applied and read the inline `bottom`.
      const name = m[1];
      const useRe = new RegExp(`styles\\.${name}\\s*,\\s*\\{([^}]*)\\}`, 'g');
      let offset: number | null = null;
      let raw = '(no inline bottom — style carries none either)';
      const inStyle = /(?:^|[{,\s])bottom:\s*([^,\n}]+)/.exec(body);
      if (inStyle) { raw = inStyle[1].trim(); offset = resolveBottomOffset(raw, src, callers); }
      let u: RegExpExecArray | null;
      while ((u = useRe.exec(src))) {
        const b = /(?:^|[{,\s])bottom:\s*([^,\n}]+)/.exec(u[1]);
        if (!b) continue;
        raw = b[1].trim();
        offset = resolveBottomOffset(raw, src, callers);
        break;
      }
      found.push({
        where: `${relative(ROOT, file)}:${src.slice(0, m.index!).split('\n').length}`,
        style: name,
        height: height ? Number(height[1]) : Number(width[1]),
        offset,
        raw,
      });
    }
  }
  return found;
}

const screenFiles = collectFiles(['app', 'components']);
const allCorners = floatingCorner(screenFiles, screenFiles)
  .filter((c) => !c.where.startsWith('components/brain/BrainFab.tsx'));

const collides = (c: Corner) =>
  c.offset !== null && c.offset < BRAIN_TOP && c.offset + c.height > BRAIN_BOTTOM;

const cornerHits = allCorners.filter(collides).map(
  (c) =>
    `${c.where}  styles.${c.style} — y[${c.offset},${c.offset! + c.height}] overlaps the Brain FAB's ` +
    `y[${BRAIN_BOTTOM},${BRAIN_TOP}]; it will be painted over and swallow its own taps. ` +
    `Move the action into the title row, or stack it at insets.bottom + ${BRAIN_TOP + 12}.`,
);
ok(
  'no floating circle overlaps the global Brain FAB',
  cornerHits.length === 0,
  cornerHits.join('\n        '),
);

// An offset this guard cannot resolve used to print as a WARN and pass. A check
// that cannot check is not a check: the one circle it could not measure sat
// uncomputed through a release. Unresolvable is now a FAILURE — either express
// the offset as a sum this can add (numbers, a Platform ternary, or a prop with
// a numeric default) or the geometry has to be verified some other way.
const unresolved = allCorners.filter((c) => c.offset === null);
ok(
  'every floating circle in that corner has a computable bottom offset',
  unresolved.length === 0,
  unresolved
    .map((c) => `${c.where}  styles.${c.style}  bottom: ${c.raw}  — not a sum this can add, so the overlap with the Brain FAB cannot be computed. It takes a literal number, \`insets.bottom + N\`, a Platform ternary of two numbers, or a prop whose default and every caller are numeric.`)
    .join('\n        '),
);

// ── Check 9: a screen must not print its own native header title again ──────
//
// VIS-19. app/crew.tsx declared `<Stack.Screen options={{ title: 'Crew' }} />`
// under a native header that already prints it, then drew "Crew" again in an
// in-page header row — the word twice, stacked, costing ~90pt of the screen.
// Narrow by construction: only a <Text> whose STYLE NAME says it is a header /
// screen title counts, so a list row that happens to share a word is safe.

const dupTitles: string[] = [];
for (const file of collectFiles(['app'])) {
  const src = stripComments(readFileSync(file, 'utf8'));
  const titles = new Set<string>();
  for (const m of src.matchAll(/<Stack\.Screen[\s\S]{0,400}?title:\s*'([^']+)'/g)) titles.add(m[1]);
  if (titles.size === 0) continue;
  for (const m of src.matchAll(/<Text\s+style=\{styles\.(\w*(?:[Hh]eaderTitle|[Ss]creenTitle|[Pp]ageTitle)\w*)\}[^>]*>([^<{]+)<\/Text>/g)) {
    const label = m[2].trim();
    if (!titles.has(label)) continue;
    dupTitles.push(
      `${relative(ROOT, file)}:${src.slice(0, m.index!).split('\n').length}  styles.${m[1]} prints "${label}", which the native header already shows`,
    );
  }
}
ok(
  'no screen renders its own native header title a second time in the body',
  dupTitles.length === 0,
  dupTitles.join('\n        '),
);

// ── Check 10: an identity tile does not wear a magnifying glass ────────────
//
// VIS-20. Discover's "My Profile" tile shipped a <Search> icon over the
// label, so it read as a search box: a contractor looking for search tapped
// it and landed in Settings, one looking for their profile walked past it.

const IDENTITY_LABELS = /^(My Profile|Profile|My Account|Account)$/;
const iconMismatch: string[] = [];
for (const file of collectFiles(['app', 'components'])) {
  const src = stripComments(readFileSync(file, 'utf8'));
  for (const m of src.matchAll(/>([^<>{}\n]{2,20})<\/Text>/g)) {
    if (!IDENTITY_LABELS.test(m[1].trim())) continue;
    const back = src.slice(Math.max(0, m.index! - 400), m.index!);
    const icon = /<(Search|SearchIcon|MagnifyingGlass)\b/.exec(back);
    if (!icon) continue;
    iconMismatch.push(
      `${relative(ROOT, file)}:${src.slice(0, m.index!).split('\n').length}  "${m[1].trim()}" is labelled with a <${icon[1]}> icon`,
    );
  }
}
ok(
  'identity tiles are not labelled with a search icon',
  iconMismatch.length === 0,
  iconMismatch.join('\n        '),
);

// ── Check 11: every native header title carries the app's typeface ─────────
//
// VIS-18. app/_layout.tsx declares NATIVE_HEADER_TITLE (Fraunces_700Bold, 17)
// and applies it on 41 routes — but `<Stack screenOptions>` set no DEFAULT
// headerTitleStyle, and 27 screens declared their own as
// `{ fontWeight: '700', color: themeColors.text }`. React Navigation merges
// screen options shallowly, so each of those REPLACED the shared style and
// fell back to the system face: moving from a Fraunces-titled financial screen
// to Payments changed the title typeface mid-flow, one tap apart.
//
// Both halves are pinned here: the Stack must carry a default, and no
// individual override may omit the fontFamily.

const headerFailures: string[] = [];

const layoutSrc = stripComments(read('app/_layout.tsx'));
if (!/<Stack\s+screenOptions=\{\{[^}]*headerTitleStyle:/.test(layoutSrc)) {
  headerFailures.push(
    'app/_layout.tsx  <Stack screenOptions> declares no default headerTitleStyle — ' +
    'a route with `title` only falls back to the system typeface',
  );
}

for (const file of collectFiles(['app'])) {
  const rel = relative(ROOT, file);
  const src = stripComments(readFileSync(file, 'utf8'));
  for (const m of src.matchAll(/headerTitleStyle:\s*/g)) {
    const val = readValue(src, m.index! + m[0].length);
    // A named constant, or a spread of one, carries the face already.
    if (/^[A-Z][A-Z0-9_]*$/.test(val.replace(/,$/, '').trim())) continue;
    if (/\.\.\.NATIVE_HEADER_TITLE(_FACE)?\b/.test(val)) continue;
    if (/fontFamily/.test(val)) continue;
    headerFailures.push(
      `${rel}:${src.slice(0, m.index!).split('\n').length}  headerTitleStyle without a fontFamily — ` +
      `this screen's title drops out of Fraunces: ${val.slice(0, 70)}`,
    );
  }
}

ok(
  'every native header title style carries the app typeface (Fraunces)',
  headerFailures.length === 0,
  headerFailures.join('\n        '),
);

// ── Check 12: every theme preset's DERIVED accent family clears AA ─────────
//
// Audit 2026-09-07, "Do next" 4. Settings → APP THEME ships nine presets and
// promised "Customize the app's accent colors to match your brand", but the
// five accent tokens every screen draws in were '#FF6A1A' literals frozen
// inside Theme.light / Theme.dark, so picking Navy repainted the ~420
// `Colors.primary|accent` reads and left the ~3,395 `t.accent*` reads orange.
// The family is now solved per hue in constants/colors.ts, which moves the
// risk: a hue that is legible for the brand orange is not legible for
// Charcoal, and NOTHING in the type system says a solved value made its
// budget. This check is what makes the feature safe to ship.
//
// It calls the real deriveAccentPalette — so it fails if the solver breaks,
// if a preset names a hue no lightness of which can clear AA, and (via the
// distinctness check) if someone "fixes" a failure by collapsing every preset
// back onto the brand family.
//
// Budgets, taken from the token comments in constants/colors.ts:
//   accentLabel  coloured TEXT — AA 4.5:1 on bg / surface / surfaceAlt AND on
//                the accentSoft wash of itself over each (the app's chip idiom)
//   accentFill   a BUTTON, so TWO budgets: white text on it at AA 4.5:1, AND
//                the button itself visible as a shape at WCAG 1.4.11's 3:1
//                against bg / surface / surfaceAlt. Measuring only the first
//                is what let the original fix through review with a Charcoal
//                dark-mode CTA at 1.19:1 on the page — a black slab carrying
//                floating white text, at 461 call sites (review 2026-09-07).
//                No founder-decision exemption here: unlike `accent` this is
//                an interactive control, not decoration.
//   accent       nominally large non-text chrome, but 373 of the 588
//                `color: …accent` sites are text, so in the DARK theme it
//                carries the AA 4.5:1 text budget the brand hue already meets
//                there (#FF6A1A is 5.78:1 on its worst dark ground). In the
//                LIGHT theme the brand sits at 2.50:1 on surfaceAlt and
//                founder decision #1 keeps it there, so the light floor is
//                only "no preset may be harder to see than the brand already
//                is" (review 2026-09-07)
//   accentSoft   a WASH, so it must stay translucent — an opaque value here
//                would silently turn every chip tint into a solid block

const PRESET_AA = 4.5;
// Dark is the AA text bar, not 3:1 — see the accent note above. A picked hue
// solved to a bare 3:1 would have taken every accent-coloured caption in dark
// mode from the brand's 5.78:1 to ~3.05:1 (review 2026-09-07).
const PRESET_CHROME_FLOOR = { light: 2.4, dark: 4.5 } as const;
// A button boundary is a UI component, not chrome — 3:1 in BOTH themes.
const PRESET_FILL_FLOOR = 3.0;
const WHITE: RGB = [255, 255, 255];

// Solver probes, swept alongside the real presets.
//
// The nine shipped hues are all mid-to-dark, so every one of them clears the
// white-on-accentFill budget at its own lightness without the solver moving a
// step — which means the preset sweep alone cannot tell a working fill solve
// from a broken one. (Measured: reversing the accentFill search direction left
// all nine passing.) These probes are the hues the presets do not cover — pale
// enough that the fill MUST darken, dark enough that the dark-theme chrome MUST
// lighten — so the guard exercises the solver rather than only the data. They
// are not offered to users; they exist to fail here first.
const SOLVER_PROBES = [
  { id: 'probe-pale-amber', primary: '#FFE08A' },
  { id: 'probe-pale-cyan', primary: '#7FE3FF' },
  { id: 'probe-near-black', primary: '#0A0A0A' },
] as const;

const accentFailures: string[] = [];
const seenAccents = new Map<string, string>();

for (const theme of ['light', 'dark'] as const) {
  const base = Theme[theme] as unknown as Record<string, string>;
  const grounds = (['bg', 'surface', 'surfaceAlt'] as const).map((g) => {
    const c = parseColor(base[g]);
    return { name: g, hex: base[g], rgb: c ? c.rgb : ([0, 0, 0] as RGB) };
  });

  for (const preset of [...THEME_PRESETS, ...SOLVER_PROBES]) {
    const fam = deriveAccentPalette(preset.primary, theme);
    const label = `${preset.id}/${theme}`;

    const accentC = parseColor(fam.accent);
    const labelC = parseColor(fam.accentLabel);
    const fillC = parseColor(fam.accentFill);
    const softC = parseColor(fam.accentSoft);
    if (!accentC || !labelC || !fillC || !softC) {
      accentFailures.push(`${label}: unparseable family ${JSON.stringify(fam)}`);
      continue;
    }

    // accentSoft must stay a wash of the accent it belongs to.
    if (softC.a >= 1) {
      accentFailures.push(`${label}: accentSoft ${fam.accentSoft} is opaque — every chip tint becomes a solid block`);
    }

    // accentLabel — bare grounds, then the accentSoft wash over each.
    for (const g of grounds) {
      const bare = contrast(labelC.rgb, g.rgb);
      if (bare < PRESET_AA) {
        accentFailures.push(`${label}: accentLabel ${fam.accentLabel} on ${g.name} ${g.hex} = ${round2(bare)}:1 — needs ${PRESET_AA}:1`);
      }
      const tint = composite(softC, g.rgb);
      const onTint = contrast(labelC.rgb, tint);
      if (onTint < PRESET_AA) {
        accentFailures.push(`${label}: accentLabel ${fam.accentLabel} on its accentSoft wash over ${g.name} = ${round2(onTint)}:1 — needs ${PRESET_AA}:1`);
      }
    }

    // accentFill — white text sits on it, AND it is the primary button, so it
    // also has to be visible as a shape against the page it is a button on.
    const white = contrast(fillC.rgb, WHITE);
    if (white < PRESET_AA) {
      accentFailures.push(`${label}: white text on accentFill ${fam.accentFill} = ${round2(white)}:1 — needs ${PRESET_AA}:1`);
    }
    const worstFill = Math.min(...grounds.map((g) => contrast(fillC.rgb, g.rgb)));
    if (worstFill < PRESET_FILL_FLOOR) {
      accentFailures.push(
        `${label}: accentFill ${fam.accentFill} is ${round2(worstFill)}:1 on its worst ${theme} ground — ` +
        `needs ${PRESET_FILL_FLOOR}:1. The primary button is an invisible slab with white text floating on it.`,
      );
    }

    // accent — non-text chrome, worst ground of its own theme.
    const worstChrome = Math.min(...grounds.map((g) => contrast(accentC.rgb, g.rgb)));
    if (worstChrome < PRESET_CHROME_FLOOR[theme]) {
      accentFailures.push(
        `${label}: accent ${fam.accent} is ${round2(worstChrome)}:1 on its worst ${theme} ground — ` +
        `needs ${PRESET_CHROME_FLOOR[theme]}:1. An icon or progress bar in this hue disappears into the page.`,
      );
    }

    // Two presets that resolve to one accent means the picker stopped picking.
    // Probes are exempt: they are never offered, so a collision with one is
    // not a picker defect.
    if (preset.id.startsWith('probe-')) continue;
    const prior = seenAccents.get(`${theme}|${fam.accent.toUpperCase()}`);
    if (prior && prior !== preset.id) {
      accentFailures.push(
        `${label}: accent ${fam.accent} is identical to preset "${prior}" — ` +
        `two presets paint the same app, so the picker is not applying the chosen hue.`,
      );
    }
    seenAccents.set(`${theme}|${fam.accent.toUpperCase()}`, preset.id);
  }
}

// The brand must be one of the presets, or the default the app boots in is not
// a thing the picker can express (and check 12 would not be measuring it).
if (!THEME_PRESETS.some((p) => p.primary.toUpperCase() === BRAND_ACCENT)) {
  accentFailures.push(`no preset carries the brand hue ${BRAND_ACCENT} — the default palette is unreachable from the picker`);
}

ok(
  "every theme preset's derived accent family clears AA on the grounds it lands on",
  accentFailures.length === 0,
  accentFailures.join('\n        '),
);

// ── Check 12b: the accent family is DERIVED, and the picker reaches it ─────
//
// The maths above only protects values that are actually built per hue. Two
// regressions would make it vacuous, and both are one careless edit away —
// re-freezing an accent literal back into Theme.light/dark (where it silently
// wins over the derived one, because ThemeContext spreads the base FIRST), or
// dropping the merge in ThemeContext and returning Theme[resolved] again,
// which is exactly the state this finding was filed against.

const derivationFailures: string[] = [];

const themeObjSrc = (() => {
  const at = colorsSrc.indexOf('export const Theme');
  if (at < 0) return '';
  const end = colorsSrc.indexOf('\n};', at);
  return stripComments(colorsSrc.slice(at, end < 0 ? undefined : end));
})();
for (const tok of ['accent', 'accentHot', 'accentSoft', 'accentLabel', 'accentFill']) {
  if (new RegExp(`\\b${tok}\\s*:`).test(themeObjSrc)) {
    derivationFailures.push(
      `constants/colors.ts: Theme declares \`${tok}\` again — a frozen accent token overrides the derived ` +
      `family for all nine presets, which is the defect audit 2026-09-07 "Do next" 4 was filed against`,
    );
  }
}

const themeCtxSrc = stripComments(read('contexts/ThemeContext.tsx'));
if (!/deriveAccentPalette\(/.test(themeCtxSrc)) {
  derivationFailures.push('contexts/ThemeContext.tsx no longer builds the palette with deriveAccentPalette() — every screen is back on the frozen accent');
}
if (!/subscribeCustomPrimary\(/.test(themeCtxSrc)) {
  derivationFailures.push('contexts/ThemeContext.tsx no longer subscribes to the picker — a saved theme would need an app restart to appear');
}

// Boot must only re-apply a hue this file has actually measured. `theme_colors`
// is a jsonb column older builds wrote with a different preset list, and an
// unknown hue would repaint the whole app in something check 12 never swept
// while Settings displayed MAGE Orange as the selection (review 2026-09-07).
const themeBootSrc = stripComments(read('app/_layout.tsx'));
const loaderCall = /setCustomPrimary\(([^)]*)\)/.exec(themeBootSrc);
if (!loaderCall) {
  derivationFailures.push('app/_layout.tsx no longer restores the saved hue on boot — a picked theme would not survive a relaunch');
} else if (
  // Not `/THEME_PRESETS/` — that string is satisfied by the import line at the
  // top of app/_layout.tsx, so the check passed with the gate itself deleted
  // (proved by mutation, review 2026-09-07). The lookup has to be CALLED, and
  // the value handed to setCustomPrimary has to be something other than the
  // stored hue passed straight through.
  !/THEME_PRESETS\.(some|find|includes|indexOf)\(/.test(themeBootSrc) ||
  /^[\w.]*themeColors\.\w+$/.test(loaderCall[1].trim())
) {
  derivationFailures.push(
    `app/_layout.tsx applies the stored hue (\`setCustomPrimary(${loaderCall[1].trim()})\`) without checking it against ` +
    'THEME_PRESETS — a retired preset from an older build would paint the whole app in a hue no guard has measured',
  );
}

// The DEFAULT may not drift. Every screen the product has ever shipped is
// drawn in these five values, and check 12 above only proves a family clears
// AA — a brand family re-solved a step of lightness away would clear it too,
// and would restyle the entire app on a refactor nobody reviewed as a redesign.
// Pinned here, in the theme's own terms, and asserted through the SAME entry
// point the app calls (lowercase included: a `theme_colors` row could carry
// either spelling).
const BRAND_EXPECTED: Record<'light' | 'dark', Record<string, string>> = {
  light: { accent: '#FF6A1A', accentHot: '#FF8533', accentSoft: 'rgba(255,106,26,0.12)', accentLabel: '#B23E08', accentFill: '#BC440C' },
  dark: { accent: '#FF6A1A', accentHot: '#FF8533', accentSoft: 'rgba(255,106,26,0.16)', accentLabel: '#FF6A1A', accentFill: '#BC440C' },
};
for (const theme of ['light', 'dark'] as const) {
  for (const seed of [BRAND_ACCENT, BRAND_ACCENT.toLowerCase()]) {
    const fam = deriveAccentPalette(seed, theme) as unknown as Record<string, string>;
    for (const [tok, want] of Object.entries(BRAND_EXPECTED[theme])) {
      if ((fam[tok] ?? '').toUpperCase() !== want.toUpperCase()) {
        derivationFailures.push(
          `deriveAccentPalette('${seed}', '${theme}').${tok} is ${fam[tok]} — the shipped default is ${want}. ` +
          'The no-custom-colour palette must stay the measured brand family, not a re-solve of it.',
        );
      }
    }
  }
}

const settingsSrc = stripComments(read('app/(tabs)/settings/index.tsx'));
if (!/setCustomPrimary\(/.test(settingsSrc)) {
  derivationFailures.push('app/(tabs)/settings/index.tsx no longer sets the chosen hue — the APP THEME picker writes nothing');
}
if (/restarting the app/i.test(settingsSrc)) {
  derivationFailures.push('app/(tabs)/settings/index.tsx still tells the user to restart for theme changes — the palette is live, so the instruction is false');
}

ok(
  'the accent family stays derived per hue and the picker still reaches it',
  derivationFailures.length === 0,
  derivationFailures.join('\n        '),
);

console.log('');
process.exit(failures === 0 ? 0 : 1);

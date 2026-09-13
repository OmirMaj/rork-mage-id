// validate-theme-surface-pairs.ts — no INVERTING theme text stranded on a
// hardcoded light surface.
//
// WHY THIS EXISTS. The 2026-08-26 visual audit found unread rows in the
// notifications inbox rendered near-invisible: `rowUnread` hardcoded a cream
// `#FFF7EE` background while the row's text used `t.text` / `t.textSecondary`.
// In LIGHT mode that reads fine — dark text on cream. In DARK mode `t.text`
// becomes near-white while the hardcoded background stays cream, so the text
// disappears. Two more were then found in client-portal-setup (`proposalRow`,
// `coApprovalRow`).
//
// THE PRECISE RULE. A hardcoded light background is only a bug when the text
// ON IT uses an INVERTING foreground token — `text`, `textSecondary`,
// `textMuted`. Those flip with the theme. Brand/semantic hues (`accent`,
// `success`, `danger`, `warning`) do NOT invert, so orange-on-cream is stable
// and fine. A light fill paired with a HARDCODED dark text colour is also fine
// — both ends are pinned.
//
// PAIRING HEURISTIC. This codebase names styles by shared prefix
// (`proposalRow` + `proposalAmount` + `proposalNote`; `rowUnread` + `rowTitle`
// + `rowBody`). So for a style with a light hardcoded background we check:
//   1. a `color:` inside the SAME style object, then
//   2. sibling styles sharing the longest alphabetic prefix.
// If any of those uses an inverting token, the surface is flagged.
//
// Run via: bun run test:theme-surface-pairs

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOTS = ['app', 'components'];

/** Foreground tokens that FLIP between themes. Brand hues are excluded on
 *  purpose — they stay the same colour in both themes. */
const INVERTING = /\b(?:t|themeColors|colors)\.(?:text|textSecondary|textMuted)\b/;

function isLightHex(hex: string): boolean {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  if (full.length < 6) return false;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return false;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.72;
}

// Style-level exemptions, verified by reading the JSX on 2026-08-26. The
// prefix heuristic pairs a surface with same-family text styles, which
// over-matches when the surface holds only an ICON, or when the text on it
// uses a brand hue. Keyed `file::styleName` so an exemption can't silently
// cover a different style added later in the same file.
const ALLOW_STYLE: Record<string, string> = {
  'app/client-portal-setup.tsx::budgetStatusBadge':
    'icon-only badge (Check / X, hardcoded colors) — budgetStatusValue is a sibling rendered outside it',
  'app/aia-pay-app.tsx::modalIconWrap':
    'icon-only wrap (ShieldAlert, hardcoded #C26A00) — modalTitle renders outside it',
  'components/ClientPaywall.tsx::subCardTag':
    'contains only subCardTagText, which uses t.accent — a brand hue that does not invert',
};

/** Files that legitimately hardcode a light surface. Each needs a reason. */
const ALLOW: Record<string, string> = {
  'components/ErrorBoundary.tsx':
    'last-resort crash screen — may render without theme context; text is hardcoded dark',
  'components/SignaturePad.tsx':
    'signature canvas must be paper-white in both themes; ink is hardcoded dark',
  'app/compare-drawings.tsx':
    'drawing comparison canvas — paper surface by definition',
  'app/plan-viewer.tsx':
    'plan sheet canvas — paper surface by definition',
  'app/post-rfp.tsx':
    'print/PDF-styled RFP preview — intentionally paper, hardcoded dark text',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

/** Longest leading alphabetic run — the naming-convention "family". */
function familyOf(styleName: string): string {
  const m = styleName.match(/^[a-z]+/);
  return m ? m[0] : styleName;
}

interface Finding { file: string; line: number; hex: string; style: string; via: string }

const findings: Finding[] = [];
let scannedLight = 0;

for (const root of ROOTS) {
  for (const file of walk(root)) {
    const src = readFileSync(file, 'utf8');
    if (!/ThemeColors|useThemedStyles|useTheme\(/.test(src)) continue;

    const lines = src.split('\n');

    // Collect style blocks: `name: { ... }` (single- or multi-line).
    type Block = { name: string; body: string; line: number };
    const blocks: Block[] = [];
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^\s*([A-Za-z][A-Za-z0-9_]*):\s*\{/);
      if (!m) continue;
      let depth = 0;
      let body = '';
      for (let j = i; j < Math.min(lines.length, i + 40); j++) {
        body += lines[j] + '\n';
        depth += (lines[j].match(/\{/g) ?? []).length;
        depth -= (lines[j].match(/\}/g) ?? []).length;
        if (depth <= 0) break;
      }
      blocks.push({ name: m[1], body, line: i + 1 });
    }

    for (const b of blocks) {
      const bg = b.body.match(/backgroundColor:\s*'(#[0-9A-Fa-f]{3,8})'/);
      if (!bg || !isLightHex(bg[1])) continue;
      scannedLight++;

      // 1. Own block declares a colour → that settles it.
      const ownColor = b.body.match(/\bcolor:\s*([^,\n}]+)/);
      if (ownColor) {
        if (INVERTING.test(ownColor[1])) {
          findings.push({ file, line: b.line, hex: bg[1], style: b.name, via: `own color: ${ownColor[1].trim()}` });
        }
        continue; // hardcoded own colour = pinned = safe
      }

      // 2. Sibling styles in the same naming family.
      const fam = familyOf(b.name);
      const sibs = blocks.filter(o => o.name !== b.name && familyOf(o.name) === fam);
      const bad = sibs.find(o => {
        const c = o.body.match(/\bcolor:\s*([^,\n}]+)/);
        return c && INVERTING.test(c[1]);
      });
      if (bad) {
        findings.push({ file, line: b.line, hex: bg[1], style: b.name, via: `sibling ${bad.name} uses an inverting token` });
      }
    }
  }
}

// ── THE INVERSE RULE ───────────────────────────────────────────────────────
//
// Everything above catches a hardcoded LIGHT FILL under inverting text. This
// catches the mirror: the DARK theme's own `textSecondary` literal, '#9AA3AD',
// pasted into a themed StyleSheet where it lands on a light surface.
//
// It is the same class of mistake and it was far more common — the 2026-09-07
// audit counted 82 instances, worst in app/equipment-detail.tsx (13),
// components/schedule/TaskInspector.tsx (10), app/warranties.tsx (8) and
// app/coi-vault.tsx (6). On a near-white background that literal measures
// 2.2–2.6:1, well under the 4.5:1 floor, and it survived every existing check
// because nothing here looked for a FOREGROUND literal.
//
// Only RN style values are matched (`color: '#9AA3AD'`). Deliberately NOT
// flagged: the same string inside a comment explaining this very fix, and
// inside email/PDF HTML (utils/emailLayout.ts, utils/emailService.ts,
// app/warranty-walk.tsx) where there is no theme to read and a literal is the
// only option.
//
// The replacement is `neutralInk(t)` from components/ui/ink.ts, which picks the
// same grey family from the background's luminance so it clears AA in light and
// keeps the intended colour in dark.
const DARK_TEXT_SECONDARY = '#9AA3AD';
const FG_LITERAL_RE = new RegExp(`color:\\s*'${DARK_TEXT_SECONDARY}'`, 'i');
const strandedFg: { file: string; line: number }[] = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const src = readFileSync(file, 'utf8');
    if (!src.includes(DARK_TEXT_SECONDARY)) continue;
    // Themed files only: an unthemed screen has no token to reach for, and
    // validate-app-slop owns the "this file should be themed at all" question.
    if (!/ThemeColors|useTheme|useThemedStyles/.test(src)) continue;
    src.split('\n').forEach((ln, i) => {
      const code = ln.replace(/\/\/.*$/, '');
      if (FG_LITERAL_RE.test(code)) strandedFg.push({ file, line: i + 1 });
    });
  }
}

const unexpected = findings.filter(f => !ALLOW[f.file] && !ALLOW_STYLE[`${f.file}::${f.style}`]);

console.log('\ntheme surface-pair guard (inverting theme text on a hardcoded light fill):');
console.log(`  scanned ${scannedLight} light hardcoded background(s) in themed files`);
if (strandedFg.length > 0) {
  console.error(`\n  FAIL  ${strandedFg.length} themed style(s) hardcode the DARK theme's textSecondary as a foreground.`);
  console.error(`        '${DARK_TEXT_SECONDARY}' measures 2.2-2.6:1 on a light surface — under the 4.5:1 floor.`);
  console.error('        Use neutralInk(t) from @/components/ui, which picks the grey by background luminance.\n');
  for (const f of strandedFg) console.error(`        ${f.file}:${f.line}`);
}
if (unexpected.length === 0 && strandedFg.length === 0) {
  console.log('  PASS  none pair an inverting foreground token with a hardcoded light fill');
  console.log(`  PASS  no themed style hardcodes '${DARK_TEXT_SECONDARY}' as a foreground`);
  process.exit(0);
}
if (unexpected.length === 0) process.exit(1);

console.error(`  FAIL  ${unexpected.length} surface(s) strand inverting theme text on a light fill.`);
console.error('        These read fine in light mode and VANISH in dark mode.');
console.error('        Use a theme token: accentSoft / successSoft / warningSoft / dangerSoft / neutralSoft / surfaceAlt,');
console.error('        or pin the text to a hardcoded dark colour.\n');
for (const f of unexpected) {
  console.error(`        ${f.file}:${f.line}  ${f.style}  bg ${f.hex}`);
  console.error(`          ↳ ${f.via}`);
}
process.exit(1);

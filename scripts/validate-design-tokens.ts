// validate-design-tokens.ts — smoke test for the design system.
//
// Why this exists: there are 0 actual unit/integration tests in the
// codebase (the audit flagged this). A full Jest setup with Expo
// mocks is its own multi-day project. In the meantime, this script
// at least guarantees the design system itself is internally
// consistent.
//
// Strategy: read token files as source and pattern-match. No React
// Native runtime dependency, no Expo, no build pipeline — just text
// assertions. Catches regressions like accidentally removing a
// token or flipping a brand color back to an iOS default.
//
// Run via: `bun run scripts/validate-design-tokens.ts`
// Wire into CI when full test infra lands.

import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8');
}

interface Check { name: string; pass: boolean; detail?: string }
const checks: Check[] = [];
const ok = (name: string) => checks.push({ name, pass: true });
const fail = (name: string, detail: string) => checks.push({ name, pass: false, detail });

// ─── Typography ──────────────────────────────────────────────────
const typo = read('constants/typography.ts');
const requiredTypeKeys = [
  'display:', 'displayItalic:', 'displaySm:', 'displaySmItalic:',
  'mono:', 'monoSm:',
  'largeTitle:', 'title1:', 'title2:', 'title3:',
  'headline:', 'body:', 'bodyEmphasized:',
  'callout:', 'subhead:', 'footnote:',
  'eyebrow:',
];
for (const k of requiredTypeKeys) {
  if (typo.includes(k)) ok(`Type.${k.slice(0, -1)} exists`);
  else fail(`Type.${k.slice(0, -1)} exists`, `missing key in typography.ts`);
}

if (typo.includes("Fraunces_700Bold")) ok('Display uses Fraunces font');
else fail('Display uses Fraunces font', 'no Fraunces fontFamily found');

if (typo.includes("JetBrainsMono_500Medium")) ok('Mono uses JetBrains font');
else fail('Mono uses JetBrains font', 'no JetBrainsMono fontFamily found');

// ─── Colors ──────────────────────────────────────────────────────
const colors = read('constants/colors.ts');
const requiredColorKeys = [
  'cream', 'ink', 'concrete', 'bone',
  'accent', 'accentHot', 'accentSoft', 'accentGlow',
  'primary', 'success', 'warning', 'error', 'info',
  'background', 'surface', 'text', 'textSecondary',
];
for (const k of requiredColorKeys) {
  if (new RegExp(`\\b${k}[ :\\(]`).test(colors)) ok(`Colors.${k} exists`);
  else fail(`Colors.${k} exists`, `missing in colors.ts`);
}

// Brand amber must be #FF6A1A, not iOS-system #FF9500
if (colors.includes("'#FF6A1A'") || colors.includes('"#FF6A1A"')) {
  ok('Brand amber #FF6A1A is the default accent');
} else {
  fail('Brand amber #FF6A1A is the default accent', 'amber value not found');
}

// Cream must match marketing palette
if (colors.includes("'#F4EFE6'") || colors.includes('"#F4EFE6"')) {
  ok('Brand cream #F4EFE6 matches marketing palette');
} else {
  fail('Brand cream #F4EFE6 matches marketing palette', 'cream value not found');
}

// ─── Motion ──────────────────────────────────────────────────────
const tokens = read('constants/designTokens.ts');
if (tokens.includes('[0.16, 1.0, 0.3, 1]') || tokens.includes('[0.16,1.0,0.3,1]') || tokens.includes('[0.16, 1, 0.3, 1]')) {
  ok('Motion.easing.decelerate is brand curve [0.16,1,0.3,1]');
} else {
  fail('Motion.easing.decelerate is brand curve', 'brand curve not found — may be iOS default');
}

if (tokens.includes('TouchTarget') && tokens.includes('min: 44')) {
  ok('Apple-HIG touch target floor (44pt) preserved');
} else {
  fail('Apple-HIG touch target floor', 'TouchTarget.min: 44 not found');
}

// ─── Cross-system consistency ────────────────────────────────────
// Check that the marketing site uses the same amber as the app
let marketing = '';
try { marketing = read('marketing/landing.css'); }
catch { /* marketing folder may not exist in some checkouts */ }

if (marketing) {
  if (marketing.includes('#FF6A1A')) ok('Marketing site amber matches app amber');
  else fail('Marketing site amber matches app amber', 'marketing/landing.css missing #FF6A1A');

  if (marketing.includes('Fraunces') && marketing.includes('JetBrains Mono')) {
    ok('Marketing site shares app font palette (Fraunces + JetBrains Mono)');
  } else {
    fail('Marketing site shares app font palette', 'fonts differ');
  }
}

// ─── Report ──────────────────────────────────────────────────────
const passed = checks.filter(c => c.pass).length;
const failed = checks.filter(c => !c.pass);

console.log('\nDesign system token validation:');
console.log(`  ✓ ${passed} checks passed`);
if (failed.length > 0) {
  console.log(`  ✗ ${failed.length} checks failed:\n`);
  for (const c of failed) console.log(`    - ${c.name}: ${c.detail ?? '?'}`);
  process.exit(1);
}
console.log(`  Total: ${checks.length}\n`);
process.exit(0);

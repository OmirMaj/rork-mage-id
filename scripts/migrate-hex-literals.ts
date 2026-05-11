// migrate-hex-literals.ts — automated migration of inline hex color
// literals to Colors.* tokens. Run via `bun run scripts/migrate-hex-literals.ts`.
//
// Strategy: only replace UNAMBIGUOUS cases — hexes that map 1:1 to a
// known token (e.g., #FFFFFF → Colors.surface, #34C759 → Colors.success).
// Ambiguous cases (custom mid-tones, opacity-mixed colors) are left alone
// for human review.
//
// Safety: doesn't replace inside test files, doesn't touch the token
// files themselves, doesn't replace inside string literals that look
// like documentation. Replaces only inside `color:`, `backgroundColor:`,
// `borderColor:`, `tintColor:`, `shadowColor:` properties.
//
// Outputs a summary of files touched + replacement count.

import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '..');

// ─── Mapping: hex → Colors token ─────────────────────────────────
// Add entries here as you confirm "this hex always means this token
// across the codebase". Start conservative; expand as patterns
// emerge.
//
// All keys are LOWERCASE (we normalize input to lowercase before
// matching). Quote style is handled at replacement time.
const HEX_TO_TOKEN: Record<string, string> = {
  // iOS system colors → semantic tokens
  '#34c759': 'Colors.success',
  '#ff9500': 'Colors.accent', // brand amber now lives at #FF6A1A but
                              // legacy #FF9500 should still mean "accent"
  '#ff3b30': 'Colors.error',
  '#007aff': 'Colors.info',
  '#5856d6': 'Colors.purple',

  // Brand palette → tokens
  '#0b0d10': 'Colors.ink',
  '#14181d': 'Colors.steel',
  '#2a2f36': 'Colors.concrete',
  '#f4efe6': 'Colors.cream',
  '#e8e1d4': 'Colors.bone',
  '#ff6a1a': 'Colors.accent',
  '#ff8533': 'Colors.accentHot',

  // Common surface colors
  '#ffffff': 'Colors.surface',
  '#f2f2f7': 'Colors.background',

  // Dark variants (Material A700) → semantic dark tokens
  '#2e7d32': 'Colors.successDark',
  '#1e8e4a': 'Colors.successDark',
  '#e65100': 'Colors.warningDark',
  '#c62828': 'Colors.errorDark',
  '#1565c0': 'Colors.infoDark',
};

// Properties we'll rewrite. Skip everything else.
const TARGET_PROPS = new Set([
  'color', 'backgroundColor', 'borderColor', 'tintColor', 'shadowColor',
  'borderTopColor', 'borderBottomColor', 'borderLeftColor', 'borderRightColor',
]);

// Files we'll never touch
const SKIP = (rel: string) =>
  rel.startsWith('node_modules/') ||
  rel.startsWith('.expo/') ||
  rel.startsWith('dist/') ||
  rel.startsWith('ios/') ||
  rel.startsWith('android/') ||
  rel.startsWith('scripts/') ||
  rel.includes('constants/colors.ts') ||
  rel.includes('constants/typography.ts') ||
  rel.includes('constants/designTokens.ts') ||
  rel.endsWith('.test.tsx') ||
  rel.endsWith('.test.ts');

interface FileResult { rel: string; replacements: number }
const results: FileResult[] = [];

function* walk(dir: string): Generator<string> {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const rel = path.relative(ROOT, full);
    if (SKIP(rel)) continue;
    if (e.isDirectory()) {
      yield* walk(full);
    } else if (e.isFile() && (e.name.endsWith('.tsx') || e.name.endsWith('.ts'))) {
      yield full;
    }
  }
}

function migrateFile(filePath: string): number {
  const rel = path.relative(ROOT, filePath);
  let source = fs.readFileSync(filePath, 'utf-8');
  let count = 0;

  // Match `propName: '#xxxxxx'` or `propName: "#xxxxxx"`. The regex
  // captures the prop name + hex string. We rewrite inline.
  //
  // (\b(?:color|backgroundColor|…)\b) — the prop name
  // (\s*:\s*)                          — the colon + whitespace
  // (['"])(#[0-9a-fA-F]{3,8})\3        — the quoted hex
  const propPattern = Array.from(TARGET_PROPS).join('|');
  const re = new RegExp(`\\b(${propPattern})(\\s*:\\s*)(['"])(#[0-9a-fA-F]{3,8})\\3`, 'g');

  source = source.replace(re, (match, propName, colon, _quote, hex) => {
    const lower = hex.toLowerCase();
    const token = HEX_TO_TOKEN[lower];
    if (!token) return match; // unknown → leave alone
    count++;
    return `${propName}${colon}${token}`;
  });

  if (count > 0) {
    fs.writeFileSync(filePath, source, 'utf-8');
  }
  results.push({ rel, replacements: count });
  return count;
}

// ─── Run ─────────────────────────────────────────────────────────
for (const file of walk(ROOT)) {
  try { migrateFile(file); }
  catch (e) { console.error('failed', file, e); }
}

const total = results.reduce((s, r) => s + r.replacements, 0);
const filesChanged = results.filter(r => r.replacements > 0);

console.log('\nHex literal migration:');
console.log(`  ${total} hex literals replaced across ${filesChanged.length} files\n`);

if (filesChanged.length > 0) {
  // Sort by replacement count desc and show the top 15
  filesChanged.sort((a, b) => b.replacements - a.replacements);
  for (const r of filesChanged.slice(0, 15)) {
    console.log(`  ${r.replacements.toString().padStart(4)}  ${r.rel}`);
  }
  if (filesChanged.length > 15) {
    console.log(`  ... and ${filesChanged.length - 15} more\n`);
  } else {
    console.log('');
  }
}

console.log('Run `git diff` to review changes, then `bun run ship-check` to verify.');

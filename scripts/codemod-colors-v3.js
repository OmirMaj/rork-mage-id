#!/usr/bin/env node
// Color hex codemod, third pass — extends to dark-variant + system-named
// hexes that we just added to the token set.

const fs = require('fs');
const path = require('path');

const ROOTS = ['app', 'components'];

const HEX_TO_TOKEN = {
  // Dark variants — typically used as foreground text on light tinted bgs.
  "'#2E7D32'": 'Colors.successDark',
  "'#1E8E4A'": 'Colors.successDark',  // close shade — consolidate
  "'#1A6B3C'": 'Colors.successDark',  // close shade (also matches Colors.primary default)
  "'#E65100'": 'Colors.warningDark',
  "'#C62828'": 'Colors.errorDark',
  "'#1565C0'": 'Colors.infoDark',
  // Apple iOS system colors
  "'#5856D6'": 'Colors.purple',
  "'#6A1B9A'": 'Colors.purple',  // close shade — material purple
  "'#FF6A1A'": 'Colors.orange',
  // Surface
  "'#FFFFFF'": 'Colors.surface',  // safe on backgroundColor; risky on color
  // Black text — Colors.text is '#000000' exactly
  "'#000000'": 'Colors.text',
  // Doubled
  '"#2E7D32"': 'Colors.successDark',
  '"#1E8E4A"': 'Colors.successDark',
  '"#1A6B3C"': 'Colors.successDark',
  '"#E65100"': 'Colors.warningDark',
  '"#C62828"': 'Colors.errorDark',
  '"#1565C0"': 'Colors.infoDark',
  '"#5856D6"': 'Colors.purple',
  '"#6A1B9A"': 'Colors.purple',
  '"#FF6A1A"': 'Colors.orange',
  '"#FFFFFF"': 'Colors.surface',
  '"#000000"': 'Colors.text',
};

const COLOR_CONTEXT_RE = /\b(color|Color|tint|border|background|shadow|fill|stroke)\b/i;

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (/\.(tsx|ts)$/.test(entry.name)) files.push(full);
  }
  return files;
}

function ensureColorsImport(src) {
  if (/from ['"]@\/constants\/colors['"]/.test(src)) {
    if (/import\s*\{\s*([^}]*)\}\s*from\s*['"]@\/constants\/colors['"]/.test(src)) {
      const m = src.match(/import\s*\{\s*([^}]*)\}\s*from\s*['"]@\/constants\/colors['"]/);
      const names = m[1].split(',').map(s => s.trim()).filter(Boolean);
      if (!names.includes('Colors')) {
        names.push('Colors');
        return src.replace(
          /import\s*\{\s*[^}]*\}\s*from\s*['"]@\/constants\/colors['"]/,
          `import { ${names.join(', ')} } from '@/constants/colors'`
        );
      }
      return src;
    }
    return src;
  }
  const importLines = [...src.matchAll(/^import .+;$/gm)];
  if (importLines.length === 0) {
    return `import { Colors } from '@/constants/colors';\n` + src;
  }
  const last = importLines[importLines.length - 1];
  const insertAt = last.index + last[0].length;
  return src.slice(0, insertAt) + `\nimport { Colors } from '@/constants/colors';` + src.slice(insertAt);
}

let totalReplacements = 0;
let touchedFiles = 0;

const files = ROOTS.flatMap(r => fs.existsSync(r) ? walk(r) : []);

// Token files themselves are exempt
const EXEMPT = new Set(['constants/colors.ts', 'constants/typography.ts', 'constants/designTokens.ts']);

for (const file of files) {
  if (EXEMPT.has(file)) continue;
  let src = fs.readFileSync(file, 'utf8');
  let changes = 0;

  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!COLOR_CONTEXT_RE.test(line)) continue;

    let newLine = line;
    for (const [hex, token] of Object.entries(HEX_TO_TOKEN)) {
      while (newLine.includes(hex)) {
        newLine = newLine.replace(hex, token);
        changes++;
      }
    }
    lines[i] = newLine;
  }

  if (changes > 0) {
    src = lines.join('\n');
    src = ensureColorsImport(src);
    fs.writeFileSync(file, src);
    totalReplacements += changes;
    touchedFiles++;
  }
}

console.log(`Pass 3: touched ${touchedFiles} files; ${totalReplacements} additional hex → token replacements.`);

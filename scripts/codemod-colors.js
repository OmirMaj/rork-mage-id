#!/usr/bin/env node
// Color hex → semantic token codemod.
//
// Replaces high-frequency status hex literals with Colors.* tokens
// across app/ + components/. Only matches values of color-related keys
// (color, backgroundColor, borderColor, tintColor, shadowColor,
// borderTopColor, borderBottomColor, borderLeftColor, borderRightColor)
// — not arbitrary string literals in chart palettes or comments.
//
// Adds `import { Colors } from '@/constants/colors'` if needed.

const fs = require('fs');
const path = require('path');

const ROOTS = ['app', 'components'];

// Map of hex → Colors.* token. Only safe, semantic mappings.
// '#34C759' is system green / our success color.
// '#FF9500' is system orange / our warning + accent.
// '#FF3B30' is system red / our error.
// '#007AFF' is system blue / our info.
// Lights are tinted backgrounds.
const HEX_TO_TOKEN = {
  '#34C759': 'Colors.success',
  '#FF9500': 'Colors.warning',
  '#FF3B30': 'Colors.error',
  '#007AFF': 'Colors.info',
  '#FFF3E0': 'Colors.warningLight',  // exact match
  '#FFF0EF': 'Colors.errorLight',    // exact match
  '#FFEBEE': 'Colors.errorLight',    // close shade — consolidate
  '#E8FAF0': 'Colors.successLight',  // exact match
  '#E8F5E9': 'Colors.successLight',  // close shade — consolidate
  '#E8F5ED': 'Colors.successLight',  // close shade — consolidate
  '#EBF3FF': 'Colors.infoLight',     // exact match
  '#E3F2FD': 'Colors.infoLight',     // close shade — consolidate
};

const COLOR_KEYS = [
  'color', 'backgroundColor', 'borderColor', 'tintColor', 'shadowColor',
  'borderTopColor', 'borderBottomColor', 'borderLeftColor', 'borderRightColor',
  'placeholderTextColor',
];

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
    // already imports Colors module — make sure Colors is in the named imports
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
    return src;  // default import — leave alone
  }
  // need to add the import — slot after the last existing import
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

for (const file of files) {
  let src = fs.readFileSync(file, 'utf8');
  let changes = 0;

  for (const [hex, token] of Object.entries(HEX_TO_TOKEN)) {
    // Match `key: '#HEX'` (object property) → `key: Colors.x`
    const propRe = new RegExp(
      `\\b(${COLOR_KEYS.join('|')})(\\s*:\\s*)['"]${hex}['"]`,
      'g'
    );
    src = src.replace(propRe, (m, key, sep) => {
      changes++;
      return `${key}${sep}${token}`;
    });

    // Match `color={'#HEX'}` or `color="#HEX"` (JSX prop) → `color={Colors.x}`
    const jsxRe1 = new RegExp(
      `\\b(${COLOR_KEYS.join('|')})=\\{?['"]${hex}['"]\\}?`,
      'g'
    );
    src = src.replace(jsxRe1, (m, key) => {
      changes++;
      return `${key}={${token}}`;
    });
  }

  if (changes > 0) {
    src = ensureColorsImport(src);
    fs.writeFileSync(file, src);
    totalReplacements += changes;
    touchedFiles++;
  }
}

console.log(`Touched ${touchedFiles} files; ${totalReplacements} hex → token replacements.`);

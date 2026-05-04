#!/usr/bin/env node
// Color hex → token codemod, second pass.
//
// Pass 1 (codemod-colors.js) handled simple `key: '#hex'` and JSX
// `key={'#hex'}` cases. This pass handles:
//   1. Bare hex literals inside ternaries / expressions inside an
//      already-color-context object property or JSX attribute. We replace
//      every standalone occurrence of one of our tracked hex strings.
//   2. We confirm the import of Colors is present (idempotent).
//
// Risk: a hex literal might appear in a chart color palette array or a
// non-color context. Mitigation: we restrict to files we already touched
// in pass 1 (which by definition have color-context use of these
// literals) PLUS we scan the rest of app/ + components/ for OBVIOUS
// color-context lines (lines containing one of our color keys somewhere
// nearby). To stay safe we only do replacements on lines that contain
// any of `color`, `Color`, `tint`, `border`, `background`, `shadow`,
// `fill`, `stroke` — this filters out chart palettes, ID strings, etc.

const fs = require('fs');
const path = require('path');

const ROOTS = ['app', 'components'];

const HEX_TO_TOKEN = {
  "'#34C759'": 'Colors.success',
  "'#FF9500'": 'Colors.warning',
  "'#FF3B30'": 'Colors.error',
  "'#007AFF'": 'Colors.info',
  "'#FFF3E0'": 'Colors.warningLight',
  "'#FFF0EF'": 'Colors.errorLight',
  "'#FFEBEE'": 'Colors.errorLight',
  "'#E8FAF0'": 'Colors.successLight',
  "'#E8F5E9'": 'Colors.successLight',
  "'#E8F5ED'": 'Colors.successLight',
  "'#EBF3FF'": 'Colors.infoLight',
  "'#E3F2FD'": 'Colors.infoLight',
  // Double-quoted variants too
  '"#34C759"': 'Colors.success',
  '"#FF9500"': 'Colors.warning',
  '"#FF3B30"': 'Colors.error',
  '"#007AFF"': 'Colors.info',
  '"#FFF3E0"': 'Colors.warningLight',
  '"#FFF0EF"': 'Colors.errorLight',
  '"#FFEBEE"': 'Colors.errorLight',
  '"#E8FAF0"': 'Colors.successLight',
  '"#E8F5E9"': 'Colors.successLight',
  '"#E8F5ED"': 'Colors.successLight',
  '"#EBF3FF"': 'Colors.infoLight',
  '"#E3F2FD"': 'Colors.infoLight',
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

for (const file of files) {
  let src = fs.readFileSync(file, 'utf8');
  let changes = 0;

  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!COLOR_CONTEXT_RE.test(line)) continue;

    let newLine = line;
    for (const [hex, token] of Object.entries(HEX_TO_TOKEN)) {
      // Use indexOf-based replace (no regex special chars in hex)
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

console.log(`Pass 2: touched ${touchedFiles} files; ${totalReplacements} additional hex → token replacements.`);

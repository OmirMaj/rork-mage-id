#!/usr/bin/env node
// fontSize codemod, second pass — covers the new bodyCompact (14) and
// subheadline (18) tokens.

const fs = require('fs');
const path = require('path');

const ROOTS = ['app', 'components'];

const SIZE_TO_TOKEN = {
  14: 'Type.bodyCompact.fontSize',
  18: 'Type.subheadline.fontSize',
};

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (/\.(tsx|ts)$/.test(entry.name)) files.push(full);
  }
  return files;
}

function ensureTypeImport(src) {
  if (/from ['"]@\/constants\/typography['"]/.test(src)) {
    if (/import\s*\{\s*([^}]*)\}\s*from\s*['"]@\/constants\/typography['"]/.test(src)) {
      const m = src.match(/import\s*\{\s*([^}]*)\}\s*from\s*['"]@\/constants\/typography['"]/);
      const names = m[1].split(',').map(s => s.trim()).filter(Boolean);
      if (!names.includes('Type')) {
        names.push('Type');
        return src.replace(
          /import\s*\{\s*[^}]*\}\s*from\s*['"]@\/constants\/typography['"]/,
          `import { ${names.join(', ')} } from '@/constants/typography'`
        );
      }
      return src;
    }
    return src;
  }
  const importLines = [...src.matchAll(/^import .+;$/gm)];
  if (importLines.length === 0) {
    return `import { Type } from '@/constants/typography';\n` + src;
  }
  const last = importLines[importLines.length - 1];
  const insertAt = last.index + last[0].length;
  return src.slice(0, insertAt) + `\nimport { Type } from '@/constants/typography';` + src.slice(insertAt);
}

let totalReplacements = 0;
let touchedFiles = 0;

const files = ROOTS.flatMap(r => fs.existsSync(r) ? walk(r) : []);

for (const file of files) {
  let src = fs.readFileSync(file, 'utf8');
  let changes = 0;

  for (const [size, token] of Object.entries(SIZE_TO_TOKEN)) {
    const re = new RegExp(`\\bfontSize:\\s*${size}\\b(?!\\d|\\.)`, 'g');
    const before = src;
    src = src.replace(re, `fontSize: ${token}`);
    if (src !== before) {
      const matches = before.match(re);
      changes += matches ? matches.length : 0;
    }
  }

  if (changes > 0) {
    src = ensureTypeImport(src);
    fs.writeFileSync(file, src);
    totalReplacements += changes;
    touchedFiles++;
  }
}

console.log(`fontSize v2: touched ${touchedFiles} files; ${totalReplacements} 14/18 → bodyCompact/subheadline.`);

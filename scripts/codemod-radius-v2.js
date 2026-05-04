#!/usr/bin/env node
// borderRadius literal codemod, second pass — covers the new card (12)
// and panel (16) tokens added to designTokens.ts.

const fs = require('fs');
const path = require('path');

const ROOTS = ['app', 'components'];

const RADIUS_TO_TOKEN = {
  12: 'Tokens.radius.card',
  16: 'Tokens.radius.panel',
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

function ensureTokensImport(src) {
  if (/from ['"]@\/constants\/designTokens['"]/.test(src)) {
    if (/import\s*\{\s*([^}]*)\}\s*from\s*['"]@\/constants\/designTokens['"]/.test(src)) {
      const m = src.match(/import\s*\{\s*([^}]*)\}\s*from\s*['"]@\/constants\/designTokens['"]/);
      const names = m[1].split(',').map(s => s.trim()).filter(Boolean);
      if (!names.includes('Tokens')) {
        names.push('Tokens');
        return src.replace(
          /import\s*\{\s*[^}]*\}\s*from\s*['"]@\/constants\/designTokens['"]/,
          `import { ${names.join(', ')} } from '@/constants/designTokens'`
        );
      }
      return src;
    }
    return src;
  }
  const importLines = [...src.matchAll(/^import .+;$/gm)];
  if (importLines.length === 0) {
    return `import { Tokens } from '@/constants/designTokens';\n` + src;
  }
  const last = importLines[importLines.length - 1];
  const insertAt = last.index + last[0].length;
  return src.slice(0, insertAt) + `\nimport { Tokens } from '@/constants/designTokens';` + src.slice(insertAt);
}

let totalReplacements = 0;
let touchedFiles = 0;

const files = ROOTS.flatMap(r => fs.existsSync(r) ? walk(r) : []);

for (const file of files) {
  let src = fs.readFileSync(file, 'utf8');
  let changes = 0;

  for (const [val, token] of Object.entries(RADIUS_TO_TOKEN)) {
    const re = new RegExp(`\\bborderRadius:\\s*${val}\\b(?!\\d|\\.)`, 'g');
    const before = src;
    src = src.replace(re, `borderRadius: ${token}`);
    if (src !== before) {
      const matches = before.match(re);
      changes += matches ? matches.length : 0;
    }
  }

  if (changes > 0) {
    src = ensureTokensImport(src);
    fs.writeFileSync(file, src);
    totalReplacements += changes;
    touchedFiles++;
  }
}

console.log(`borderRadius v2: touched ${touchedFiles} files; ${totalReplacements} 12/16 → Tokens.radius.card/panel.`);

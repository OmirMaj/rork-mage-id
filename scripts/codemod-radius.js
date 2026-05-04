#!/usr/bin/env node
// borderRadius literal → Tokens.radius.X codemod.
//
// Same strategy as fontSize: replace `borderRadius: 12` with
// `borderRadius: Tokens.radius.lg` (or whichever exact token matches).
// Only EXACT matches — no rounding, no visual changes.

const fs = require('fs');
const path = require('path');

const ROOTS = ['app', 'components'];

// Exact-match radius values only. Off-scale values (5, 11, 13, 22, 28)
// stay as literals so a designer can decide whether to round to scale.
const RADIUS_TO_TOKEN = {
  6: 'Tokens.radius.xs',
  8: 'Tokens.radius.sm',
  10: 'Tokens.radius.md',
  14: 'Tokens.radius.lg',
  18: 'Tokens.radius.xl',
  24: 'Tokens.radius["2xl"]',
  999: 'Tokens.radius.full',
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

console.log(`borderRadius codemod: touched ${touchedFiles} files; ${totalReplacements} radius literals → Tokens.radius.X.`);

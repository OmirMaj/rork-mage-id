#!/usr/bin/env node
// fontSize literal → Type.X.fontSize codemod.
//
// Strategy: replace `fontSize: 13` with `fontSize: Type.footnote.fontSize`
// where the literal value EXACTLY matches a Type token's fontSize. This
// satisfies the no-restricted-syntax lint rule (the value is now a
// MemberExpression, not a Literal) while changing zero rendered pixels.
//
// We don't try to spread the whole Type token because:
//  - existing styles often diverge from the token's fontWeight/lineHeight
//  - spreading risks a visual regression we can't validate cheaply
//
// This is a bridge: it removes lint noise so genuinely new offenders
// surface in red, and it tags every existing call site with which token
// it should eventually become. Future cleanup is one regex away.

const fs = require('fs');
const path = require('path');

const ROOTS = ['app', 'components'];

// Only EXACT fontSize matches. No visual changes.
const SIZE_TO_TOKEN = {
  11: 'Type.caption2.fontSize',
  12: 'Type.caption1.fontSize',
  13: 'Type.footnote.fontSize',
  15: 'Type.subhead.fontSize',
  16: 'Type.callout.fontSize',
  17: 'Type.body.fontSize',
  20: 'Type.title3.fontSize',
  22: 'Type.title2.fontSize',
  28: 'Type.title1.fontSize',
  34: 'Type.largeTitle.fontSize',
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
    // Match `fontSize: 13` followed by `,` or `}` or whitespace
    // Need to NOT match `fontSize: 130` etc — use word boundary on the digits
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

console.log(`fontSize codemod: touched ${touchedFiles} files; ${totalReplacements} fontSize literals → Type.X.fontSize.`);

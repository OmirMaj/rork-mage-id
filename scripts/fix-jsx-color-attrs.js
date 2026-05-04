#!/usr/bin/env node
// Fix JSX attribute syntax broken by codemod-colors-v3.
//
// Pattern: my v3 replaced `"#1565C0"` (double-quoted) with `Colors.infoDark`.
// On JSX attributes like `color="#1565C0"`, the result was the invalid
// `color=Colors.infoDark` — JSX requires `color={Colors.infoDark}`.
//
// Find every `(colorKey)=Colors.X` and wrap in braces.

const fs = require('fs');
const path = require('path');

const ROOTS = ['app', 'components'];

const COLOR_KEYS = [
  'color', 'backgroundColor', 'borderColor', 'tintColor', 'shadowColor',
  'borderTopColor', 'borderBottomColor', 'borderLeftColor', 'borderRightColor',
  'placeholderTextColor', 'selectionColor', 'underlineColorAndroid', 'fill', 'stroke',
];

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (/\.(tsx)$/.test(entry.name)) files.push(full);
  }
  return files;
}

let fixed = 0;
let touched = 0;

const files = ROOTS.flatMap(r => fs.existsSync(r) ? walk(r) : []);

for (const file of files) {
  let src = fs.readFileSync(file, 'utf8');
  let changed = false;

  for (const key of COLOR_KEYS) {
    // Match `key=Colors.identifier` (no braces) — wrap in braces.
    // Use word boundary on the key so we don't match e.g. tintColor when looking for color.
    // We want to avoid matching `key=Colors.X` if it's already `key={Colors.X}`.
    const re = new RegExp(`(\\s|^)(${key})=Colors\\.([A-Za-z]\\w*)(?=\\s|/|>)`, 'g');
    const before = src;
    src = src.replace(re, (m, lead, k, prop) => {
      changed = true;
      fixed++;
      return `${lead}${k}={Colors.${prop}}`;
    });
  }

  if (changed) {
    fs.writeFileSync(file, src);
    touched++;
  }
}

console.log(`Fixed ${fixed} JSX color attribute syntax issues across ${touched} files.`);

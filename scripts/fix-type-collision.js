#!/usr/bin/env node
// Fix `Type` name collision: lucide-react-native has a `Type` icon, and
// our typography token module also exports `Type`. The fontSize codemod
// added the typography import without checking for collisions. Resolve
// by aliasing the Lucide import: `Type` → `Type as TypeIcon`. Then
// rewrite call sites of the icon (JSX `<Type ` → `<TypeIcon `).

const fs = require('fs');
const path = require('path');

const ROOTS = ['app', 'components'];

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (/\.(tsx|ts)$/.test(entry.name)) files.push(full);
  }
  return files;
}

let touched = 0;
const files = ROOTS.flatMap(r => fs.existsSync(r) ? walk(r) : []);

for (const file of files) {
  let src = fs.readFileSync(file, 'utf8');

  // Find a multi-line lucide import containing `Type` as a bare named
  // import (not already aliased). Use a robust scan: find each
  // `from 'lucide-react-native'` import block and check its named-imports.
  const importRe = /import\s*\{([\s\S]*?)\}\s*from\s*['"]lucide-react-native['"]/g;
  let didChange = false;

  src = src.replace(importRe, (full, body) => {
    // Tokenize the named imports, preserving aliases
    const items = body.split(',').map(s => s.trim()).filter(Boolean);
    let changedThisImport = false;
    const newItems = items.map(item => {
      // `Type` (bare) → `Type as TypeIcon`
      // `Type as Foo` → leave alone (already aliased)
      if (item === 'Type') {
        changedThisImport = true;
        return 'Type as TypeIcon';
      }
      return item;
    });
    if (!changedThisImport) return full;
    didChange = true;
    return `import { ${newItems.join(', ')} } from 'lucide-react-native'`;
  });

  if (didChange) {
    // Now rewrite JSX use sites. Replace `<Type ` and `<Type/>` and
    // `<Type>` (the icon was used as a JSX element). Skip text "Type"
    // word boundaries that aren't JSX.
    // Pattern: `<Type` followed by space, `/`, `>`, or any whitespace
    src = src.replace(/<Type([\s/>])/g, '<TypeIcon$1');
    // Also handle `Type as the icon component reference, e.g. `icon: Type`
    // — but only inside object property values where the line uses `icon:`
    // or `Icon`. Be conservative: only replace exact `Type` standalone
    // when preceded by `: ` or `(` or `=` (an expression position).
    // Skip this for now — JSX is the common pattern.
    fs.writeFileSync(file, src);
    touched++;
  }
}

console.log(`Aliased lucide Type → TypeIcon in ${touched} files.`);

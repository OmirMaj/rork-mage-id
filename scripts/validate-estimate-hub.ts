// Estimate-hub validation — utils/estimateHubEntries.ts (pure, no RN imports).
//
// Guards: unique ids, non-empty labels/subtitles, valid group, every route
// starts with '/' and resolves to a REAL screen file under app/ (so a renamed
// or deleted estimating screen fails ship-check instead of shipping a dead card).
//
// fileURLToPath + join because the repo path contains a space.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { HUB_ENTRIES, HUB_GROUPS, entriesForGroup } from '@/utils/estimateHubEntries';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

let failed = 0;
let passed = 0;
const assert = (c: boolean, m: string) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.error('  FAIL  ' + m); } };

console.log('\nestimate-hub validation:');

const ids = HUB_ENTRIES.map(e => e.id);
assert(new Set(ids).size === ids.length, 'entry ids are unique');
assert(HUB_ENTRIES.length >= 6, `hub covers the estimating surfaces (found ${HUB_ENTRIES.length})`);
assert(entriesForGroup('create').length >= 3, 'at least 3 create entries');
assert(entriesForGroup('insights').length >= 3, 'at least 3 insights entries');

for (const e of HUB_ENTRIES) {
  assert(e.label.trim().length > 0, `${e.id}: non-empty label`);
  assert(e.subtitle.trim().length > 0, `${e.id}: non-empty subtitle`);
  assert(e.iconKey.trim().length > 0, `${e.id}: non-empty iconKey`);
  assert(HUB_GROUPS.includes(e.group), `${e.id}: group '${e.group}' is valid`);
  assert(e.route.startsWith('/'), `${e.id}: route starts with '/'`);

  // Route must resolve to a real screen file. Expo Router: '/foo' → app/foo.tsx;
  // '/(tabs)/estimate/full' → app/(tabs)/estimate/full.tsx.
  const rel = e.route.replace(/^\//, '');
  const candidates = [
    join(ROOT, 'app', rel + '.tsx'),
    join(ROOT, 'app', rel, 'index.tsx'),
  ];
  assert(candidates.some(existsSync), `${e.id}: route '${e.route}' resolves to a screen file`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

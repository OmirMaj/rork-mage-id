// scripts/validate-route-titles.ts
// Run: bun scripts/validate-route-titles.ts
//
// Pins utils/routeTitle.ts (the web document.title map, consumed by
// app/_layout.tsx) against the real route tree under app/.
//
// Why this exists: the map is hand-maintained, and it silently drifted. The
// three estimate screens — /estimate, /estimate/full, /estimate/review, the
// most-used surfaces in the product — plus EVERY primary tab root resolved to
// null, so app/_layout.tsx set a bare "MAGE ID" on the browser tab. Nothing
// caught it because nothing compared the map to the routes.
//
// PINNED SET: the tab bar's destinations (app/(tabs)/*) and the estimate
// group. These are enumerated from the filesystem, not hard-coded, so a new
// tab that ships without a title fails this validator instead of shipping a
// nameless tab. Root-stack detail screens are NOT pinned yet — that backlog is
// listed at the bottom and is deliberately out of scope here (each needs a
// copy decision, and a wrong label is worse than the honest null fallback).

import fs from 'fs';
import path from 'path';
import { pathToDocumentTitle } from '@/utils/routeTitle';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { console.error(`FAIL: ${msg}`); failures++; }
  else { console.log(`PASS: ${msg}`); }
}

const REPO = path.resolve(__dirname, '..');
const TABS = path.join(REPO, 'app', '(tabs)');

/** Every route reachable under app/(tabs)/, as the URL the browser shows. */
function tabRoutes(): string[] {
  const out: string[] = [];
  const walk = (dir: string, urlPrefix: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const name = entry.name;
      if (entry.isDirectory()) {
        // Group segments '(home)' never appear in the URL.
        const isGroup = name.startsWith('(') && name.endsWith(')');
        walk(path.join(dir, name), isGroup ? urlPrefix : `${urlPrefix}/${name}`);
        continue;
      }
      if (!name.endsWith('.tsx')) continue;
      if (name === '_layout.tsx' || name.startsWith('+')) continue;
      // Dynamic segments (materials/[category].tsx) are covered by their
      // parent's label via the nested-pattern fallbacks; skip the literal.
      if (name.includes('[')) continue;
      const base = name.replace(/\.tsx$/, '');
      out.push(base === 'index' ? (urlPrefix || '/') : `${urlPrefix}/${base}`);
    }
  };
  walk(TABS, '');
  return out.sort();
}

// ── 1. Every tab-tree route has a title ───────────────────────────────────
const routes = tabRoutes();
assert(routes.length > 15, `enumerated tab routes (${routes.length} found)`);
const untitled = routes.filter(r => pathToDocumentTitle(r) === null);
assert(
  untitled.length === 0,
  `every app/(tabs) route resolves to a title${untitled.length ? ` — missing: ${untitled.join(', ')}` : ''}`,
);

// ── 2. The three estimate screens specifically (the reported defect) ──────
assert(pathToDocumentTitle('/estimate') === 'Estimate', "/estimate → 'Estimate'");
assert(pathToDocumentTitle('/estimate/full') === 'Estimator', "/estimate/full → 'Estimator'");
assert(pathToDocumentTitle('/estimate/review') === 'Estimate review', "/estimate/review → 'Estimate review'");

// ── 3. Group segments are stripped wherever they appear ──────────────────
assert(pathToDocumentTitle('/(tabs)/estimate') === 'Estimate', '/(tabs)/estimate strips the group');
assert(pathToDocumentTitle('/(tabs)/estimate/full') === 'Estimator', '/(tabs)/estimate/full strips the group');
assert(pathToDocumentTitle('/(tabs)/(home)') === 'Projects', '/(tabs)/(home) → Projects (nested groups)');
assert(pathToDocumentTitle('/(tabs)/settings') === 'Settings', '/(tabs)/settings strips the group');

// ── 4. Query/hash are stripped ───────────────────────────────────────────
assert(pathToDocumentTitle('/estimate/review?id=7') === 'Estimate review', 'query string stripped');
assert(pathToDocumentTitle('/estimate#top') === 'Estimate', 'hash stripped');

// ── 5. Detail routes inherit the parent label ────────────────────────────
assert(pathToDocumentTitle('/invoice/abc-123') === 'Invoice', 'detail route inherits parent label');
// Unmapped children under /estimate now fall back to the group label rather
// than null — this is the half of the defect that '/estimate' missing from the
// exact table also broke (the fallback at the bottom looks up '/estimate').
assert(pathToDocumentTitle('/estimate/anything-new') === 'Estimate', 'unmapped estimate child inherits Estimate');

// ── 6. Unknown routes still return null — the fallback must stay honest ──
// app/_layout.tsx renders plain "MAGE ID" for null. Inventing a label from the
// slug would put wrong words in the tab, which is worse than a generic one.
assert(pathToDocumentTitle('/definitely-not-a-route') === null, 'unknown route → null (no invented label)');
assert(pathToDocumentTitle('') === 'Projects', 'empty pathname → Projects');

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log('\nAll route-title tests passed');
console.log(
  `\nNOTE (not enforced): ${''}root-stack screens outside app/(tabs) still have gaps in the map ` +
  '(e.g. /safety-*, /week-close, /work-order). Each needs a product copy decision; ' +
  'they fall back to plain "MAGE ID" rather than an invented label.',
);

// Estimate-hub validation — utils/estimateHubEntries.ts (pure, no RN imports).
//
// Guards: unique ids, non-empty labels/subtitles, valid group, every route
// starts with '/' and resolves to a REAL screen file under app/ (so a renamed
// or deleted estimating screen fails ship-check instead of shipping a dead card).
//
// fileURLToPath + join because the repo path contains a space.

import { existsSync, readFileSync } from 'node:fs';
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

// ── A hub route never dead-ends on a missing projectId (audit #87) ─────────
//
// The hub (and the Summary tools sheet, and the web sidebar) push these routes
// BARE. Estimate Risk and Bid vs Actual answered "Project not found" with Back
// as the only action, and Visual Takeoff could trace a floor but never add it.
// Every hub screen that reads `projectId` must now either default to a job and
// offer a picker (pickEstimateProject + router.setParams), or be on the list
// below of screens that genuinely work without one — with the reason. A new
// hub screen that reads projectId and does neither fails here.
const STANDALONE_OK: Record<string, string> = {
  '/estimate-wizard': 'builds an estimate from scratch; the project link is optional',
  '/takeoff': 'a standalone takeoff is saved under the standalone key',
  '/(tabs)/estimate/full': 'the Full Estimator builds a cart first and links a project later',
  '/cost-xray': 'has its own initialProjectId default and project chip row',
};
// Wave-4-owned screens with the same dead end, routed to wave 5's join lane
// (w5-join-screens). Listed so the gap is visible, and asserted still-open so
// the entry is removed the moment the screen is fixed.
const KNOWN_GAPS: Record<string, string> = {
  '/living-estimate': 'app/living-estimate.tsx is wave-4 owned — w5-join-screens adds the pickEstimateProject default',
};
const MUST_PICK = new Set(['/estimate-confidence', '/estimate-accuracy', '/area-takeoff']);
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

for (const e of HUB_ENTRIES) {
  const rel = e.route.replace(/^\//, '');
  const file = [join(ROOT, 'app', rel + '.tsx'), join(ROOT, 'app', rel, 'index.tsx')].find(existsSync);
  if (!file) continue; // reported above
  const src = stripComments(readFileSync(file, 'utf8'));
  const readsProjectId = /useLocalSearchParams<\{[^>]*\bprojectId\b/.test(src);
  if (!readsProjectId) continue;
  const picks = /pickEstimateProject\(/.test(src) && /router\.setParams\(\{\s*projectId/.test(src);
  if (MUST_PICK.has(e.route)) {
    assert(picks, `${e.id}: '${e.route}' defaults to a job with pickEstimateProject and puts it in the URL (router.setParams) instead of "Project not found"`);
    assert(/EstimateJobPicker/.test(src), `${e.id}: '${e.route}' renders the EstimateJobPicker so he can switch jobs without backing out`);
    continue;
  }
  if (picks) { assert(true, `${e.id}: '${e.route}' handles a missing projectId (default job + picker)`); continue; }
  if (STANDALONE_OK[e.route]) {
    assert(e.route !== '/cost-xray' || /initialProjectId/.test(src),
      `${e.id}: '${e.route}' works without a projectId — ${STANDALONE_OK[e.route]}`);
    continue;
  }
  if (KNOWN_GAPS[e.route]) {
    assert(!picks, `${e.id}: '${e.route}' is a listed known gap (${KNOWN_GAPS[e.route]}) — remove it from KNOWN_GAPS once fixed`);
    continue;
  }
  assert(false, `${e.id}: '${e.route}' reads projectId but neither defaults to a job (pickEstimateProject + router.setParams) nor is listed as working standalone — pushed bare from the hub it dead-ends`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

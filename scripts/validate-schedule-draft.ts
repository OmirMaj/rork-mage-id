// validate-schedule-draft.ts — pins utils/scheduleDraft.ts (wizard autosave).
// The wizard claims to create a "file"; this is what stops that file being lost
// when the app backgrounds. Run: bun run scripts/validate-schedule-draft.ts
import {
  buildDraft, isWorthSaving, parseDraft, draftMatchesEntry, savedAgoLabel,
  SCHEDULE_DRAFT_VERSION, DRAFT_MAX_AGE_MS, SCHEDULE_DRAFT_KEY,
} from '../utils/scheduleDraft';
import type { TemplateTask } from '../constants/scheduleTemplates';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got: ', JSON.stringify(got), '\n      want:', JSON.stringify(want)); }
}
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

const NOW = Date.parse('2026-08-01T12:00:00Z');
const task = (name: string, id = name): TemplateTask => ({
  id, name, phase: 'General', duration: 1, predecessorIds: [],
  isMilestone: false, isCriticalPath: false, crewSize: 1,
} as TemplateTask);

console.log('\nschedule draft autosave:');

// ── isWorthSaving — the seeded blank row must NOT be persisted ──
expect('empty list not worth saving', isWorthSaving([]), false);
expect('single unnamed row (the wizard seed) not worth saving', isWorthSaving([task('')]), false);
expect('single 1-char name not worth saving (mid-keystroke)', isWorthSaving([task('D')]), false);
expect('a real named task is worth saving', isWorthSaving([task('Demo')]), true);
expect('two rows, one named, is worth saving', isWorthSaving([task('Demo'), task('')]), true);

// ── buildDraft ──
const d = buildDraft({ projectId: 'p1', templateId: '__scratch__', startIso: '2026-08-03', tasks: [task('Demo')], nowMs: NOW });
expect('buildDraft stamps version + savedAt', [d.version, d.savedAt], [SCHEDULE_DRAFT_VERSION, NOW]);
expect('buildDraft carries the payload', [d.projectId, d.startIso, d.tasks.length], ['p1', '2026-08-03', 1]);

// ── parseDraft: only trust what we can actually restore ──
expect('round-trips a good draft', parseDraft(JSON.parse(JSON.stringify(d)), NOW)?.projectId, 'p1');
expect('rejects null', parseDraft(null, NOW), null);
expect('rejects a non-object', parseDraft('nope', NOW), null);
expect('rejects a future version', parseDraft({ ...d, version: 99 }, NOW), null);
expect('rejects a missing tasks array', parseDraft({ ...d, tasks: undefined }, NOW), null);
expect('rejects an empty tasks array', parseDraft({ ...d, tasks: [] }, NOW), null);
expect('rejects a bad savedAt', parseDraft({ ...d, savedAt: 'soon' }, NOW), null);
expect('rejects a draft with only the blank seed row', parseDraft({ ...d, tasks: [task('')] }, NOW), null);

// staleness — an abandoned draft must not resurrect
expect('rejects a draft older than the max age',
  parseDraft({ ...d, savedAt: NOW - DRAFT_MAX_AGE_MS - 1000 }, NOW), null);
ok('accepts a draft just inside the max age',
  parseDraft({ ...d, savedAt: NOW - DRAFT_MAX_AGE_MS + 1000 }, NOW) !== null);

// ── draftMatchesEntry — never resume one job's draft inside another ──
expect('same project matches', draftMatchesEntry(d, 'p1'), true);
expect('different project does NOT match', draftMatchesEntry(d, 'p2'), false);
expect('no project chosen yet → draft decides', draftMatchesEntry(d, ''), true);

// ── savedAgoLabel ──
expect('just saved', savedAgoLabel(NOW, NOW), 'Saved');
expect('seconds', savedAgoLabel(NOW - 20_000, NOW), 'Saved 20s ago');
expect('minutes', savedAgoLabel(NOW - 5 * 60_000, NOW), 'Saved 5m ago');
expect('hours', savedAgoLabel(NOW - 3 * 3_600_000, NOW), 'Saved 3h ago');

// ── the key must be registered for per-user wipe (shared-device tenancy) ──
import { readFileSync } from 'node:fs';
const auth = readFileSync('contexts/AuthContext.tsx', 'utf8');
ok(`${SCHEDULE_DRAFT_KEY} is in LOCAL_USER_CACHE_KEYS (or it leaks across tenants)`,
  auth.includes(`'${SCHEDULE_DRAFT_KEY}'`),
  'add it to LOCAL_USER_CACHE_KEYS in contexts/AuthContext.tsx');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

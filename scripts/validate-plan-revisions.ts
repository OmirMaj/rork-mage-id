// validate-plan-revisions.ts — pins drawing revision control.
//
// WHY: ProjectContext.addPlanSheet has always stamped `superseded` on the old
// copy when a sheet number is re-uploaded — and nothing read it. The viewer
// rendered a dead drawing identically to a live one, so a saved deep link or
// an existing pin opened a stale sheet in silence. Building from a superseded
// drawing is the largest rework driver on a job (demo + RFI + delay + change
// order), and the GC carries it because the GC distributed the sheet.
//
// Two failure modes matter and they pull in opposite directions:
//   1. Under-warning — a stale sheet that looks current. That's the bug.
//   2. Over-navigating — a jump button that lands on the WRONG sheet. That is
//      worse than no button, because the user trusts it.
// So the resolver is allowed to answer "I don't know" (not_found / ambiguous),
// and this file pins that it does exactly that instead of guessing.
//
// Run: bun run scripts/validate-plan-revisions.ts
import {
  planRevisionStatus, resolveCurrentSheet, currentSheetCandidates,
  isStale, effectiveRevision, sheetNumberKey, staleBannerCopy,
  STALE_BANNER_TITLE,
  type RevisionSheetLike,
} from '../utils/planRevisionCore';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// fileURLToPath + join because the repo path contains a space.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const okay = JSON.stringify(got) === JSON.stringify(want);
  if (okay) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got: ', JSON.stringify(got), '\n      want:', JSON.stringify(want)); }
}
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

const sheet = (o: Partial<RevisionSheetLike> & { id: string }): RevisionSheetLike => ({
  projectId: 'p1', ...o,
});

console.log('\nplan revision control:');

// ── The happy path: a two-revision chain ────────────────────────────────────
// Mirrors exactly what addPlanSheet writes: old row flagged superseded, new
// row carries revision+1 and previousSheetId back to it.
const a101r1 = sheet({ id: 'a', sheetNumber: 'A-101', revision: 1, superseded: true });
const a101r2 = sheet({ id: 'b', sheetNumber: 'A-101', revision: 2, previousSheetId: 'a' });
const twoRev = [a101r1, a101r2];

expect('superseded sheet resolves to the current sheet',
  resolveCurrentSheet(a101r1, twoRev), { status: 'resolved', sheetId: 'b', revision: 2 });
expect('the current sheet resolves to itself (nothing to jump to)',
  resolveCurrentSheet(a101r2, twoRev), { status: 'self' });
ok('the current sheet is never flagged stale', !isStale(a101r2));
ok('the superseded sheet IS flagged stale', isStale(a101r1));

// Three revisions deep: the oldest must skip the middle (also superseded) and
// land on the live head, not on the next link in the chain.
const a101r3 = sheet({ id: 'c', sheetNumber: 'A-101', revision: 3, previousSheetId: 'b' });
const threeRev = [a101r1, { ...a101r2, superseded: true }, a101r3];
expect('rev 1 of a 3-deep chain skips rev 2 and lands on the live head',
  resolveCurrentSheet(a101r1, threeRev), { status: 'resolved', sheetId: 'c', revision: 3 });
expect('rev 2 of a 3-deep chain also lands on the live head',
  resolveCurrentSheet({ ...a101r2, superseded: true }, threeRev), { status: 'resolved', sheetId: 'c', revision: 3 });

// Resolution must walk FORWARD. previousSheetId points newer -> older, so a
// resolver that followed it would send the user further into the past.
ok('resolution never returns the sheet it was asked about',
  resolveCurrentSheet(a101r1, threeRev).status === 'resolved'
  && (resolveCurrentSheet(a101r1, threeRev) as { sheetId: string }).sheetId !== a101r1.id);

// ── No current sheet found ──────────────────────────────────────────────────
expect('superseded with no live successor → not_found',
  resolveCurrentSheet(a101r1, [a101r1]), { status: 'not_found' });
expect('every copy superseded (live head deleted) → not_found',
  resolveCurrentSheet(a101r1, [a101r1, { ...a101r2, superseded: true }]), { status: 'not_found' });
expect('superseded sheet alone in an empty project → not_found',
  resolveCurrentSheet(a101r1, []), { status: 'not_found' });

// ── Ambiguity: two live heads for one number ────────────────────────────────
// Happens when two devices race an upload offline. There is no correct answer,
// so the resolver must refuse rather than pick — and refuse the SAME way every
// time, regardless of array order.
const dupA = sheet({ id: 'z-live', sheetNumber: 'A-101', revision: 2 });
const dupB = sheet({ id: 'm-live', sheetNumber: 'A-101', revision: 2 });
const ambiguous = [a101r1, dupA, dupB];
expect('two live heads → ambiguous, never a guess',
  resolveCurrentSheet(a101r1, ambiguous),
  { status: 'ambiguous', candidateIds: ['m-live', 'z-live'] });
expect('ambiguity is order-independent (deterministic candidate order)',
  resolveCurrentSheet(a101r1, [dupB, dupA, a101r1]),
  resolveCurrentSheet(a101r1, [dupA, dupB, a101r1]));
ok('ambiguous never yields a navigable sheetId',
  !('sheetId' in resolveCurrentSheet(a101r1, ambiguous)));
// Three live heads stay ambiguous — "most revisions wins" is not a tiebreak we
// are willing to invent when the cost of being wrong is a framed wall.
expect('three live heads stay ambiguous',
  (resolveCurrentSheet(a101r1, [a101r1, dupA, dupB, sheet({ id: 'q-live', sheetNumber: 'A-101' })]) as { candidateIds: string[] }).candidateIds,
  ['m-live', 'q-live', 'z-live']);

// ── Isolation: nothing from elsewhere may leak in ───────────────────────────
const otherProject = sheet({ id: 'other-proj', projectId: 'p2', sheetNumber: 'A-101', revision: 5 });
const otherNumber = sheet({ id: 'other-num', sheetNumber: 'A-102', revision: 5 });
expect('a live A-101 in a DIFFERENT project never resolves',
  resolveCurrentSheet(a101r1, [a101r1, otherProject]), { status: 'not_found' });
expect('a live A-102 in the same project never resolves',
  resolveCurrentSheet(a101r1, [a101r1, otherNumber]), { status: 'not_found' });
expect('cross-project + cross-number noise does not disturb a good resolution',
  resolveCurrentSheet(a101r1, [otherProject, a101r1, otherNumber, a101r2]),
  { status: 'resolved', sheetId: 'b', revision: 2 });
expect('candidates exclude other projects and other numbers',
  currentSheetCandidates(a101r1, [otherProject, otherNumber, a101r2]).map(s => s.id), ['b']);

// ── Sheet-number identity must match addPlanSheet's comparison exactly ──────
// addPlanSheet keys on `(sheetNumber ?? '').trim()`, case-SENSITIVE. Reading
// more loosely than we wrote would pair rows the writer treated as unrelated
// sheets and route someone to a drawing of a different room.
expect('whitespace is trimmed, matching the writer', sheetNumberKey(sheet({ id: 'x', sheetNumber: '  A-101 ' })), 'A-101');
expect('padded number still resolves',
  resolveCurrentSheet({ ...a101r1, sheetNumber: ' A-101' }, twoRev),
  { status: 'resolved', sheetId: 'b', revision: 2 });
expect('case differences are NOT merged (writer is case-sensitive)',
  resolveCurrentSheet(a101r1, [a101r1, sheet({ id: 'lower', sheetNumber: 'a-101' })]), { status: 'not_found' });

// A blank sheet number is not an identity. PDF import creates every page with
// sheetNumber undefined; grouping those would make each page of a 50-page set
// a "revision" of every other page.
expect('blank sheet number has no identity', sheetNumberKey(sheet({ id: 'x' })), null);
expect('whitespace-only sheet number has no identity', sheetNumberKey(sheet({ id: 'x', sheetNumber: '   ' })), null);
expect('blank-numbered sheets never group with each other',
  resolveCurrentSheet(sheet({ id: 'n1', superseded: true }), [sheet({ id: 'n1', superseded: true }), sheet({ id: 'n2' }), sheet({ id: 'n3' })]),
  { status: 'not_found' });
expect('blank-numbered sheets produce no candidates',
  currentSheetCandidates(sheet({ id: 'n1' }), [sheet({ id: 'n2' }), sheet({ id: 'n3' })]), []);

// ── Staleness is the explicit flag, never inferred ──────────────────────────
// A false "do not build from this" is how a real warning gets trained out of
// the crew, so a live sheet must stay unflagged even next to a weird row.
ok('a sheet with no superseded field is not stale', !isStale(sheet({ id: 'x', sheetNumber: 'A-101' })));
ok('superseded:false is not stale', !isStale(sheet({ id: 'x', superseded: false })));
ok('a live Rev 1 next to a live Rev 9 is still not stale',
  !isStale(sheet({ id: 'x', sheetNumber: 'A-101', revision: 1 })));
expect('legacy row with no revision counts as Rev 1', effectiveRevision(sheet({ id: 'x' })), 1);
expect('a bad revision value falls back to Rev 1', effectiveRevision(sheet({ id: 'x', revision: 0 })), 1);
expect('a real revision is preserved', effectiveRevision(sheet({ id: 'x', revision: 4 })), 4);

// ── planRevisionStatus / banner copy ────────────────────────────────────────
expect('status of a live sheet: not stale, resolves to self',
  planRevisionStatus(a101r2, twoRev), { stale: false, revision: 2, current: { status: 'self' } });
expect('status of a stale sheet carries its own revision, not the current one',
  planRevisionStatus(a101r1, twoRev).revision, 1);

ok('a live sheet gets NO banner', staleBannerCopy(planRevisionStatus(a101r2, twoRev)) === null);
for (const [label, list] of [['resolved', twoRev], ['not_found', [a101r1]], ['ambiguous', ambiguous]] as const) {
  const copy = staleBannerCopy(planRevisionStatus(a101r1, list));
  ok(`stale sheet (${label}) gets a banner that says do not build`,
    copy !== null && copy.title === STALE_BANNER_TITLE && /do not build/i.test(copy.title),
    `got: ${JSON.stringify(copy)}`);
  ok(`stale sheet (${label}) banner states which revision you are looking at`,
    copy !== null && copy.detail.includes('Rev 1'), `got: ${JSON.stringify(copy)}`);
}
ok('the resolved banner names the replacing revision',
  staleBannerCopy(planRevisionStatus(a101r1, twoRev))!.detail.includes('Rev 2'));

// ── The UI must actually consume all of this ────────────────────────────────
// The whole gap being closed was "the data existed and nothing read it," so a
// green unit suite alone would not prove the bug is fixed.
const viewer = readFileSync(join(ROOT, 'app/plan-viewer.tsx'), 'utf8');
ok('plan-viewer imports the revision core', /from '@\/utils\/planRevisionCore'/.test(viewer));
ok('plan-viewer computes revision status', /planRevisionStatus\(/.test(viewer));
ok('plan-viewer renders the superseded banner', /plan-viewer-superseded-banner/.test(viewer));
ok('plan-viewer gates the jump on a resolved lookup',
  /current\.status === 'resolved'/.test(viewer));
ok('plan-viewer offers a route to the current sheet', /plan-viewer-open-current/.test(viewer));
ok('the banner is non-dismissible (no dismiss/close state on it)',
  !/setBannerDismissed|bannerDismissed|dismissStale/.test(viewer));

const plans = readFileSync(join(ROOT, 'app/plans.tsx'), 'utf8');
ok('plans list renders a superseded badge', /supersededBadge/.test(plans));
// The badge must NOT be gated on revision > 1: the original copy of a
// re-uploaded sheet is Rev 1, and that is precisely the row already printed
// and taped to the trailer wall.
ok('the superseded badge is not gated behind revision > 1',
  /\{s\.superseded \? \(\s*<View style=\{styles\.supersededBadge\}/.test(plans),
  'badge must render off s.superseded alone, not off s.revision');
ok('superseded rows are visually distinguished, not just listed',
  /sheetCardSuperseded/.test(plans));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

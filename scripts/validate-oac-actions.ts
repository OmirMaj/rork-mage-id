// validate-oac-actions.ts — an OAC action item must be closeable, and must
// outlive the meeting that minted it.
//
// WHY THIS EXISTS. The weekly OAC is the one place a tenant fit-out PM assigns
// work to the owner, the architect, the landlord and the building engineer —
// four parties the app has no other home for. None of them is a sub with a
// schedule row, a contact with an invoice, or a user with a login. The only
// record MAGE holds of what they owe is OACActionItem, minted by the AI from the
// meeting transcript: description, ballInCourt, dueBy, status.
//
// The screen audit found that record was write-only:
//
//   1. NOTHING COULD CLOSE ONE. app/oac-meeting.tsx drew each item's status
//      inside a plain <View> — not a TouchableOpacity, no handler. `status` and
//      `closedAt` existed on the type and nothing in the repo ever wrote them.
//      Grepped across the whole tree, `actionItems` was written in exactly two
//      places: `[]` at meeting creation and the AI merge after minutes.
//   2. NOTHING OUTSIDE THE MEETING READ ONE. Items were scoped to
//      `active.actionItems`. Open commitments from meeting #3 vanished the
//      moment meeting #4 opened, and the agenda's closing row was the hardcoded
//      string "Confirm next OAC date, owner of action items, due-bys" — printed
//      while the app was holding last week's unclosed items and naming not one
//      of them.
//   3. THERE WAS NO TYPED PATH IN. The sole producer was the AI merge, which
//      needs a recorded transcript of 50+ characters, and the card itself was
//      gated on `actionItems.length > 0` — so a PM who ran the meeting without
//      recording it never saw the card at all.
//
// That is the app storing and not joining, in the one place the founder speaks
// his follow-ups out loud.
//
// ── WHAT THIS GUARD HOLDS ──────────────────────────────────────────────────
//
// A. THE CLOCK IS THREE-VALUED. `dueBy` is routinely empty BY DESIGN — the
//    minutes prompt tells the model to leave it blank when no date was named —
//    and on a fit-out the undated commitments are usually the owner decisions.
//    So "overdue", "not yet due" and "nobody ever said when" must stay three
//    distinct states. `dueInDays: null` must never collapse to 0, and an undated
//    action must never be dropped: it carries forward with its own age clock
//    (UNDATED_STALE_DAYS).
//
// B. TITLES MUST NOT CARRY COUNTS. mergeAgenda de-dups on the EXACT title
//    string. A carry-forward row titled "Carried forward: 4 open actions, 2
//    overdue" appends a second copy of itself the moment a count changes — on
//    every Refresh, forever. §4 builds the same set at two different instants
//    eight days apart and asserts the titles and ids are byte-identical, then
//    runs the real mergeAgenda over an annotated agenda to prove nothing
//    duplicates.
//
// C. A CLOSE MUST LAND IN THE MEETING THAT OWNS THE ROW. A carried-forward row
//    is shown on THIS meeting but belongs to an earlier one. Writing it to the
//    meeting on screen would fork a copy and leave the original open forever, so
//    the screen's write is addressed by meetingId (§6).
//
// The pure half (§1-§5) executes the real utils/oacEngine against a FIXED clock.
// The screen half (§6) is a source scan, which is how this repo pins behaviour in
// a .tsx it cannot import.
//
// Run: bun run test:oac-actions

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { OACMeeting, OACActionItem, Project } from '../types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

// @types/bun is not installed and one validator does not justify the dependency
// (same note as validate-photo-drain.ts). Only the sliver used below is declared.
type VirtualModule = { exports: Record<string, unknown>; loader: 'object' };
type BunPluginBuilder = { module: (specifier: string, cb: () => VirtualModule) => void };
declare const Bun: {
  plugin: (p: { name: string; setup: (build: BunPluginBuilder) => void }) => void;
};

if (typeof Bun === 'undefined') {
  console.error('\n✗ validate-oac-actions must run under bun (needs Bun.plugin to stub @/utils/mageAI)\n');
  process.exit(1);
}

// utils/oacEngine imports the Gemini relay for its minutes generator, and that
// module reaches react-native, which bun cannot parse. Nothing under test calls
// it — the agenda and the action-item logic are entirely deterministic — so it
// is stubbed to a thrower: if a future edit routes the carry-forward through the
// model, this guard fails loudly rather than quietly testing a fake.
Bun.plugin({
  name: 'oac-actions-stubs',
  setup(build) {
    build.module('@/utils/mageAI', () => ({
      exports: {
        mageAI: async () => { throw new Error('mageAI must not be called by the agenda builder'); },
      },
      loader: 'object',
    }));
  },
});

const {
  collectOpenOACActions,
  buildCarryForwardAgendaItems,
  cycleOACActionStatus,
  makeManualOACActionItem,
  actionDueLabel,
  buildAgendaFromProjectState,
  mergeAgenda,
  UNDATED_STALE_DAYS,
} = await import('../utils/oacEngine');

// ── Fixture: a fit-out three weeks in ─────────────────────────────────────
//
// NOW is fixed from LOCAL components, never an ISO instant: the whole point of
// utils/calendarDate is that a bare 'YYYY-MM-DD' compared through `new Date()`
// flips a day early west of Greenwich, and a guard that pinned itself to a UTC
// instant would pass in CI and lie in Denver.
const NOW = new Date(2026, 8, 16, 12, 0, 0);          // Wed 16 Sep 2026, noon local
const LATER = new Date(2026, 8, 24, 12, 0, 0);        // eight days on — one OAC cycle plus
const iso = (y: number, m: number, d: number) => new Date(y, m, d, 9, 0, 0).toISOString();

function action(p: Partial<OACActionItem> & { id: string; description: string; ballInCourt: string }): OACActionItem {
  return {
    status: 'open',
    createdAt: iso(2026, 8, 1),
    ...p,
  } as OACActionItem;
}

function meeting(id: string, number: number, actionItems: OACActionItem[]): OACMeeting {
  return {
    id, projectId: 'p1', number,
    scheduledAt: iso(2026, 8, number),
    attendees: [], agenda: [], actionItems,
    status: 'distributed',
    createdAt: iso(2026, 8, number), updatedAt: iso(2026, 8, number),
  };
}

const a1 = action({ id: 'a1', description: 'Owner to approve the terrace radiant scope on CO #6', ballInCourt: 'Owner', dueBy: '2026-09-10' });
const a2 = action({ id: 'a2', description: 'Architect to issue the beam-size response on RFI #14', ballInCourt: 'Sarah Chen, AIA', dueBy: '2026-09-20' });
// No dueBy: the minutes prompt tells the model to leave it empty when the room
// named no date. createdAt is 15 days back, so it is past UNDATED_STALE_DAYS.
const a3 = action({ id: 'a3', description: 'Landlord to confirm the freight elevator window', ballInCourt: 'Landlord', createdAt: iso(2026, 8, 1) });
// Done: kept for audit, must stop nagging.
const a4 = action({ id: 'a4', description: 'GC to reissue CO #5 with the corrected retention', ballInCourt: 'Owner', status: 'done', closedAt: iso(2026, 8, 12) });
// Undated and FRESH — minted yesterday, so not yet chase-worthy.
const a5 = action({ id: 'a5', description: 'Building engineer to schedule the riser shutdown', ballInCourt: 'Building engineer', createdAt: iso(2026, 8, 15) });
const a6 = action({ id: 'a6', description: 'GC to price the added data drops', ballInCourt: 'Mike (GC)', dueBy: '2026-09-30' });
const a7 = action({ id: 'a7', description: 'Owner to pick the lobby stone', ballInCourt: 'owner', dueBy: '2026-09-25' });

const m1 = meeting('m1', 1, [a1, a2, a3, a4]);
const m2 = meeting('m2', 2, [a5, a7]);
const m3 = meeting('m3', 3, [a6]);          // the meeting on screen
const ALL = [m1, m2, m3];

// ── §1. Collecting what is still open ─────────────────────────────────────
console.log('\nopen actions across meetings:');

const open = collectOpenOACActions(ALL, { excludeMeetingId: 'm3', now: NOW });
const openIds = open.map(o => o.action.id).sort();

ok('a closed action stops nagging',
  !openIds.includes('a4'),
  `collectOpenOACActions returned ${openIds.join(', ')} — a4 is 'done' and must not be carried forward.`);

ok("the meeting on screen does not carry its own actions",
  !openIds.includes('a6'),
  'a6 belongs to m3, the excluded meeting. Carrying it would print it twice: once in the Action items card, once on the agenda.');

ok('every open action from every OTHER meeting is collected',
  JSON.stringify(openIds) === JSON.stringify(['a1', 'a2', 'a3', 'a5', 'a7']),
  `got ${JSON.stringify(openIds)}`);

ok('a meeting row seen twice yields one action, not two',
  collectOpenOACActions([m1, m1, m2], { now: NOW }).length === open.length,
  'A re-synced meeting row must not duplicate its commitments onto the agenda.');

// ── §2. Three-valued clock ────────────────────────────────────────────────
console.log('\nthe clock is three-valued — overdue, upcoming, and never agreed:');

const by = (id: string) => open.find(o => o.action.id === id)!;

ok('a past due date reads as overdue by whole local days',
  by('a1').dueInDays === -6,
  `a1 is due 2026-09-10 and NOW is 2026-09-16, so dueInDays must be -6; got ${by('a1').dueInDays}.`);

ok('a future due date reads as days remaining',
  by('a2').dueInDays === 4,
  `got ${by('a2').dueInDays}`);

ok('an undated action reads as null, NOT as zero',
  by('a3').dueInDays === null && by('a5').dueInDays === null,
  'null means "nobody agreed a date"; 0 means "due today". Collapsing them makes the UI print a deadline that was never given.');

ok(`an undated action older than ${UNDATED_STALE_DAYS} days is chase-worthy on its own age`,
  by('a3').ageDays === 15 && by('a3').needsChasing === true,
  `a3 has sat ${by('a3').ageDays} days with no date; needsChasing=${by('a3').needsChasing}. An overdue-only rule would silently lose exactly the commitments nobody dated — on a fit-out, the owner decisions.`);

ok('a freshly-minted undated action is not yet chased',
  by('a5').ageDays === 1 && by('a5').needsChasing === false,
  `got ageDays=${by('a5').ageDays} needsChasing=${by('a5').needsChasing}`);

ok('an overdue dated action is chase-worthy',
  by('a1').needsChasing === true && by('a2').needsChasing === false,
  'a1 is past due; a2 is not.');

ok('the undated label says so in words, and never invents a date',
  actionDueLabel(by('a3')) === 'No due date agreed · 15d open',
  `got "${actionDueLabel(by('a3'))}"`);

ok('the overdue label counts the days late',
  /6 days overdue/.test(actionDueLabel(by('a1'))),
  `got "${actionDueLabel(by('a1'))}"`);

// ── §3. One agenda row per commitment ─────────────────────────────────────
console.log('\ncarry-forward agenda rows:');

const carried = buildCarryForwardAgendaItems(open);

ok('one row per open action — nothing is summarised away',
  carried.length === open.length,
  `${open.length} open actions produced ${carried.length} rows.`);

ok('the undated action is carried forward, not dropped',
  carried.some(i => i.referenceId === 'a3') && carried.some(i => i.referenceId === 'a5'),
  'An agenda that only carries dated items loses the owner decisions, which are the ones nobody dates.');

ok('every row points back at the action it came from',
  carried.every(i => i.referenceType === 'oac_action' && !!i.referenceId && i.section === 'action_items'),
  'Without referenceId the row is an untraceable sentence and the screen cannot close the action in the meeting that owns it.');

const overdueRow = carried.find(i => i.referenceId === 'a1')!;
ok('the overdue row is marked urgent and says how late',
  overdueRow.status === 'urgent' && /6 days overdue/.test(overdueRow.detail ?? ''),
  `status=${overdueRow.status} detail="${overdueRow.detail}"`);

const staleRow = carried.find(i => i.referenceId === 'a3')!;
ok('a stale undated row warns without claiming a deadline',
  staleRow.status === 'warn' && /No due date agreed/.test(staleRow.detail ?? ''),
  `status=${staleRow.status} detail="${staleRow.detail}"`);

ok('the row names who owes it, as written',
  carried.every(i => {
    const owed = open.find(o => o.action.id === i.referenceId)!.action.ballInCourt;
    return (i.detail ?? '').startsWith(owed.trim());
  }),
  'ballInCourt is free text — "Owner", "Sarah Chen, AIA", "Building engineer" — and is never resolved to a Contact, so it must be printed exactly as it was said in the room.');

const ownerRows = carried
  .map((i, idx) => ({ idx, owed: open.find(o => o.action.id === i.referenceId)!.action.ballInCourt.toLowerCase() }))
  .filter(r => r.owed === 'owner')
  .map(r => r.idx);
ok('rows are grouped by who owes them, case-insensitively',
  ownerRows.length === 2 && ownerRows[1] === ownerRows[0] + 1,
  `the two Owner rows landed at ${ownerRows.join(', ')} — a1 ("Owner") and a7 ("owner") are the same person and belong together.`);

ok('the most pressing group comes first',
  carried[0].referenceId === 'a1',
  `got ${carried[0].referenceId}. a1 is six days overdue; it opens the list.`);

// ── §4. Stable titles — the mergeAgenda duplication trap ──────────────────
console.log('\ntitles are stable across a Refresh:');

const carriedLater = buildCarryForwardAgendaItems(
  collectOpenOACActions(ALL, { excludeMeetingId: 'm3', now: LATER }),
);

ok('no title carries a count',
  carried.every(i => !/\d+\s*(open|overdue|carried|action)/i.test(i.title)),
  `titles: ${carried.map(i => i.title).join(' | ')}\n      mergeAgenda de-dups on the exact title string; a count in the title re-appends the row on every Refresh.`);

ok('titles are byte-identical eight days later',
  JSON.stringify(carried.map(i => i.title).sort()) === JSON.stringify(carriedLater.map(i => i.title).sort()),
  `before: ${carried.map(i => i.title).sort().join(' | ')}\n      after:  ${carriedLater.map(i => i.title).sort().join(' | ')}`);

ok('ids are derived from the action, not freshly minted',
  JSON.stringify(carried.map(i => i.id).sort()) === JSON.stringify(carriedLater.map(i => i.id).sort()),
  'A regenerated agenda must produce the SAME row, not a new UUID for the same commitment.');

// The real merge path: the GC annotated one carried row during the meeting, then
// tapped Refresh a week later. mergeAgenda keeps annotated rows and appends fresh
// ones that do not duplicate a kept title.
const annotated = carried.map((i, n) => (n === 0 ? { ...i, manualNote: 'Chased by phone Tuesday' } : i));
const merged = mergeAgenda(annotated, carriedLater);
ok('a Refresh does not duplicate an annotated carry-forward row',
  merged.filter(i => i.referenceId === 'a1').length === 1,
  `a1 appears ${merged.filter(i => i.referenceId === 'a1').length} times after a merge. This is the exact failure a count-bearing title produces.`);
ok("the GC's note survives the Refresh",
  merged.find(i => i.referenceId === 'a1')?.manualNote === 'Chased by phone Tuesday');

// ── §5. Status transitions and the manual path ────────────────────────────
console.log('\nclosing and reopening an action:');

const t = new Date(2026, 8, 16, 15, 30, 0);
const opened = cycleOACActionStatus({ ...a1 }, t);
ok('open advances to in progress, with nothing closed yet',
  opened.status === 'in_progress' && opened.closedAt === undefined,
  `got status=${opened.status} closedAt=${opened.closedAt}`);

const doneItem = cycleOACActionStatus(opened, t);
ok('in progress advances to done and stamps closedAt',
  doneItem.status === 'done' && doneItem.closedAt === t.toISOString(),
  `got status=${doneItem.status} closedAt=${doneItem.closedAt}`);

const reopened = cycleOACActionStatus(doneItem, t);
ok('reopening CLEARS closedAt',
  reopened.status === 'open' && reopened.closedAt === undefined,
  `got status=${reopened.status} closedAt=${reopened.closedAt}. A reopened action carrying a closing date is a record that contradicts itself.`);

ok('a reopened action is collected again',
  collectOpenOACActions([meeting('mx', 9, [reopened])], { now: NOW }).length === 1);

const manual = makeManualOACActionItem({
  description: '  Owner to sign the landlord work letter  ',
  ballInCourt: '  Owner  ',
  dueBy: '2026-09-30',
  meetingId: 'm3',
  now: t,
});
ok('a typed action is trimmed, open, and attributed to its meeting',
  manual.description === 'Owner to sign the landlord work letter' &&
  manual.ballInCourt === 'Owner' &&
  manual.status === 'open' && manual.meetingId === 'm3',
  JSON.stringify(manual));
ok('a typed action records that a person wrote it, not the model',
  manual.source === 'manual',
  'An AI reading of the room is a paraphrase; the screen tells the PM which rows those are.');
ok('an empty due date is stored as absent, not as an empty string',
  makeManualOACActionItem({ description: 'd', ballInCourt: 'o', dueBy: '   ', now: t }).dueBy === undefined,
  "'' would parse as a date of null downstream; undefined is the honest 'no date agreed'.");

// ── §6. The agenda actually carries them ──────────────────────────────────
console.log('\nthe built agenda names last week by name:');

const project = {
  id: 'p1', name: 'Bishopsgate fit-out', createdAt: iso(2026, 7, 1),
} as unknown as Project;
const agendaArgs = { project, rfis: [], submittals: [], changeOrders: [], dailyReports: [], schedule: null, tasks: [] };

const withPrior = buildAgendaFromProjectState({ ...agendaArgs, priorMeetings: ALL, currentMeetingId: 'm3', now: NOW });
const withoutPrior = buildAgendaFromProjectState({ ...agendaArgs, now: NOW });

ok('every open commitment appears on the agenda by name',
  ['a1', 'a2', 'a3', 'a5', 'a7'].every(id => withPrior.some(i => i.referenceId === id)),
  `agenda referenceIds: ${withPrior.map(i => i.referenceId).filter(Boolean).join(', ')}`);

ok('a project with no prior meetings produces no carry-forward rows',
  withoutPrior.every(i => i.referenceType !== 'oac_action'),
  'The carry-forward must come from the meetings passed in, never be invented.');

const nextMeetingRow = withPrior.find(i => i.section === 'next_meeting')!;
ok('the closing row stays count-free',
  !/\d/.test(nextMeetingRow.title) && !/\d/.test(nextMeetingRow.detail ?? ''),
  `"${nextMeetingRow.title}" / "${nextMeetingRow.detail}" — a number here re-appends this row on every Refresh.`);

ok('the carry-forward rows survive a Refresh of the whole agenda',
  mergeAgenda(withPrior, buildAgendaFromProjectState({ ...agendaArgs, priorMeetings: ALL, currentMeetingId: 'm3', now: LATER }))
    .filter(i => i.referenceId === 'a1').length === 1);

// ── §7. The screen: a control that writes to the right meeting ────────────
console.log('\napp/oac-meeting.tsx — the status is a control, and the write lands home:');

const screen = read('app/oac-meeting.tsx');

ok('the status pill is a pressable with a handler',
  /<TouchableOpacity[^>]*\n?[\s\S]{0,400}?onPress=\{\(\) => handleCycleAction\(meetingId, a\.id\)\}/.test(screen),
  'The audited screen drew the status inside a plain <View>: there was no way to close an action, ever.');

ok('the status pill announces itself to VoiceOver',
  /accessibilityLabel=\{`Status: \$\{STATUS_WORD\[a\.status\]\}/.test(screen),
  'validate-a11y-roles holds the ceiling; a new control has to say what it is.');

ok('the action-items card is no longer gated on being non-empty',
  !/\{active\.actionItems\.length > 0 && \(/.test(screen),
  'The card was hidden until the AI had produced a row, so a PM with no recording never found the way in.');

ok('there is a typed path in',
  /makeManualOACActionItem\(/.test(screen) && /testID="oac-add-action"/.test(screen),
  'The AI merge needs a 50+ character recorded transcript. Without a manual path the whole feature can ship into a permanently empty set.');

ok('both halves of an action are required before it is written',
  /if \(!description \|\| !ballInCourt\) \{/.test(screen),
  'An action with no owner cannot be chased and cannot be carried forward — the AI path already filters these out, and the typed path must too.');

ok('a write is addressed to the meeting that OWNS the row',
  /ctx\.updateOACMeeting\?\.\(meetingId, \{ actionItems: next/.test(screen),
  'A carried-forward row is displayed on this meeting but belongs to an earlier one. Writing it to the meeting on screen forks a copy and leaves the original open forever.');

ok('carried-forward actions are rendered on the meeting screen',
  /carriedActions\.map\(o => renderActionRow\(o\.action, o\.meetingId, o\)\)/.test(screen),
  'Making them visible on the agenda is half the fix; being able to close last week\'s item in this week\'s meeting is the other half.');

ok('both agenda builds are handed the prior meetings',
  (screen.match(/priorMeetings: meetings/g) ?? []).length === 2,
  'New meeting AND Refresh. If only one passes them, the carry-forward silently disappears on the other path.');

ok('a refresh excludes the meeting on screen',
  /currentMeetingId: active\.id/.test(screen));

const engine = read('utils/oacEngine.ts');
ok('the agenda builder emits the carry-forward rows',
  /items\.push\(\.\.\.carriedForward\)/.test(engine),
  'buildCarryForwardAgendaItems can be perfect and still reach nobody if the builder never pushes its result.');

console.log('');
if (fail > 0) {
  console.error(`✗ validate-oac-actions: ${fail} failure(s), ${pass} passed — an OAC commitment can go into a drawer again.\n`);
  process.exit(1);
}
console.log(`✓ validate-oac-actions: ${pass} checks — action items close, and last week's arrive on this week's agenda.\n`);

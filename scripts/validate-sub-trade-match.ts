// scripts/validate-sub-trade-match.ts — the sub-by-trade matcher refuses.
//
// utils/autoScheduleFromEstimate.ts deliberately leaves `crew` empty, under a
// long comment ending "Empty is the honest value: the generator does not know
// who is doing this work." Writing `assignedSubId` from that same generator
// only earns the right to exist if it is at least as careful — so the
// assertions below are mostly about the cases where it must say nothing.
//
// The reason it is worth doing at all: assignedSubId is a JOIN KEY. Resource
// levelling groups by it, buyout and commitments read it, crew presence reads
// it, and the follow-up engine joins it against Subcontractor.coiExpiry to ask
// whether a crew's insurance will be valid on the day they are booked. Across
// seven live projects and 44 tasks it is set on ZERO, because its only writers
// were a manual picker and punch-walk.

import {
  matchSubForPhase, assignmentNote, summariseAssignments,
  type TradeCandidate, type SubTradeOutcome,
} from '../utils/subTradeMatch';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
function ok(n: string, cond: boolean, why?: string) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n, why ? `\n      ${why}` : ''); }
}
function eq<T>(n: string, got: T, want: T) {
  const good = JSON.stringify(got) === JSON.stringify(want);
  if (good) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n, '\n   got ', JSON.stringify(got), '\n   want', JSON.stringify(want)); }
}

const P = 'p1';
const sub = (id: string, companyName: string, trade: string, assignedProjects?: string[]): TradeCandidate =>
  ({ id, companyName, trade, assignedProjects });

const ACE = sub('s1', 'Ace Drywall', 'Drywall');
const BOLT = sub('s2', 'Bolt Electric', 'Electrical');

console.log('\nit assigns only when there is exactly one answer');
{
  const r = matchSubForPhase('Drywall', [ACE, BOLT], P);
  ok('one drywall sub on the roster → matched', r.matched);
  if (r.matched) {
    eq('the right sub', r.match.subId, 's1');
    ok('and it says why, in words a screen can print', /only drywall sub/i.test(r.match.reason),
      r.match.reason);
  }
  const e = matchSubForPhase('Electrical', [ACE, BOLT], P);
  ok('a different phase picks the other sub', e.matched && e.match.subId === 's2');
}

console.log('\nTHE POINT OF THE MODULE — it refuses when it would be guessing');
{
  const two = matchSubForPhase('Drywall', [ACE, sub('s3', 'Bay Drywall', 'Drywall'), BOLT], P);
  eq('TWO drywall subs → no assignment', two.matched, false);
  if (!two.matched) {
    eq('and the refusal names the ambiguity', two.refusal.kind, 'ambiguous');
    ok('listing both candidates so the UI can offer a choice',
      two.refusal.kind === 'ambiguous' && two.refusal.candidates.length === 2);
  }

  const none = matchSubForPhase('Roofing', [ACE, BOLT], P);
  eq('no sub for the trade → no assignment', none.matched, false);
  eq('and says which trade had nobody', none.matched ? '' : none.refusal.kind, 'no_sub_for_trade');

  eq('an empty roster assigns nobody', matchSubForPhase('Drywall', [], P).matched, false);
  eq('an empty phase assigns nobody', matchSubForPhase('', [ACE], P).matched, false);
  eq('undefined phase assigns nobody', matchSubForPhase(undefined, [ACE], P).matched, false);
}

console.log('\nphases that are not trades never match');
{
  for (const p of ['Punch List', 'Permitting', 'Closeout', 'Inspection', 'General Conditions', 'Design', 'Procurement']) {
    const r = matchSubForPhase(p, [sub('sx', 'Anyone Inc', p)], P);
    ok(`"${p}" is not a subcontract scope`, !r.matched);
  }
}

console.log('\nroster scoping — a sub on another job is not on this one');
{
  const other = sub('s9', 'Far Drywall', 'Drywall', ['p2']);
  eq('a sub assigned only to another project is excluded',
    matchSubForPhase('Drywall', [other], P).matched, false);

  const here = sub('s9', 'Near Drywall', 'Drywall', ['p1', 'p2']);
  ok('a sub assigned to THIS project is eligible', matchSubForPhase('Drywall', [here], P).matched);

  const roaming = sub('s9', 'Any Drywall', 'Drywall', []);
  ok('a sub with an empty roster is treated as available everywhere',
    matchSubForPhase('Drywall', [roaming], P).matched);

  // The scoping must not accidentally resolve ambiguity: two eligible subs is
  // still two, even when one of them is also on another job.
  const twoEligible = matchSubForPhase('Drywall', [here, roaming], P);
  eq('two eligible subs stay ambiguous', twoEligible.matched, false);
}

console.log('\nthe two vocabularies join — phase words vs company words');
{
  // SCHEDULE_PHASES says "Demo"; a demolition contractor's SubTrade says
  // "Demolition". Equality after normalisation does not bridge that, so
  // without the alias map the sub is never matched and the failure looks
  // identical to having no sub for the trade.
  const RENAMES: [string, string][] = [
    ['Demo', 'Demolition'],
    ['Ceilings', 'Acoustical Ceilings'],
    ['Low Voltage', 'Low Voltage / Cabling'],
  ];
  for (const [phase, trade] of RENAMES) {
    const r = matchSubForPhase(phase, [sub('sa', `${trade} Co`, trade)], P);
    ok(`phase "${phase}" reaches a "${trade}" sub`, r.matched,
      'the alias map in utils/subTradeMatch.ts is what makes this join');
  }

  // Phases that merely OVERLAP a trade must NOT be bridged. A wrong
  // assignedSubId is worse than none — levelling, buyout, crew presence and
  // the COI check all join on it.
  const NOT_ALIASES: [string, string][] = [
    ['Site Work', 'Landscaping'],
    ['Structure', 'Concrete'],
    ['Building Envelope', 'Roofing'],
    ['Interior', 'Drywall'],
  ];
  for (const [phase, trade] of NOT_ALIASES) {
    const r = matchSubForPhase(phase, [sub('sa', `${trade} Co`, trade)], P);
    ok(`phase "${phase}" does NOT get guessed onto a "${trade}" sub`, !r.matched,
      'an overlapping phase is not a rename; guessing here corrupts a join key');
  }

  // Trades whose names already agree need no alias and must still work.
  for (const t of ['Fire Protection', 'Millwork', 'Glazing', 'Painting']) {
    ok(`"${t}" matches without an alias`, matchSubForPhase(t, [sub('sb', `${t} Inc`, t)], P).matched);
  }

  // Commercial phases that are events, not scopes.
  for (const p of ['Above-Ceiling Inspection', 'Commissioning']) {
    ok(`"${p}" is not a subcontract scope`, !matchSubForPhase(p, [sub('sc', 'Anyone', p)], P).matched);
  }
}

console.log('\ncase and spacing are not a reason to miss a match');
{
  ok('phase case is ignored', matchSubForPhase('DRYWALL', [ACE], P).matched);
  ok('surrounding space is ignored', matchSubForPhase('  Drywall  ', [ACE], P).matched);
  ok('sub trade case is ignored', matchSubForPhase('Drywall', [sub('s1', 'Ace', 'drywall')], P).matched);
}

console.log('\nit says out loud that the app chose');
{
  const r = matchSubForPhase('Drywall', [ACE], P);
  ok('the note names the sub', r.matched && /Ace Drywall/.test(assignmentNote(r.match)));
  ok('and tells him how to override it',
    r.matched && /change it/i.test(assignmentNote(r.match)),
    'a silent auto-assignment is the thing this module exists not to do');
}

console.log('\nthe summary is honest about what it did NOT do');
{
  const outcomes: SubTradeOutcome[] = [
    matchSubForPhase('Drywall', [ACE], P),
    matchSubForPhase('Drywall', [ACE, sub('s3', 'Bay Drywall', 'Drywall')], P),
    matchSubForPhase('Roofing', [ACE], P),
  ];
  const s = summariseAssignments(outcomes);
  ok('it counts what it assigned', /1 task assigned/.test(s), s);
  ok('and confesses the ambiguous one', /1 left unassigned/.test(s), s);
  eq('nothing to say when nothing happened', summariseAssignments([matchSubForPhase('Roofing', [ACE], P)]), '');
}

console.log('\nthe generator actually calls it, and every caller hands over the roster');
{
  const gen = readFileSync('utils/autoScheduleFromEstimate.ts', 'utf-8');
  ok('the generator imports the matcher', /matchSubForPhase/.test(gen));
  ok('and writes assignedSubId from it', /assignedSubId = outcome\.match\.subId/.test(gen));
  ok('and records it on rationale, not the boolean assumption flag',
    /assignmentNote\(/.test(gen) && /tasks\[i\]\.rationale =/.test(gen) && !/tasks\[i\]\.assumption =/.test(gen),
    'ScheduleTask.assumption is a boolean (types/index.ts:602); rationale (599) is the string');
  ok('the roster parameter is OPTIONAL, so an unloaded vault assigns nobody',
    /subcontractors\?: TradeCandidate\[\]/.test(gen),
    'a required parameter would tempt a caller to pass [] and claim he has no subs');
  ok('and assignment is skipped entirely when it is absent', /if \(subcontractors\) \{/.test(gen));

  // Every call site must thread it, or the field stays empty exactly where it
  // matters and this whole change is decorative.
  const CALLERS = [
    'app/schedule-review.tsx',
    'app/generative-setup.tsx',
    'components/AIAutoScheduleButton.tsx',
    'app/(tabs)/schedule/index.tsx',
    'utils/copilot/schedule/scheduleCapability.ts',
  ];
  const missing: string[] = [];
  for (const f of CALLERS) {
    const src = readFileSync(f, 'utf-8');
    const call = src.match(/generateScheduleFromEstimate\([^)]*\)/s);
    if (!call) { missing.push(`${f}: no call found`); continue; }
    // A fourth argument must be present — the roster.
    const args = call[0].slice('generateScheduleFromEstimate('.length, -1).split(',');
    if (args.length < 4) missing.push(`${f}: passes ${args.length} args, roster not threaded`);
  }
  ok(`all ${CALLERS.length} call sites thread the sub roster`, missing.length === 0, missing.join('; '));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

// scripts/validate-follow-up-engine.ts — the follow-up engine's honesty guards.
//
// The engine exists to turn records MAGE already holds into follow-up items
// nobody typed. That is only worth having if it REFUSES in the right places,
// so this validator spends most of its assertions proving the refusals fire —
// not that the happy path works.
//
// Every guard below is asserted in BOTH directions: the condition that should
// produce an item, and the condition that must not. A guard that can only pass
// is not a guard, and this repo has already been bitten by 61 of those.

import {
  runFollowUpRules, mergeHeldFollowUps, rankFollowUps, overdueFor,
  coveredControls, QUIET_WINDOW_DAYS,
  type FollowUpRule, type FollowUpContext,
} from '../utils/followUp/engine';
import {
  FOLLOW_UP_RULES, coiExpiresBeforeSubIsOnSite, coPastItsOwnTurnaround,
  rfiPastRequiredDate, workStartedWithoutCommitment,
} from '../utils/followUp/rules';
import type { FollowUpHold } from '../types';
import { toCalendarDayString } from '../utils/calendarDate';

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

// LOCAL noon, both sides.
//
// The engine parses a bare YYYY-MM-DD at LOCAL noon — the convention
// utils/systemOfAction.ts:47 already uses, and consistent with
// utils/calendarDate.toCalendarDayString, which builds calendar days from
// LOCAL components on purpose (audit UX-F3/F11: the
// `toISOString().slice(0,10)` idiom stamped evening records with tomorrow).
//
// So the fixture has to speak the same dialect. Building days from a UTC-noon
// instant made every span floor one day short in any negative-offset zone —
// four assertions off by exactly one in EDT, and they would have been RIGHT in
// UTC, which is the shape of a test that passes on CI and lies on a laptop.
// This repo already had that bug in __tests__/smoke/cross-project-block.tsx.
const NOW = new Date(2026, 8, 14, 12, 0, 0).getTime();
const iso = (offsetDays: number) =>
  toCalendarDayString(new Date(2026, 8, 14 + offsetDays, 12, 0, 0));

/** A context with every collection LOADED and empty — the "looked, none" state. */
function emptyCtx(over: Partial<FollowUpContext> = {}): FollowUpContext {
  return {
    nowMs: NOW,
    projectId: 'p1',
    projectName: 'Henderson',
    changeOrders: [], rfis: [], submittals: [], tasks: [], deliveries: [],
    commitments: [], invoices: [], permits: [], planSheets: [], contacts: [],
    subcontractors: [], scheduleStartDate: iso(-30),
    seenRuleIds: new Set(FOLLOW_UP_RULES.map(r => r.id)),
    ...over,
  };
}

const sub = (o: Record<string, unknown> = {}) => ({
  id: 's1', companyName: 'Ace Drywall', contactName: 'Dana', phone: '', email: '',
  address: '', trade: 'Drywall', licenseNumber: '', w9OnFile: true,
  bidHistory: [], assignedProjects: [], notes: '',
  createdAt: iso(-90), updatedAt: iso(-1), ...o,
}) as never;

const task = (o: Record<string, unknown> = {}) => ({
  id: 't1', title: 'Hang drywall', phase: 'Drywall', durationDays: 3, startDay: 40,
  progress: 0, crew: '', dependencies: [], notes: '', status: 'not_started', ...o,
}) as never;

console.log('\nA. the engine runs and covers his controls');
{
  const run = runFollowUpRules(FOLLOW_UP_RULES, emptyCtx());
  eq('an empty-but-loaded project mints nothing', run.items.length, 0);
  eq('and refuses nothing — empty is not absent', run.refusals.length, 0);
  eq('every rule ran', run.ranRuleIds.length, FOLLOW_UP_RULES.length);
  const controls = coveredControls(FOLLOW_UP_RULES);
  ok(`the registry answers ${controls.length} of his 173 controls (${controls.join(', ')})`, controls.length > 0);
  ok('every rule declares at least one control', FOLLOW_UP_RULES.every(r => r.controls.length > 0));
  ok('every rule id is unique', new Set(FOLLOW_UP_RULES.map(r => r.id)).size === FOLLOW_UP_RULES.length);
  ok('every join rule is declared as one', coiExpiresBeforeSubIsOnSite.joins && workStartedWithoutCommitment.joins);
}

console.log('\nG3. empty is not absent — the guard that stops "your whole crew is uninsured"');
{
  // subcontractors UNDEFINED = the vault never loaded.
  const notLoaded = runFollowUpRules([coiExpiresBeforeSubIsOnSite],
    emptyCtx({ subcontractors: undefined }));
  eq('a rule whose collection is not loaded does not run', notLoaded.ranRuleIds.length, 0);
  eq('and mints nothing', notLoaded.items.length, 0);
  eq('and says so out loud', notLoaded.refusals.length, 1);
  eq('with the right guard named', notLoaded.refusals[0]?.guard, 'G3_collection_not_loaded');
  ok('naming the collection', /subcontractors/.test(notLoaded.refusals[0]?.detail ?? ''));

  // subcontractors [] = loaded, genuinely none. Must NOT refuse.
  const loadedEmpty = runFollowUpRules([coiExpiresBeforeSubIsOnSite], emptyCtx());
  eq('a loaded-but-empty collection RUNS the rule', loadedEmpty.ranRuleIds, ['coi_expires_before_sub_is_on_site']);
  eq('and refuses nothing', loadedEmpty.refusals.length, 0);
}

console.log('\nThe flagship join — a COI that expires before the sub is on site');
{
  // Expiry BEFORE the task start → the item exists.
  const hit = runFollowUpRules([coiExpiresBeforeSubIsOnSite], emptyCtx({
    scheduleStartDate: iso(0),
    subcontractors: [sub({ coiExpiry: iso(10) })],
    tasks: [task({ startDay: 21, assignedSubId: 's1' })], // ~20 days out
  }));
  eq('expiry before the start mints one item', hit.items.length, 1);
  eq('it is a two-record join', hit.items[0]?.evidence.length, 2);
  ok('it names the sub AND the task in evidence',
    hit.items[0]?.evidence.some(e => e.ref.kind === 'subcontractor') === true &&
    hit.items[0]?.evidence.some(e => e.ref.kind === 'task') === true);
  ok('the reason names both records', /expires/.test(hit.items[0]?.because ?? '') && /starts/.test(hit.items[0]?.because ?? ''));
  ok('the basis is derived, not invented', hit.items[0]?.targetBasis.kind === 'derived');
  ok('a nudge is drafted, because the sub has a name', !!hit.items[0]?.nudge);

  // Expiry AFTER the start → nothing, and the rule closes it.
  const miss = runFollowUpRules([coiExpiresBeforeSubIsOnSite], emptyCtx({
    scheduleStartDate: iso(0),
    subcontractors: [sub({ coiExpiry: iso(60) })],
    tasks: [task({ startDay: 21, assignedSubId: 's1' })],
  }));
  eq('a COI valid past the start mints nothing', miss.items.length, 0);
  ok('and is reported closed BY EVIDENCE', miss.closedByEvidence.includes('coi_expires_before_sub_is_on_site:subcontractor:s1'));

  // An UNDATED schedule cannot answer "before" — it must refuse, not guess.
  const undated = runFollowUpRules([coiExpiresBeforeSubIsOnSite], emptyCtx({
    scheduleStartDate: undefined,
    subcontractors: [sub({ coiExpiry: iso(10) })],
    tasks: [task({ startDay: 21, assignedSubId: 's1' })],
  }));
  eq('an undated schedule mints nothing rather than anchoring on today', undated.items.length, 0);

  // A finished task is not a reason to chase insurance.
  const done = runFollowUpRules([coiExpiresBeforeSubIsOnSite], emptyCtx({
    scheduleStartDate: iso(0),
    subcontractors: [sub({ coiExpiry: iso(10) })],
    tasks: [task({ startDay: 21, assignedSubId: 's1', status: 'done' })],
  }));
  eq('a sub with only finished work mints nothing', done.items.length, 0);
}

console.log('\nG1. a join must show its two records');
{
  const halfJoin: FollowUpRule = {
    ...coiExpiresBeforeSubIsOnSite,
    id: 'half_join',
    mint: () => ([{
      id: 'half_join:subcontractor:s1', ruleId: 'half_join', category: 'insurance',
      title: 'one-sided', because: 'only one record', ball: 'sub',
      targetBasis: { kind: 'none' },
      evidence: [{ ref: { kind: 'subcontractor', id: 's1' }, says: 'expires soon' }],
    }] as never),
    closed: () => [],
  };
  const run = runFollowUpRules([halfJoin], emptyCtx());
  eq('a join rule producing ONE evidence row is dropped', run.items.length, 0);
  eq('and refused out loud', run.refusals[0]?.guard, 'G1_join_needs_two_records');
}

console.log('\nG2. no basis, no overdue — "never invent a date", in the type');
{
  eq('a basis of none yields null, even with a date', overdueFor(iso(-30), { kind: 'none' }, NOW), null);
  eq('a stated basis yields real days', overdueFor(iso(-30), { kind: 'stated', field: 'x' }, NOW), 30);
  eq('a stated basis with NO date still yields null', overdueFor(undefined, { kind: 'stated', field: 'x' }, NOW), null);

  // A CO with no agreed turnaround still mints — it IS out — but is never late.
  const noTurnaround = runFollowUpRules([coPastItsOwnTurnaround], emptyCtx({
    changeOrders: [{
      id: 'co1', number: 3, projectId: 'p1', date: iso(-40), description: 'Extra doors',
      reason: '', lineItems: [], originalContractValue: 0, changeAmount: 2500,
      newContractTotal: 0, status: 'submitted', createdAt: iso(-40), updatedAt: iso(-1),
    }] as never,
  }));
  eq('a CO with no turnaround still mints', noTurnaround.items.length, 1);
  eq('but can never be called late', noTurnaround.items[0]?.daysOverdue, null);
  eq('and its basis says so', noTurnaround.items[0]?.targetBasis.kind, 'none');

  // With the turnaround the owner agreed, it IS late, by a real number.
  const withTurnaround = runFollowUpRules([coPastItsOwnTurnaround], emptyCtx({
    changeOrders: [{
      id: 'co1', number: 3, projectId: 'p1', date: iso(-40), description: 'Extra doors',
      reason: '', lineItems: [], originalContractValue: 0, changeAmount: 2500,
      newContractTotal: 0, status: 'submitted', approvalDeadlineDays: 10,
      createdAt: iso(-40), updatedAt: iso(-1),
    }] as never,
  }));
  eq('with a stated turnaround it is late by a real number', withTurnaround.items[0]?.daysOverdue, 30);
  eq('and the basis names the field that had never been read', withTurnaround.items[0]?.targetBasis, { kind: 'stated', field: 'approvalDeadlineDays' });
}

console.log('\nG4. no name, no nudge — "the reviewer" is not a person');
{
  const named = runFollowUpRules([rfiPastRequiredDate], emptyCtx({
    rfis: [{
      id: 'r1', projectId: 'p1', number: 12, subject: 'Beam conflict at grid B',
      question: '', submittedBy: 'me', assignedTo: 'Jane Kim', dateSubmitted: iso(-20),
      dateRequired: iso(-6), status: 'open', priority: 'high', attachments: [],
      createdAt: iso(-20), updatedAt: iso(-1),
    }] as never,
  }));
  eq('a named reviewer gets a drafted chase', typeof named.items[0]?.nudge, 'string');
  eq('and the item is late by the real number', named.items[0]?.daysOverdue, 6);

  const unnamed = runFollowUpRules([rfiPastRequiredDate], emptyCtx({
    rfis: [{
      id: 'r1', projectId: 'p1', number: 12, subject: 'Beam conflict at grid B',
      question: '', submittedBy: 'me', assignedTo: '   ', dateSubmitted: iso(-20),
      dateRequired: iso(-6), status: 'open', priority: 'high', attachments: [],
      createdAt: iso(-20), updatedAt: iso(-1),
    }] as never,
  }));
  eq('an unnamed reviewer still mints the item', unnamed.items.length, 1);
  eq('but NO message is drafted to nobody', unnamed.items[0]?.nudge, undefined);

  // The assertion above passes even with the ENGINE's guard removed, because
  // rfiPastRequiredDate also nulls its own nudge — so it tests the rule, not
  // the guard. This one hands the engine a rule that DOES try to draft a
  // message to nobody, which is the only way to prove the engine strips it.
  const rogue: FollowUpRule = {
    id: 'rogue_nudge', category: 'risk', controls: [166], reads: [], joins: false,
    closeMode: 'attested',
    mint: () => ([{
      id: 'rogue_nudge:project:p1', ruleId: 'rogue_nudge', category: 'risk',
      title: 'someone should chase this', because: 'no ball name is known',
      ball: 'landlord', targetBasis: { kind: 'none' }, evidence: [],
      nudge: 'Hi — following up on this.',
    }] as never),
    closed: () => [],
  };
  const stripped = runFollowUpRules([rogue], emptyCtx());
  eq('the ENGINE strips a nudge a rule drafted with no ball name',
    stripped.items[0]?.nudge, undefined);
  eq('while still keeping the item itself', stripped.items.length, 1);

  const named2: FollowUpRule = {
    ...rogue, id: 'rogue_named',
    mint: () => ([{
      id: 'rogue_named:project:p1', ruleId: 'rogue_named', category: 'risk',
      title: 'chase the landlord', because: 'named', ball: 'landlord',
      ballName: 'Tishman Speyer', targetBasis: { kind: 'none' }, evidence: [],
      nudge: 'Hi — following up on this.',
    }] as never),
  };
  eq('and keeps the nudge when a name IS known',
    runFollowUpRules([named2], emptyCtx()).items[0]?.nudge, 'Hi — following up on this.');
}

console.log('\nG6. first run is quiet — the difference between adoption and week two');
{
  const old = {
    id: 'r1', projectId: 'p1', number: 12, subject: 'old one', question: '',
    submittedBy: 'me', assignedTo: 'Jane Kim', dateSubmitted: iso(-200),
    dateRequired: iso(-180), status: 'open', priority: 'high', attachments: [],
    createdAt: iso(-200), updatedAt: iso(-1),
  } as never;

  const firstRun = runFollowUpRules([rfiPastRequiredDate], emptyCtx({ rfis: [old], seenRuleIds: new Set() }));
  eq('a 180-day-old item on a FIRST run is flagged pre-existing', firstRun.items[0]?.preExisting, true);
  eq('and does not shout', firstRun.items[0]?.severity, 'normal');

  const laterRun = runFollowUpRules([rfiPastRequiredDate], emptyCtx({ rfis: [old] }));
  eq('on a later run it is not pre-existing', laterRun.items[0]?.preExisting, false);
  eq('and takes its real severity', laterRun.items[0]?.severity, 'critical');

  const fresh = {
    ...(old as Record<string, unknown>),
    dateSubmitted: iso(-QUIET_WINDOW_DAYS + 2), dateRequired: iso(-4),
  } as never;
  const freshFirst = runFollowUpRules([rfiPastRequiredDate], emptyCtx({ rfis: [fresh], seenRuleIds: new Set() }));
  eq('something that happened THIS WEEK is not silenced by the first run', freshFirst.items[0]?.preExisting, false);
}

console.log('\nG0. absence is not evidence — a half-loaded cache must not close twenty items');
{
  const held: FollowUpHold[] = [{
    id: 'rfi_past_required_date:rfi:GONE', projectId: 'p1', status: 'chased',
    createdAt: iso(-10), updatedAt: iso(-1),
  }];
  const run = runFollowUpRules([rfiPastRequiredDate], emptyCtx());
  const merged = mergeHeldFollowUps(run, held, NOW);
  eq('an item that stopped minting is NOT closed', merged.items.length, 0);
  eq('it is reported as stale, separately', merged.stale.length, 1);
  ok('and keeps its held status', merged.stale[0]?.status === 'chased');

  const closedHeld: FollowUpHold[] = [{
    id: 'rfi_past_required_date:rfi:GONE', projectId: 'p1', status: 'closed_verified',
    createdAt: iso(-10), updatedAt: iso(-1),
  }];
  eq('an already-closed item is not re-reported as stale',
    mergeHeldFollowUps(run, closedHeld, NOW).stale.length, 0);
}

console.log('\nThe held face — his date beats the rule, and says whose it is');
{
  const run = runFollowUpRules([rfiPastRequiredDate], emptyCtx({
    rfis: [{
      id: 'r1', projectId: 'p1', number: 12, subject: 's', question: '',
      submittedBy: 'me', assignedTo: 'Jane Kim', dateSubmitted: iso(-20),
      dateRequired: iso(-6), status: 'open', priority: 'high', attachments: [],
      createdAt: iso(-20), updatedAt: iso(-1),
    }] as never,
  }));
  const held: FollowUpHold[] = [{
    id: 'rfi_past_required_date:rfi:r1', projectId: 'p1', status: 'chased',
    targetDate: iso(-2), createdAt: iso(-10), updatedAt: iso(-1),
  }];
  const merged = mergeHeldFollowUps(run, held, NOW);
  eq('his target date overrides the rule’s', merged.items[0]?.targetDate, iso(-2));
  eq('and the overdue count follows HIS date', merged.items[0]?.daysOverdue, 2);
  eq('and the basis says it is his', merged.items[0]?.targetBasis, { kind: 'stated', field: 'your target date' });
}

console.log('\nwork started with no commitment behind it');
{
  const base = {
    scheduleStartDate: iso(-30),
    subcontractors: [sub()],
    tasks: [task({ status: 'in_progress', assignedSubId: 's1', actualStartDate: iso(-3) })],
  };
  const noPo = runFollowUpRules([workStartedWithoutCommitment], emptyCtx(base));
  eq('started work with no commitment mints an item', noPo.items.length, 1);
  eq('with no invented due date', noPo.items[0]?.targetBasis.kind, 'none');
  eq('and therefore never late', noPo.items[0]?.daysOverdue, null);
  eq('and no message drafted — this is HIS move', noPo.items[0]?.nudge, undefined);

  const withPo = runFollowUpRules([workStartedWithoutCommitment], emptyCtx({
    ...base,
    commitments: [{
      id: 'c1', projectId: 'p1', number: 'PO-1', type: 'subcontract', subcontractorId: 's1',
      description: '', amount: 1000, signedDate: iso(-10), status: 'executed',
      createdAt: iso(-10), updatedAt: iso(-1),
    }] as never,
  }));
  eq('a signed commitment mints nothing', withPo.items.length, 0);
  ok('and closes it by evidence', withPo.closedByEvidence.includes('work_started_without_commitment:task:t1'));

  const draftPo = runFollowUpRules([workStartedWithoutCommitment], emptyCtx({
    ...base,
    commitments: [{
      id: 'c1', projectId: 'p1', number: 'PO-1', type: 'subcontract', subcontractorId: 's1',
      description: '', amount: 1000, signedDate: iso(-10), status: 'draft',
      createdAt: iso(-10), updatedAt: iso(-1),
    }] as never,
  }));
  eq('a DRAFT commitment does not count as issued', draftPo.items.length, 1);

  const unassigned = runFollowUpRules([workStartedWithoutCommitment], emptyCtx({
    ...base, tasks: [task({ status: 'in_progress', assignedSubId: undefined })],
  }));
  eq('"somebody started something" is not actionable, so no item', unassigned.items.length, 0);
}

console.log('\nranking puts what is actually burning first');
{
  const run = runFollowUpRules(FOLLOW_UP_RULES, emptyCtx({
    scheduleStartDate: iso(0),
    subcontractors: [sub({ coiExpiry: iso(3) })],
    tasks: [task({ startDay: 21, assignedSubId: 's1' })],
    rfis: [{
      id: 'r1', projectId: 'p1', number: 12, subject: 's', question: '',
      submittedBy: 'me', assignedTo: 'Jane Kim', dateSubmitted: iso(-40),
      dateRequired: iso(-30), status: 'open', priority: 'high', attachments: [],
      createdAt: iso(-40), updatedAt: iso(-1),
    }] as never,
  }));
  const ranked = rankFollowUps(run.items);
  ok('the 30-day-late RFI outranks a COI that has not expired yet',
    ranked[0]?.ruleId === 'rfi_past_required_date',
    `got ${ranked.map(r => r.ruleId).join(' > ')}`);
  ok('ranking is stable — same input, same order',
    JSON.stringify(rankFollowUps(run.items)) === JSON.stringify(ranked));
}

console.log('\nreads-completeness — a rule cannot touch what it did not declare');
{
  // G3 only refuses on DECLARED reads. A rule that quietly touches an
  // undeclared collection therefore gets NO refusal when that collection is
  // unloaded, and silently degrades — which is the exact thing G3 exists to
  // stop. workStartedWithoutCommitment shipped with this bug: it declared
  // ['tasks','commitments'] and read ctx.subcontractors. 68 assertions did not
  // catch it, because nothing compared the declaration to the source.
  const src = require('node:fs').readFileSync('utils/followUp/rules.ts', 'utf-8');
  const COLLECTIONS = [
    'changeOrders', 'rfis', 'submittals', 'tasks', 'deliveries', 'commitments',
    'invoices', 'permits', 'planSheets', 'contacts', 'subcontractors', 'scheduleStartDate',
  ];
  const offenders: string[] = [];
  for (const rule of FOLLOW_UP_RULES) {
    // The rule's own source block, from its export to the closing brace.
    const start = src.indexOf(`id: '${rule.id}'`);
    if (start < 0) { offenders.push(`${rule.id}: source block not found`); continue; }
    const end = src.indexOf('\n};', start);
    const body = src.slice(start, end < 0 ? undefined : end);
    const declared = new Set<string>(rule.reads as readonly string[]);
    for (const c of COLLECTIONS) {
      if (new RegExp(`ctx\\.${c}\\b`).test(body) && !declared.has(c)) {
        offenders.push(`${rule.id} reads ctx.${c} but does not declare it`);
      }
    }
  }
  ok('every collection a rule touches is declared in its reads',
    offenders.length === 0, offenders.join('; '));
  ok('the scan actually found the rules', FOLLOW_UP_RULES.length >= 4);
}

console.log('\npurity — the engine has no clock of its own');
{
  const engineSrc = require('node:fs').readFileSync('utils/followUp/engine.ts', 'utf-8');
  const rulesSrc = require('node:fs').readFileSync('utils/followUp/rules.ts', 'utf-8');
  ok('engine.ts calls no Date.now()', !/Date\.now\(\)/.test(engineSrc),
    'nowMs arrives on the context — a clock here makes the whole set untestable');
  ok('rules.ts calls no Date.now()', !/Date\.now\(\)/.test(rulesSrc));
  ok('neither reaches for the network or storage',
    !/fetch\(|AsyncStorage|supabase/.test(engineSrc + rulesSrc));
  // Same input twice must give byte-identical output, or nothing above is trustworthy.
  const a = runFollowUpRules(FOLLOW_UP_RULES, emptyCtx({ subcontractors: [sub({ coiExpiry: iso(5) })], tasks: [task({ startDay: 21, assignedSubId: 's1' })] }));
  const b = runFollowUpRules(FOLLOW_UP_RULES, emptyCtx({ subcontractors: [sub({ coiExpiry: iso(5) })], tasks: [task({ startDay: 21, assignedSubId: 's1' })] }));
  ok('two identical runs are byte-identical', JSON.stringify(a) === JSON.stringify(b));
  ok('ids are deterministic across runs',
    a.items.map(i => i.id).join() === b.items.map(i => i.id).join());
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

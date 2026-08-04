// validate-notice-clock.ts — pins the notice clock and the delay register.
//
// WHAT THIS FEATURE IS: a countdown against a number the user typed in, after
// reading their own contract. MAGE does not read contracts, does not supply a
// default, and does not tell anybody what any agreement or any statute
// requires of them. §15 below is the enforcement of that last sentence.
//
// The rules with teeth:
//
//   * NO DEFAULT NOTICE PERIOD. Shipping 21 days would hand a GC on a 7-day
//     agreement a countdown that runs two weeks long. Worse than none.
//   * A reservation is three structured fields, not a free-text box.
//   * A notice asking for time records how many days.
//   * A notice with no response recorded stays visible.
//   * The app suggests a classification; the user sets it.
//   * NO LEGAL ADVICE ANYWHERE. No statute or rule citations, no case names,
//     no claims about admissibility or how any of this will be received.
//
// Pure node:fs + the pure module. No bundler, no react-native import (those
// crash bun). fileURLToPath + join because the repo path contains a space.
//
// Run: bun run scripts/validate-notice-clock.ts

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  noticeDeadline, effectiveNoticePeriod, daysUntil, daysSince, parseNoticeDate,
  buildNoticeStatus, noticeSummary, ownerSilencePromptFor,
  reservationViolations, extensionRequestViolations, noticeViolations,
  noticeMethodWarning, suggestClassification, nextDelayEventNumber,
  formatDelayEventNumber,
  NOTICE_PERIOD_PRESETS, ASSUMED_NOTICE_PERIOD_DAYS, ASSUMED_LABEL,
  RECORDING_IS_NOT_SERVING, OWNER_RESPONSE_WINDOW_DAYS,
  NOTICE_REMINDER_DISCLAIMER, NOTICE_PERIOD_QUESTION,
} from '../utils/noticeClock';
import type { DelayEvent, DelayNotice, Project } from '../types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

// Fixed clock so nothing here depends on the day it runs.
const NOW = Date.parse('2026-08-03T09:00:00');

function makeEvent(over: Partial<DelayEvent> = {}): DelayEvent {
  return {
    id: 'de1', projectId: 'p1', number: 1, cause: 'owner_directed_change',
    firstObservedDate: '2026-08-01', description: 'Owner stopped the framing crew.',
    evidence: [], impactedTaskIds: [], claimedDays: 4, notices: [],
    classification: 'unclassified',
    createdAt: '2026-08-01T12:00:00Z', updatedAt: '2026-08-01T12:00:00Z',
    ...over,
  };
}
function makeProject(over: Partial<Project> = {}): Project {
  return { id: 'p1', name: 'Maple St', ...over } as Project;
}
function makeNotice(over: Partial<DelayNotice> = {}): DelayNotice {
  return {
    id: 'n1', kind: 'initial', sentAt: '2026-08-02T12:00:00Z',
    method: 'certified_mail', recipient: 'Owner rep', daysRequested: 4,
    ...over,
  };
}

console.log('\nnotice clock:');

// ── 1. Deadline derivation ──────────────────────────────────────────────────

ok('deadline = first observed + contract period',
  noticeDeadline('2026-08-01', 21) === '2026-08-22',
  `got ${noticeDeadline('2026-08-01', 21)}`);
ok('7-day window derives correctly',
  noticeDeadline('2026-08-01', 7) === '2026-08-08',
  `got ${noticeDeadline('2026-08-01', 7)}`);
ok('deadline crosses a month boundary',
  noticeDeadline('2026-08-25', 14) === '2026-09-08',
  `got ${noticeDeadline('2026-08-25', 14)}`);

// The noon anchor exists for exactly this: a bare YYYY-MM-DD parsed at
// midnight can land on the previous day across a DST shift or a negative UTC
// offset. A legal deadline silently moving by a day is the failure mode.
ok('bare dates do not drift across the spring DST boundary',
  noticeDeadline('2026-03-01', 14) === '2026-03-15',
  `got ${noticeDeadline('2026-03-01', 14)} — expected 2026-03-15 (US DST starts 2026-03-08)`);
ok('bare dates do not drift across the autumn DST boundary',
  noticeDeadline('2026-10-25', 14) === '2026-11-08',
  `got ${noticeDeadline('2026-10-25', 14)}`);
ok('a bare date parses to the same calendar day it names',
  new Date(parseNoticeDate('2026-08-01') as number).getDate() === 1,
  'midnight parsing would put this on Jul 31 in a negative-offset zone');

ok('daysUntil counts forward', daysUntil('2026-08-10', NOW) === 7, `got ${daysUntil('2026-08-10', NOW)}`);
ok('daysUntil goes negative once past', daysUntil('2026-07-30', NOW) === -4, `got ${daysUntil('2026-07-30', NOW)}`);
ok('daysSince is the inverse', daysSince('2026-07-30', NOW) === 4, `got ${daysSince('2026-07-30', NOW)}`);
ok('an unparseable date yields null, never 0', daysUntil('not-a-date', NOW) === null);

// ── 2. THE DEFAULT IS UNSET, AND STAYS UNSET ────────────────────────────────
// Spec §3.3. This is the single most important behaviour in the file.

ok('a project with no notice period reports null, not a default',
  effectiveNoticePeriod(makeProject()).days === null,
  'a fallback here silently invents a contract term the product cannot know');
ok('noticeDeadline refuses to derive without a period',
  noticeDeadline('2026-08-01', null) === null && noticeDeadline('2026-08-01', undefined) === null);
ok('a zero or negative period is treated as unset, not honoured',
  effectiveNoticePeriod(makeProject({ noticePeriodDays: 0 })).days === null
  && noticeDeadline('2026-08-01', -5) === null);
ok('a set period is reported with assumed=false',
  effectiveNoticePeriod(makeProject({ noticePeriodDays: 14 })).days === 14
  && effectiveNoticePeriod(makeProject({ noticePeriodDays: 14 })).assumed === false);
ok('"I don\'t know" is carried through as assumed',
  effectiveNoticePeriod(makeProject({ noticePeriodDays: 7, noticePeriodAssumed: true })).assumed === true);
ok('the assumed fallback is conservative (short, not long)',
  ASSUMED_NOTICE_PERIOD_DAYS === 7 && ASSUMED_NOTICE_PERIOD_DAYS <= Math.min(...NOTICE_PERIOD_PRESETS),
  `ASSUMED_NOTICE_PERIOD_DAYS=${ASSUMED_NOTICE_PERIOD_DAYS} — a long assumption is a false sense of safety`);
ok('the preset shortcuts are the three numbers people enter most',
  NOTICE_PERIOD_PRESETS.join(',') === '7,14,21', `got ${NOTICE_PERIOD_PRESETS.join(',')}`);
ok('the assumed label tells the user to verify',
  /verify your contract/i.test(ASSUMED_LABEL), ASSUMED_LABEL);

// ── 3. Urgency + the status list ────────────────────────────────────────────

function statusFor(eventOver: Partial<DelayEvent>, projOver: Partial<Project>) {
  return buildNoticeStatus({
    events: [makeEvent(eventOver)],
    projects: [makeProject(projOver)],
    nowMs: NOW,
    includeGiven: true,
  })[0];
}

const open = statusFor({ firstObservedDate: '2026-08-01' }, { noticePeriodDays: 21 });
ok('a 21-day window on a 2-day-old event reads open',
  open.urgency === 'open' && open.daysRemaining === 19 && open.severity === 1,
  `${open.urgency} / ${open.daysRemaining}d / sev ${open.severity}`);

const dueSoon = statusFor({ firstObservedDate: '2026-07-30' }, { noticePeriodDays: 9 });
ok('4–7 days out is due_soon at severity 2',
  dueSoon.urgency === 'due_soon' && dueSoon.severity === 2,
  `${dueSoon.urgency} / ${dueSoon.daysRemaining}d / sev ${dueSoon.severity}`);

const critical = statusFor({ firstObservedDate: '2026-08-01' }, { noticePeriodDays: 5 });
ok('0–3 days out is critical at severity 3',
  critical.urgency === 'critical' && critical.severity === 3,
  `${critical.urgency} / ${critical.daysRemaining}d / sev ${critical.severity}`);

const blown = statusFor({ firstObservedDate: '2026-07-01' }, { noticePeriodDays: 7 });
ok('a closed window reads blown at severity 3',
  blown.urgency === 'blown' && (blown.daysRemaining ?? 0) < 0 && blown.severity === 3,
  `${blown.urgency} / ${blown.daysRemaining}d`);
ok('a blown window says so in the headline',
  /closed/i.test(blown.headline), blown.headline);

// The clock counts from the day the GC FIRST KNEW, not from data entry — a GC
// logging Monday's washout on Wednesday must not get two free days.
const late = statusFor(
  { firstObservedDate: '2026-07-25', createdAt: '2026-08-03T09:00:00Z' },
  { noticePeriodDays: 7 },
);
ok('the clock runs from firstObservedDate, not createdAt',
  late.urgency === 'blown',
  'an event entered today about a condition first seen 9 days ago is already out of a 7-day window');

const unset = statusFor({}, {});
ok('an event on a project with no period is SURFACED, not skipped',
  unset.urgency === 'unset' && unset.deadlineDate === null,
  'dropping it hides the one thing the user must do for the clock to work at all');
ok('the unset row asks the question', /notice window/i.test(unset.headline), unset.headline);
ok('the unset row is loud enough to act on', unset.severity >= 2, `sev ${unset.severity}`);

const assumedStatus = statusFor({ firstObservedDate: '2026-08-01' }, { noticePeriodDays: 7, noticePeriodAssumed: true });
ok('an assumed deadline is labelled in its own detail line',
  assumedStatus.assumed === true && assumedStatus.detail.includes(ASSUMED_LABEL),
  assumedStatus.detail);

// ── 4. Notice recorded stops the clock ──────────────────────────────────────

const given = statusFor({ firstObservedDate: '2026-08-01', notices: [makeNotice()] }, { noticePeriodDays: 7 });
ok('a recorded initial notice stops the clock',
  given.urgency === 'given' && given.daysRemaining === null, given.urgency);
ok('a notice-given event drops out of the default list',
  buildNoticeStatus({
    events: [makeEvent({ notices: [makeNotice()] })],
    projects: [makeProject({ noticePeriodDays: 7 })],
    nowMs: NOW,
  }).length === 0,
  'nothing to chase once notice is on the record');
ok('an unnoticed event stays in the default list',
  buildNoticeStatus({
    events: [makeEvent()],
    projects: [makeProject({ noticePeriodDays: 7 })],
    nowMs: NOW,
  }).length === 1);

// ── 5. Sorting + summary ────────────────────────────────────────────────────

const many = buildNoticeStatus({
  events: [
    makeEvent({ id: 'a', number: 1, firstObservedDate: '2026-08-02' }),   // open
    makeEvent({ id: 'b', number: 2, firstObservedDate: '2026-07-01' }),   // blown
    makeEvent({ id: 'c', number: 3, firstObservedDate: '2026-07-29' }),   // critical
  ],
  projects: [makeProject({ noticePeriodDays: 7 })],
  nowMs: NOW,
});
ok('the most urgent row sorts first', many[0].eventId === 'b' || many[0].eventId === 'c',
  `first was ${many[0].eventId} (${many[0].urgency})`);
ok('the open row sorts last', many[many.length - 1].eventId === 'a',
  `last was ${many[many.length - 1].eventId}`);
const sum = noticeSummary(many);
ok('summary counts blown and critical separately',
  sum.total === 3 && sum.blown === 1 && sum.critical === 1,
  JSON.stringify(sum));

// ── 6. The reservation of rights is THREE STRUCTURED FIELDS ────────────────

ok('a reservation with no named claim is rejected',
  reservationViolations({ kind: 'reservation_of_rights', reservedAmount: 5000 }).length > 0,
  'the record has to say WHICH claim');
ok('a reservation with no stated amount is rejected',
  reservationViolations({ kind: 'reservation_of_rights', reservedClaimDescription: 'extra crew hours' }).length > 0,
  'the record has to say HOW MUCH');
ok('an empty reservation is rejected on both counts',
  reservationViolations({ kind: 'reservation_of_rights' }).length === 2,
  'a free-text box would let both go unfilled');
ok('a whitespace-only description does not satisfy the requirement',
  reservationViolations({ kind: 'reservation_of_rights', reservedClaimDescription: '   ', reservedAmount: 5000 }).length > 0);
ok('a zero amount does not count as a stated amount',
  reservationViolations({ kind: 'reservation_of_rights', reservedClaimDescription: 'x', reservedAmount: 0 }).length > 0);
ok('claim + dollars is accepted',
  reservationViolations({ kind: 'reservation_of_rights', reservedClaimDescription: 'May stair re-work', reservedAmount: 17900 }).length === 0);
ok('claim + days is accepted (time is an amount too)',
  reservationViolations({ kind: 'reservation_of_rights', reservedClaimDescription: 'May stair re-work', reservedDaysClaimed: 12 }).length === 0);
ok('the reservation rule does not fire on a normal notice',
  reservationViolations({ kind: 'initial' }).length === 0);

// ── 7. An extension request records an amount of time ──────────────────────

ok('an initial notice with no days requested is rejected',
  extensionRequestViolations({ kind: 'initial' }).length > 0,
  'the field exists so the record says how many days were asked for');
ok('a supplemental notice with no days requested is rejected',
  extensionRequestViolations({ kind: 'supplemental' }).length > 0);
ok('zero days is not an amount',
  extensionRequestViolations({ kind: 'initial', daysRequested: 0 }).length > 0);
ok('a stated number of days is accepted',
  extensionRequestViolations({ kind: 'initial', daysRequested: 8 }).length === 0);
ok('the days rule does not fire on a reservation of rights',
  extensionRequestViolations({ kind: 'reservation_of_rights' }).length === 0);
ok('noticeViolations folds both rules together',
  noticeViolations(makeNotice({ kind: 'reservation_of_rights', daysRequested: undefined })).length === 2);

// ── 8. The method mismatch — two settings reported back, nothing more ───────

ok('a portal notice against a certified-mail setting is flagged',
  (noticeMethodWarning('certified_mail', 'portal') ?? '').includes('certified mail'),
  String(noticeMethodWarning('certified_mail', 'portal')));
ok('the flag attributes the requirement to the USER, not to a rule',
  /^You set /.test(noticeMethodWarning('certified_mail', 'portal') ?? ''),
  'the app must never say a contract or a clause "requires" anything');
ok('the flag draws no conclusion from the mismatch',
  !/(may not satisfy|does not satisfy|invalid|insufficient|waive)/i.test(
    noticeMethodWarning('certified_mail', 'portal') ?? ''),
  String(noticeMethodWarning('certified_mail', 'portal')));
ok('an email notice against a courier contract warns',
  noticeMethodWarning('courier', 'email') !== null);
ok('certified mail against a certified-mail contract does not warn',
  noticeMethodWarning('certified_mail', 'certified_mail') === null);
ok('courier satisfies a certified-mail requirement (both are proof of delivery)',
  noticeMethodWarning('certified_mail', 'courier') === null);
ok('hand delivery does not warn', noticeMethodWarning('courier', 'hand_delivered') === null);
ok('no recorded requirement means no warning — never a guess',
  noticeMethodWarning(undefined, 'portal') === null,
  'the app must not invent a delivery requirement the user never entered');
ok('a portal-only contract does not warn about a portal notice',
  noticeMethodWarning('portal', 'portal') === null);
ok('recording is explicitly distinguished from sending',
  /not the same as sending/i.test(RECORDING_IS_NOT_SERVING), RECORDING_IS_NOT_SERVING);

// ── 9. A notice with no response recorded stays visible ────────────────────

const waited = makeEvent({ notices: [makeNotice({ sentAt: '2026-07-10T12:00:00Z' })] });
ok('the silence prompt fires once the response window elapses',
  ownerSilencePromptFor(waited, NOW) !== null,
  `waited ${daysSince('2026-07-10T12:00:00Z', NOW)}d against a ${OWNER_RESPONSE_WINDOW_DAYS}d window`);
ok('the prompt states elapsed time and nothing else',
  /^No response recorded in the \d+ days since you logged this notice\.$/
    .test(ownerSilencePromptFor(waited, NOW) ?? ''),
  ownerSilencePromptFor(waited, NOW) ?? 'null');
ok('the prompt tells nobody what to do about it',
  !/(you (should|must|need to|have to)|notify them|in writing|constructive|accelerat)/i
    .test(ownerSilencePromptFor(waited, NOW) ?? ''),
  ownerSilencePromptFor(waited, NOW) ?? 'null');
ok('no prompt before the response window elapses',
  ownerSilencePromptFor(makeEvent({ notices: [makeNotice({ sentAt: '2026-08-01T12:00:00Z' })] }), NOW) === null);
ok('no prompt without an initial notice — nothing has been sent yet',
  ownerSilencePromptFor(makeEvent({ notices: [] }), NOW) === null);
ok('no prompt once a change order resolved it',
  ownerSilencePromptFor(makeEvent({
    notices: [makeNotice({ sentAt: '2026-07-10T12:00:00Z' })], changeOrderId: 'co1',
  }), NOW) === null,
  'the owner acted — there is nothing outstanding');
ok('no prompt once a follow-up notice has been recorded',
  ownerSilencePromptFor(makeEvent({
    notices: [makeNotice({ sentAt: '2026-07-10T12:00:00Z' }), makeNotice({ id: 'n2', kind: 'supplemental' })],
  }), NOW) === null,
  'the user already followed up — do not nag');
ok('the prompt surfaces through buildNoticeStatus even though the clock stopped',
  (buildNoticeStatus({ events: [waited], projects: [makeProject({ noticePeriodDays: 21 })], nowMs: NOW })[0]
    ?.ownerSilencePrompt ?? null) !== null,
  'a notice-given event with an unanswered notice must not be filtered out');

// ── 10. SUGGEST, NEVER CONCLUDE ─────────────────────────────────────────────

ok('a stored event defaults to unclassified', makeEvent().classification === 'unclassified');
ok('weather suggests time-but-not-money',
  suggestClassification('weather') === 'excusable_noncompensable');
ok('an owner-directed change suggests time and money',
  suggestClassification('owner_directed_change') === 'excusable_compensable');
ok('a contractor-caused delay is suggested honestly',
  suggestClassification('contractor_caused') === 'nonexcusable');
ok('a differing site condition gets NO suggestion — it depends on the job',
  suggestClassification('differing_site_condition') === null,
  'MAGE cannot see the agreement, so it does not guess');
ok('permit/inspection gets no suggestion', suggestClassification('permit_or_inspection') === null);
ok('"other" gets no suggestion', suggestClassification('other') === null);
ok('no suggestion is ever "unclassified" itself',
  (['weather', 'owner_directed_change', 'late_rfi_response', 'differing_site_condition',
    'owner_supplied_item', 'permit_or_inspection', 'design_revision', 'contractor_caused', 'other'] as const)
    .every(c => suggestClassification(c) !== 'unclassified'),
  'a suggestion of "unclassified" would be noise, not a starting point');

// ── 11. Numbering ───────────────────────────────────────────────────────────

ok('the first event on a job is DE-001',
  nextDelayEventNumber([]) === 1 && formatDelayEventNumber(1) === 'DE-001');
ok('numbering continues from the highest existing',
  nextDelayEventNumber([makeEvent({ number: 3 }), makeEvent({ id: 'x', number: 7 })]) === 8);
ok('numbering pads to three digits',
  formatDelayEventNumber(12) === 'DE-012' && formatDelayEventNumber(104) === 'DE-104');

// ── 12. Source-level guards ─────────────────────────────────────────────────

console.log('\nwiring:');

const clockSrc = read('utils/noticeClock.ts');
ok('noticeClock.ts is react-native-free (bun must be able to parse it)',
  !/from\s+['"]react-native['"]/.test(clockSrc) && !/from\s+['"]react['"]/.test(clockSrc));
ok('noticeClock.ts imports types only from @/types',
  /import type \{/.test(clockSrc));

// The deadline must never be persisted — a stored deadline goes stale the
// moment the contract setting is corrected, and a stale legal deadline is
// worse than none.
const typesSrc = read('types/index.ts');
ok('no stored notice deadline on DelayEvent',
  !/noticeDeadline\s*[?]?:/.test(typesSrc) && !/deadlineDate\s*[?]?:\s*string/.test(typesSrc),
  'derive it; a stored deadline goes stale when the contract setting is fixed');
ok('DelayEvent carries the concurrency field',
  /concurrentDays\s*\?:\s*number/.test(typesSrc),
  'a register that cannot show concurrency gets taken apart in one question');
ok('the reservation is three separate fields on DelayNotice',
  /reservedClaimDescription\?:\s*string/.test(typesSrc)
  && /reservedAmount\?:\s*number/.test(typesSrc)
  && /reservedDaysClaimed\?:\s*number/.test(typesSrc));
ok('DelayEvidenceRef is a pointer, not an embedded record',
  /export interface DelayEvidenceRef \{[^}]*kind: DelayEvidenceKind;[^}]*id: string;/s.test(typesSrc),
  'copying evidence creates a second version of a fact that can drift');
ok('Project.noticePeriDays is optional — the type itself refuses a default',
  /noticePeriodDays\?:\s*number/.test(typesSrc));

// No screen may quietly invent a notice period.
const appFiles = readdirSync(join(ROOT, 'app')).filter(f => f.endsWith('.tsx'));
const defaulted = [...appFiles.map(f => join('app', f)), 'contexts/ProjectContext.tsx', 'hooks/useSmartInbox.ts']
  .filter(rel => existsSync(join(ROOT, rel)))
  .filter(rel => /noticePeriodDays\s*(\?\?|\|\|)\s*\d+/.test(read(rel)));
ok('no caller falls back to a hardcoded notice period',
  defaulted.length === 0,
  defaulted.length ? `found in: ${defaulted.join(', ')}` : undefined);

const inboxSrc = read('hooks/useSmartInbox.ts');
ok('the notice_deadline inbox rule exists',
  /'notice_deadline'/.test(inboxSrc));
ok('the inbox rule is driven by the pure module, not a reimplementation',
  /buildNoticeStatus/.test(inboxSrc),
  'a second copy of the day math will drift from this one');

// The chase list is for OTHER people's obligations. A notice deadline is the
// GC's own, and putting it there would invert that file's stated contract.
ok('the notice deadline did not leak into the chase list',
  !/notice/i.test(read('utils/systemOfAction.ts')),
  'utils/systemOfAction.ts:56 — "chasing yourself is noise"');

const authSrc = read('contexts/AuthContext.tsx');
ok('mageid_delay_events is wiped on tenant switch',
  /'mageid_delay_events'/.test(authSrc),
  'any mageid_* key missing from LOCAL_USER_CACHE_KEYS leaks across tenants');

const ctxSrc = read('contexts/ProjectContext.tsx');
ok('delay events persist locally under mageid_delay_events',
  /DELAY_EVENTS_KEY = 'mageid_delay_events'/.test(ctxSrc));
ok('delay-event writes go through supabaseWrite, never supabase.from directly',
  /supabaseWrite\('delay_events'/.test(ctxSrc)
  && !/supabase\.from\('delay_events'\)\.(insert|update|delete|upsert)/.test(ctxSrc));
ok('the register falls back to local storage when the table is missing',
  /loadLocal<DelayEvent\[\]>\(DELAY_EVENTS_KEY/.test(ctxSrc),
  'the table does not exist in production yet — the feature must work anyway');

// ── 13. The migration ───────────────────────────────────────────────────────

const migDir = join(ROOT, 'supabase', 'migrations');
const migName = readdirSync(migDir).find(f => /delay_events\.sql$/.test(f));
ok('a delay_events migration exists', !!migName, `looked in ${migDir}`);
if (migName) {
  const version = migName.slice(0, 14);
  ok('the migration sorts after the last unapplied one (20260803150000)',
    version > '20260803150000', `version prefix is ${version}`);
  const mig = readFileSync(join(migDir, migName), 'utf8');
  ok('it creates a real table, not a jsonb column on projects',
    /create table if not exists public\.delay_events/i.test(mig)
    && !/alter table public\.projects/i.test(mig),
    'projects.schedule is a whole-row upsert with last-write-wins clobber');
  ok('RLS is enabled', /alter table public\.delay_events enable row level security/i.test(mig));
  for (const cmd of ['select', 'insert', 'update', 'delete']) {
    ok(`an RLS policy covers ${cmd.toUpperCase()}`,
      new RegExp(`create policy delay_events_${cmd}`, 'i').test(mig));
  }
  ok('every policy is owner-scoped on auth.uid() = user_id',
    (mig.match(/auth\.uid\(\) = user_id/g) ?? []).length >= 4,
    'mirrors public.change_orders');
  ok('classification defaults to unclassified in the schema too',
    /classification text not null default 'unclassified'/i.test(mig),
    'the DB must not be able to hold a guessed classification as a default');
  ok('first_observed_date is NOT NULL — the clock has nothing to count from otherwise',
    /first_observed_date text not null/i.test(mig));
  ok('a unique index stops two DE-004s on the same job',
    /unique index[\s\S]{0,120}delay_events\s*\(project_id, number\)/i.test(mig));
  ok('the migration says out loud that sealing is Phase 2',
    /PHASE 2 PLACEHOLDER/i.test(mig),
    'nothing writes sealed_at or content_hash yet, so nothing may claim they do');
}

// ── 14. Route registration ──────────────────────────────────────────────────
// Several fully-built screens in this repo shipped unreachable.

ok('the delay register screen exists', existsSync(join(ROOT, 'app', 'delay-events.tsx')));
ok('it is registered in app/_layout.tsx',
  /<Stack\.Screen name="delay-events"/.test(read('app/_layout.tsx')));
ok('it is searchable via featureRegistry',
  /route: '\/delay-events'/.test(read('utils/featureRegistry.ts')));
ok('it is reachable from the desktop sidebar',
  /route: '\/delay-events'/.test(read('components/DesktopSidebar.tsx')));
ok('the daily report can log a delay from Issues & Delays',
  /pathname: '\/delay-events'/.test(read('app/daily-report.tsx')),
  'the spine is worthless if nothing writes to it');
ok('the weather reschedule can log a delay',
  /pathname: '\/delay-events'/.test(read('app/schedule-pro.tsx')));

// ── 15. NO LEGAL ADVICE, ANYWHERE ───────────────────────────────────────────
//
// The founder's rule: this ships without a lawyer, so nothing in it may need
// one. Two separate bans, enforced differently.
//
//   HARD BAN (§15a) — statute and rule citations, and case names. There is no
//   "we deliberately don't cite FRE 803(6)" exemption, because writing the
//   citation down at all is how it ends up in a tooltip six months from now.
//   The unreviewed research that produced these lives in the design spec and
//   stays there.
//
//   SOFT BAN (§15b) — outcome and guarantee language, where a file is allowed
//   to name a phrase in order to forbid it.
//
// Both run over the claim-defense sources AND over every string these modules
// actually hand to a user, because a clean source file that renders a bad
// sentence is not clean.

// Scope matters. types/index.ts is a 4,700-line shared file whose unrelated
// sections legitimately say "immutable" about other things, so only the delay
// block added for this feature is scanned.
function delayTypesBlock(): string {
  const src = read('types/index.ts');
  const start = src.indexOf('// Delay events — the record that ties the evidence together.');
  const end = src.indexOf('export interface InvoiceLineItem', start);
  return start >= 0 && end > start ? src.slice(start, end) : '';
}
const NEW_SOURCES: { rel: string; text: string }[] = [
  { rel: 'utils/noticeClock.ts', text: read('utils/noticeClock.ts') },
  { rel: 'utils/rfiHoldTime.ts', text: read('utils/rfiHoldTime.ts') },
  { rel: 'utils/dailyLogCompletion.ts', text: read('utils/dailyLogCompletion.ts') },
  { rel: 'app/delay-events.tsx', text: read('app/delay-events.tsx') },
  { rel: 'components/home/DailyLogCard.tsx', text: read('components/home/DailyLogCard.tsx') },
  { rel: 'types/index.ts (delay block)', text: delayTypesBlock() },
  ...(migName ? [{ rel: migName, text: readFileSync(join(migDir, migName), 'utf8') }] : []),
];
ok('the delay-types block was found for scanning', delayTypesBlock().length > 500);

// ── 15a. HARD BAN — citations and case names ────────────────────────────────
// No negation escape hatch. A hit anywhere in the file fails.

const CITATIONS: { re: RegExp; why: string }[] = [
  { re: /\bFRE\s*\d|\bF\.?R\.?E\.?\s*803|Federal Rule[s]? of Evidence|\bRule 803\b/i,
    why: 'evidence-rule citation' },
  { re: /\bA201\b|AIA Document|ConsensusDocs/i, why: 'contract-form citation' },
  { re: /§\s*\d/, why: 'section citation — a section number is a citation to something' },
  { re: /\bE-?SIGN\b|\bUETA\b/i, why: 'statute citation' },
  { re: /\b\d+\s*U\.?\s?S\.?\s?C\.?\s*§?\s*\d|\bUCC\s*\d/i, why: 'code citation' },
  { re: /statute[s]? of (repose|limitation)/i, why: 'statute citation' },
  { re: /\bF\.\s?[23]d\b|\bU\.S\.\s?\d|Cal\.\s?App|Ohio St\.|\bASBCA\b|\bCBCA\b|Fed\.\s?(Cir|Cl)\./i,
    why: 'case reporter citation' },
  { re: /\b(?:Inc\.|Corp\.|Co\.|LLC)?\s*v\.\s+(?:United States|City of|[A-Z][a-z]+\s+(?:Constr|Dept|Corp))/,
    why: 'case name' },
  { re: /\b(Mingus|Zafer|Fraser|Meltech|Vistas|Caddell|Opinski|Dugan & Meyers|Enfield)\b/,
    why: 'case name' },
  { re: /as a matter of law|condition precedent|blunderbuss/i, why: 'legal term of art stated as fact' },
];
for (const { re, why } of CITATIONS) {
  const hits = NEW_SOURCES.filter(s => re.test(s.text)).map(s => s.rel);
  ok(`no claim-defense source carries a ${why}`, hits.length === 0,
    hits.length ? `/${re.source.slice(0, 44)}/ — found in: ${hits.join(', ')}` : undefined);
}

// NEGATIVE CONTROL: the scanner must actually fire. If this ever passes as
// "clean", every check above is theatre.
ok('NEGATIVE: the citation scanner fires on a planted citation',
  CITATIONS.some(({ re }) => re.test(
    'Under FRE 803(6) and AIA A201-2017 §15.1.3.2, see Mingus Constructors v. United States, 812 F.2d 1387 (Fed. Cir. 1987).')),
  'a planted citation was not detected — the patterns are broken');

// ── 15b. SOFT BAN — outcome and guarantee language ──────────────────────────
// A file is allowed to NAME forbidden language in order to warn against it —
// that is the whole point of several comments here. So a hit only counts when
// the surrounding two lines carry no negation.
const NEGATION = /\b(not|never|no\b|anti-pattern|fails?|void|must not|cannot|refus|forbidden|wrong|deliberately|may not appear|do not say)/i;
function affirmativeHits(text: string, re: RegExp): number {
  const lines = text.split('\n');
  let n = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!re.test(lines[i])) continue;
    const window = lines.slice(Math.max(0, i - 2), i + 3).join(' ');
    if (!NEGATION.test(window)) n++;
  }
  return n;
}

const FORBIDDEN: { re: RegExp; why: string }[] = [
  { re: /unassailable/i, why: 'nothing is — there are five independent ways to assail it' },
  { re: /admissib/i, why: 'admissibility is a ruling on a record, not a property of a file' },
  { re: /will hold up|holds? up in court|stand[s]? up in court|survive[s]? (a )?(challenge|cross)/i,
    why: 'outcome claim — MAGE cannot know how anything will be received' },
  { re: /legally binding|legal[- ]grade|legally valid/i, why: 'legal-effect claim' },
  { re: /tamper[- ]proof/i, why: 'tamper-EVIDENT is true; tamper-proof is not' },
  { re: /blockchain[- ]grade|cryptographically guaranteed/i, why: 'there is no external anchor' },
  { re: /proves (that )?the owner/i, why: 'causation is argued from evidence; software assembles evidence' },
  { re: /will win your claim|wins? your claim|protects? your claim/i, why: 'outcome claim' },
  { re: /reserves? all rights/i, why: 'reads as drafting advice, not a field label' },
  { re: /under protest/i, why: 'drafting advice' },
  { re: /CPM is required/i, why: 'conditional — most residential contracts do not require it' },
  // "Send it the way your agreement requires" is a DISCLAIMER — it hands the
  // question back to the user's own document. "Your contract requires
  // certified mail" is MAGE finishing that sentence for them, which it cannot
  // do, having never read the contract. So the ban is on the completed form:
  // `requires` followed by a word.
  { re: /(your|the) (contract|agreement) requires \w|the law requires/i,
    why: 'MAGE has never read the contract; say "you set", not "your contract requires X"' },
  { re: /waives? (your|a|the) claim|claim is waived|forfeits?/i, why: 'legal consequence stated as fact' },
];
for (const { re, why } of FORBIDDEN) {
  const hits = NEW_SOURCES.filter(s => affirmativeHits(s.text, re) > 0).map(s => s.rel);
  ok(`no claim-defense source asserts /${re.source.slice(0, 34)}/`, hits.length === 0,
    hits.length ? `${why} — found in: ${hits.join(', ')}` : undefined);
}

// "Immutable" is only true once the sealing triggers ship, and even then only
// against UPDATE. Until then it must not appear as a promise.
const immutableClaims = NEW_SOURCES
  .filter(s => affirmativeHits(s.text, /\bimmutable\b/i) > 0)
  .map(s => s.rel);
ok('no claim-defense source promises immutability', immutableClaims.length === 0,
  immutableClaims.length ? `the rows are deletable by their owner today — found in: ${immutableClaims.join(', ')}` : undefined);

// ── 15c. The strings a user actually reads ──────────────────────────────────
// Everything the pure module renders, run through BOTH bans with no negation
// escape — a user-facing sentence has no surrounding comment to soften it.

const USER_FACING: string[] = [
  ASSUMED_LABEL,
  RECORDING_IS_NOT_SERVING,
  NOTICE_REMINDER_DISCLAIMER,
  NOTICE_PERIOD_QUESTION,
  noticeMethodWarning('certified_mail', 'portal') ?? '',
  noticeMethodWarning('courier', 'email') ?? '',
  ownerSilencePromptFor(waited, NOW) ?? '',
  ...reservationViolations({ kind: 'reservation_of_rights' }),
  ...extensionRequestViolations({ kind: 'initial' }),
  ...buildNoticeStatus({
    events: [
      makeEvent({ id: 'x1', number: 1, firstObservedDate: '2026-07-01' }),
      makeEvent({ id: 'x2', number: 2, firstObservedDate: '2026-08-02' }),
      makeEvent({ id: 'x3', number: 3, notices: [makeNotice({ sentAt: '2026-07-10T12:00:00Z' })] }),
    ],
    projects: [makeProject({ noticePeriodDays: 7, noticePeriodAssumed: true, noticeMethodRequired: 'certified_mail' })],
    nowMs: NOW,
    includeGiven: true,
  }).flatMap(s => [s.headline, s.detail, s.methodWarning ?? '', s.ownerSilencePrompt ?? '']),
  ...buildNoticeStatus({ events: [makeEvent()], projects: [makeProject()], nowMs: NOW })
    .flatMap(s => [s.headline, s.detail]),
].filter(s => s.length > 0);

ok('every user-facing notice string was collected', USER_FACING.length >= 14, `got ${USER_FACING.length}`);

for (const { re, why } of [...CITATIONS, ...FORBIDDEN]) {
  const bad = USER_FACING.find(s => re.test(s));
  ok(`no user-facing notice string carries a ${why}`, !bad, bad);
}

// NEGATIVE CONTROLS for the soft ban, on the two rules most easily written
// too loose. Both of these sentences shipped in this file's earlier version.
ok('NEGATIVE: the scanner fires on MAGE stating what a contract requires',
  FORBIDDEN.some(({ re }) => re.test(
    'Your contract requires certified mail or courier with proof of delivery.')));
ok('NEGATIVE: deferring to the user\'s own contract is NOT flagged',
  !FORBIDDEN.some(({ re }) => re.test(
    'Send it the way your agreement requires, then log it here.')),
  'a disclaimer that hands the question back to the user must stay legal');
ok('NEGATIVE: the scanner fires on an outcome claim',
  FORBIDDEN.some(({ re }) => re.test(
    'An unbroken record is what makes the log hold up in court.')));

// The honest disclaimer has to exist, be short, and actually be rendered.
ok('the reminder disclaimer says the date came from the user\'s own setting',
  /you entered/i.test(NOTICE_REMINDER_DISCLAIMER), NOTICE_REMINDER_DISCLAIMER);
ok('the reminder disclaimer says it is not legal advice',
  /not legal advice/i.test(NOTICE_REMINDER_DISCLAIMER), NOTICE_REMINDER_DISCLAIMER);
ok('the reminder disclaimer is one short line, not a wall of text',
  NOTICE_REMINDER_DISCLAIMER.length < 200, `${NOTICE_REMINDER_DISCLAIMER.length} chars`);
{
  const screen = read('app/delay-events.tsx');
  ok('the delay register renders the reminder disclaimer',
    (screen.match(/NOTICE_REMINDER_DISCLAIMER/g) ?? []).length >= 3,
    'it must appear wherever a derived notice date is shown, not just in the footer');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

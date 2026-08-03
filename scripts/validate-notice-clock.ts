// validate-notice-clock.ts — pins the notice clock and the delay register.
//
// WHY: this is the only feature in the product whose failure mode is a WAIVED
// CLAIM. Most construction contracts make written notice a condition precedent
// to any claim for time or money; miss the window and a real entitlement is
// gone. Greg Opinski Constr. v. City of Oakdale, 199 Cal.App.4th 1107 (2011)
// held a contractor liable for liquidated damages despite OWNER-caused delay,
// because it never used the contract's procedure to obtain the extension.
//
// Several rules below have a specific case behind them and a specific wrong
// implementation they exist to prevent:
//
//   * NO DEFAULT NOTICE PERIOD. Shipping 21 days would hand a GC on a 7-day
//     residential agreement a clock that runs two weeks long. Worse than none.
//   * Mingus Constructors v. United States, 812 F.2d 1387 (Fed. Cir. 1987) —
//     a generic "reserves all rights" is a "blunderbuss exception" and
//     "insufficient as a matter of law". Three structured fields, not a box.
//   * Zafer Taahhut Insaat v. United States, 833 F.3d 1356 (Fed. Cir. 2016) —
//     an open-ended extension request is not a sufficient request.
//   * Fraser Constr. Co. v. United States, 384 F.3d 1354 (Fed. Cir. 2004),
//     element 4 — constructive acceleration needs a SECOND notice.
//   * The app must never conclude entitlement (spec §5.3).
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
  buildNoticeStatus, noticeSummary, accelerationPromptFor,
  reservationViolations, extensionRequestViolations, noticeViolations,
  noticeMethodWarning, suggestClassification, nextDelayEventNumber,
  formatDelayEventNumber,
  NOTICE_PERIOD_PRESETS, ASSUMED_NOTICE_PERIOD_DAYS, ASSUMED_LABEL,
  RECORDING_IS_NOT_SERVING, OWNER_RESPONSE_WINDOW_DAYS,
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
ok('presets are the three real contract windows',
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
ok('the unset row asks the question', /notice period/i.test(unset.headline), unset.headline);
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

// ── 6. Mingus — the reservation of rights is THREE STRUCTURED FIELDS ────────

ok('a reservation with no named claim is rejected',
  reservationViolations({ kind: 'reservation_of_rights', reservedAmount: 5000 }).length > 0,
  'Mingus: the exception must identify the claim');
ok('a reservation with no stated amount is rejected',
  reservationViolations({ kind: 'reservation_of_rights', reservedClaimDescription: 'acceleration costs' }).length > 0,
  'Mingus: "specific claims be excepted in stated amounts"');
ok('a bare "reserves all rights" is rejected on both counts',
  reservationViolations({ kind: 'reservation_of_rights' }).length === 2,
  'the blunderbuss exception — insufficient as a matter of law');
ok('a whitespace-only description does not satisfy the requirement',
  reservationViolations({ kind: 'reservation_of_rights', reservedClaimDescription: '   ', reservedAmount: 5000 }).length > 0);
ok('a zero amount does not count as a stated amount',
  reservationViolations({ kind: 'reservation_of_rights', reservedClaimDescription: 'x', reservedAmount: 0 }).length > 0);
ok('claim + dollars is accepted',
  reservationViolations({ kind: 'reservation_of_rights', reservedClaimDescription: 'May acceleration', reservedAmount: 17900 }).length === 0);
ok('claim + days is accepted (time is an amount too)',
  reservationViolations({ kind: 'reservation_of_rights', reservedClaimDescription: 'May acceleration', reservedDaysClaimed: 12 }).length === 0);
ok('the reservation rule does not fire on a normal notice',
  reservationViolations({ kind: 'initial' }).length === 0);

// ── 7. Zafer — an extension request must state an amount of time ────────────

ok('an initial notice with no days requested is rejected',
  extensionRequestViolations({ kind: 'initial' }).length > 0,
  'Zafer: an open-ended request fails Fraser elements 2 and 3');
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

// ── 8. §3.5 — the one thing the clock must say out loud ─────────────────────

ok('a portal notice against a certified-mail contract warns',
  (noticeMethodWarning('certified_mail', 'portal') ?? '').includes('certified mail'),
  String(noticeMethodWarning('certified_mail', 'portal')));
ok('the warning names the clause',
  /15\.1\.3\.2/.test(noticeMethodWarning('certified_mail', 'portal') ?? ''),
  'a GC needs to know WHICH clause to go read');
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
ok('recording is explicitly distinguished from serving',
  /not the same as serving/i.test(RECORDING_IS_NOT_SERVING), RECORDING_IS_NOT_SERVING);

// ── 9. Fraser element 4 — the SECOND notice ─────────────────────────────────

const waited = makeEvent({ notices: [makeNotice({ sentAt: '2026-07-10T12:00:00Z' })] });
ok('the acceleration prompt fires once the owner has sat on it',
  accelerationPromptFor(waited, NOW) !== null,
  `waited ${daysSince('2026-07-10T12:00:00Z', NOW)}d against a ${OWNER_RESPONSE_WINDOW_DAYS}d window`);
ok('the prompt names acceleration',
  /accelerat/i.test(accelerationPromptFor(waited, NOW) ?? ''));
ok('no prompt before the response window elapses',
  accelerationPromptFor(makeEvent({ notices: [makeNotice({ sentAt: '2026-08-01T12:00:00Z' })] }), NOW) === null);
ok('no prompt without an initial notice — element 2 comes first',
  accelerationPromptFor(makeEvent({ notices: [] }), NOW) === null);
ok('no prompt once a change order resolved it',
  accelerationPromptFor(makeEvent({
    notices: [makeNotice({ sentAt: '2026-07-10T12:00:00Z' })], changeOrderId: 'co1',
  }), NOW) === null,
  'the owner acted — there is nothing to escalate');
ok('no prompt once the second notice has been sent',
  accelerationPromptFor(makeEvent({
    notices: [makeNotice({ sentAt: '2026-07-10T12:00:00Z' }), makeNotice({ id: 'n2', kind: 'supplemental' })],
  }), NOW) === null,
  'element 4 is satisfied — do not nag');
ok('the prompt surfaces through buildNoticeStatus even though the clock stopped',
  (buildNoticeStatus({ events: [waited], projects: [makeProject({ noticePeriodDays: 21 })], nowMs: NOW })[0]
    ?.accelerationPrompt ?? null) !== null,
  'a notice-given event with a live second-notice obligation must not be filtered out');

// ── 10. §5.3 — SUGGEST, NEVER CONCLUDE ──────────────────────────────────────

ok('a stored event defaults to unclassified', makeEvent().classification === 'unclassified');
ok('weather suggests time-but-not-money',
  suggestClassification('weather') === 'excusable_noncompensable');
ok('an owner-directed change suggests time and money',
  suggestClassification('owner_directed_change') === 'excusable_compensable');
ok('a contractor-caused delay is suggested honestly',
  suggestClassification('contractor_caused') === 'nonexcusable');
ok('a differing site condition gets NO suggestion — it depends on the contract',
  suggestClassification('differing_site_condition') === null,
  'who bears that risk is a contract question; guessing is deciding entitlement');
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
    'the DB must not be able to hold a guessed entitlement as a default');
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

// ── 15. Language limits (spec §6.7) ─────────────────────────────────────────

// Scope matters. types/index.ts is a 4,700-line shared file whose unrelated
// sections legitimately say "immutable" about other things, so only the delay
// block added for this feature is scanned.
function delayTypesBlock(): string {
  const src = read('types/index.ts');
  const start = src.indexOf('// Delay events — the claim-defense spine.');
  const end = src.indexOf('export interface InvoiceLineItem', start);
  return start >= 0 && end > start ? src.slice(start, end) : '';
}
const NEW_SOURCES: { rel: string; text: string }[] = [
  { rel: 'utils/noticeClock.ts', text: read('utils/noticeClock.ts') },
  { rel: 'app/delay-events.tsx', text: read('app/delay-events.tsx') },
  { rel: 'types/index.ts (delay block)', text: delayTypesBlock() },
  ...(migName ? [{ rel: migName, text: readFileSync(join(migDir, migName), 'utf8') }] : []),
];
ok('the delay-types block was found for scanning', delayTypesBlock().length > 500);

// A file is allowed to NAME forbidden language in order to warn against it —
// that is the whole point of several comments here. So a hit only counts when
// the surrounding two lines carry no negation.
const NEGATION = /\b(not|never|no\b|insufficient|anti-pattern|blunderbuss|fails?|void|must not|cannot|refus|forbidden|wrong|deliberately)/i;
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
  { re: /court[- ]admissible/i, why: 'admissibility is a ruling on a record, not a property of a file' },
  { re: /legally binding proof/i, why: 'same' },
  { re: /blockchain[- ]grade|cryptographically guaranteed/i, why: 'there is no external anchor' },
  { re: /proves (that )?the owner/i, why: 'causation is argued from evidence; software assembles evidence' },
  { re: /will win your claim/i, why: 'outcome claim' },
  { re: /reserves? all rights\b(?![^.]*insufficient)/i, why: 'Mingus — the blunderbuss exception, insufficient as a matter of law' },
  { re: /under protest/i, why: 'UCC 1-308(b) switches it off against accord and satisfaction — legally wrong advice' },
  { re: /CPM is required/i, why: 'conditional — most residential contracts do not require it' },
];
for (const { re, why } of FORBIDDEN) {
  const hits = NEW_SOURCES.filter(s => affirmativeHits(s.text, re) > 0).map(s => s.rel);
  ok(`no new file asserts /${re.source.slice(0, 34)}/`, hits.length === 0,
    hits.length ? `${why} — found in: ${hits.join(', ')}` : undefined);
}

// "Immutable" is only true after the Phase 2 triggers ship, and even then only
// against UPDATE. Until then it must not appear as a promise.
const immutableClaims = NEW_SOURCES
  .filter(s => affirmativeHits(s.text, /\bimmutable\b/i) > 0)
  .map(s => s.rel);
ok('no new file promises immutability', immutableClaims.length === 0,
  immutableClaims.length ? `the rows are deletable by their owner today — found in: ${immutableClaims.join(', ')}` : undefined);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

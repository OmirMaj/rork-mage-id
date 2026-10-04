// validate-whoson — "who is on this project" (lane WHOKIT).
//
// WHAT IT PROVES. The feature shows a contractor the people on a project he
// shares and a "Has it open" dot. Every way it can be wrong is a privacy or an
// honesty failure: one team member learning about another, an email on a
// screen that is not the owner's, a dot the app cannot vouch for, a "last
// seen" that keeps saying "12 min ago" for an hour, a timer that asks the
// server when nobody is there. The decisions live in two pure files
// (utils/whoson/people.ts, utils/whoson/heartbeat.ts) so they can be run here
// under bun; the source checks at the bottom pin the wiring around them: one
// file calls the server, nothing is queued, nothing is stored on the device,
// the words claim only what the app knows, and with WHOS_ON_ENABLED false
// nothing runs at all.
//
// Run: bun run scripts/validate-whoson.ts
// Pure node:fs + the pure modules; no react-native import (those crash bun).
// fileURLToPath + join because the repo path contains a space.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import type { ProjectPerson } from '../types';
import { PROJECT_CHIP_PALETTE } from '../constants/colors';
import { WHOS_ON_ENABLED } from '../constants/featureFlags';
import {
  WHOSON, PERSON_COLORS, UNKNOWN_PEOPLE,
  activityLine, cleanPersonText, isOpenNow, mapPeopleRow, mapPeopleRows, membershipLine, needsClock,
  peopleModel, peopleUsable, personColor, personInitials, readIsStale, stackSlots,
} from '../utils/whoson/people';
import {
  HEARTBEAT_START, afterResult, afterRouteChange, backoffDelayMs, dueInMs, isWebIdle, leaveNeeded, nextTick,
  type CachedPeopleFacts, type PresenceSituation, type TickInput,
} from '../utils/whoson/heartbeat';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  PASS  ' + name); return; }
  fail++;
  console.error('  FAIL  ' + name + (detail ? `\n        ${detail}` : ''));
}
function eq<T>(name: string, actual: T, expected: T) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(name, a === e, `got ${a}, want ${e}`);
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const T0 = Date.parse('2026-10-04T15:00:00Z');
const OWNER = 'owner-0000';

function ownerRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    user_id: OWNER, kind: 'owner', role: 'owner', display_name: 'Omar Majeed', company_name: 'Majeed Builders',
    is_self: true, invited_by_viewer: false, invited_email: null, joined_at: null,
    open_expires_s: null, last_seen_at: null, seen_age_s: null, shares_presence: true, ...over,
  };
}
function memberRow(n: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    user_id: `member-${String(n).padStart(4, '0')}`, kind: 'member', role: 'field',
    display_name: `Sub ${n}`, company_name: `Trade ${n} LLC`,
    is_self: false, invited_by_viewer: true, invited_email: `sub${n}@example.com`,
    joined_at: new Date(T0 - (100 - n) * 86_400_000).toISOString(),
    open_expires_s: null, last_seen_at: null, seen_age_s: null, shares_presence: null, ...over,
  };
}
/** The owner's own payload: himself plus `members` accepted team members (member 1 joined first). */
function ownerPayload(members: number, over: (n: number) => Record<string, unknown> = () => ({})): ProjectPerson[] {
  const rows = [ownerRow()];
  for (let n = 1; n <= members; n++) rows.push(memberRow(n, over(n)));
  return mapPeopleRows(rows);
}
const clock = { fetchedAtMs: T0, nowMs: T0 + 1_000 };

// ── 1. mapPeopleRow ──────────────────────────────────────────────────────────
console.log('\nrows:');
{
  const p = mapPeopleRow(memberRow(1, { open_expires_s: 90, last_seen_at: '2026-10-04T14:58:00Z', seen_age_s: 120 }));
  ok('a member row maps snake_case to camelCase', !!p && p.userId === 'member-0001' && p.kind === 'member' && p.role === 'field'
    && p.displayName === 'Sub 1' && p.companyName === 'Trade 1 LLC' && p.invitedEmail === 'sub1@example.com'
    && p.invitedByViewer === true && p.openExpiresS === 90 && p.seenAgeS === 120 && p.isSelf === false);
  eq('the mapped person has exactly the thirteen fields of the type', p ? Object.keys(p).sort() : [], [
    'companyName', 'displayName', 'invitedByViewer', 'invitedEmail', 'isSelf', 'joinedAt', 'kind',
    'lastSeenAt', 'openExpiresS', 'role', 'seenAgeS', 'sharesPresence', 'userId',
  ]);
  ok('an unknown kind is dropped', mapPeopleRow(memberRow(1, { kind: 'client' })) === null);
  ok('an unknown role is dropped', mapPeopleRow(memberRow(1, { role: 'admin' })) === null);
  ok('a member row with the owner role is dropped', mapPeopleRow(memberRow(1, { role: 'owner' })) === null);
  ok('a row with no user id is dropped', mapPeopleRow(memberRow(1, { user_id: '' })) === null && mapPeopleRow(null) === null && mapPeopleRow('x') === null);
  ok('a name containing @ is nulled', mapPeopleRow(memberRow(1, { display_name: 'dana@ruizelectric.com' }))?.displayName === null);
  ok('a company containing @ is nulled', mapPeopleRow(memberRow(1, { company_name: 'ruiz@work' }))?.companyName === null);
  ok('control characters are stripped', mapPeopleRow(memberRow(1, { display_name: 'Da\u0000na\n Ru\u0007iz\u009F' }))?.displayName === 'Dana Ruiz');
  ok('a name is capped at NAME_MAX', mapPeopleRow(memberRow(1, { display_name: 'x'.repeat(200) }))?.displayName?.length === WHOSON.NAME_MAX && WHOSON.NAME_MAX === 80);
  ok('a blank name is null', mapPeopleRow(memberRow(1, { display_name: '   ' }))?.displayName === null && cleanPersonText(7) === null);
  ok('the viewer\'s own row never carries an open expiry', mapPeopleRow(ownerRow({ open_expires_s: 120 }))?.openExpiresS === null);
  ok('open is a positive number or null, never false or zero',
    mapPeopleRow(memberRow(1, { open_expires_s: false }))?.openExpiresS === null
    && mapPeopleRow(memberRow(1, { open_expires_s: 0 }))?.openExpiresS === null
    && mapPeopleRow(memberRow(1, { open_expires_s: -5 }))?.openExpiresS === null
    && mapPeopleRow(memberRow(1, { open_expires_s: '90' }))?.openExpiresS === null);
  ok('sharesPresence is read on the own row only', mapPeopleRow(ownerRow({ shares_presence: false }))?.sharesPresence === false
    && mapPeopleRow(ownerRow({ shares_presence: null }))?.sharesPresence === null
    && mapPeopleRow(memberRow(1, { shares_presence: true }))?.sharesPresence === null);
  ok('the owner row has no joined date', mapPeopleRow(ownerRow({ joined_at: '2026-01-01T00:00:00Z' }))?.joinedAt === null);
  const extra = mapPeopleRow(memberRow(1, { tier: 'pro', plan: 'business', phone: '555', pending: 3 })) as unknown as Record<string, unknown>;
  ok('a plan, tier, phone or pending field the server might send never reaches the person',
    !!extra && !('tier' in extra) && !('plan' in extra) && !('phone' in extra) && !('pending' in extra));
  ok('a duplicate user id is listed once', mapPeopleRows([ownerRow(), memberRow(1), memberRow(1)]).length === 2);
  ok('a non-array answer is no rows', mapPeopleRows(null).length === 0 && mapPeopleRows({}).length === 0);
}

// ── 2. peopleModel ───────────────────────────────────────────────────────────
console.log('\nmodel:');
{
  ok('[] is unknown', peopleModel([], clock).known === false && peopleModel(null, clock) === UNKNOWN_PEOPLE);
  const alone = peopleModel(ownerPayload(0), clock);
  ok('the owner alone is known and not shared', alone.known && alone.shared === false && alone.viewerIsOwner === true && alone.members.length === 0);
  const three = peopleModel(ownerPayload(3), clock);
  ok('the owner with three team members is shared', three.known && three.shared && three.members.length === 3 && three.viewerIsOwner);
  ok('choice is the self row\'s tri-state',
    peopleModel(mapPeopleRows([ownerRow({ shares_presence: true })]), clock).choice === true
    && peopleModel(mapPeopleRows([ownerRow({ shares_presence: false })]), clock).choice === false
    && peopleModel(mapPeopleRows([ownerRow({ shares_presence: null })]), clock).choice === null);

  // A team member's payload: the owner and himself.
  const memberView = mapPeopleRows([
    ownerRow({ is_self: false, shares_presence: null, open_expires_s: 100 }),
    memberRow(2, { is_self: true, invited_email: null, invited_by_viewer: false, shares_presence: null }),
  ]);
  const m = peopleModel(memberView, clock);
  ok('viewerIsOwner comes from the self row', m.known && m.viewerIsOwner === false && m.self?.userId === 'member-0002');
  ok('a team member is on a shared project by definition', m.shared === true && m.members.length === 1 && m.members[0].isSelf);
  ok('a team member sees the owner\'s dot', m.openOthers === 1 && m.openIds[0] === OWNER);

  // Second lock: even a payload that carried more than it should.
  const leaky = mapPeopleRows([
    ownerRow({ is_self: false, shares_presence: null, invited_email: 'owner@example.com', last_seen_at: '2026-10-04T14:00:00Z', seen_age_s: 3600 }),
    memberRow(2, { is_self: true, shares_presence: true }),
    memberRow(3, { open_expires_s: 100, last_seen_at: '2026-10-04T14:00:00Z', seen_age_s: 3600 }),
    memberRow(4),
  ]);
  const lm = peopleModel(leaky, clock);
  ok('a team member\'s model never holds another team member', lm.known && lm.members.length === 1 && lm.members[0].userId === 'member-0002');
  ok('a team member\'s model holds no email and no last-seen time',
    [lm.owner, lm.self, ...lm.members].every(p => p?.invitedEmail === null && p?.lastSeenAt === null && p?.seenAgeS === null));
  ok('a team member\'s model never counts another team member as open', lm.openOthers === 0);
  ok('a team member\'s model never yields an overflow', [2, 3, 4, 5].every(max => stackSlots(lm, max).overflow === 0 && stackSlots(lm, max).shown.length === 2));

  ok('no self row: unknown (there is no telling whose screen this is)',
    peopleModel(mapPeopleRows([ownerRow({ is_self: false }), memberRow(1)]), clock).known === false);
  ok('no owner row: unknown', peopleModel(mapPeopleRows([memberRow(1, { is_self: true })]), clock).known === false);
  ok('two owner rows: unknown', peopleModel(mapPeopleRows([ownerRow(), ownerRow({ user_id: 'owner-2', is_self: false })]), clock).known === false);

  // What the client asks before it calls an answer an answer.
  ok('usable: the owner alone, the owner with a team, a team member\'s two rows',
    peopleUsable(ownerPayload(0)) && peopleUsable(ownerPayload(5)) && peopleUsable(memberView) && peopleUsable(leaky));
  ok('not usable: nothing', peopleUsable([]) === false && peopleUsable(null) === false && peopleUsable(undefined) === false);
  ok('not usable: no row for the viewer', peopleUsable(mapPeopleRows([ownerRow({ is_self: false }), memberRow(1)])) === false);
  ok('not usable: no owner row', peopleUsable(mapPeopleRows([memberRow(1, { is_self: true })])) === false);
  ok('not usable: two owner rows, or two rows for the viewer',
    peopleUsable(mapPeopleRows([ownerRow(), ownerRow({ user_id: 'owner-2', is_self: false })])) === false
    && peopleUsable(mapPeopleRows([ownerRow(), memberRow(1, { is_self: true })])) === false);
  // The two payloads the database allows today and a later server could send:
  // the viewer's own row carries a role this build does not know, or a team
  // member's row carries the role 'owner'. Both rows are dropped by the mapper.
  const unknownRole = mapPeopleRows([ownerRow({ is_self: false, shares_presence: null }), memberRow(2, { is_self: true, role: 'manager' })]);
  const memberAsOwner = mapPeopleRows([ownerRow({ is_self: false, shares_presence: null }), memberRow(2, { is_self: true, role: 'owner' })]);
  ok('the viewer\'s own row with a role this build does not know: rows came back, none usable',
    unknownRole.length === 1 && peopleUsable(unknownRole) === false && peopleModel(unknownRole, clock).known === false);
  ok('the viewer\'s own row as a member with the owner role: rows came back, none usable',
    memberAsOwner.length === 1 && peopleUsable(memberAsOwner) === false && peopleModel(memberAsOwner, clock).known === false);
  ok('usable and known are the same question', [ownerPayload(0), ownerPayload(3), memberView, leaky, unknownRole, memberAsOwner, []]
    .every(rows => peopleUsable(rows) === peopleModel(rows, clock).known));

  const open = peopleModel(ownerPayload(4, n => (n === 3 ? { open_expires_s: 120 } : {})), clock);
  eq('members: open first, then by joined date', open.members.map(p => p.userId), ['member-0003', 'member-0001', 'member-0002', 'member-0004']);
  ok('openOthers counts the people this screen may call open', open.openOthers === 1);
  const stale = peopleModel(ownerPayload(4, n => (n === 3 ? { open_expires_s: 120 } : {})), { fetchedAtMs: T0, nowMs: T0 + 121_000 });
  ok('an expired read: nobody open, order back to joined date', stale.openOthers === 0 && stale.members[0].userId === 'member-0001');
}

// ── 3. isOpenNow ─────────────────────────────────────────────────────────────
console.log('\nopen / not known:');
{
  const p = { openExpiresS: 40, isSelf: false };
  ok('openExpiresS 40, read 39 s old: open', isOpenNow(p, T0, T0 + 39_000) === true);
  ok('openExpiresS 40, read 41 s old: not open', isOpenNow(p, T0, T0 + 41_000) === false);
  ok('openExpiresS 40, read exactly 40 s old: not open', isOpenNow(p, T0, T0 + 40_000) === false);
  ok('fetchedAtMs null is never open', isOpenNow(p, null, T0) === false && isOpenNow(p, undefined, T0) === false);
  ok('the viewer\'s own row is never open', isOpenNow({ openExpiresS: 40, isSelf: true }, T0, T0 + 1) === false);
  ok('null never draws', isOpenNow({ openExpiresS: null, isSelf: false }, T0, T0 + 1) === false && isOpenNow(null, T0, T0) === false);
  ok('a clock that went backwards proves nothing', isOpenNow(p, T0, T0 - 5_000) === false);
  ok('a read is stale after the window', readIsStale(T0, T0 + 150_000) === false && readIsStale(T0, T0 + 150_001) === true && readIsStale(null, T0) === true);
}

// ── 4. stackSlots ────────────────────────────────────────────────────────────
console.log('\nstack:');
{
  // n people = the owner + (n - 1) team members.
  const want: Record<number, Record<number, [number, number]>> = {
    5: { 1: [1, 0], 2: [2, 0], 3: [3, 0], 4: [4, 0], 5: [5, 0], 6: [4, 2], 7: [4, 3], 8: [4, 4], 40: [4, 36] },
    4: { 1: [1, 0], 2: [2, 0], 3: [3, 0], 4: [4, 0], 5: [3, 2], 6: [3, 3], 7: [3, 4], 8: [3, 5], 40: [3, 37] },
  };
  for (const max of [5, 4]) {
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 40]) {
      const s = stackSlots(peopleModel(ownerPayload(n - 1), clock), max);
      eq(`${n} people at max ${max}: shown / overflow`, [s.shown.length, s.overflow], want[max][n]);
      ok(`${n} people at max ${max}: every person is shown or counted`, s.shown.length + s.overflow === n);
    }
  }
  ok('the constants are the phone and desktop slot counts', WHOSON.STACK_MAX_PHONE === 5 && WHOSON.STACK_MAX_DESKTOP === 4);
  const seven = peopleModel(ownerPayload(7, n => (n === 6 ? { open_expires_s: 100 } : {})), clock);
  const s5 = stackSlots(seven, 5);
  eq('order is owner, open, joined date', s5.shown.map(p => p.userId), [OWNER, 'member-0006', 'member-0001', 'member-0002']);
  ok('an open person shown: the chip carries no dot', s5.overflowOpen === false && s5.overflow === 4);
  const many = peopleModel(ownerPayload(7, n => (n >= 2 && n <= 6 ? { open_expires_s: 100 } : {})), clock);
  const m5 = stackSlots(many, 5);
  ok('a hidden person open: the chip carries the dot', m5.overflowOpen === true && m5.shown.length === 4 && m5.overflow === 4);
  ok('nobody open: no dot on the chip', stackSlots(peopleModel(ownerPayload(7), clock), 5).overflowOpen === false);
  const forty = stackSlots(peopleModel(ownerPayload(39, n => (n === 39 ? { open_expires_s: 100 } : {})), clock), 5);
  ok('40 people: the newest joiner who has it open is in front, not behind the chip', forty.shown[1].userId === 'member-0039' && forty.overflowOpen === false);
  ok('an unknown model has no slots', stackSlots(UNKNOWN_PEOPLE, 5).shown.length === 0 && stackSlots(UNKNOWN_PEOPLE, 5).overflow === 0);
}

// ── 5. one person ────────────────────────────────────────────────────────────
console.log('\nperson:');
{
  eq('initials: first and last word of the name', personInitials({ displayName: 'Dana Maria Ruiz', companyName: 'Ruiz Electric', invitedEmail: null }), 'DR');
  eq('initials: one word gives two letters', personInitials({ displayName: 'Dana', companyName: null, invitedEmail: null }), 'DA');
  eq('initials: no name, the company', personInitials({ displayName: null, companyName: 'Ruiz Electric', invitedEmail: null }), 'RE');
  eq('initials: nothing typed and no email is empty, never invented', personInitials({ displayName: null, companyName: null, invitedEmail: null }), '');
  eq('initials: the owner\'s screen may fall back to the email he invited', personInitials({ displayName: null, companyName: null, invitedEmail: 'dana@ruizelectric.com' }), 'DA');
  ok('initials never contain @', !personInitials({ displayName: 'a@b.co', companyName: '@', invitedEmail: '@x' }).includes('@'));
  ok('the avatar palette is the chip palette minus the teal', PERSON_COLORS.length === PROJECT_CHIP_PALETTE.length - 1
    && !PERSON_COLORS.includes('#0A7F79') && PERSON_COLORS.every(c => PROJECT_CHIP_PALETTE.includes(c)));
  const ids = Array.from({ length: 200 }, (_, i) => `user-${i}-${(i * 7919).toString(16)}`);
  ok('personColor is stable and always from that palette', ids.every(id => PERSON_COLORS.includes(personColor(id)) && personColor(id) === personColor(id)));
  ok('personColor uses the whole palette', new Set(ids.map(personColor)).size === PERSON_COLORS.length);

  const joined = mapPeopleRow(memberRow(1))!;
  eq('membership: the viewer sent the invite', membershipLine(joined)?.key, 'joinedFromInvite');
  eq('membership: someone else sent it', membershipLine({ ...joined, invitedByViewer: false })?.key, 'joined');
  ok('membership: the owner row has no line', membershipLine(mapPeopleRow(ownerRow())!) === null);
}

// ── 6. activityLine ──────────────────────────────────────────────────────────
console.log('\nlast seen:');
{
  const at = '2026-10-04T14:00:00Z';
  const seen = (seenAgeS: number | null, over: Partial<ProjectPerson> = {}) => ({ openExpiresS: null, isSelf: false, lastSeenAt: at, seenAgeS, ...over });
  const line = (ageS: number, sinceReadMs = 0) => activityLine(seen(ageS), T0, T0 + sinceReadMs);
  eq('59 s: 1 min', line(59), { key: 'seenMin', count: 1 });
  eq('60 s: 1 min', line(60), { key: 'seenMin', count: 1 });
  eq('119 s: 1 min', line(119), { key: 'seenMin', count: 1 });
  eq('120 s: 2 min', line(120), { key: 'seenMin', count: 2 });
  eq('59 min 59 s: 59 min', line(3599), { key: 'seenMin', count: 59 });
  eq('60 min: 1 hr', line(3600), { key: 'seenHr', count: 1 });
  eq('23 h 59 min: 23 hr', line(86_399), { key: 'seenHr', count: 23 });
  eq('24 h: the date', line(86_400), { key: 'seenDate', at });
  eq('the time since the read is added', line(700, 60_000), { key: 'seenMin', count: 12 });
  eq('the read is older than the window: the absolute date and time', line(700, 151_000), { key: 'seenAt', at });
  eq('the read is exactly the window old: still relative', line(700, 150_000), { key: 'seenMin', count: 14 });
  eq('no read time: absolute', activityLine(seen(700), null, T0), { key: 'seenAt', at });
  eq('no server age: absolute', activityLine(seen(null), T0, T0), { key: 'seenAt', at });
  ok('lastSeenAt null gives no line', activityLine(seen(700, { lastSeenAt: null }), T0, T0) === null);
  eq('open wins over last seen', activityLine(seen(5, { openExpiresS: 100 }), T0, T0 + 1_000), { key: 'open' });
  eq('an expired dot falls back to last seen', activityLine(seen(5, { openExpiresS: 100 }), T0, T0 + 101_000), { key: 'seenMin', count: 1 });
  ok('the viewer\'s own row has no line', activityLine(seen(5, { isSelf: true }), T0, T0) === null && activityLine(null, T0, T0) === null);
  ok('the line is a key and numbers, never a sentence', [line(59), line(3600), line(86_400), line(700, 151_000)].every(l => !!l && Object.values(l).every(v => typeof v !== 'string' || v === l.key || v === at)));

  const withDot = ownerPayload(2, n => (n === 1 ? { open_expires_s: 100 } : {}));
  ok('the clock is needed while a dot is drawn', needsClock(withDot, T0, T0 + 1_000) === true);
  ok('the clock is needed while a relative time is drawn', needsClock(ownerPayload(1, () => ({ last_seen_at: at, seen_age_s: 60 })), T0, T0 + 1_000) === true);
  ok('no dot and no time: no clock', needsClock(ownerPayload(2), T0, T0 + 1_000) === false);
  ok('a stale read: no clock (every line is absolute)', needsClock(withDot, T0, T0 + (WHOSON.OPEN_WINDOW_S + 16) * 1000) === false);
  ok('nothing read: no clock', needsClock([], T0, T0) === false && needsClock(withDot, null, T0) === false);
}

// ── 7. nextTick ──────────────────────────────────────────────────────────────
console.log('\nticks:');
{
  const shared: CachedPeopleFacts = { known: true, shared: true, viewerIsOwner: true, choice: true };
  const base: TickInput = {
    userId: 'u', routeProjectId: 'p', foreground: true, webIdle: false, cached: shared, ownerHasPending: false,
    inFlight: false, backoffLevel: 0, pausedUntilMs: 0, stopped: false, marked: true, nowMs: T0,
  };
  const t = (over: Partial<TickInput>) => nextTick({ ...base, ...over });
  eq('constants', [WHOSON.TICK_MS, WHOSON.SLOW_TICK_MS, WHOSON.OPEN_WINDOW_S, WHOSON.WEB_IDLE_MS, WHOSON.READ_TIMEOUT_MS, WHOSON.MIN_GAP_MS, WHOSON.SERVER_PAUSE_MS],
    [60_000, 120_000, 150, 300_000, 10_000, 5_000, 600_000]);
  eq('back-off steps', [...WHOSON.BACKOFF_MS], [60_000, 120_000, 300_000]);
  eq('no user: none', t({ userId: null }).action, 'none');
  eq('no project: none', t({ routeProjectId: null }).action, 'none');
  eq('background: none', t({ foreground: false }).action, 'none');
  eq('in flight: none', t({ inFlight: true }).action, 'none');
  eq('paused: none', t({ pausedUntilMs: T0 + 1 }).action, 'none');
  eq('the pause is over: ticks again', t({ pausedUntilMs: T0 }).action, 'mark');
  eq('web idle: none', t({ webIdle: true }).action, 'none');
  eq('zero rows stopped this project: none', t({ stopped: true }).action, 'none');
  eq('shared, said yes: mark at 60 s', t({}), { action: 'mark', delayMs: 60_000 });
  eq('shared, said yes, not marked yet: the first mark within seconds', t({ marked: false }), { action: 'mark', delayMs: 5_000 });
  eq('shared, said no: read at 60 s', t({ cached: { ...shared, choice: false } }), { action: 'read', delayMs: 60_000 });
  eq('shared, not asked: read at 60 s', t({ cached: { ...shared, choice: null } }), { action: 'read', delayMs: 60_000 });
  eq('a team member who said yes: mark', t({ cached: { ...shared, viewerIsOwner: false } }).action, 'mark');
  const alone: CachedPeopleFacts = { known: true, shared: false, viewerIsOwner: true, choice: true };
  eq('owner alone with a pending invite: read at 120 s', t({ cached: alone, ownerHasPending: true }), { action: 'read', delayMs: 120_000 });
  eq('owner alone, nothing pending: none', t({ cached: alone, ownerHasPending: false }).action, 'none');
  eq('an owner alone never marks, even when he said yes', t({ cached: alone, ownerHasPending: true }).action, 'read');
  eq('nothing read yet: one read, at once', t({ cached: null }), { action: 'read', delayMs: 0 });
  // An answer nobody can use. The client calls it 'empty', which stops the
  // project until the route changes (results, below). The second lock: with
  // such an answer cached and the stop lifted, a read is never sooner than a
  // minute after the last request. It used to be `delayMs: 0`, which the 5 s
  // gap turned into one request every five seconds for as long as the project
  // was in front.
  const unusable: CachedPeopleFacts = { ...shared, known: false };
  eq('nothing usable cached, the project stopped: none', t({ cached: unusable, stopped: true }).action, 'none');
  eq('nothing usable cached, the stop lifted: a read, a minute after the last request', t({ cached: unusable }), { action: 'read', delayMs: 60_000 });
  eq('nothing usable cached: the back-off still holds', t({ cached: unusable, backoffLevel: 3 }).delayMs, 300_000);
  ok('nothing usable cached: never a mark, whatever the choice', t({ cached: unusable }).action === 'read' && t({ cached: { ...unusable, choice: true }, marked: false }).action === 'read');
  {
    // The whole path: an unusable answer, then what the timer may do.
    const stoppedState = afterResult(HEARTBEAT_START, { outcome: 'empty', projectId: 'p', nowMs: T0 });
    const again = (nowMs: number, routeProjectId = 'p') => nextTick({ ...base, cached: unusable, routeProjectId,
      stopped: stoppedState.stoppedProjectId !== null && stoppedState.stoppedProjectId === routeProjectId, nowMs });
    ok('an unusable answer is never read again while the route stays on the project',
      [0, 5_000, 60_000, 600_000, 6_000_000].every(ms => again(T0 + ms).action === 'none'));
    const lifted = afterRouteChange(stoppedState);
    const afterLift = nextTick({ ...base, cached: unusable, stopped: lifted.stoppedProjectId === 'p', nowMs: T0 + 1 });
    ok('after the route changes it may be read once more, and a result never re-reads it sooner than TICK_MS',
      afterLift.action === 'read' && dueInMs({ tick: afterLift, reason: 'result', lastSentMs: T0, backoffLevel: 0, nowMs: T0 + 1 }) === WHOSON.TICK_MS - 1);
  }
  eq('back-off level 1: 60 s', t({ backoffLevel: 1 }).delayMs, 60_000);
  eq('back-off level 2: 120 s', t({ backoffLevel: 2 }).delayMs, 120_000);
  eq('back-off level 3: 300 s', t({ backoffLevel: 3 }).delayMs, 300_000);
  eq('back-off level 9: stays at 300 s', t({ backoffLevel: 9 }).delayMs, 300_000);
  eq('back-off holds the first read too', t({ cached: null, backoffLevel: 2 }), { action: 'read', delayMs: 120_000 });
  eq('back-off never shortens the slow tick', t({ cached: alone, ownerHasPending: true, backoffLevel: 1 }).delayMs, 120_000);
  eq('backoffDelayMs(0) is no wait', backoffDelayMs(0), 0);

  const mark = { action: 'mark' as const, delayMs: 60_000 };
  eq('periodic, no mark sent yet: counted from the last request', dueInMs({ tick: mark, reason: 'result', lastSentMs: T0 - 20_000, backoffLevel: 0, nowMs: T0 }), 40_000);
  eq('periodic, no mark sent yet (null): the same', dueInMs({ tick: mark, reason: 'result', lastSentMs: T0 - 20_000, lastMarkMs: null, backoffLevel: 0, nowMs: T0 }), 40_000);
  // A mark is counted from the last MARK. A plain read 1 s ago must not push it out.
  eq('periodic mark: 60 s counted from the last mark, not from a read in between',
    dueInMs({ tick: mark, reason: 'result', lastSentMs: T0 - 10_000, lastMarkMs: T0 - 45_000, backoffLevel: 0, nowMs: T0 }), 15_000);
  eq('a mark already due, a read 1 s ago: only the 5 s gap is left',
    dueInMs({ tick: mark, reason: 'result', lastSentMs: T0 - 1_000, lastMarkMs: T0 - 70_000, backoffLevel: 0, nowMs: T0 }), 4_000);
  eq('a mark already due, the last request long ago: at once',
    dueInMs({ tick: mark, reason: 'result', lastSentMs: T0 - 30_000, lastMarkMs: T0 - 70_000, backoffLevel: 0, nowMs: T0 }), 0);
  {
    // Reads every 50 s (a screen opening the Team section) for five minutes:
    // each read's answer re-plans, and the mark still goes every 60 s, 5 s late at most.
    let lastMarkMs = T0;
    let lastSentMs = T0;
    const gaps: number[] = [];
    for (let now = T0 + 1_000; now <= T0 + 300_000; now += 1_000) {
      const isRead = (now - T0) % 50_000 === 0;
      if (isRead) lastSentMs = now;
      if (dueInMs({ tick: mark, reason: 'result', lastSentMs, lastMarkMs, backoffLevel: 0, nowMs: now }) === 0) {
        gaps.push(now - lastMarkMs);
        lastMarkMs = now;
        lastSentMs = now;
      }
    }
    ok('reads every 50 s for five minutes: a mark at least every 60 s plus the gap', gaps.length >= 4 && gaps.every(g => g >= WHOSON.TICK_MS && g <= WHOSON.TICK_MS + WHOSON.MIN_GAP_MS), gaps.join(','));
    ok('...so the gap between marks stays inside the server window', gaps.every(g => g < WHOSON.OPEN_WINDOW_S * 1000));
  }
  eq('a mark does not jump the back-off after a request that got no answer',
    dueInMs({ tick: { action: 'mark', delayMs: 60_000 }, reason: 'result', lastSentMs: T0 - 10_000, lastMarkMs: T0 - 59_000, backoffLevel: 1, nowMs: T0 }), 50_000);
  const readTick = { action: 'read' as const, delayMs: 60_000 };
  eq('a periodic READ is counted from the last request (that read was as fresh as a tick)',
    dueInMs({ tick: readTick, reason: 'result', lastSentMs: T0 - 20_000, lastMarkMs: T0 - 90_000, backoffLevel: 0, nowMs: T0 }), 40_000);
  eq('an event is immediate once 5 s have passed', dueInMs({ tick: mark, reason: 'event', lastSentMs: T0 - 20_000, backoffLevel: 0, nowMs: T0 }), 0);
  eq('an event still waits out the 5 s gap', dueInMs({ tick: mark, reason: 'event', lastSentMs: T0 - 2_000, backoffLevel: 0, nowMs: T0 }), 3_000);
  eq('an event does not jump the back-off', dueInMs({ tick: mark, reason: 'event', lastSentMs: T0 - 20_000, backoffLevel: 2, nowMs: T0 }), 100_000);
  eq('nothing sent yet: an event goes at once', dueInMs({ tick: mark, reason: 'event', lastSentMs: null, backoffLevel: 0, nowMs: T0 }), 0);
  eq('a first read after an answer never comes sooner than the gap', dueInMs({ tick: { action: 'read', delayMs: 0 }, reason: 'result', lastSentMs: T0 - 1_000, backoffLevel: 0, nowMs: T0 }), 4_000);

  ok('web: idle after five minutes with no input', isWebIdle({ isWeb: true, lastInputMs: T0, nowMs: T0 + 300_000 }) === true
    && isWebIdle({ isWeb: true, lastInputMs: T0, nowMs: T0 + 299_999 }) === false);
  ok('native never idles', isWebIdle({ isWeb: false, lastInputMs: T0, nowMs: T0 + 9_000_000 }) === false);
}

// ── 8. leaveNeeded ───────────────────────────────────────────────────────────
console.log('\nleave:');
{
  const here: PresenceSituation = { userId: 'u', projectId: 'p', appState: 'active', webIdle: false };
  const marked = { ...here, markedProjectId: 'p' };
  eq('the route changes project: one leave', leaveNeeded(marked, { ...here, projectId: 'q' }), 'p');
  eq('the route leaves every project: one leave', leaveNeeded(marked, { ...here, projectId: null }), 'p');
  eq('background: one leave', leaveNeeded(marked, { ...here, appState: 'background' }), 'p');
  eq('web idle: one leave', leaveNeeded(marked, { ...here, webIdle: true }), 'p');
  eq('inactive (Face ID, Control Centre): none', leaveNeeded(marked, { ...here, appState: 'inactive' }), null);
  eq('nothing changed: none', leaveNeeded(marked, here), null);
  eq('nothing marked: none, whatever happens', [
    leaveNeeded({ ...here, markedProjectId: null }, { ...here, projectId: 'q' }),
    leaveNeeded({ ...here, markedProjectId: null }, { ...here, appState: 'background' }),
    leaveNeeded({ ...here, markedProjectId: null }, { ...here, webIdle: true }),
  ], [null, null, null]);
  eq('already in the background: no second leave', leaveNeeded({ ...marked, appState: 'background' }, { ...here, appState: 'background' }), null);
  eq('already idle: no second leave', leaveNeeded({ ...marked, webIdle: true }, { ...here, webIdle: true }), null);
  eq('another account signed in: nothing is sent as the old one', leaveNeeded(marked, { ...here, userId: 'v', projectId: 'q' }), null);
  eq('signed out: nothing is sent', leaveNeeded(marked, { ...here, userId: null, projectId: null }), null);
}

// ── 9. afterResult ───────────────────────────────────────────────────────────
console.log('\nresults:');
{
  const r = (s: typeof HEARTBEAT_START, outcome: Parameters<typeof afterResult>[1]['outcome'], projectId = 'p') => afterResult(s, { outcome, projectId, nowMs: T0 });
  eq('unknown raises the back-off', r(HEARTBEAT_START, 'unknown').backoffLevel, 1);
  eq('unknown three times, then a fourth: the level stops at 3', r(r(r(r(HEARTBEAT_START, 'unknown'), 'unknown'), 'unknown'), 'unknown').backoffLevel, 3);
  eq('an answer resets it', r({ ...HEARTBEAT_START, backoffLevel: 3 }, 'ok').backoffLevel, 0);
  eq('a server refusal pauses every project for ten minutes', r(HEARTBEAT_START, 'server').pausedUntilMs, T0 + 600_000);
  eq('a server refusal does not raise the back-off', r(HEARTBEAT_START, 'server').backoffLevel, 0);
  eq('zero rows, or nothing usable, stops that project', r(HEARTBEAT_START, 'empty').stoppedProjectId, 'p');
  eq('zero rows on one project does not pause the others', r(HEARTBEAT_START, 'empty').pausedUntilMs, 0);
  eq('the route changes: the stop is lifted', afterRouteChange(r(HEARTBEAT_START, 'empty')).stoppedProjectId, null);
  eq('rows for the stopped project lift the stop', r(r(HEARTBEAT_START, 'empty'), 'ok').stoppedProjectId, null);
  eq('web offline is not a failure', r({ ...HEARTBEAT_START, backoffLevel: 1 }, 'offline'), { ...HEARTBEAT_START, backoffLevel: 1 });
  eq('a dropped answer changes nothing', r({ ...HEARTBEAT_START, backoffLevel: 2 }, 'dropped'), { ...HEARTBEAT_START, backoffLevel: 2 });
}

// ── 10. Source checks ────────────────────────────────────────────────────────
console.log('\nsource:');

/** Blank comments, keep strings: a banned word in a comment is not code. */
function stripComments(src: string): string {
  const out = src.split('');
  type Mode = 'code' | 'line' | 'block' | 'sq' | 'dq' | 'tpl';
  let mode: Mode = 'code';
  const blank = (at: number) => { if (out[at] !== '\n') out[at] = ' '; };
  let i = 0;
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    const ch = src[i];
    if (mode === 'code') {
      if (two === '//') { mode = 'line'; blank(i); blank(i + 1); i += 2; continue; }
      if (two === '/*') { mode = 'block'; blank(i); blank(i + 1); i += 2; continue; }
      if (ch === "'") mode = 'sq';
      else if (ch === '"') mode = 'dq';
      else if (ch === '`') mode = 'tpl';
      i++; continue;
    }
    if (mode === 'line') { if (ch === '\n') mode = 'code'; else blank(i); i++; continue; }
    if (mode === 'block') {
      if (two === '*/') { blank(i); blank(i + 1); mode = 'code'; i += 2; continue; }
      blank(i); i++; continue;
    }
    if (ch === '\\') { i += 2; continue; }
    if ((mode === 'sq' && ch === "'") || (mode === 'dq' && ch === '"') || (mode === 'tpl' && ch === '`')) mode = 'code';
    // A quote that never closes on its line was an apostrophe in JSX text or a regex.
    else if (ch === '\n' && mode !== 'tpl') mode = 'code';
    i++;
  }
  return out.join('');
}
const code = (rel: string) => stripComments(read(rel));

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p) && !p.endsWith('.d.ts')) out.push(p);
  }
  return out;
}
const rel = (abs: string) => relative(ROOT, abs).split('\\').join('/');

const CLIENT = 'utils/whoson/peopleClient.ts';
const PEOPLE_HOOK = 'hooks/useProjectPeople.ts';
const SHARE_HOOK = 'hooks/useSharePresence.ts';
const COPY_HOOK = 'hooks/useWhosOnCopy.ts';
const BEACON = 'components/whoson/ProjectPresenceBeacon.tsx';
const KIT_UTILS = walk(join(ROOT, 'utils', 'whoson')).map(rel);
const KIT_COMPONENTS = walk(join(ROOT, 'components', 'whoson')).map(rel);
const KIT_HOOKS = [PEOPLE_HOOK, SHARE_HOOK, COPY_HOOK];
const KIT = [...KIT_UTILS, ...KIT_COMPONENTS, ...KIT_HOOKS];

for (const f of ['utils/whoson/people.ts', 'utils/whoson/heartbeat.ts', CLIENT, ...KIT_HOOKS,
  'components/whoson/PersonAvatar.tsx', 'components/whoson/ProjectPeopleStack.tsx', 'components/whoson/ProjectPeopleBlock.tsx',
  'components/whoson/PersonRowExtras.tsx', 'components/whoson/PresenceChoiceCard.tsx', 'components/whoson/SharePresenceSwitchRow.tsx',
  'components/whoson/SharePresenceSettingRow.tsx', BEACON]) {
  ok(`${f} exists`, existsSync(join(ROOT, f)));
}

// The flag: everything ships dark.
ok('WHOS_ON_ENABLED is false', WHOS_ON_ENABLED === false);
ok('the flag is declared in constants/featureFlags.ts in the house pattern', /^export const WHOS_ON_ENABLED = false;$/m.test(read('constants/featureFlags.ts')));
ok('the client refuses to send while the flag is off', /if \(!WHOS_ON_ENABLED \|\|[^\n]*\) return Promise\.resolve\(DROPPED\);/.test(code(CLIENT)));
ok('useProjectPeople stays disabled while the flag is off', /const on = Boolean\(WHOS_ON_ENABLED && /.test(code(PEOPLE_HOOK)) && /enabled: on,/.test(code(PEOPLE_HOOK)));
ok('useSharePresence stays disabled, and refuses to write, while the flag is off',
  /const on = Boolean\(WHOS_ON_ENABLED && /.test(code(SHARE_HOOK)) && /enabled: on,/.test(code(SHARE_HOOK)) && /if \(!WHOS_ON_ENABLED \|\|[^\n]*\) return 'failed';/.test(code(SHARE_HOOK)));
for (const f of KIT_COMPONENTS.filter(f => f.endsWith('.tsx') && !f.endsWith('WhosOnBoundary.tsx'))) {
  const src = code(f);
  const exported = [...src.matchAll(/^export function ([A-Z]\w*)\(/gm)].map(m => m[1]);
  const gated = exported.every((name) => {
    const at = src.indexOf(`export function ${name}(`);
    const body = src.slice(at, src.indexOf('\n}\n', at));
    return /if \(!WHOS_ON_ENABLED\b[^\n]*\) return null;/.test(body);
  });
  ok(`${f}: every exported component returns null while the flag is off`, exported.length > 0 && gated, exported.join(', '));
}
{
  const src = code(BEACON);
  const at = src.indexOf('export function ProjectPresenceBeacon()');
  const body = src.slice(at, src.indexOf('\n}\n', at));
  ok('the beacon returns null before any hook while the flag is off',
    /^export function ProjectPresenceBeacon\(\) \{\s*if \(!WHOS_ON_ENABLED\) return null;/.test(body) && !/use[A-Z]\w*\(/.test(body));
}

// One file calls the server.
const SOURCE_DIRS = ['app', 'components', 'hooks', 'contexts', 'utils', 'lib', 'constants', 'i18n', 'backend'];
const allSource = SOURCE_DIRS.flatMap(d => walk(join(ROOT, d))).map(rel);
{
  const callers: string[] = [];
  const markers: string[] = [];
  const choosers: string[] = [];
  for (const f of allSource) {
    const src = code(f);
    if (f !== CLIENT) {
      // A quoted project_people outside the client may only be a query key: [ 'project_people', …
      for (const m of src.matchAll(/(.{0,2})(['"`])project_people\2/g)) {
        if (!/\[\s?$/.test(m[1])) callers.push(f);
      }
      if (/\bp_mark\b/.test(src)) markers.push(f);
    }
    if (f !== SHARE_HOOK && /set_share_presence/.test(src)) choosers.push(f);
  }
  ok("'project_people' is called only in utils/whoson/peopleClient.ts", callers.length === 0, [...new Set(callers)].join(', '));
  ok('p_mark appears only in utils/whoson/peopleClient.ts', markers.length === 0, markers.join(', '));
  ok("'set_share_presence' appears only in hooks/useSharePresence.ts", choosers.length === 0, choosers.join(', '));
  ok('the client calls project_people through the read and through the online-only door',
    /supabase\.rpc\('project_people', \{ p_project_id: projectId, p_mark: 'none' \}\)\.abortSignal\(/.test(code(CLIENT))
    && /supabaseRpcOnline<unknown>\('project_people', \{ p_project_id: projectId, p_mark: mark \}\)/.test(code(CLIENT)));
  ok('the choice is written through the online-only door', /supabaseRpcOnline<boolean>\('set_share_presence', \{ p_on: value \}\)/.test(code(SHARE_HOOK)));
}
for (const f of [CLIENT, SHARE_HOOK]) {
  const src = code(f);
  const imports = [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'@\/utils\/offlineQueue'/g)].flatMap(m => m[1].split(',').map(s => s.trim()).filter(Boolean));
  ok(`${f} imports the online-only door and nothing that queues`,
    imports.includes('supabaseRpcOnline') && imports.every(n => n === 'supabaseRpcOnline' || n === 'currentSessionUserId'), imports.join(', '));
  ok(`${f} names no queueing write`, !/\b(supabaseWrite|supabaseWriteDetailed|supabaseRpcDetailed|addToOfflineQueue|enqueue\w*)\b/.test(src));
}
{
  const src = code(CLIENT);
  ok("'open' and 'closed' are sent only for an account known to have said yes",
    /const saidYes = choices\.get\(userId\) === true;/.test(src) && /asked !== 'none' && saidYes \? asked : 'none'/.test(src));
  ok('the answer is stamped with when the request was sent', (src.match(/const sentAtMs = Date\.now\(\);/g) ?? []).length === 2
    && /fetchedAtMs: sentAtMs/.test(src) && !/fetchedAtMs: Date\.now\(\)/.test(src));
  ok('the read is aborted after READ_TIMEOUT_MS', /setTimeout\(\(\) => \{ timedOut = true; ctrl\.abort\(\); \}, WHOSON\.READ_TIMEOUT_MS\)/.test(src));
  ok('the answer is dropped when the signed-in account changed', (src.match(/if \(!\(await sessionIs\(userId\)\)\) return DROPPED;/g) ?? []).length === 4);
  ok('single flight: a second caller gets the request already in flight', /if \(running\) \{[\s\S]{0,420}return running\.promise;\n  \}/.test(src));
  ok('a caller who asks after a save does not join a request sent before it: it waits, then asks again',
    /if \(running\.startedAtMs < \(choiceSavedAtMs\.get\(userId\) \?\? 0\)\) \{\s*const again = \(\) => callPeople\(userId, projectId, mark\);\s*return running\.promise\.then\(again, again\);/.test(src));
  ok('an answer sent before a save never overwrites the saved choice',
    /if \(sentAtMs < \(choiceSavedAtMs\.get\(userId\) \?\? 0\)\) \{[\s\S]{0,260}sharesPresence: saved[\s\S]{0,80}\} else \{\s*const self = mapped\.find\(p => p\.isSelf\);\s*if \(self\) choices\.set\(userId, self\.sharesPresence\);/.test(src)
    && (src.match(/choices\.set\(/g) ?? []).length === 3
    && /if \(typeof sentAtMs === 'number' && sentAtMs < \(choiceSavedAtMs\.get\(userId\) \?\? 0\)\) return;/.test(src));
  ok('an answer nobody can use is the zero-rows answer (the project stops; it is never read in a loop)',
    /const usable = peopleUsable\(mapped\);/.test(src) && /if \(!usable\) return \{ outcome: 'empty', fetchedAtMs: sentAtMs \};/.test(src)
    && src.indexOf("if (!usable) return { outcome: 'empty'") < src.indexOf("return { outcome: 'ok', people"));
  ok('rows dropped or unusable are reported once a session, with counts only',
    /if \(reportedUnusable\) return;\s*reportedUnusable = true;/.test(src) && !/captureMessage\([^\n]*(displayName|invitedEmail|userId|projectId)/.test(src));
  ok('a server refusal stops every call', /if \(Date\.now\(\) < heartbeat\.pausedUntilMs\) return DROPPED;/.test(src));
  const freed = src.indexOf('if (inFlight.get(key)?.promise === p) inFlight.delete(key);');
  const told = src.indexOf('tell(userId, projectId, result);');
  ok('the in-flight slot is freed before any listener is told (or the next tick finds it busy and never runs)', freed > 0 && told > freed);
  ok('a leave waits for the request in flight and is never announced to listeners',
    /return running \? running\.promise\.then\(go, go\) : go\(\);/.test(src) && (src.match(/\btell\(/g) ?? []).length === 2);
}

// Nothing on the device, no channel, no polling observer.
for (const f of KIT) {
  const src = code(f);
  ok(`${f}: no AsyncStorage, SecureStore or localStorage`, !/AsyncStorage|SecureStore|localStorage|sessionStorage/.test(src));
  ok(`${f}: no realtime channel`, !/\.channel\(/.test(src));
  ok(`${f}: no react-query focusManager`, !/focusManager/.test(src));
}
{
  const src = code(PEOPLE_HOOK);
  ok('useProjectPeople has no refetchInterval', !/refetchInterval/.test(src));
  ok("the query key literal is ['project_people', userId, projectId]", /queryKey: \['project_people', userId, projectId\],/.test(src));
  ok('fresh on open: staleTime 0, refetchOnMount always, no retry',
    /staleTime: 0,/.test(src) && /refetchOnMount: 'always',/.test(src) && /retry: false,/.test(src));
  ok('no refetch on window focus or reconnect (the beacon is the one trigger)', /refetchOnWindowFocus: false,/.test(src) && /refetchOnReconnect: false,/.test(src));
  ok('the hook reads through the client, never the server directly', /callPeople\(userId, projectId, 'none'\)/.test(src) && !/supabase\.(rpc|from)\(/.test(src));
  ok('the hook never hands out the raw rows: `people` is what the model lets this viewer see',
    /const people = model\.known && model\.owner \? \[model\.owner, \.\.\.model\.members\] : NO_PEOPLE;/.test(src)
    && (src.match(/data\??\.people/g) ?? []).length === 1 && /peopleModel\(data\.people, /.test(src));
}
{
  const src = code(SHARE_HOOK);
  ok('a saved choice is remembered as a save, and a profile read is remembered with its send time',
    /rememberSavedChoice\(userId, value\);/.test(src) && /rememberChoice\(userId as string, choice, sentAtMs\);/.test(src)
    && (src.match(/\brememberChoice\(/g) ?? []).length === 1);
}
{
  const src = code(BEACON);
  ok('the beacon names the project from the route', /urlProjectIdFrom\(/.test(src) && /usePathname\(\)/.test(src) && /useGlobalSearchParams/.test(src));
  ok('the beacon never reads the stored active project', !/activeProjectId|useActiveProject/.test(src));
  ok('the beacon has one timer and no interval', !/setInterval/.test(src) && (src.match(/timer = setTimeout\(/g) ?? []).length === 2);
  ok('the beacon listens to AppState and adds no visibilitychange listener', /AppState\.addEventListener\('change'/.test(src) && !/visibilitychange/.test(src));
  ok("the beacon ignores 'inactive'", /if \(state !== 'active' && state !== 'background'\) return;/.test(src));
  ok('web input listeners are passive capture listeners on document',
    /const INPUT_EVENTS = \['pointerdown', 'keydown', 'wheel', 'touchstart'\] as const;/.test(src) && /\{ capture: true, passive: true \}/.test(src));
  ok('the beacon writes answers into the query cache under the hook\'s key', /setQueryData<PeopleRead>\(\['project_people', userId, projectId\], read\)/.test(src));
  ok('the beacon sits inside the whoson boundary (a router hook cannot be try/caught)', /return <WhosOnBoundary><ProjectPresenceBeaconInner \/><\/WhosOnBoundary>;/.test(src));
  ok('an answer that sent nothing never re-plans at once', /plan\('result', notSent \? WHOSON\.TICK_MS : 0\);/.test(src));
  ok('no two requests closer than the gap, whatever an answer says', /Math\.max\(due, floor, atLeastMs\)/.test(src) && /lastFireMs \+ WHOSON\.MIN_GAP_MS - nowMs/.test(src));
  ok('the minute between marks is counted from the last mark this engine sent',
    /if \(tick\.action === 'mark'\) \{\s*markAttemptFor = projectId;\s*lastMarkMs = lastFireMs;\s*\}/.test(src)
    && /dueInMs\(\{ tick, reason, lastSentMs: lastPeopleSentMs\(\), lastMarkMs, backoffLevel: hb\.backoffLevel, nowMs \}\)/.test(src));
  ok('leaving the project forgets the last mark (the next arrival marks within seconds)', (src.match(/lastMarkMs = null;/g) ?? []).length === 2
    && /if \(toLeave\) \{\s*markedProjectId = null;\s*lastMarkMs = null;/.test(src));
  ok('a timer that finds nothing to do plans again (a pause set by a leave still ends)',
    /if \(tick\.action === 'none' \|\| !userId \|\| !projectId\) \{\s*plan\('event'\);\s*return;\s*\}/.test(src));
}

// Tokens, theme, roles.
for (const f of KIT_COMPONENTS.filter(f => f.endsWith('.tsx'))) {
  const src = code(f);
  ok(`${f}: no hex literal`, !/#[0-9a-fA-F]{3,8}\b/.test(src));
  ok(`${f}: no '800' weight`, !/fontWeight:\s*['"]800['"]/.test(src));
  ok(`${f}: no module-scope StyleSheet.create (a themed factory instead)`, !/^const \w+ = StyleSheet\.create\(/m.test(src)
    && (!/StyleSheet\.create\(/.test(src) || /const makeStyles = \(t: ThemeColors\) => StyleSheet\.create\(/.test(src)));
  ok(`${f}: no static Colors.* read`, !/\bColors\.\w+/.test(src));
  ok(`${f}: no t() / tn() call (strings live in hooks/useWhosOnCopy.ts)`, !/\b(t|tn)\(\s*'/.test(src) && !/useT\(/.test(src));
  const pressables = [...src.matchAll(/<(Pressable|TouchableOpacity)\b[\s\S]*?>/g)].map(m => m[0]);
  ok(`${f}: every pressable has an accessibilityRole`, pressables.every(p => /accessibilityRole=/.test(p)));
  ok(`${f}: no animation`, !/Animated\.|LayoutAnimation|useNativeDriver/.test(src));
}
{
  const src = code('components/whoson/PersonAvatar.tsx');
  ok('circles use Tokens.radius.full', (src.match(/borderRadius: Tokens\.radius\.full/g) ?? []).length === 2);
  ok('the dot is the themed success colour', /backgroundColor: t\.success,/.test(src));
  ok('the avatar is decorative for a screen reader', /importantForAccessibility="no-hide-descendants"/.test(src));
  const stack = code('components/whoson/ProjectPeopleStack.tsx');
  ok('the stack is one Pressable with the root testID', /<Pressable\s+testID="whoson-stack"\s+accessibilityRole="button"/.test(stack) && (stack.match(/<Pressable\b/g) ?? []).length === 1);
  ok('the stack draws nothing unless the read is a list', /if \(view !== 'list' \|\| !model\.known \|\| !model\.owner \|\| !model\.self\) return null;/.test(stack));
  ok('the stack opens no sheet of its own', !/<Modal\b|<Sheet\b|visible=/.test(stack));
  ok('an earlier avatar sits above the next one, so its dot is never covered',
    /layer=\{slots\.shown\.length - i\}/.test(stack) && /layer !== undefined \? \{ zIndex: layer \} : null/.test(src));
  const block = code('components/whoson/ProjectPeopleBlock.tsx');
  ok('the block draws nothing unless the read is a list', /if \(view !== 'list' \|\| !model\.known \|\| !model\.owner \|\| !model\.self\) return null;/.test(block)
    && /testID="whoson-people"/.test(block));
  ok('a dot with no owner line above it names its subject', /\{ownerLine \? copy\.rowOpen : copy\.stackOwnerOpen\}/.test(block)
    && (block.match(/copy\.rowOpen/g) ?? []).length === 1);
  ok('the dot on its own is gated like every other component', /export function PresenceDot\([^\n]*\{\n  const styles = useThemedStyles\(makeStyles\);\n  if \(!WHOS_ON_ENABLED\) return null;/.test(src));
  const row = code('components/whoson/PersonRowExtras.tsx');
  ok('the row extras carry the per-person testID and return null without a person',
    /testID=\{`whoson-row-\$\{person\.userId\}`\}/.test(row) && /if \(!WHOS_ON_ENABLED \|\| !person\) return null;/.test(row));
  ok('no component reads an email for display', KIT_COMPONENTS.every(f => !/invitedEmail/.test(code(f).replace(/Pick<ProjectPerson,[^>]*>/g, ''))));
  const setting = code('components/whoson/SharePresenceSettingRow.tsx');
  ok('the Settings row waits for the choice read', /if \(!known\) return null;/.test(setting));
}

// The words.
{
  const src = read(COPY_HOOK);
  const str = String.raw`'((?:[^'\\]|\\.)*)'`;
  const unesc = (s: string) => s.replace(/\\(.)/g, '$1');
  const found = new Map<string, string[]>();
  for (const m of src.matchAll(new RegExp(String.raw`\bt\(\s*${str}\s*,\s*${str}`, 'g'))) found.set(m[1], [unesc(m[2])]);
  for (const m of src.matchAll(new RegExp(String.raw`\btn\(\s*${str}\s*,\s*[\w.]+\s*,\s*\{\s*one:\s*${str}\s*,\s*other:\s*${str}\s*\}`, 'g'))) found.set(m[1], [unesc(m[2]), unesc(m[3])]);
  const calls = (stripComments(src).match(/\b(?:t|tn)\(\s*'/g) ?? []).length;
  ok('every t() / tn() call in the copy hook was read', calls === found.size, `${calls} calls, ${found.size} read`);
  ok('every key starts office.whoson.', [...found.keys()].every(k => k.startsWith('office.whoson.')), [...found.keys()].filter(k => !k.startsWith('office.whoson.')).join(', '));
  ok('no t() at module scope', !/^(?:const|let|export const)[^\n]*\bt\(/m.test(stripComments(src)) && /export function useWhosOnCopy\(\)/.test(src));

  const WANT: Record<string, string[]> = {
    'stack.empty': ['No team members yet'],
    'stack.invite': ['Invite'],
    'stack.open': ['1 has it open', '{count} have it open'],
    'stack.ownerOpen': ['The project owner has it open'],
    'stack.choose': ["Choose what's shown"],
    'stack.a11y': ['Team on this project: {count}.'],
    'stack.a11yOpen': ['1 has it open now.', '{count} have it open now.'],
    'stack.a11yMember': ['Team on this project.'],
    'stack.a11yEmpty': ['No team members yet. Open the Team section.'],
    'row.nameCompany': ['{name} · {company}'],
    'row.joinedFromInvite': ['Joined from your invite · {date}'],
    'row.joined': ['Joined {date}'],
    'row.open': ['Has it open now'],
    'row.seenMin': ['Last seen online here 1 min ago', 'Last seen online here {count} min ago'],
    'row.seenHr': ['Last seen online here 1 hr ago', 'Last seen online here {count} hr ago'],
    'row.seenDate': ['Last seen online here {date}'],
    'row.seenAt': ['Last seen online here {date}, {time}'],
    'owner.line': ['Project owner: {name}'],
    'owner.lineCompany': ['Project owner: {name}, {company}'],
    'choice.title': ['Show when you have a project open?'],
    'choice.body': ['On a project someone shared with you, the project owner sees when you have it open and when you were last seen online there. On a project you own, your team members see when you have it open. Nothing is shown until you choose, and you can change it in Settings.'],
    'choice.yes': ['Show it'],
    'choice.no': ["Don't show it"],
    'share.label': ['Show when I have a project open'],
    'share.helper': ['The project owner sees when you have their project open and when you were last seen online there. Your team members see when you have your project open. Turn it off and they stop seeing both, and your last seen times are deleted.'],
    'share.offlineWeb': ['Needs a connection.'],
    'share.failed': ["Couldn't save that. Try again."],
    'empty.body': ['Team members show up here after they accept your invite to this project, not when they only download MAGE ID.'],
    'foot.meaning': ['"Has it open" means the project is on that person\'s screen right now. It doesn\'t show what they are doing.'],
    'foot.gaps': ["Work done without a signal, or on an older app version, doesn't show here. A team member can also choose not to show it."],
    'foot.who': ["Clients and subs who use a link instead of an account aren't listed here. Names and companies are what each person typed on their own profile; the email is the one you invited."],
  };
  eq('the copy hook holds exactly the keys of the spec', [...found.keys()].map(k => k.replace('office.whoson.', '')).sort(), Object.keys(WANT).sort());
  for (const [k, en] of Object.entries(WANT)) eq(`office.whoson.${k}`, found.get(`office.whoson.${k}`) ?? null, en);

  const BANNED: [string, RegExp][] = [
    ['!', /!/], ['job', /\bjobs?\b/i], ['collaborator', /collaborator/i], ['seat', /\bseats?\b/i],
    ['Active / active / Inactive / Last active', /active/i], ['Offline', /\boffline\b/i], ['working', /working/i],
    ['tracking', /track/i], ['Just', /\bjust\b/i], ['he', /\bhe\b/i], ['his', /\bhis\b/i], ['Online now', /online now/i],
  ];
  const english = [...found.values()].flat();
  for (const [name, re] of BANNED) {
    const hits = english.filter(s => re.test(s));
    ok(`no English default says "${name}"`, hits.length === 0, hits.join(' | '));
  }
  ok('the banned-word test can fail', BANNED.every(([, re]) => ['Hurry!', 'On this job', 'collaborators', '5 seats', 'Last active', 'Offline', 'working now', 'tracking', 'Just now', 'he left', 'his crew', 'Online now'].some(s => re.test(s))));
}

// The type.
{
  const types = read('types/index.ts');
  const at = types.indexOf('export interface ProjectPerson {');
  const body = at >= 0 ? types.slice(at, types.indexOf('\n}\n', at)) : '';
  ok('ProjectPerson and ProjectPersonKind are in types/index.ts', at >= 0 && /export type ProjectPersonKind = 'owner' \| 'member';/.test(types));
  const fields = [...stripComments(body).matchAll(/^\s{2}(\w+)\??:/gm)].map(m => m[1]);
  eq('ProjectPerson has exactly the thirteen fields of the contract', fields.sort(), [
    'companyName', 'displayName', 'invitedByViewer', 'invitedEmail', 'isSelf', 'joinedAt', 'kind',
    'lastSeenAt', 'openExpiresS', 'role', 'seenAgeS', 'sharesPresence', 'userId',
  ]);
  ok('ProjectPerson has no plan, tier, phone, address, avatar or pending field', !/plan|tier|phone|address|avatar|pending|subscription/i.test(fields.join(' ')));
  ok('openExpiresS is a number or null: there is no false', /openExpiresS: number \| null;/.test(body));
}

// The pure files stay pure.
for (const f of ['utils/whoson/people.ts', 'utils/whoson/heartbeat.ts']) {
  const src = code(f);
  const froms = [...src.matchAll(/from\s+'([^']+)'/g)].map(m => m[1]);
  ok(`${f} imports nothing that needs react-native`, froms.every(s => s === '@/types' || s === '@/constants/colors' || s === './people'), froms.join(', '));
  ok(`${f} reads no clock of its own`, !/Date\.now\(\)|new Date\(\)/.test(src));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

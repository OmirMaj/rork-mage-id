// utils/whoson/people.ts — "who is on this project": the pure half.
//
// Everything here is plain data in, plain data out, and loads under bun (no
// react, no react-native, no supabase). scripts/validate-whoson.ts runs it.
//
// The rules this file holds (whoson spec, sections 1-3):
//   - An unanswered read is not an empty team. `peopleModel([])` is
//     `known: false`, and every component draws nothing (null) for it.
//   - Only the project owner receives the list. A team member's model holds
//     the owner and himself and NOTHING else, even if a payload ever carried
//     more: other team members' rows are dropped here, and emails and
//     last-seen times are blanked for a viewer who is not the owner.
//   - "Has it open" is a number of seconds or null. There is no false: not
//     open and not known are one answer. A dot carries its own expiry,
//     counted from when the request was SENT, so a viewer who lost signal
//     drops the dot on time without another read.
//   - "Last seen online here" is the server's age at read time plus the time
//     since the read; once the read is older than the window the line turns
//     into an absolute date and time, so it never keeps saying "12 min ago".
//   - Names are what an account typed about itself. A name containing "@" is
//     nulled (never an email as a name), control characters are stripped and
//     the length is capped.

import type { ProjectPerson, ProjectPersonKind } from '@/types';
import { PROJECT_CHIP_PALETTE } from '@/constants/colors';

export const WHOSON = {
  /** One request a minute while a shared project is in front. */
  TICK_MS: 60_000,
  /** An owner alone with an invite out: how often he looks for the accept. */
  SLOW_TICK_MS: 120_000,
  /** Seconds the server keeps saying "open" after the last mark. Must equal
   *  the migration's `interval '150 seconds'` (validate-whoson-integrate). */
  OPEN_WINDOW_S: 150,
  /** Web only: no input for this long reads as nobody at the computer. */
  WEB_IDLE_MS: 300_000,
  /** A direct read is aborted after this. */
  READ_TIMEOUT_MS: 10_000,
  /** An "immediate" tick still waits this long after the last request. */
  MIN_GAP_MS: 5_000,
  /** No answer (transport error): wait 60 s, then 120 s, then 300 s. */
  BACKOFF_MS: [60_000, 120_000, 300_000],
  /** The server said no (5xx, permission, missing function): stop for this long. */
  SERVER_PAUSE_MS: 600_000,
  /** Slots in the phone stack, the "+n" chip included. */
  STACK_MAX_PHONE: 5,
  /** Slots in the desktop header stack at 1280 and up (one fewer below). */
  STACK_MAX_DESKTOP: 4,
  NAME_MAX: 80,
  /** How often a screen showing a dot or a relative time re-reads the clock. No request. */
  RERENDER_MS: 15_000,
} as const;

const KINDS: readonly ProjectPersonKind[] = ['owner', 'member'];
const ROLES: readonly ProjectPerson['role'][] = ['owner', 'editor', 'viewer', 'field'];

/** The teal chip sits too close to the "has it open" dot. */
const DOT_NEIGHBOUR = '#0A7F79';
/** Avatar fills: the project-chip hues (white initials clear AA on each) minus the teal. */
export const PERSON_COLORS: readonly string[] = PROJECT_CHIP_PALETTE.filter(c => c.toUpperCase() !== DOT_NEIGHBOUR);

// ── Rows ─────────────────────────────────────────────────────────────────────

/** A profile name as it may be shown: one line, no control characters, never an email. */
export function cleanPersonText(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  if (v.includes('@')) return null;
  const s = v.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim().slice(0, WHOSON.NAME_MAX).trim();
  return s.length > 0 ? s : null;
}

function isoOrNull(v: unknown): string | null {
  if (typeof v !== 'string' || v.length === 0) return null;
  return Number.isFinite(new Date(v).getTime()) ? v : null;
}

/**
 * One row of project_people(), snake_case, to a ProjectPerson. Null (dropped)
 * for anything that is not a row this app knows how to show: no user id, an
 * unknown kind, an unknown role. Whatever else the server sends is ignored, so
 * a field added later (a plan, a phone) never reaches a screen through here.
 */
export function mapPeopleRow(row: unknown): ProjectPerson | null {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const r = row as Record<string, unknown>;
  const userId = typeof r.user_id === 'string' ? r.user_id : '';
  if (!userId) return null;
  const kind = r.kind as ProjectPersonKind;
  if (!KINDS.includes(kind)) return null;
  const role = r.role as ProjectPerson['role'];
  if (!ROLES.includes(role)) return null;
  if ((kind === 'owner') !== (role === 'owner')) return null;
  const isSelf = r.is_self === true;
  const open = typeof r.open_expires_s === 'number' && Number.isFinite(r.open_expires_s) && r.open_expires_s > 0
    ? Math.floor(r.open_expires_s) : null;
  const lastSeenAt = isSelf ? null : isoOrNull(r.last_seen_at);
  const age = typeof r.seen_age_s === 'number' && Number.isFinite(r.seen_age_s) && r.seen_age_s >= 0
    ? Math.floor(r.seen_age_s) : null;
  const email = typeof r.invited_email === 'string' && r.invited_email.trim().length > 0 ? r.invited_email.trim() : null;
  return {
    userId,
    kind,
    role,
    displayName: cleanPersonText(r.display_name),
    companyName: cleanPersonText(r.company_name),
    isSelf,
    invitedByViewer: r.invited_by_viewer === true,
    invitedEmail: email,
    joinedAt: kind === 'owner' ? null : isoOrNull(r.joined_at),
    // Never on the viewer's own row: nobody is shown a dot about himself.
    openExpiresS: isSelf ? null : open,
    lastSeenAt,
    seenAgeS: lastSeenAt ? age : null,
    // Own row only. Anything but true/false is "not asked yet".
    sharesPresence: isSelf && typeof r.shares_presence === 'boolean' ? r.shares_presence : null,
  };
}

/** Every row of an RPC answer that maps; a non-array answer is no rows. */
export function mapPeopleRows(rows: unknown): ProjectPerson[] {
  if (!Array.isArray(rows)) return [];
  const out: ProjectPerson[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const p = mapPeopleRow(row);
    if (!p || seen.has(p.userId)) continue;
    seen.add(p.userId);
    out.push(p);
  }
  return out;
}

/**
 * Can a screen be drawn from these rows? Only when they hold exactly one owner
 * row and exactly one row for the viewer. Anything else (zero rows, the
 * viewer's own row dropped because its role is one this build does not know,
 * two owners) is NOT an answer this app can use: the caller treats it like
 * zero rows, draws nothing and stops asking until the route changes.
 */
export function peopleUsable(rows: readonly ProjectPerson[] | null | undefined): boolean {
  if (!rows || rows.length === 0) return false;
  let owners = 0;
  let selves = 0;
  for (const p of rows) {
    if (p.kind === 'owner') owners++;
    if (p.isSelf) selves++;
  }
  return owners === 1 && selves === 1;
}

// ── Open / not known ─────────────────────────────────────────────────────────

/**
 * Does this screen still say "has it open" for this person? Only while the
 * expiry the server sent, counted from when the request was SENT, has not run
 * out. A read with no send time, the viewer's own row and a null expiry are
 * never open.
 */
export function isOpenNow(person: Pick<ProjectPerson, 'openExpiresS' | 'isSelf'> | null | undefined, fetchedAtMs: number | null | undefined, nowMs: number): boolean {
  if (!person || person.isSelf) return false;
  if (typeof fetchedAtMs !== 'number' || !Number.isFinite(fetchedAtMs)) return false;
  const s = person.openExpiresS;
  if (typeof s !== 'number' || !(s > 0)) return false;
  const age = nowMs - fetchedAtMs;
  if (age < 0) return false; // a clock that went backwards proves nothing
  return age < s * 1000;
}

/** The read is older than a dot's validity: relative times turn absolute. */
export function readIsStale(fetchedAtMs: number | null | undefined, nowMs: number): boolean {
  if (typeof fetchedAtMs !== 'number' || !Number.isFinite(fetchedAtMs)) return true;
  const age = nowMs - fetchedAtMs;
  return age < 0 || age > WHOSON.OPEN_WINDOW_S * 1000;
}

// ── The model ────────────────────────────────────────────────────────────────

export interface PeopleModel {
  /** false = the read has not answered, failed, or returned nothing usable. Draw nothing. */
  known: boolean;
  owner: ProjectPerson | null;
  /** The viewer's own row. */
  self: ProjectPerson | null;
  /** Accepted team members THIS viewer may see: all of them for the owner
   *  (open first, then by joined date), his own row only for a team member. */
  members: ProjectPerson[];
  /** From the self row, never from a prop. */
  viewerIsOwner: boolean;
  /** Somebody other than the owner is on the project. */
  shared: boolean;
  /** The viewer's own choice: true, false, or null = not asked yet. */
  choice: boolean | null;
  /** Other people who have it open right now, as far as this screen may say. */
  openOthers: number;
  /** Their user ids. */
  openIds: readonly string[];
}

export const UNKNOWN_PEOPLE: PeopleModel = Object.freeze({
  known: false, owner: null, self: null, members: [], viewerIsOwner: false,
  shared: false, choice: null, openOthers: 0, openIds: [],
});

function joinedMs(p: ProjectPerson): number {
  const t = p.joinedAt ? new Date(p.joinedAt).getTime() : NaN;
  return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
}

/**
 * What a screen may say about the people on a project, from one read.
 * Unknown (`known: false`) unless the rows hold exactly one owner and the
 * viewer's own row: without the self row there is no telling whose screen
 * this is, so nothing is drawn.
 */
export function peopleModel(
  rows: readonly ProjectPerson[] | null | undefined,
  clock: { fetchedAtMs: number | null | undefined; nowMs: number },
): PeopleModel {
  if (!rows || !peopleUsable(rows)) return UNKNOWN_PEOPLE;
  const ownerRow = rows.find(p => p.kind === 'owner');
  const selfRow = rows.find(p => p.isSelf);
  if (!ownerRow || !selfRow) return UNKNOWN_PEOPLE;
  const viewerIsOwner = selfRow.kind === 'owner';

  // D1: a team member never holds another team member's row, and nobody but
  // the owner holds an email or a last-seen time. The server already says so;
  // this is the second lock.
  const blind = (p: ProjectPerson): ProjectPerson => (viewerIsOwner ? p : { ...p, invitedEmail: null, lastSeenAt: null, seenAgeS: null, invitedByViewer: false });
  const owner = blind(ownerRow);
  const self = blind(selfRow);
  const visibleMembers = rows
    .filter(p => p.kind === 'member' && p.userId !== owner.userId && (viewerIsOwner || p.isSelf))
    .map(blind);

  const open = (p: ProjectPerson) => isOpenNow(p, clock.fetchedAtMs, clock.nowMs);
  const members = [...visibleMembers].sort((a, b) => {
    const ao = open(a) ? 0 : 1;
    const bo = open(b) ? 0 : 1;
    if (ao !== bo) return ao - bo;
    const d = joinedMs(a) - joinedMs(b);
    if (d !== 0) return d;
    return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
  });
  const openIds = [owner, ...members].filter(open).map(p => p.userId);
  return {
    known: true,
    owner,
    self,
    members,
    viewerIsOwner,
    shared: members.length > 0,
    choice: self.sharesPresence,
    openOthers: openIds.length,
    openIds,
  };
}

// ── The stack ────────────────────────────────────────────────────────────────

export interface StackSlots {
  /** Avatars, in order: the owner, then people who have it open, then by joined date. */
  shown: ProjectPerson[];
  /** People behind the "+n" chip. 0 = no chip. */
  overflow: number;
  /** A hidden person has it open: the chip carries the dot. */
  overflowOpen: boolean;
}

/**
 * `max` is the number of slots, the chip included: everyone fits, or `max - 1`
 * avatars and a chip for the rest. A team member's model is two people, so it
 * never yields a chip.
 */
export function stackSlots(model: PeopleModel, max: number): StackSlots {
  if (!model.known || !model.owner) return { shown: [], overflow: 0, overflowOpen: false };
  const all = [model.owner, ...model.members];
  const cap = Math.max(2, Math.floor(max));
  if (all.length <= cap) return { shown: all, overflow: 0, overflowOpen: false };
  const shown = all.slice(0, cap - 1);
  const hidden = all.slice(cap - 1);
  return { shown, overflow: hidden.length, overflowOpen: hidden.some(p => model.openIds.includes(p.userId)) };
}

// ── One person ───────────────────────────────────────────────────────────────

/**
 * Two initials from what the account typed about itself: its name, else its
 * company. For the project owner's own screen only, the invited email is the
 * last resort (he typed that address; no other viewer's payload carries one).
 * '' when there is nothing: the avatar then shows a person mark, never an
 * invented letter.
 */
export function personInitials(person: Pick<ProjectPerson, 'displayName' | 'companyName' | 'invitedEmail'>): string {
  const source = cleanPersonText(person.displayName) ?? cleanPersonText(person.companyName);
  if (source) {
    const words = source.split(/\s+/).map(w => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(w => w.length > 0);
    if (words.length >= 2) return (first(words[0]) + first(words[words.length - 1])).toUpperCase();
    if (words.length === 1) return Array.from(words[0]).slice(0, 2).join('').toUpperCase();
  }
  const email = typeof person.invitedEmail === 'string' ? person.invitedEmail : '';
  const local = email.split('@')[0]?.replace(/[^\p{L}\p{N}]/gu, '') ?? '';
  return Array.from(local).slice(0, 2).join('').toUpperCase();
}
function first(word: string): string {
  return Array.from(word)[0] ?? '';
}

/** A stable avatar fill from the user id. Never the teal: that is the dot's family. */
export function personColor(userId: string): string {
  let h = 2166136261;
  for (let i = 0; i < userId.length; i++) {
    h ^= userId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return PERSON_COLORS[(h >>> 0) % PERSON_COLORS.length];
}

/** `{name} · {company}`, one of them, or null. What the account typed; never an email. */
export function personNameParts(person: Pick<ProjectPerson, 'displayName' | 'companyName'>): { name: string | null; company: string | null } {
  return { name: cleanPersonText(person.displayName), company: cleanPersonText(person.companyName) };
}

export type MembershipLine =
  | { key: 'joinedFromInvite'; at: string }
  | { key: 'joined'; at: string };

/** When this person's invite to THIS project was accepted. Null on the owner row. */
export function membershipLine(person: Pick<ProjectPerson, 'kind' | 'joinedAt' | 'invitedByViewer'>): MembershipLine | null {
  if (person.kind !== 'member' || !person.joinedAt) return null;
  return { key: person.invitedByViewer ? 'joinedFromInvite' : 'joined', at: person.joinedAt };
}

export type ActivityLine =
  | { key: 'open' }
  | { key: 'seenMin'; count: number }
  | { key: 'seenHr'; count: number }
  /** A day or more ago: the date. */
  | { key: 'seenDate'; at: string }
  /** The read itself is old: the date and the time, never a relative phrase. */
  | { key: 'seenAt'; at: string };

/**
 * The third line of a roster row. A key and numbers, never a string (the words
 * live in hooks/useWhosOnCopy.ts). Null = say nothing: never opened, chose not
 * to show it, an older app version, or not the owner's screen.
 */
export function activityLine(
  person: Pick<ProjectPerson, 'openExpiresS' | 'isSelf' | 'lastSeenAt' | 'seenAgeS'> | null | undefined,
  fetchedAtMs: number | null | undefined,
  nowMs: number,
): ActivityLine | null {
  if (!person || person.isSelf) return null;
  if (isOpenNow(person, fetchedAtMs, nowMs)) return { key: 'open' };
  const at = person.lastSeenAt;
  if (!at) return null;
  if (readIsStale(fetchedAtMs, nowMs) || typeof person.seenAgeS !== 'number') return { key: 'seenAt', at };
  const ageS = person.seenAgeS + Math.max(0, Math.floor((nowMs - (fetchedAtMs as number)) / 1000));
  if (ageS < 3600) return { key: 'seenMin', count: Math.max(1, Math.floor(ageS / 60)) };
  if (ageS < 86400) return { key: 'seenHr', count: Math.floor(ageS / 3600) };
  return { key: 'seenDate', at };
}

/**
 * Does a screen showing this read need to re-read the clock (no request)?
 * Only while something on it ages: a dot, or a relative time, and only until
 * the read goes stale. After that every line is absolute and nothing changes.
 */
export function needsClock(people: readonly ProjectPerson[] | null | undefined, fetchedAtMs: number | null | undefined, nowMs: number): boolean {
  if (!people || people.length === 0) return false;
  if (typeof fetchedAtMs !== 'number' || !Number.isFinite(fetchedAtMs)) return false;
  const age = nowMs - fetchedAtMs;
  if (age < 0 || age > WHOSON.OPEN_WINDOW_S * 1000 + WHOSON.RERENDER_MS) return false;
  return people.some(p => !p.isSelf && (p.openExpiresS !== null || p.lastSeenAt !== null));
}

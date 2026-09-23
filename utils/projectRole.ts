// utils/projectRole.ts
//
// Pure role derivation for multi-user projects (Live Schedule Collaboration
// Phase 1). Kept React-free so it's unit-testable in a plain bun script.

import type { ProjectCollaborator } from '@/types';

export type ProjectRole = 'owner' | 'editor' | 'viewer' | 'field' | null;

/**
 * The current user's role on a project, given the collaborator rows visible to
 * them and (when known) the project's owner:
 *   - an ACCEPTED collaborator row for this user → that role;
 *   - otherwise 'owner' only when the project is HIS (ownerUserId === uid), or
 *     when its owner is unknown — a legacy cache from before the owner stamp,
 *     or his own create the server has not seen. Never lock an owner out.
 *   - a KNOWN, different owner and no accepted row → null: he is not on this
 *     job (#90 — the GC removed him; the old fallback handed him 'owner').
 * Returns null when the user id is unknown (not signed in / still loading).
 *
 * `ownerUserId` is optional so every older caller (and its tests) keeps its
 * answer; the runtime caller, useProjectRoleState, always passes it.
 */
export function roleForUser(
  collaborators: ProjectCollaborator[],
  uid: string | null | undefined,
  ownerUserId?: string | null,
): ProjectRole {
  if (!uid) return null;
  const row = collaborators.find((c) => c.userId === uid && c.status === 'accepted');
  if (row) return row.role;
  if (!ownerUserId || ownerUserId === uid) return 'owner';
  return null;
}

/** What the role hook reports. `isPaused`: the collaborator read is waiting
 *  for a network it does not have (react-query's paused fetch) — the answer
 *  below is the last one this device knew, or still loading. */
export interface ResolvedRoleState {
  role: ProjectRole;
  isLoading: boolean;
  isError: boolean;
  isPaused: boolean;
  /** Set only on a settled-null PAUSED answer: why the role cannot be known
   *  offline, for the gate to say instead of spinning. */
  reason?: string;
}

/** Review round 1 · the reasons a paused (offline) read gives for no role. */
export const ROLE_PAUSED_NOT_ON_PHONE = 'This job is not on this phone, so your access to it cannot be checked offline. Connect to the internet and try again.';
export const ROLE_PAUSED_UNKNOWN = 'Your access to this job cannot be checked offline. Connect to the internet and try again.';

/**
 * The one decision behind useProjectRoleState, pure so it is tested (#90 and
 * the paused-read handoff):
 *  - no project → null, settled;
 *  - HIS project (the server's owner stamp, cached) → 'owner' at once, even
 *    offline or after a failed collaborator read — the owner is never a row
 *    in that table, and locking him out of his own job on a blip is worse
 *    than useless;
 *  - the read failed IN TRANSPORT (no signal: the request never reached the
 *    server — utils/networkErrors isTransportError) and the cached job carries
 *    a stamped 'field' or 'editor' role → that role, PAUSED (#126). On native
 *    react-query never marks the device offline, so a read with no signal
 *    does not pause: it retries and settles as an error. Answering null there
 *    put a Business paywall on the Punch List he was invited to run. The
 *    server's RLS still decides whether anything he writes lands, and a
 *    removed collaborator's read ANSWERS (an empty list), so this can never
 *    keep a revoked seat open. A 'viewer' stamp, no stamp, or an error the
 *    server sent (RLS, 5xx) keeps the error answer below;
 *  - the read failed → null with isError (the screen offers Retry);
 *  - the read answered → roleForUser, with the owner stamp;
 *  - the read is in flight → null, loading;
 *  - the read is PAUSED (offline, never answered on this launch) → the role
 *    the projects load last stamped on the cached job, if any; otherwise
 *    'owner' when the owner is unknown AND the job is in the cached list (his
 *    own offline create); otherwise null, settled, with a reason ("cannot be
 *    checked offline" / "not on this phone") — never a silent 'owner' (the
 *    old fallback: a paused read looked settled with an empty list, which
 *    read as owner), and never a spinner that lasts as long as the outage;
 *  - pending but not yet fetching (about to start) → loading.
 */
export function resolveRoleState(a: {
  projectId: string | undefined;
  uid: string | null | undefined;
  ownerUserId?: string | null;
  cachedRole?: ProjectCollaborator['role'] | null;
  collaborators: ProjectCollaborator[];
  isLoading: boolean;
  isError: boolean;
  /** The query has never produced data or an error (status 'pending'). */
  isPending: boolean;
  /** The job is in this device's cached project list (useCachedProjectRoleHint
   *  found it). Absent = not known to be cached. */
  inCache?: boolean;
  /** react-query's fetchStatus is 'paused' (waiting for a network). Absent =
   *  unknown (legacy callers: treated as paused-and-waiting, i.e. loading). */
  fetchPaused?: boolean;
  /** The failed read's error was a transport failure (isTransportError) —
   *  the request never reached the server. Absent = not known to be one. */
  errorIsTransport?: boolean;
}): ResolvedRoleState {
  const settled = (role: ProjectRole): ResolvedRoleState => ({ role, isLoading: false, isError: false, isPaused: false });
  if (!a.projectId || !a.uid) return settled(null);
  if (a.ownerUserId && a.ownerUserId === a.uid) return settled('owner');
  if (a.isError) {
    if (a.errorIsTransport === true && (a.cachedRole === 'field' || a.cachedRole === 'editor')) {
      return { role: a.cachedRole, isLoading: false, isError: false, isPaused: true };
    }
    return { role: null, isLoading: false, isError: true, isPaused: false };
  }
  if (a.isLoading) return { role: null, isLoading: true, isError: false, isPaused: false };
  if (a.isPending) {
    if (a.cachedRole && a.cachedRole !== 'owner') return { role: a.cachedRole, isLoading: false, isError: false, isPaused: true };
    // Review round 1: "owner unknown" means HIS unsynced create only when the
    // job IS in the cached list — a deep link to a job this phone never held
    // (or already forgot) has no owner stamp either, and must not be handed
    // owner controls.
    if (!a.ownerUserId && a.inCache === true) return { role: 'owner', isLoading: false, isError: false, isPaused: true };
    // Truly paused (offline): say why instead of spinning for as long as the
    // phone has no signal. Not yet started (about to fetch): loading.
    if (a.fetchPaused === true) {
      return { role: null, isLoading: false, isError: false, isPaused: true, reason: a.inCache === true ? ROLE_PAUSED_UNKNOWN : ROLE_PAUSED_NOT_ON_PHONE };
    }
    return { role: null, isLoading: true, isError: false, isPaused: a.fetchPaused === undefined };
  }
  return settled(roleForUser(a.collaborators, a.uid, a.ownerUserId));
}

/**
 * #129 · What the Team roster may claim, from the collaborator read's state.
 * `collaborators` is `[]` for a read that failed, a read paused offline and a
 * genuinely empty team alike; only a read that has ANSWERED (hasData) may say
 * "No collaborators yet". The GC who believed that line re-invited his
 * pending foreman, and the re-send used to rotate the invite token — killing
 * the link he had already texted.
 *   - 'loading'  the first read is in flight;
 *   - 'error'    the read failed and nothing was ever read (Retry);
 *   - 'offline'  the read is waiting for a network, nothing read yet;
 *   - 'empty'    the server answered: no one else on the job;
 *   - 'list'     rows to draw (a later refresh may have failed — `stale`).
 */
export type RosterView = 'loading' | 'error' | 'offline' | 'empty' | 'list';
export function rosterView(a: { isLoading: boolean; isError: boolean; isPaused: boolean; hasData: boolean; count: number }): RosterView {
  if (a.hasData) return a.count === 0 ? 'empty' : 'list';
  if (a.isError) return 'error';
  if (a.isPaused) return 'offline';
  return 'loading';
}

export const ROSTER_ERROR_LINE = "Couldn't load the team. Check your signal and try again.";
export const ROSTER_OFFLINE_LINE = "You're offline. The team list loads when you have signal.";

/** #129 · Why "Send invite" is off while the roster is unknown: the "already on
 *  this job" check needs the list, and a re-send to someone already invited
 *  must be a choice made with the list in view. Null = the roster is known. */
export function inviteBlockedReason(view: RosterView): string | null {
  if (view === 'error') return "Invites are paused until the team list loads, so you can see who's already on this job or invited before you send.";
  if (view === 'offline') return "Invites need a connection. The team list loads when you have signal.";
  if (view === 'loading') return 'Loading the team list…';
  return null;
}

/**
 * #129 · The Team count (#173) — a number only from a roster the server has
 * ANSWERED. `hasData` false covers loading, a failed read AND a read paused
 * offline: the paused one was neither loading nor an error, so the old
 * `!isLoading && !isError` test printed "Team (1)" (0 accepted + the owner),
 * the guess #173 was meant to remove. A collaborator's read returns only his
 * OWN row (RLS), so he gets no number either — no number, not a wrong one.
 */
export function teamCountLabel(args: { hasData: boolean; viewerIsOwner: boolean; rows: { status: string }[] }): string | null {
  if (!args.hasData) return null;
  if (!args.viewerIsOwner) return null;
  const accepted = args.rows.filter(r => r.status === 'accepted').length;
  const pending = args.rows.filter(r => r.status === 'pending').length;
  const members = accepted + 1;
  return pending > 0 ? `${members} + ${pending} pending` : String(members);
}

/**
 * #63 · "Filed by …" on a daily report row, from the report's author id
 * (DailyFieldReport.filedByUserId). Null = say nothing: no author on record,
 * or it is the viewer's own report. Never an invented name — an id the
 * roster cannot resolve (a foreman sees only his own row under RLS) reads
 * "a team member".
 */
export function filedByLine(a: {
  filedByUserId?: string | null;
  viewerId?: string | null;
  ownerUserId?: string | null;
  collaborators: readonly Pick<ProjectCollaborator, 'userId' | 'name' | 'email'>[];
}): string | null {
  const who = a.filedByUserId;
  if (!who) return null;
  if (a.viewerId && who === a.viewerId) return null;
  if (a.ownerUserId && who === a.ownerUserId) return "Filed by the job's owner";
  const row = a.collaborators.find(c => c.userId === who);
  const name = (row?.name ?? '').trim() || (row?.email ?? '').trim();
  return name ? `Filed by ${name}` : 'Filed by a team member';
}

/**
 * #8/#128 · The Leave-project dialog, from how many of his changes to this
 * job have not reached the server (countQueuedForProject — the same matcher
 * the leave sweep discards by, plus queued photos). The old copy promised
 * "Nothing on the job is deleted" and then the sweep dropped his unsent
 * daily report. Only records already synced stay with the owner; with
 * anything still queued the dialog says the number and offers "Sync first".
 */
export const LEAVE_SYNCED_STAYS = 'Records already synced stay with the project owner.';
/**
 * Integration round 3 · `unsaved` is the part of `pending` that is under Not
 * saved (MAGE refused it, or it waits behind a refused change). A sync never
 * sends those — only Retry on the Not-saved sheet does — so "Sync first" is
 * offered only for the rest (it came back with the same count on every tap),
 * and the Not-saved part is named, with a button that opens the sheet.
 */
/**
 * Wave-4 final fix · `maxButtons`: React Native's Android Alert keeps only the
 * first three buttons (Alert.js "At most three buttons … Ignore rest"), so
 * Cancel + Sync first + Open Not saved + Leave anyway dropped Leave anyway —
 * offline with one queued change and one refused line, he could not leave.
 * With room for three, "Sync first" is the one that goes: the queued part
 * still syncs on its own, Open Not saved is the only way to the refused part,
 * and the destructive action must stay.
 */
export function leaveDialogCopy(name: string, pending: number, unsaved = 0, maxButtons = 4): {
  title: string; message: string; offerSyncFirst: boolean; offerOpenNotSaved: boolean; leaveLabel: string;
} {
  const job = name.trim() || 'this project';
  const base = `You'll lose access to ${job} on every device. ${LEAVE_SYNCED_STAYS} To come back, the owner has to invite you again.`;
  const notSaved = Math.min(Math.max(0, unsaved), Math.max(0, pending));
  const queued = Math.max(0, pending - notSaved);
  if (pending > 0) {
    const head = `${pending} change${pending === 1 ? '' : 's'} on this job ${pending === 1 ? "hasn't" : "haven't"} reached the cloud yet.`;
    const refused = notSaved === 0 ? ''
      : notSaved === pending
        ? ` ${pending === 1 ? 'It is' : 'They are'} under Not saved — MAGE refused ${pending === 1 ? 'it' : 'them'}, so syncing won't send ${pending === 1 ? 'it' : 'them'}. Open Not saved to Retry or Discard.`
        : ` ${notSaved} of them ${notSaved === 1 ? 'is' : 'are'} under Not saved — MAGE refused ${notSaved === 1 ? 'it' : 'them'}, so syncing won't send ${notSaved === 1 ? 'it' : 'them'}. Open Not saved to Retry or Discard.`;
    return {
      title: `Leave ${job}?`,
      message: `${head}${refused} Leaving now discards ${pending === 1 ? 'it' : 'them'}. ${base}`,
      offerSyncFirst: queued > 0 && (notSaved === 0 || maxButtons >= 4),
      offerOpenNotSaved: notSaved > 0,
      leaveLabel: 'Leave anyway',
    };
  }
  return { title: `Leave ${job}?`, message: base, offerSyncFirst: false, offerOpenNotSaved: false, leaveLabel: 'Leave' };
}

/** "You left" — with the count the sweep reports, so it is never silent. */
export function leftProjectMessage(name: string, forgot: boolean, dropped: number): string {
  const job = name.trim() || 'this project';
  const head = forgot
    ? `You're no longer on ${job}, and it has left this device.`
    : `You're no longer on ${job}. It leaves your job list when your projects next reload.`;
  return dropped > 0
    ? `${head} ${dropped} change${dropped === 1 ? '' : 's'} you had not synced could not be sent.`
    : head;
}

/**
 * #111/#130 · Wait for a promise at most `ms`. 'done' = it resolved, 'failed'
 * = it rejected, 'timeout' = still out. Used to hold the accept spinner until
 * the projects list has re-read (so the job he just joined is there when he
 * opens it) without hanging forever on a weak signal.
 */
export function settleWithin(p: Promise<unknown>, ms: number): Promise<'done' | 'failed' | 'timeout'> {
  return new Promise((resolve) => {
    let finished = false;
    const timer = setTimeout(() => { if (!finished) { finished = true; resolve('timeout'); } }, ms);
    p.then(
      () => { if (!finished) { finished = true; clearTimeout(timer); resolve('done'); } },
      () => { if (!finished) { finished = true; clearTimeout(timer); resolve('failed'); } },
    );
  });
}

/**
 * #111/#130 · What project-detail shows when the job is not in the list.
 *  - 'loading'   the list has not loaded, is re-reading, or a delete is
 *                mid-flight — a job a refetch is about to bring is not "not
 *                found";
 *  - 'joined'    he just accepted an invite and a finished read still lacks
 *                it — "You joined, but this job hasn't loaded yet" + Retry;
 *  - 'not_found' a finished read without it.
 */
export function missingProjectView(a: { projectsLoaded: boolean; projectsFetching: boolean; deleting: boolean; justJoined: boolean }): 'loading' | 'joined' | 'not_found' {
  if (!a.projectsLoaded || a.projectsFetching || a.deleting) return 'loading';
  return a.justJoined ? 'joined' : 'not_found';
}
export const JUST_JOINED_NOT_LOADED = "You joined, but this job hasn't loaded yet. Check your signal and try again.";

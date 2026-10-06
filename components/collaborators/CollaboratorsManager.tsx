// components/collaborators/CollaboratorsManager.tsx
//
// Invite + manage project collaborators (Live Schedule Collaboration Phase 1).
// Owner-only controls; editors/viewers see the roster read-only. Because the
// invite email is best-effort (Resend may be unconfigured), we surface a
// copyable invite link too.
//
// ── WHAT IS GATED, AND WHAT IS DELIBERATELY NOT ─────────────────────────────
// Inviting an ADMIN collaborator (editor / viewer — the roles that read
// financials) is gated to Pro via schedule_collaboration. Inviting a FIELD
// collaborator is NOT gated at any tier.
//
// This used to be wrong, and it was wrong in the expensive direction. The
// canAccess('schedule_collaboration') check sat ABOVE the role, so it fired for
// role 'field' too: a free-tier GC who picked "Field" and tapped Send Invite was
// bounced to /paywall and could not add a single sub. The server would have
// allowed it — supabase/functions/project-invite/index.ts:220 calls seatCheck()
// only when isBillableRole(role) is true, so a field invite passes at every
// tier — and utils/seatModel previewSeat('free', …, 'field') returns
// allowed:true, which scripts/validate-seat-model.ts has asserted the whole
// time. The CLIENT was the only thing refusing, and it refused the exact
// promise the marketing site makes ("subcontractors are always free").
//
// So the tier check is now asked only about the roles it is actually about.
// Keep it below the role test: a field invite must never reach /paywall.
//
// ── THE ROSTER ROLE PICKER (audit round 2 #27) ──────────────────────────────
// Each row used to carry ONE chip, `role === 'editor' ? 'viewer' : 'editor'`.
// On a Field row that read "Make editor": one tap, no dialog, and the foreman
// saw the job's estimate, markup and contract terms from his next load — the
// numbers the field role exists to keep from the crew. Nothing could set Field
// on an existing row, so the only way back was to re-invite him, which reset
// his row to 'pending' and locked him out of the whole project. Now every row
// has the same Editor / Viewer / Field picker the invite form has, a move that
// LIFTS financial blinding asks first and names what they will see, and
// re-inviting an active member is refused (here, and by project-invite,
// which answers code 'already_member').
//
// ── REMOVING SOMEONE, AND THE LINK AFTER YOU LEAVE (#95, #177) ──────────────
// The trash icon used to revoke on touch — no dialog, no undo, and a failure
// (weak signal on site) rendered nothing, so the GC thought the super was off
// the job while he still had it. It now confirms, shows a spinner on that row
// while the server answers, and says out loud when the person STILL has
// access. It stays OUTSIDE utils/offlineQueue on purpose: removing access is a
// server-authoritative permission change, and a queued "removed" that has not
// happened yet is exactly the false comfort this fixes.
// The invite's email outcome is now reported (emailSent), and a pending row
// carries "Copy link", which re-reads the CURRENT link (getLink) instead of
// re-sending — re-sending rotates the token and kills a link already texted.
//
// ── THE JOB'S CLIENT IS NOT A COLLABORATOR (Phase 0, lane B) ─────────────────
// Every seat here — viewer included — reads the job's costs; field reads the
// crew's reports and hours. A GC who types his homeowner's address into this
// form was about to hand him margins, labour and markup. project-invite now
// refuses any address the job records as its client (primary contact, a
// client-portal invite, an invoice's bill-to) with code 'is_client', for every
// role. This screen asks the same question first from the data it already has,
// so the GC gets the reason — and the client portal, the client's real door —
// before a request is sent; the server stays the authority for anything this
// device hasn't loaded.

//
// ── WHO IS ON THIS PROJECT (2026-10-04, dark behind WHOS_ON_ENABLED) ─────────
// With the flag on, an ACCEPTED row gains the person's initials at the left
// and up to three lines under the role line: the name and company that
// account typed on its own profile, the date it accepted, and "Has it open
// now" or "Last seen online here …" (nothing when the app does not know).
// They come from the owner's own project_people() read (hooks/
// useProjectPeople), matched to the row by user id and only ever to a
// `member` row. A pending row gains nothing: nothing is claimed about whether
// that address has an account. The status word becomes "Joined": a green dot
// beside "Active" on a row that only means "accepted the invite" would read
// as presence. With the flag off this file renders exactly what it rendered
// before, "Active" included, and no hook of the feature is called.
//
// WHERE THE FEATURE IS READ. Not in CollaboratorsManager's own body. The one
// people read lives in RosterPeopleRead (below), mounted by RosterPeopleScope
// around the roster. The scope is an error boundary with a way back: if the
// read or anything it feeds throws, the roster is drawn again WITHOUT the
// feature (no initials, no lines), never taken down with it. The rows read
// the answer from a context, so there is one observer and one clock for the
// whole roster, however long it is.
//
// TWO READS, ONE STORY. The initials come from the people read, which is
// fresh on every open and every minute; the rows come from the roster read,
// which the app keeps for five minutes. So a sub who accepted two minutes ago
// was in the avatar stack and still "Invited" here. RosterPeopleRead closes
// that with one rule (rosterReadDecision, below): when the owner's people
// read was SENT after the roster last answered, and it names a team member
// the roster does not show as accepted (or the roster shows one it does not
// name), the roster is read again. ONCE per distinct disagreement: one that a
// fresh roster cannot settle (a role this build does not know) costs one
// request, not one a minute. A people read OLDER than the roster proves
// nothing about the roster (it is the stale picture, and it is refreshed on
// its own), and a roster read already in flight is waited for, so removing a
// person does not read the roster twice. The roster key is shared with the
// project page, so the Team title and tile follow.

import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { UserPlus, Trash2, Copy, Check, Mail, Link2, ShieldAlert } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import { useProjectCollaborators } from '@/hooks/useProjectCollaborators';
import { useProjectRole } from '@/hooks/useProjectRole';
import { useProjectPeople } from '@/hooks/useProjectPeople';
import { PersonAvatar, PersonRowExtras, WhosOnBoundary } from '@/components/whoson';
import { WHOS_ON_ENABLED } from '@/constants/featureFlags';
import { rosterView, inviteBlockedReason, ROSTER_ERROR_LINE, ROSTER_OFFLINE_LINE } from '@/utils/projectRole';
import { ROLE_LABELS, ROLE_DESCRIPTIONS, FIELD_ROLE_SCOPE_NOTE, isFinancialsBlinded } from '@/utils/roleBlinding';
import { useAccountSeats } from '@/hooks/useAccountSeats';
import { isBillableSeat } from '@/utils/seatModel';
import type { ProjectCollaborator, ProjectPerson } from '@/types';
import { showAlert } from '@/utils/alert';
import { describeError, classifyError, rawErrorMessage, readerSentence } from '@/utils/errorCopy';
import { Button } from '@/components/ui';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

/** Addresses in a free-text field, trimmed and lower-cased (a bill-to can
 *  hold "a@x.com, b@x.com"). Same rule as project-invite's emailsIn. */
function emailsIn(v: unknown): string[] {
  if (typeof v !== 'string') return [];
  // Display-name form ('Dana <dana@x.com>') splits on the brackets too.
  return v.split(/[\s,;<>"'()]+/).map((x) => x.trim().toLowerCase()).filter((x) => x.includes('@'));
}


type ClientSource = 'primary_contact' | 'portal_invite' | 'bill_to';
/** Where this job records its client — the same three places project-invite reads. */
const CLIENT_SOURCE_LINES: Record<ClientSource, string> = {
  primary_contact: 'is the client contact on this project',
  portal_invite: "is invited to this project's client portal",
  bill_to: "is the address this project's invoices are billed to",
};

/** The server's is_client sentence always carries this phrase; unwrap() in
 *  useProjectCollaborators keeps only the message, so it is how a refusal the
 *  device could not foresee (data not loaded here) is recognised. */
const CLIENT_REFUSAL_PHRASE = "a client can't be added here";

// ── Who is on this project: the roster's side of it ─────────────────────────
// The three functions between the two marks are pure (no React, no imports
// used at run time). scripts/validate-whoson-wire.ts lifts this block out of
// the file and runs it; keep it free of anything the file imports.
// ── roster-people pure (begin)

/**
 * The team member an ACCEPTED roster row stands for in the people read, by
 * user id. A pending row stands for nobody (nothing is claimed about whether
 * that address has an account), and only a `member` row is ever matched: an
 * owner who accepted an invite to his own address has a roster row, and it
 * must not borrow the owner's row.
 */
export function rosterRowPerson(
  people: readonly ProjectPerson[],
  c: Pick<ProjectCollaborator, 'status' | 'userId'>,
): ProjectPerson | undefined {
  if (c.status !== 'accepted' || !c.userId) return undefined;
  return people.find((p) => p.kind === 'member' && p.userId === c.userId);
}

/**
 * Where the roster and the project OWNER's people read disagree about who has
 * joined. '' = they agree, or the people read is not the owner's own (a team
 * member's read names only the owner and himself, so it says nothing about
 * the roster), or it is unknown (no rows).
 *   +id  the people read names a team member the roster does not show as accepted
 *   -id  the roster shows an accepted team member the people read does not name
 * Sorted, so the same disagreement always reads the same.
 */
export function rosterPeopleMismatch(
  roster: readonly Pick<ProjectCollaborator, 'status' | 'userId'>[],
  people: readonly Pick<ProjectPerson, 'kind' | 'userId' | 'isSelf'>[],
): string {
  const owner = people.find((p) => p.kind === 'owner');
  if (!owner || !owner.isSelf) return '';
  const joined = new Set<string>();
  for (const c of roster) {
    // The owner's own address, invited and accepted, is not a team member.
    if (c.status === 'accepted' && c.userId && c.userId !== owner.userId) joined.add(c.userId);
  }
  const named = new Set<string>();
  for (const p of people) if (p.kind === 'member') named.add(p.userId);
  const out: string[] = [];
  for (const id of named) if (!joined.has(id)) out.push(`+${id}`);
  for (const id of joined) if (!named.has(id)) out.push(`-${id}`);
  return out.sort().join(' ');
}

/**
 * Should the roster be read again? Pure.
 *   mismatch         rosterPeopleMismatch() of what is on screen now
 *   askedFor         the last disagreement the roster was re-read for ('' = none)
 *   rosterFetching   a roster read is in flight
 *   peopleSentAtMs   when the people read was SENT (null = nothing read)
 *   rosterReadAtMs   when the roster last answered (0 = never)
 * Returns the new `askedFor` and whether to read.
 */
export function rosterReadDecision(a: {
  mismatch: string;
  askedFor: string;
  rosterFetching: boolean;
  peopleSentAtMs: number | null;
  rosterReadAtMs: number;
}): { askedFor: string; refetch: boolean } {
  // They agree: nothing to ask, and a later disagreement is a new one.
  if (!a.mismatch) return { askedFor: '', refetch: false };
  const wait = { askedFor: a.askedFor, refetch: false };
  // A roster answer is already on its way: judge that one when it lands.
  if (a.rosterFetching) return wait;
  // Only a people read sent AFTER the roster answered can show the roster is
  // behind. An older one is itself the stale picture.
  if (a.peopleSentAtMs === null || !(a.peopleSentAtMs > a.rosterReadAtMs)) return wait;
  // Already asked for exactly this, and a fresh roster did not settle it.
  if (a.mismatch === a.askedFor) return wait;
  return { askedFor: a.mismatch, refetch: true };
}

// ── roster-people pure (end)

/** What the roster rows read of the people read. */
type RosterPeople = { people: readonly ProjectPerson[]; openIds: readonly string[]; fetchedAtMs: number | null };
/** Nothing known: every row draws what it drew before the feature. */
const NO_ROSTER_PEOPLE: RosterPeople = { people: [], openIds: [], fetchedAtMs: null };
const RosterPeopleContext = React.createContext<RosterPeople>(NO_ROSTER_PEOPLE);

type RosterPeopleProps = {
  projectId: string;
  roster: ProjectCollaborator[];
  /** The roster read has answered (useProjectCollaborators().hasData). */
  rosterKnown: boolean;
  rosterFetching: boolean;
  /** When the roster last answered, in ms. 0 = never. */
  rosterReadAtMs: number;
  refetchRoster: () => void;
  children: React.ReactNode;
};

/** The ONE people read of the roster, and the rule that keeps the roster in
 *  step with it (see the header). Mounted only by RosterPeopleScope. */
function RosterPeopleRead({ projectId, roster, rosterKnown, rosterFetching, rosterReadAtMs, refetchRoster, children }: RosterPeopleProps) {
  const whosOn = useProjectPeople(projectId);
  const mismatch = rosterKnown ? rosterPeopleMismatch(roster, whosOn.people) : '';
  const peopleSentAtMs = whosOn.fetchedAtMs;
  // The last disagreement the roster was re-read for. '' = none.
  const askedFor = useRef('');
  useEffect(() => {
    const next = rosterReadDecision({ mismatch, askedFor: askedFor.current, rosterFetching, peopleSentAtMs, rosterReadAtMs });
    askedFor.current = next.askedFor;
    if (next.refetch) refetchRoster();
  }, [mismatch, rosterFetching, peopleSentAtMs, rosterReadAtMs, refetchRoster]);
  return (
    <RosterPeopleContext.Provider value={{ people: whosOn.people, openIds: whosOn.model.openIds, fetchedAtMs: whosOn.fetchedAtMs }}>
      {children}
    </RosterPeopleContext.Provider>
  );
}

let rosterPeopleFailureLogged = false;

/**
 * Wraps the roster. Feature off: its children, untouched. Feature on: the
 * people read around them. If that read, or anything drawn from it, throws,
 * the roster is drawn again without it. The kit's WhosOnBoundary draws
 * NOTHING on a failure, which is right for a block of the feature and wrong
 * here: its children are the roster itself.
 */
class RosterPeopleScope extends React.Component<RosterPeopleProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    if (rosterPeopleFailureLogged) return;
    rosterPeopleFailureLogged = true;
    console.warn('[WhosOn] the roster is shown without its people:', error instanceof Error ? error.message : String(error));
  }

  render(): React.ReactNode {
    const { children, ...read } = this.props;
    if (!WHOS_ON_ENABLED || this.state.failed) return children;
    return <RosterPeopleRead {...read}>{children}</RosterPeopleRead>;
  }
}

/** The initials at the left of an accepted row. Nothing (no empty box) for any other row. */
function RosterRowAvatar({ c }: { c: ProjectCollaborator }) {
  const { people, openIds } = useContext(RosterPeopleContext);
  const person = rosterRowPerson(people, c);
  if (!person) return null;
  return (
    <View style={styles.rowAvatar}>
      <WhosOnBoundary>
        <PersonAvatar person={person} size={32} open={openIds.includes(person.userId)} />
      </WhosOnBoundary>
    </View>
  );
}

/** The lines under an accepted row's role line. PersonRowExtras draws nothing without a person. */
function RosterRowLines({ c }: { c: ProjectCollaborator }) {
  const { people, fetchedAtMs } = useContext(RosterPeopleContext);
  return <PersonRowExtras person={rosterRowPerson(people, c)} fetchedAtMs={fetchedAtMs} />;
}

export function CollaboratorsManager({ projectId, onOpenClientPortal }: {
  projectId: string;
  /** Opens this job's client portal setup. Optional: the host decides how to
   *  leave its own modal first. Without it the reason names where to go. */
  onOpenClientPortal?: () => void;
}) {
  const { colors: t } = useTheme();
  const router = useRouter();
  const { getProject, getInvoicesForProject } = useProjects();
  const { canAccess } = useTierAccess();
  const role = useProjectRole(projectId);
  const isOwner = role === 'owner';
  const { collaborators, isLoading, isError, isPaused, hasData, isFetching, dataUpdatedAt, refetch, invite, revoke, changeRole, getLink } = useProjectCollaborators(projectId);
  // #129: a failed or offline read is NOT an empty team. Only a read that has
  // answered may say "No collaborators yet"; until then the invite form is
  // off with its reason (the "already on this job" check needs the list).
  const view = rosterView({ isLoading, isError, isPaused, hasData, count: collaborators.length });
  const inviteBlocked = inviteBlockedReason(view);
  // Account-wide, not per-project: one person on six jobs is one seat.
  const seats = useAccountSeats();

  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'editor' | 'viewer' | 'field'>('editor');
  const [lastLink, setLastLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // #177: what happened to the last invite's email. `sent: null` = a function
  // deployed before emailSent existed — neither claim is made then.
  const [lastSend, setLastSend] = useState<{ email: string; sent: boolean | null } | null>(null);
  // #177: which pending row's link was just copied (row-level "Copy link").
  const [rowCopiedId, setRowCopiedId] = useState<string | null>(null);

  const validEmail = /^\S+@\S+\.\S+$/.test(email.trim());

  // Phase 0 lane B: is the typed address this job's CLIENT? Checked against
  // what this device has loaded — the same three places project-invite reads.
  const clientSourceFor = useCallback((address: string): ClientSource | null => {
    const typed = address.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(typed)) return null;
    const project = getProject(projectId);
    if (emailsIn(project?.primaryContact?.email).includes(typed)) return 'primary_contact';
    if ((project?.clientPortal?.invites ?? []).some((i) => emailsIn(i?.email).includes(typed))) return 'portal_invite';
    if (getInvoicesForProject(projectId).some((inv) => emailsIn(inv.billToEmail).includes(typed))) return 'bill_to';
    return null;
  }, [projectId, getProject, getInvoicesForProject]);
  const clientSource = useMemo(() => clientSourceFor(email), [clientSourceFor, email]);
  const clientReason = clientSource
    ? `${email.trim()} ${CLIENT_SOURCE_LINES[clientSource]}. Team members can see the project's costs, margins and labor, so a client can't be added here in any role. Share the client portal with them instead: it shows only the sections you switch on.`
    : null;
  // The guard runs at invite, accept and promotion. A seat taken BEFORE the
  // address was recorded as this job's client (the GC invited first, then
  // added the person to the portal or an invoice) is already live and reads
  // the job's costs. Nothing on the server revisits it, so the roster flags
  // it here, with the reason and a way to remove it.
  const clientSeats = useMemo(() => {
    const m = new Map<string, ClientSource>();
    for (const c of collaborators) {
      if (c.role === 'owner') continue;
      const src = clientSourceFor(c.email ?? '');
      if (src) m.set(c.id, src);
    }
    return m;
  }, [collaborators, clientSourceFor]);
  // A refusal the server made from data this device hasn't loaded.
  const serverClientRefusal = invite.isError
    && ((invite.error as Error)?.message ?? '').includes(CLIENT_REFUSAL_PHRASE);

  // A server refusal belongs to the address that was SENT. Once the GC edits
  // the field (say, to a real teammate), the old refusal and its portal
  // pointer must go, or they sit under an address they are not about.
  const onEmailChange = useCallback((next: string) => {
    if (invite.isError) invite.reset();
    setEmail(next);
  }, [invite]);

  // What this specific invite costs, computed before it is sent so a charge is
  // never a surprise. Field invites always return bills:false — crew are free.
  const seatPreview = seats.preview(inviteRole, email);

  const onInvite = useCallback(() => {
    if (!validEmail) return;
    if (inviteBlocked) { showAlert("Can't Send the Invite Yet", inviteBlocked); return; }
    // The client first: no role makes this invite safe (see the header).
    if (clientReason) { showAlert("This is the project's client", clientReason); return; }
    // Someone already active on this job is never re-invited: the invite
    // resets his row to 'pending' and he loses the project until he accepts
    // again. Point at the row's role picker instead.
    const typed = email.trim().toLowerCase();
    const active = collaborators.find((c) => c.status === 'accepted' && c.email.trim().toLowerCase() === typed);
    if (active) {
      showAlert(
        'Already on This Project',
        `${active.email} is already here as ${ROLE_LABELS[active.role] ?? active.role}. To change what they can see, use the role buttons on their row below. Sending a new invite would lock them out until they accept it again.`,
      );
      return;
    }
    // Role FIRST, tier second — see the header. Field invites are free at every
    // tier and must never be bounced to the paywall.
    if (isBillableSeat(inviteRole) && !canAccess('schedule_collaboration')) { router.push('/paywall'); return; }
    // Out of seats (or free tier). The edge function enforces the same limit
    // and would return 402, so route to the upgrade instead of firing a
    // request we know will fail.
    if (!seatPreview.allowed) {
      showAlert(
        'Your Team Is Full',
        `${seatPreview.message}\n\nField team members don't count toward it. If they only need the schedule, daily reports, photos and RFIs, invite them as Field.`,
        [
          { text: 'Not Now', style: 'cancel' },
          { text: 'See Plans', onPress: () => router.push('/paywall') },
        ],
      );
      return;
    }
    const send = () => {
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      invite.mutate(
        { email: email.trim().toLowerCase(), role: inviteRole },
        {
          onSuccess: (data) => {
            setLastLink(data?.link ?? null);
            setLastSend({ email: typed, sent: typeof data?.emailSent === 'boolean' ? data.emailSent : null });
            setEmail('');
            void seats.refetch();
          },
        },
      );
    };
    // Confirm before adding a billable seat. Silently charging for an invite is
    // exactly the surprise that makes people distrust per-seat pricing.
    if (seatPreview.bills) {
      showAlert(
        'This adds a paid team member',
        `${seatPreview.message}\n\nField access stays free. If they only need the schedule, daily reports and photos, invite them as Field instead.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: `Add team member · $${seatPreview.addedMonthlyUsd}/mo`, onPress: send },
        ],
      );
      return;
    }
    send();
  }, [validEmail, inviteBlocked, clientReason, canAccess, router, invite, email, inviteRole, seatPreview, seats, collaborators]);

  // Change an existing collaborator's role from the row picker.
  const requestRoleChange = useCallback((c: ProjectCollaborator, next: 'editor' | 'viewer' | 'field') => {
    if (c.role === next || changeRole.isPending) return;
    const label = ROLE_LABELS[next];
    const run = () => {
      if (Platform.OS !== 'web') void Haptics.selectionAsync();
      changeRole.mutate(
        { collaboratorId: c.id, role: next },
        {
          onSuccess: () => { void seats.refetch(); },
          onError: (err) => {
            console.warn('[Collaborators] role change failed:', rawErrorMessage(err));
            showAlert("Couldn't Change the Role", describeError(err, { action: 'change the role' }).body);
          },
        },
      );
    };
    // Field → Editor/Viewer is an UPGRADE into a paid seat. Same rules as an
    // invite (the server's changeRole runs the same seatCheck and would 402).
    // No /paywall push here — the invite gate is the one routing point.
    let seatLine = '';
    if (isBillableSeat(next) && !isBillableSeat(c.role)) {
      if (!canAccess('schedule_collaboration')) {
        showAlert(
          `${label} access is on the Pro plan`,
          `Editors and viewers count toward your team, which starts on Pro. ${c.email} can stay on Field for free, with the schedule, daily reports, photos and RFIs.`,
        );
        return;
      }
      const preview = seats.preview(next, c.email);
      if (!preview.allowed) {
        showAlert('Your Team Is Full', `${preview.message}\n\n${c.email} can stay on Field, which doesn't count toward your team.`);
        return;
      }
      if (preview.bills) seatLine = `\n\n${preview.message}`;
    }
    // Lifting financial blinding is the one move that needs a second look:
    // one mis-tap used to hand the crew the job's markup.
    if (isFinancialsBlinded(c.role) && !isFinancialsBlinded(next)) {
      showAlert(
        `Make ${c.email} ${next === 'editor' ? 'an' : 'a'} ${label}?`,
        `${label}s see costs, margins, the estimate and contract terms on this project.${seatLine}`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: `Make ${label}`, onPress: run },
        ],
      );
      return;
    }
    run();
  }, [changeRole, canAccess, seats]);

  const copyLink = useCallback(async () => {
    if (!lastLink) return;
    await Clipboard.setStringAsync(lastLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [lastLink]);

  // #95: removal asks first and names the cost of a mistake; a failure says the
  // person STILL has access, because the row staying put said nothing.
  const requestRevoke = useCallback((c: ProjectCollaborator) => {
    if (revoke.isPending) return;
    showAlert(
      `Remove ${c.email} from this project?`,
      "They lose access right away. To bring them back you'll have to send a new invite, and they'll have to accept it again.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            revoke.mutate(c.id, {
              onSuccess: () => { void seats.refetch(); },
              onError: (err) => showAlert(
                `Couldn't remove ${c.email}`,
                `${describeError(err, { action: 'remove them' }).body}\n\nThey still have access to this project.`,
              ),
            });
          },
        },
      ],
    );
  }, [revoke, seats]);

  // #177: copy a pending invite's CURRENT link, any time after sending it.
  const copyRowLink = useCallback((c: ProjectCollaborator) => {
    if (getLink.isPending) return;
    getLink.mutate(c.id, {
      onSuccess: async (data) => {
        if (!data?.link) return;
        await Clipboard.setStringAsync(data.link);
        setRowCopiedId(c.id);
        setTimeout(() => setRowCopiedId((cur) => (cur === c.id ? null : cur)), 1500);
      },
      onError: (err) => showAlert("Couldn't Get the Invite Link", describeError(err, { action: 'get the invite link' }).body),
    });
  }, [getLink]);

  return (
    <View style={{ gap: 12 }}>
      {/* Invite form — owner only */}
      {isOwner ? (
        <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.line }]}>
          <Text style={[styles.cardTitle, { color: t.text }]}>Invite a Team Member</Text>

          {/* Account-wide seat state. Field seats are shown alongside so the
              free-forever crew allowance is visible, not buried in pricing. */}
          {seats.status.included > 0 ? (
            <View
              style={[
                styles.seatBar,
                {
                  borderColor: seats.status.overage > 0 ? t.accent + '40' : t.line,
                  backgroundColor: seats.status.overage > 0 ? t.accentSoft : t.bg,
                },
              ]}
            >
              <Text style={[styles.seatBarText, { color: t.textSecondary }]}>
                <Text style={{ color: t.text, fontWeight: '700' }}>
                  {seats.status.used}/{seats.status.included}
                </Text>
                {' '}team members
                {seats.status.overage > 0
                  ? ` · ${seats.status.overage} extra · $${seats.status.overageMonthlyUsd}/mo`
                  : ''}
                {seats.counts.field > 0
                  ? ` · ${seats.counts.field} Field ${seats.counts.field === 1 ? 'member' : 'members'} (free)`
                  : ''}
              </Text>
            </View>
          ) : null}
          <View style={styles.inputRow}>
            <Mail size={16} color={t.textMuted} strokeWidth={1.75} />
            <TextInput
              style={[styles.input, { color: t.text }]}
              value={email}
              onChangeText={onEmailChange}
              placeholder="teammate@email.com"
              placeholderTextColor={t.textMuted}
              autoCapitalize="none"
              keyboardType="email-address"
              autoCorrect={false}
              testID="collab-email"
            />
          </View>
          <View style={styles.roleRow}>
            {(['editor', 'viewer', 'field'] as const).map((r) => (
              <TouchableOpacity
                key={r}
                onPress={() => setInviteRole(r)}
                style={[styles.roleChip, { borderColor: t.line }, inviteRole === r && { backgroundColor: t.accentSoft, borderColor: t.accent }]}
                accessibilityRole="button"
              >
                <Text style={[styles.roleChipText, { color: inviteRole === r ? t.accent : t.textSecondary }]}>
                  {ROLE_LABELS[r]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={[styles.roleHint, { color: t.textMuted }]}>{ROLE_DESCRIPTIONS[inviteRole]}</Text>
          {/* #176: the field promise stated at its real strength until the
              server withholds the legacy money columns (phase 2). */}
          {inviteRole === 'field' ? (
            <Text style={[styles.roleHint, { color: t.textMuted }]} testID="field-scope-note">{FIELD_ROLE_SCOPE_NOTE}</Text>
          ) : null}
          {/* Seat cost, stated before the invite is sent. */}
          <Text
            style={[styles.seatHint, { color: seatPreview.bills ? t.accentLabel : t.textMuted }]}
            testID="seat-preview"
          >
            {seatPreview.message}
          </Text>
          <TouchableOpacity
            onPress={onInvite}
            disabled={!validEmail || invite.isPending || !!inviteBlocked}
            // A client address dims Send but leaves it tappable: the tap
            // answers with the reason (onInvite), so the block is never silent.
            style={[styles.inviteBtn, { backgroundColor: t.accentFill }, (!validEmail || invite.isPending || !!inviteBlocked || !!clientReason) && { opacity: 0.5 }]}
            accessibilityRole="button"
            accessibilityState={{ disabled: !validEmail || invite.isPending || !!inviteBlocked }}
            accessibilityHint={inviteBlocked ?? clientReason ?? undefined}
            testID="collab-invite"
          >
            {invite.isPending ? <ActivityIndicator color="#FFF" /> : <UserPlus size={16} color="#FFF" strokeWidth={2} />}
            <Text style={styles.inviteBtnText}>Send Invite</Text>
          </TouchableOpacity>
          {/* #129: a blocked control says why. */}
          {inviteBlocked ? (
            <Text style={[styles.roleHint, { color: t.textSecondary }]} testID="collab-invite-blocked">{inviteBlocked}</Text>
          ) : null}
          {/* Phase 0 lane B: the client is refused with its reason and his
              real door, whether this device or the server spotted it. */}
          {clientReason ? (
            <View style={[styles.clientNote, { borderColor: t.line, backgroundColor: t.bg }]} testID="collab-client-refused">
              <ShieldAlert size={16} color={t.textSecondary} strokeWidth={1.75} />
              <Text style={[styles.clientNoteText, { color: t.text }]}>{clientReason}</Text>
            </View>
          ) : null}
          {/* The project-invite function answers in sentences written for the
              GC (the client refusal, the plan limit). Only text that reads as
              such a sentence is shown (readerSentence); a transport failure or
              a terse server note gets describeError copy instead. */}
          {invite.isError ? <Text style={[styles.errText, { color: t.danger }]}>{(classifyError(invite.error) === 'unknown' ? readerSentence(rawErrorMessage(invite.error)) : null) ?? describeError(invite.error, { action: 'send the invite' }).body}</Text> : null}
          {(clientReason || serverClientRefusal) ? (
            onOpenClientPortal ? (
              <Button label="Open the Client Portal" size="sm" variant="secondary" onPress={onOpenClientPortal} testID="collab-open-client-portal" />
            ) : (
              <Text style={[styles.roleHint, { color: t.textSecondary }]} testID="collab-client-portal-hint">
                Invite them from the Client portal tile on this project.
              </Text>
            )
          ) : null}
          {/* #177: say what happened to the email — never "Invited" alone. */}
          {lastSend ? (
            <Text
              style={[styles.sendStatus, { color: lastSend.sent === false ? t.danger : t.textSecondary }]}
              testID="invite-email-status"
            >
              {lastSend.sent === true
                ? `Emailed to ${lastSend.email}.`
                : lastSend.sent === false
                  ? `Email not sent to ${lastSend.email}. Copy the link below and send it yourself.`
                  : `Invite created for ${lastSend.email}. If the email doesn't arrive, copy the link below.`}
            </Text>
          ) : null}
          {lastLink ? (
            <TouchableOpacity onPress={copyLink} style={[styles.linkRow, { backgroundColor: t.accentSoft }]} accessibilityRole="button">
              {copied ? <Check size={14} color={t.success} strokeWidth={2} /> : <Copy size={14} color={t.accent} strokeWidth={2} />}
              <Text style={[styles.linkText, { color: t.accent }]} numberOfLines={1}>
                {copied ? 'Link Copied' : 'Copy Invite Link'}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {/* Roster. The scope adds nothing to the tree: with the feature off it
          is its children, and with it on it is the people read around them. */}
      <RosterPeopleScope projectId={projectId} roster={collaborators} rosterKnown={hasData} rosterFetching={isFetching} rosterReadAtMs={dataUpdatedAt} refetchRoster={refetch}>
      {view === 'loading' ? (
        <ActivityIndicator color={t.accent} />
      ) : view === 'error' || view === 'offline' ? (
        <View style={styles.rosterUnknown} testID={`collab-roster-${view}`}>
          <Text style={[styles.empty, { color: t.textSecondary }]}>{view === 'error' ? ROSTER_ERROR_LINE : ROSTER_OFFLINE_LINE}</Text>
          {view === 'error' ? (
            <Button label="Retry" size="sm" variant="secondary" onPress={refetch} testID="collab-roster-retry" />
          ) : null}
        </View>
      ) : view === 'empty' ? (
        <Text style={[styles.empty, { color: t.textMuted }]}>No team members yet{isOwner ? '. Invite your first above.' : '.'}</Text>
      ) : (
        collaborators.map((c) => (
          <View key={c.id} style={[styles.row, { borderColor: t.line }]}>
            <RosterRowAvatar c={c} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowEmail, { color: t.text }]} numberOfLines={1}>{c.email}</Text>
              <Text style={[styles.rowMeta, { color: t.textSecondary }]}>
                {ROLE_LABELS[c.role] ?? 'Owner'} · {c.status === 'accepted' ? (WHOS_ON_ENABLED ? 'Joined' : 'Active') : 'Invited'}
              </Text>
              <RosterRowLines c={c} />
              {isOwner && clientSeats.has(c.id) ? (
                <View style={[styles.clientNote, { borderColor: t.line, backgroundColor: t.bg, marginTop: 6 }]} testID={`collab-client-seat-${c.id}`}>
                  <ShieldAlert size={16} color={t.danger} strokeWidth={1.75} />
                  <View style={{ flex: 1, gap: 6 }}>
                    <Text style={[styles.clientNoteText, { color: t.text }]}>
                      {`${c.email} ${CLIENT_SOURCE_LINES[clientSeats.get(c.id)!]}. ${c.status === 'accepted' ? 'This person can see' : 'If accepted, this person would see'} ${c.role === 'field' ? "the crew's daily reports and hours" : "the project's costs, margins and labor"}. Remove them and share the client portal instead.`}
                    </Text>
                    <Button
                      label={`Remove ${c.email}`}
                      size="sm"
                      variant="secondary"
                      onPress={() => requestRevoke(c)}
                      disabled={revoke.isPending}
                      testID={`collab-client-seat-remove-${c.id}`}
                    />
                  </View>
                </View>
              ) : null}
              {/* Role picker — the invite form's chips, per row; the current
                  role is the filled chip. Under the address, not beside it:
                  three chips and the email do not fit one 375pt row. */}
              {isOwner ? (
              <View style={styles.rowRoles} accessibilityRole="radiogroup" accessibilityLabel={`Role for ${c.email}`}>
                {(['editor', 'viewer', 'field'] as const).map((r) => {
                  const current = c.role === r;
                  return (
                    <TouchableOpacity
                      key={r}
                      onPress={() => requestRoleChange(c, r)}
                      disabled={changeRole.isPending}
                      style={[styles.smallChip, { borderColor: t.line }, current && { backgroundColor: t.accentSoft, borderColor: t.accent }]}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: current, disabled: changeRole.isPending }}
                      accessibilityLabel={current ? `${ROLE_LABELS[r]}, current role` : `Make ${ROLE_LABELS[r]}`}
                      testID={`collab-role-${c.id}-${r}`}
                    >
                      <Text style={[styles.smallChipText, { color: current ? t.accent : t.textSecondary }]}>{ROLE_LABELS[r]}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              ) : null}
            </View>
            {isOwner && c.status === 'pending' ? (
              <TouchableOpacity
                onPress={() => copyRowLink(c)}
                disabled={getLink.isPending}
                hitSlop={10}
                style={styles.rowIconBtn}
                accessibilityRole="button"
                accessibilityLabel={rowCopiedId === c.id ? 'Invite Link Copied' : `Copy invite link for ${c.email}`}
                accessibilityHint="Copies the same link the email carried; it does not send a new one"
                testID={`collab-copy-link-${c.id}`}
              >
                {getLink.isPending && getLink.variables === c.id
                  ? <ActivityIndicator size="small" color={t.accent} />
                  : rowCopiedId === c.id
                    ? <Check size={16} color={t.success} strokeWidth={2} />
                    : <Link2 size={16} color={t.accent} strokeWidth={1.75} />}
              </TouchableOpacity>
            ) : null}
            {isOwner ? (
              revoke.isPending && revoke.variables === c.id ? (
                <View style={styles.rowIconBtn} accessibilityLabel={`Removing ${c.email}`}>
                  <ActivityIndicator size="small" color={t.danger} />
                </View>
              ) : (
                <TouchableOpacity
                  onPress={() => requestRevoke(c)}
                  disabled={revoke.isPending}
                  hitSlop={10}
                  style={[styles.rowIconBtn, revoke.isPending && { opacity: 0.4 }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${c.email}`}
                  accessibilityState={{ disabled: revoke.isPending }}
                  testID={`collab-revoke-${c.id}`}
                >
                  <Trash2 size={16} color={t.danger} strokeWidth={1.75} />
                </TouchableOpacity>
              )
            ) : null}
          </View>
        ))
      )}
      </RosterPeopleScope>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: Tokens.radius.card, padding: 14, gap: 10 },
  cardTitle: { fontSize: Type.footnote.fontSize, fontWeight: '800' },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: 'transparent', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: 'rgba(127,127,127,0.08)' },
  input: { flex: 1, fontSize: Type.subhead.fontSize },
  roleRow: { flexDirection: 'row', gap: 8 },
  roleChip: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 8, alignItems: 'center' },
  roleChipText: { fontSize: Type.caption1.fontSize, fontWeight: '700' },
  roleHint: { fontSize: Type.caption2.fontSize, lineHeight: 15 },
  seatHint: { fontSize: Type.caption2.fontSize, lineHeight: 15, marginTop: 4, fontWeight: '600' },
  seatBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: Tokens.radius.md, borderWidth: 1,
  },
  seatBarText: { flex: 1, fontSize: Type.caption1.fontSize, lineHeight: 16 },
  inviteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: Tokens.radius.lg, paddingVertical: 13 },
  inviteBtnText: { fontSize: Type.callout.fontSize, fontWeight: '800', color: '#FFF' },
  errText: { fontSize: Type.caption1.fontSize },
  clientNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderWidth: 1, borderRadius: Tokens.radius.md, padding: 10 },
  clientNoteText: { flex: 1, fontSize: Type.caption1.fontSize, lineHeight: 16 },
  sendStatus: { fontSize: Type.caption1.fontSize, lineHeight: 16, fontWeight: '600' },
  rowIconBtn: { minWidth: 28, minHeight: 28, alignItems: 'center', justifyContent: 'center' },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  linkText: { flex: 1, fontSize: Type.caption1.fontSize, fontWeight: '700' },
  empty: { fontSize: Type.subhead.fontSize, paddingVertical: 8 },
  rosterUnknown: { gap: 8, alignItems: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: Tokens.radius.card, padding: 12 },
  rowAvatar: { alignSelf: 'flex-start' },
  rowEmail: { fontSize: Type.subhead.fontSize, fontWeight: '700' },
  rowMeta: { fontSize: Type.caption1.fontSize, marginTop: 1 },
  rowRoles: { flexDirection: 'row', gap: 6, marginTop: 8 },
  smallChip: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 },
  smallChipText: { fontSize: Type.caption1.fontSize, fontWeight: '600' },
});

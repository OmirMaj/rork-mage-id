// safetyRefresh.ts — when SafetyContext re-reads the project-scoped safety
// tables, and the words the safety screens use for an invited crew seat.
//
// WHY THIS EXISTS (wave 4, audit #119 / #120 / #121 / #123). Pure and React-
// free so scripts/validate-w4-safety-*.ts can run it under bun.
//
//  #119 SafetyContext read the safety tables once per sign-in, so a foreman's
//       injury report never reached the GC's open app. refresh() now re-reads
//       on foreground / focus / pull-to-refresh; shouldRunSafetyRefresh is its
//       gate.
//  #120 On a crew seat the GC's crew cards come from useProjectCrew (a network
//       read with a saved copy). crewCardCheck says whether the lapsed-card
//       check actually ran, so a failed read never looks like "every card is
//       valid".
//  #121 A crew seat sees only the JHAs / talks / hazards he filed
//       (20260919130000). The crew notes say so.
//  #123 The three safety AI functions are Business-only on the server
//       (requireTier(['business'])). safetyAiBlockedReason gates the buttons on
//       the viewer's OWN tier, and aiLimitAlertTitle keeps "AI limit reached"
//       for a real cap.

/** The five project-scoped safety tables a refresh re-reads. Certifications
 *  and templates are company records of the signed-in user; nobody else
 *  writes them, so they are re-read only after this device's own flush. */
export const SAFETY_PROJECT_TABLES: readonly string[] = [
  'jhas', 'toolbox_talks', 'safety_incidents', 'hazards', 'safety_inspections',
];

/** Minimum gap between two automatic refreshes (focus and foreground often
 *  fire together, and web fires both AppState and visibilitychange). */
export const SAFETY_REFRESH_MIN_GAP_MS = 5_000;

export function shouldRunSafetyRefresh(o: {
  canSync: boolean;
  /** The first (mount) hydrate has landed — a refresh before it would race it. */
  hydrated: boolean;
  inFlight: boolean;
  lastAt: number | null;
  now: number;
  /** Pull-to-refresh: he asked, so the gap does not apply. */
  force?: boolean;
}): boolean {
  if (!o.canSync || !o.hydrated || o.inFlight) return false;
  if (o.force) return true;
  return o.lastAt == null || o.now - o.lastAt >= SAFETY_REFRESH_MIN_GAP_MS;
}

// ── #120: did the lapsed-card check run? ─────────────────────────────────
export type CrewCardCheck =
  /** Not a crew seat: his own crew and certifications, read locally. */
  | 'own'
  /** The GC's crew cards are loaded (fresh or the saved copy). */
  | 'ready'
  /** Still reading. */
  | 'loading'
  /** Nothing to check against: offline with no saved copy, or the read failed. */
  | 'unavailable';

export function crewCardCheck(o: {
  isCrewSeat: boolean;
  isLoading: boolean;
  /** When the list on screen was fetched (null = no list at all). */
  fetchedAt: string | null;
}): CrewCardCheck {
  if (!o.isCrewSeat) return 'own';
  if (o.fetchedAt) return 'ready';
  return o.isLoading ? 'loading' : 'unavailable';
}

export const CREW_CARDS_LOADING = "Loading the GC's crew cards…";
export const CREW_CARDS_UNAVAILABLE =
  "Couldn't load the GC's crew cards (offline?), so lapsed-card checks didn't run. Retry.";

// ── #121: what a crew seat sees ──────────────────────────────────────────
export type CrewNoteKind = 'jha' | 'toolbox' | 'hazard';

const NOUN: Record<CrewNoteKind, string> = { jha: 'JHAs', toolbox: 'toolbox talks', hazard: 'hazards' };

/** The one-line note on the JHA / toolbox / hazard list for an invited crew
 *  seat. Not the incident note's 1904.29 reasoning — these records carry no
 *  injury detail; the rule is simply that he reads what he filed. */
export function crewListNote(kind: CrewNoteKind): string {
  return `Your list shows only the ${NOUN[kind]} you filed. They go to the job's owner; the owner's own ${NOUN[kind]} aren't shown to invited crew.`;
}

/** Empty-state title for a crew seat, so an empty list doesn't read as
 *  "none exist on this job". */
export function crewEmptyTitle(kind: CrewNoteKind): string {
  return `You haven't filed any ${NOUN[kind]} on this job`;
}

// ── #123: the safety AI buttons ──────────────────────────────────────────
export type SafetyAiKind = 'hazard_scan' | 'incident_draft' | 'jha_generate';

/**
 * Why a safety AI button is disabled for this viewer, or null when his own
 * tier may use it. The server (safety-detect-hazards, safety-draft-incident,
 * safety-generate-jha) requires Business on the CALLER's own account — a GC's
 * plan does not carry AI to his invited crew — so Pro is not enough and the
 * copy never promises it is.
 */
export function safetyAiBlockedReason(kind: SafetyAiKind, ownTierIsBusinessOrAbove: boolean): string | null {
  if (ownTierIsBusinessOrAbove) return null;
  switch (kind) {
    case 'hazard_scan':
      return "AI hazard scan needs your own Business plan; your GC's plan doesn't cover it. Log the hazard by hand below — it still goes to the job's owner.";
    case 'incident_draft':
      return "Drafting with AI needs your own Business plan; your GC's plan doesn't cover it. Fill in the report below — it still goes to the job's owner.";
    case 'jha_generate':
      return "Generating a JHA with AI needs your own Business plan; your GC's plan doesn't cover it. Add the steps by hand below.";
  }
}

/** The server's 403 from requireTier, said the same way as the button. */
export function safetyAiServerRefusal(kind: SafetyAiKind, status: number): string | null {
  return status === 403 ? safetyAiBlockedReason(kind, false) : null;
}

/** Alert title for a refused checkAILimit: 'AI limit reached' only when a cap
 *  was actually used up; a tier block is a 'Business feature'. */
export function aiLimitAlertTitle(reason: string | undefined): string {
  return reason === 'daily_cap' || reason === 'smart_cap' || reason === 'lifetime_cap'
    ? 'AI limit reached'
    : 'Business feature';
}

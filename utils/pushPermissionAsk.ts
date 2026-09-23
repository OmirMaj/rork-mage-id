// utils/pushPermissionAsk.ts — when the app may raise the OS push-permission
// dialog, and when it must stay silent forever.
//
// WHY THIS EXISTS. The entire outbound stack addresses a device by the token on
// profiles.push_token: the notify edge function (and the notification_outbox
// rows it writes), morning-digest and bidQuestionsEngine. (invoice-dunning
// sends no pushes — it emails the CLIENT.) utils/notifications.ts only returns a token
// when permission is ALREADY granted unless the caller passes `prompt: true`,
// and for a long time the only caller that did was the toggle buried in
// app/notifications-settings.tsx. A user who never went looking for that toggle
// had no token, so every one of those senders had nobody to send to — the
// features were built, deployed and unreachable.
//
// The fix is not "prompt on launch". iOS grants an app exactly ONE system
// dialog; a denial is permanent until the user walks into Settings themselves.
// A cold prompt on first launch spends the only ask the app will ever get, at
// the moment the user has the least reason to say yes. So the ask happens once,
// at a moment where the value is already on screen, never during onboarding,
// and never a second time whatever the answer was.
//
// Pure: no React, no react-native, no storage. scripts/validate-activation-
// signals.ts drives it under bun. contexts/NotificationContext.tsx holds the
// one implementation of the decision — there is deliberately no second
// permission path in the app.

/** expo-notifications' getPermissionsAsync().status, narrowed to what the
 *  decision cares about. */
export type PushPermission = 'granted' | 'denied' | 'undetermined';

/** The moments an ask is allowed to be raised from. Each one is a point where
 *  the user has just produced something the app would later notify them ABOUT,
 *  so the dialog answers a question they are already holding.
 *
 *  The list is exported and the union is derived FROM it, so a moment added
 *  here is automatically covered by scripts/validate-activation-signals.ts.
 *  Written as a hardcoded literal in the validator instead, a new moment would
 *  ship with nothing checking that it has copy at all. */
export const PUSH_ASK_MOMENTS = ['estimate_shared', 'project_created'] as const;

export type PushAskMoment = typeof PUSH_ASK_MOMENTS[number];

export interface PushAskInput {
  /** Platform.OS. Web has no expo-notifications permission to ask for. */
  platform: string;
  /** ProjectContext.hasSeenOnboarding. `null` while it is still loading — an
   *  unknown onboarding state is never treated as "finished", because the one
   *  place this must not fire is inside first-run itself. */
  hasSeenOnboarding: boolean | null;
  signedIn: boolean;
  /** Has this device already been asked, in any session, with any outcome?
   *  Persisted, so a denial survives a relaunch. */
  alreadyAsked: boolean;
  permission: PushPermission;
  /** getPermissionsAsync().canAskAgain — false once iOS has spent the dialog. */
  canAskAgain: boolean;
}

export type PushAskDecision =
  | { ask: true; because: string }
  | {
      ask: false;
      because: string;
      /** Whether to write the "asked" record anyway, so this device stops
       *  re-evaluating. True only for the permanent answers: permission is
       *  already granted, or the OS will never show the dialog again. A
       *  transient no (still onboarding, signed out) must NOT be remembered or
       *  the user loses the ask forever over a race with a loading context. */
      remember: boolean;
    };

/**
 * The single decision. Order matters and is asserted by the validator:
 * onboarding and sign-in are checked BEFORE the already-asked latch, so a
 * first-run render can never be the thing that burns the one ask.
 */
export function decidePushAsk(input: PushAskInput): PushAskDecision {
  if (input.platform === 'web') {
    return { ask: false, because: 'web has no OS push permission to request', remember: false };
  }
  if (!input.signedIn) {
    return { ask: false, because: 'no signed-in user to attach a token to', remember: false };
  }
  if (input.hasSeenOnboarding !== true) {
    return { ask: false, because: 'onboarding is not finished', remember: false };
  }
  if (input.alreadyAsked) {
    return { ask: false, because: 'this device has already been asked once', remember: false };
  }
  if (input.permission === 'granted') {
    return { ask: false, because: 'permission is already granted — register the token silently', remember: true };
  }
  if (input.permission === 'denied' || !input.canAskAgain) {
    return { ask: false, because: 'the OS will not show the dialog again', remember: true };
  }
  return { ask: true, because: 'first ask, at a moment the value is on screen' };
}

/**
 * What "Notify me" actually turns on, one entry per notification the ask
 * names. Tapping it calls NotificationContext.enablePush() and NOTHING else —
 * it registers the device token; it switches no sender on. So a claim is
 * allowed here only if its push is ON BY DEFAULT once a token exists: each is a
 * notify edge-function event pushed to the GC through dispatchOne('gc', …),
 * gated by prefAllows(), which is true until he mutes that prefKey.
 *
 * Two claims were removed for being untrue (audit 2026-09-23 #132):
 *   • "plus a short brief each morning" — the brief is morning-digest, which
 *     only runs for profiles.digest_enabled = true, and that column defaults
 *     to false. Nothing in this flow sets it, so the promised brief never came.
 *   • "or lets an invoice go past due" — invoice-dunning emails the CLIENT;
 *     no sender pushes the GC when an invoice goes past due. It is replaced by
 *     the payment push that does exist (client_invoice_paid → prefKey
 *     invoice_paid).
 *
 * scripts/validate-w5-push-unsub-copy.ts builds every body's claim clause from
 * this list and checks each entry against notify's source, so a new claim
 * cannot ship without a sender that sends it by default.
 */
export const PUSH_ASK_CLAIMS = [
  { phrase: 'approves a change order', event: 'co_approval', prefKey: 'co_approval' },
  { phrase: 'sends a message from the portal', event: 'portal_message', prefKey: 'portal_message' },
  { phrase: 'pays an invoice', event: 'client_invoice_paid', prefKey: 'invoice_paid' },
] as const;

/** The three claims are examples, not the whole list: notify also pushes the
 *  GC by default for a signed contract, a sub's invoice, a selection, a punch
 *  item marked ready, a filed field report, bid questions, website leads and
 *  more (every dispatchOne('gc', …) gated only by prefAllows). The body used to
 *  say "Nothing else." after the three — as false as the brief it replaced
 *  (review of #132). This says what is true and where each one is muted. */
export const PUSH_ASK_OTHERS_NOTE = 'It also alerts you to other job events; you can mute any of them in Settings → Push & email preferences.';

/** The honest pointer to the brief: it exists, it is off, and this is where
 *  it is turned on (Settings → "Push & email preferences" → AI morning digest). */
export const PUSH_ASK_BRIEF_NOTE = 'A morning brief is off unless you turn it on in Settings → Push & email preferences.';

export interface PushAskCopy {
  title: string;
  /** What we would actually send — the PUSH_ASK_CLAIMS (examples, each a push
   *  that is on by default once the token is registered), the note that other
   *  job alerts come too and can be muted, and the brief note. The
   *  morning brief is NOT promised: "Notify me" doesn't turn it on (see
   *  PUSH_ASK_CLAIMS). Nothing here promises a notification the app will not
   *  produce. */
  body: string;
  /** The affirmative button. The soft ask is a real question, so the decline is
   *  free — declining costs the user nothing and costs us the OS dialog we
   *  never raised. */
  confirm: string;
  decline: string;
}

export const PUSH_ASK_COPY: Record<PushAskMoment, PushAskCopy> = {
  estimate_shared: {
    title: 'Want to know when they respond?',
    body: 'MAGE can notify you when a client approves a change order, sends a message from the portal, or pays an invoice. It also alerts you to other job events; you can mute any of them in Settings → Push & email preferences. A morning brief is off unless you turn it on in Settings → Push & email preferences.',
    confirm: 'Notify me',
    decline: 'Not now',
  },
  project_created: {
    title: 'Want this job to reach you?',
    body: 'MAGE can notify you when a client approves a change order, sends a message from the portal, or pays an invoice. It also alerts you to other job events; you can mute any of them in Settings → Push & email preferences. A morning brief is off unless you turn it on in Settings → Push & email preferences.',
    confirm: 'Notify me',
    decline: 'Not now',
  },
};

/**
 * Total, deliberately. A bare `COPY[moment]` returns undefined for anything
 * off the union, and the caller feeds the result straight into showAlert —
 * so the one push dialog a user ever gets would read "undefined", after the
 * once-only record had already been written. TypeScript makes that
 * unreachable today (Record<PushAskMoment, …> is exhaustive), but the record
 * is written before the copy is read and the cost of being wrong is
 * permanent.
 */
export function pushAskCopy(moment: PushAskMoment): PushAskCopy {
  return PUSH_ASK_COPY[moment] ?? PUSH_ASK_COPY.estimate_shared;
}

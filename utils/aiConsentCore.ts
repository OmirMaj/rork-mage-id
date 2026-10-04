// utils/aiConsentCore.ts — the one-time AI data-sharing permission, as pure
// logic (no react-native, no AsyncStorage import) so scripts/validate-ai-consent
// can run the real gate under bun with a fake storage and a fake transport.
//
// WHY THIS EXISTS. App Store guideline 5.1.2(i) (revised Nov 2025): an app must
// clearly disclose, and get the person's explicit permission, before it shares
// their personal data with a third-party AI. MAGE ID's AI features send what a
// contractor types or says, the project details he includes, and the photos,
// plan pages and recordings he picks to Google (Gemini), Anthropic (Claude) and
// a speech-to-text service — through our own Supabase functions, but the data
// still leaves for those vendors. Until this module, the only disclosure was the
// website privacy policy. Now every native AI entry point awaits
// ensureAiConsent() BEFORE its network call:
//   'granted'  → go ahead;
//   'declined' → refuse, with AI_CONSENT_OFF_MESSAGE (a blocked button says why);
//   'unknown'  → ask (components/AiConsentSheet.tsx, a system alert) and wait
//                for the answer, which is stored and is revocable in Settings →
//                AI features.
// The web app (app.mageid.app) is not an App Store surface: there the gate
// always answers true, shows nothing and stores nothing.
//
// THE ACCOUNT HEARS THE ANSWER. Two server paths use AI with no tap in the app
// (the Friday client recap and Ask Your Home), so the answer is also sent to
// the account (public.profiles.ai_consent, through utils/aiConsentAccount) and
// the server reads it there (supabase/functions/_shared/aiConsent.ts). This
// module only says WHEN the person answered (onAnswer); it never talks to the
// network, and a yes stored on the account is never copied onto a phone.
//
// WHERE THE GUARANTEE LIVES. components/AiConsentSheet is the "host": mounted once at the app
// root (app/_layout.tsx, pinned by scripts/validate-ai-consent.ts), it tells
// the gate how to ask and whether this is the web build. A stored "no" is
// honored everywhere. A runtime with NO host at all is not the app — a bun
// validator or a unit test that imports an AI util on its own — and there an
// unanswered gate lets the call through, so those suites keep exercising the
// util instead of every one of them stubbing this module.

export type AiConsentState = 'unknown' | 'granted' | 'declined';

/** Under an existing app prefix (utils/localCacheKeys APP_STORAGE_PREFIXES), so
 *  the tenant-switch sweep wipes it with the rest of the signed-in person's
 *  data: consent belongs to a person, not to the phone.
 *
 *  _v2 on purpose. The earlier key (the same name ending in _v1) is no longer
 *  read: an answer under it was given to a question that covered this app only,
 *  so everyone is asked once more, by the question that names the weekly client
 *  recap and Ask Your Home. No code reads or removes the old key; the tenant
 *  sweep removes it (it sits under the same prefix). */
export const AI_CONSENT_STORAGE_KEY = 'mageid_ai_consent_v2';

/** Who answered, when, and whether the account has heard it (utils/aiConsentAccount). Same
 *  prefix, so the tenant sweep wipes it with the answer. JSON: AiConsentMeta in
 *  utils/aiConsentSyncCore. */
export const AI_CONSENT_META_KEY = 'mageid_ai_consent_meta_v2';

/** The version of the question an answer under AI_CONSENT_STORAGE_KEY was given to. 2 = the
 *  first question that names the weekly client recap and Ask Your Home. The server refuses a
 *  yes below 2 (migration 20261004090000). Bump BOTH this and the key suffix together. */
export const AI_CONSENT_QUESTION_VERSION = 2;

/** The honest blocked message every refused AI request carries. */
export const AI_CONSENT_OFF_MESSAGE = 'AI features are off. Turn them on in Settings → AI features.';

/** Machine code on a refused request (mageAI's errorCode, edge-error codes). */
export const AI_CONSENT_DECLINED_CODE = 'ai_consent_declined';

export class AiConsentDeclinedError extends Error {
  readonly code = AI_CONSENT_DECLINED_CODE;
  constructor() {
    super(AI_CONSENT_OFF_MESSAGE);
    this.name = 'AiConsentDeclinedError';
  }
}

export function isAiConsentDeclinedError(e: unknown): e is AiConsentDeclinedError {
  return e instanceof AiConsentDeclinedError
    || (typeof e === 'object' && e !== null && (e as { code?: unknown }).code === AI_CONSENT_DECLINED_CODE);
}

/** True when a mageAI-shaped result is the consent refusal (mageAI returns
 *  { success:false, error: AI_CONSENT_OFF_MESSAGE, errorCode: AI_CONSENT_DECLINED_CODE }).
 *  A caller that writes its own failure words checks this FIRST, so the person
 *  reads why the button did nothing instead of "couldn't reach AI". */
export function isAiConsentRefusal(r: { errorCode?: string } | null | undefined): boolean {
  return !!r && r.errorCode === AI_CONSENT_DECLINED_CODE;
}

/** The honest sentence for a refused result, or null when it wasn't refused:
 *  `summary: aiConsentReason(res) ?? "Couldn't draft the schedule. Try again."` */
export function aiConsentReason(r: { errorCode?: string } | null | undefined): string | null {
  return isAiConsentRefusal(r) ? AI_CONSENT_OFF_MESSAGE : null;
}

/** The honest sentence when a CAUGHT error is the consent refusal — the typed
 *  AiConsentDeclinedError (requireAiConsent, the copilot capabilities) or a
 *  util's `throw new Error(res.error)` that carried mageAI's refusal — else
 *  null. describeError() reads neither (it would say "That didn't go through…
 *  try again"), so a catch that shows describeError copy checks this first:
 *  `setError(aiConsentErrorText(e) ?? describeError(e, { action }).body)`. */
export function aiConsentErrorText(e: unknown): string | null {
  if (isAiConsentDeclinedError(e)) return AI_CONSENT_OFF_MESSAGE;
  const msg = typeof e === 'object' && e !== null ? (e as { message?: unknown }).message : e;
  return typeof msg === 'string' && msg.trim() === AI_CONSENT_OFF_MESSAGE ? AI_CONSENT_OFF_MESSAGE : null;
}

/** The error a util THROWS for a failed mageAI result. A consent refusal is
 *  rethrown as the typed AiConsentDeclinedError (code ai_consent_declined), so
 *  every catch — and utils/errorCopy describeError, which reads the code —
 *  shows "AI features are off…" instead of "That didn't go through, try
 *  again". Anything else stays the plain Error it always was:
 *  `if (!aiResult.success) throw aiFailureError(aiResult, 'Weekly summary unavailable');` */
export function aiFailureError(r: { error?: string | null; errorCode?: string } | null | undefined, fallback: string): Error {
  return isAiConsentRefusal(r) ? new AiConsentDeclinedError() : new Error(r?.error || fallback);
}

/** What a stored value means. Anything unreadable is 'unknown' (ask again). */
export function parseAiConsent(raw: string | null | undefined): AiConsentState {
  return raw === 'granted' || raw === 'declined' ? raw : 'unknown';
}

export interface AiConsentStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface AiConsentDeps {
  storage: AiConsentStorage;
}

/** The mounted host (components/AiConsentSheet): how to ask, and whether this is the web build. */
export interface AiConsentHost {
  /** Asks the question; resolves true for "Allow AI features", false otherwise. */
  prompt: () => Promise<boolean>;
  /** True on the web app (react-native-web): never asks, always allowed. */
  isWeb: boolean;
}

export interface AiConsentGate {
  getState(): AiConsentState;
  /** Re-read the stored answer (storage is the truth when it can be read). */
  load(): Promise<AiConsentState>;
  subscribe(fn: (s: AiConsentState) => void): () => void;
  /** Fires only when the PERSON answers: the question, grant() or decline(). Never on a storage
   *  re-read, never on reset(). components/AiConsentAccountSync tells the account. */
  onAnswer(fn: (answer: 'granted' | 'declined') => void): () => void;
  grant(): Promise<void>;
  decline(): Promise<void>;
  reset(): Promise<void>;
  setHost(h: AiConsentHost | null): void;
  /** True when the request may go out. Never throws. */
  ensure(): Promise<boolean>;
  /** ensure(), but a refusal throws AiConsentDeclinedError. */
  require(): Promise<void>;
}

export function createAiConsentGate(deps: AiConsentDeps): AiConsentGate {
  let state: AiConsentState = 'unknown';
  let host: AiConsentHost | null = null;
  // Two AI calls racing on first use share ONE question and one answer.
  let pending: Promise<boolean> | null = null;
  const listeners = new Set<(s: AiConsentState) => void>();
  const answerListeners = new Set<(a: 'granted' | 'declined') => void>();

  const set = (s: AiConsentState) => {
    if (s === state) return;
    state = s;
    listeners.forEach((fn) => { try { fn(s); } catch { /* a listener never breaks the gate */ } });
  };

  const load = async (): Promise<AiConsentState> => {
    try {
      set(parseAiConsent(await deps.storage.getItem(AI_CONSENT_STORAGE_KEY)));
    } catch {
      // Unreadable storage: keep this session's answer (or 'unknown').
    }
    return state;
  };

  const store = async (s: AiConsentState) => {
    set(s);
    try {
      if (s === 'unknown') await deps.storage.removeItem(AI_CONSENT_STORAGE_KEY);
      else await deps.storage.setItem(AI_CONSENT_STORAGE_KEY, s);
    } catch {
      // The answer still holds for this session; it is asked again next launch.
    }
    // The person answered (never reset()). After the storage write, and not awaited: the gate
    // is never blocked by whoever listens (the account sync talks to the network).
    if (s !== 'unknown') answerListeners.forEach((fn) => { try { fn(s); } catch { /* a listener never breaks the gate */ } });
  };

  const ensure = async (): Promise<boolean> => {
    if (host?.isWeb) return true;
    const s = await load();
    // The host may register DURING that read: a mount-time call can start
    // before AiConsentSheet's own mount effect runs. Read it again, or the
    // web app would ask (and store) once.
    if (host?.isWeb) return true;
    if (s === 'granted') return true;
    if (s === 'declined') return false;
    if (pending) return pending;
    // No host: not the app (see the header). The app always has one.
    if (!host) return true;
    const ask = host.prompt;
    pending = (async () => {
      let yes = false;
      try { yes = (await ask()) === true; } catch { yes = false; }
      await store(yes ? 'granted' : 'declined');
      return yes;
    })();
    try {
      return await pending;
    } finally {
      pending = null;
    }
  };

  return {
    getState: () => state,
    load,
    subscribe(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    onAnswer(fn) {
      answerListeners.add(fn);
      return () => { answerListeners.delete(fn); };
    },
    grant: () => store('granted'),
    decline: () => store('declined'),
    reset: () => store('unknown'),
    setHost(h) { host = h; },
    ensure,
    async require() {
      if (!(await ensure())) throw new AiConsentDeclinedError();
    },
  };
}

// ── What the question says. Kept here so the validator reads the same words the
//    contractor reads. Providers come from the edge functions' outbound hosts:
//    generativelanguage.googleapis.com (ai, analyze-*, plan-extract, scan-*,
//    safety-*, import-schedule, compare-drawings, project-memory-* embeddings),
//    api.anthropic.com / @anthropic-ai/sdk (construction-answer, analyze-takeoff)
//    and toolkit.rork.com/stt (transcribe-audio, a relay: the model behind it
//    is not named in our code, so the question does not guess one). ─────────────

export const AI_CONSENT_PRIVACY_URL = 'https://mageid.app/privacy';

export const AI_CONSENT_COPY = {
  title: 'Use AI features?',
  intro: 'MAGE ID’s AI features send your request to outside AI services to get you an answer.',
  providersHeading: 'Who receives it',
  providers: [
    'Google Gemini (writing, estimates, schedules, photo and plan reading)',
    'Anthropic Claude (construction answers and takeoff)',
    'A speech-to-text service provided through Rork (turning voice notes into text)',
  ],
  sentHeading: 'What is sent',
  sent: [
    'What you type or say to an AI feature',
    'The project details you include, like scope, line items and schedule tasks',
    'Photos, plan pages and documents you choose to analyze',
    'Voice recordings you make for transcription',
  ],
  // The two server paths that use AI with no tap in the app. What each line
  // rests on: the recap prompt carries the job's name and location, up to seven
  // client-visible daily report texts and the completed task names
  // (supabase/functions/homeowner-weekly-digest buildAISummary); Ask Your Home
  // embeds the typed question and sends the matched Home Passport records
  // (supabase/functions/portal-ask-home).
  autoHeading: 'Sent automatically, with no tap from you, to Google Gemini',
  auto: [
    'For a weekly client recap you switch on for a job: that job’s name and location, the week’s daily report text and completed task names',
    'For Ask Your Home in the client portal: your client’s typed questions and the Home Passport records that match them',
  ],
  // The answer gates this app's own AI requests at once. It is also sent to the
  // account, where the server reads it before the weekly client recap and Ask
  // Your Home use AI (supabase/functions/_shared/aiConsent.ts). "from this app"
  // stays on purpose: the account hears the answer only when the phone is
  // online, so a bare "Nothing is sent" would claim more than this phone can
  // know at the moment of the answer.
  use: 'It is used only to answer that request or write that recap. Nothing is sent from this app until you allow it, and you can turn AI features off any time in Settings → AI features.',
  privacyLink: 'Privacy policy',
  allow: 'Allow AI features',
  notNow: 'Not now',
} as const;

/** Title for a blocked AI button's alert (the body is AI_CONSENT_OFF_MESSAGE). */
export const AI_CONSENT_OFF_TITLE = 'AI features are off';

/** Settings → AI features, with the switch Off. Every clause is a RULE, true in
 *  every state: (1) this app's own AI buttons send nothing while the switch is
 *  off (the gate above); (2) the two server features, the Friday recap
 *  (supabase/functions/homeowner-weekly-digest) and Ask Your Home
 *  (supabase/functions/portal-ask-home), follow the answer SAVED ON THE ACCOUNT
 *  (supabase/functions/_shared/aiConsent.ts), which this phone sends but which
 *  may not have arrived yet; (3) a personal Claude connection (Settings →
 *  Connect Claude, supabase/functions/mcp) is not gated by this answer. The row
 *  does not say the account was told, and must not: the line beneath it
 *  (components/AiAccountNote AiAccountSettingsLine) states what the account
 *  says whenever it could be read. */
export const AI_CONSENT_OFF_ROW =
  'AI buttons in this app send nothing to an AI provider until you turn this on. '
  + 'The weekly client recap and Ask Your Home run on our server and follow the answer saved on your account. '
  + 'A Claude connection you set up keeps working until you revoke it in Settings → Connect Claude.';

/** What the ACCOUNT says about AI, in words: the Client portal screen's note,
 *  the line under Settings → AI features, and the preview alert. The account's
 *  answer is what the server obeys for the weekly client recap and Ask Your
 *  Home; each sentence here is shown only in the state it describes
 *  (utils/aiConsentSyncCore portalAccountNote / settingsAccountLine). */
/** What the phone does about an answer the account has not heard, as far as the
 *  code goes (utils/aiConsentAccount): it sends again at every app start and
 *  foreground; while the app stays open a timer also sends again, waiting
 *  longer each time, but only when no answer came back (a send the server
 *  answered and did not take waits for the next open). The app cannot tell
 *  whether the phone has signal, and does not say so. */
const AI_ACCOUNT_TRIES_AGAIN =
  'This phone tries again each time you open the app. While the app stays open it also tries again when it got no answer, waiting longer each time.';

export const AI_ACCOUNT_COPY = {
  recapNote: 'Your account has not allowed AI for the weekly client recap and Ask Your Home. With the recap switched on, your client gets a plain summary: days on site, trades on site, milestones reached, and photo and change order counts. Ask Your Home does not answer questions your client types in the portal.',
  recapSubtitlePlain: 'We email your client a recap every Friday with what got done this week. Off until you toggle it on.',
  allow: 'Allow AI features',
  webOn: 'Your account allows AI for the weekly client recap and Ask Your Home, on every job you own.',
  turnOff: 'Turn off',
  settingsAlso: 'Your account also allows AI on our server for the weekly client recap and Ask Your Home, on jobs where you set them up.',
  settingsAllowed: 'Your account allows AI on our server for the weekly client recap and Ask Your Home.',
  settingsNotToldYet: `Your account has not been told yet, so the weekly client recap and Ask Your Home still use AI. ${AI_ACCOUNT_TRIES_AGAIN}`,
  yesNotTold: `You allowed AI on this phone, but your account has not been told yet. Until it has, a weekly client recap you switch on goes out as a plain summary with no AI, and Ask Your Home does not answer questions your client types in the portal. ${AI_ACCOUNT_TRIES_AGAIN}`,
  settingsNotAllowed: 'Your account has not allowed AI for the weekly client recap and Ask Your Home: a recap you switch on goes out as a plain summary with no AI, and Ask Your Home does not answer client questions.',
  turnOffForAccount: 'Turn off for my account',
  allowForAccount: 'Allow for my account',
  saveFailedTitle: 'Not saved',
  saveFailed: 'We could not reach your account, so nothing changed. Check your connection and try again.',
  previewSentPlain: (sent: number) => `Sent the recap to ${sent} portal ${sent === 1 ? 'invite' : 'invites'} as a plain summary with no AI, because your account has not allowed AI for the weekly client recap. Check your inbox or your client’s.`,
  previewSentUnchecked: (sent: number) => `Sent the recap to ${sent} portal ${sent === 1 ? 'invite' : 'invites'} as a plain summary with no AI, because we could not check your account’s AI setting just now. Check your inbox or your client’s.`,
} as const;

/** The WEB app's question, shown only by "Allow AI features" on a job's Client
 *  portal screen. Account-scoped: it covers the two server features and nothing
 *  else. It must contain neither "Nothing is sent from this app" nor "Settings →
 *  AI features": on the web the app's own AI buttons send regardless (the web
 *  gate always answers yes) and that Settings row does not exist there. */
export const AI_ACCOUNT_CONSENT_COPY = {
  title: 'Use AI for the weekly recap and Ask Your Home?',
  intro: 'Two client portal features run on our server and use an outside AI service, with no tap from you each time.',
  providersHeading: 'Who receives it',
  providers: ['Google Gemini'],
  sentHeading: 'What is sent',
  sent: AI_CONSENT_COPY.auto,
  use: 'It is used only to write that recap or answer that question. This answer covers the weekly client recap and Ask Your Home on every job you own. AI buttons in the web app are not changed by it. You can turn it off any time on a job’s Client portal screen.',
  privacyLink: 'Privacy policy',
  allow: 'Allow',
  notNow: 'Not now',
} as const;

/** The question's full text (components/AiConsentSheet shows it as the system
 *  alert's message; the Privacy policy button opens AI_CONSENT_PRIVACY_URL). */
export function aiConsentAlertMessage(): string {
  const c = AI_CONSENT_COPY;
  const list = (items: readonly string[]) => items.map((s) => `• ${s}`).join('\n');
  return [
    c.intro,
    `${c.providersHeading}:\n${list(c.providers)}`,
    `${c.sentHeading}:\n${list(c.sent)}`,
    `${c.autoHeading}:\n${list(c.auto)}`,
    c.use,
  ].join('\n\n');
}

/** The web question's full text: intro, who receives it, what is sent, use. */
export function aiAccountConsentAlertMessage(): string {
  const c = AI_ACCOUNT_CONSENT_COPY;
  const list = (items: readonly string[]) => items.map((s) => `• ${s}`).join('\n');
  return [
    c.intro,
    `${c.providersHeading}:\n${list(c.providers)}`,
    `${c.sentHeading}:\n${list(c.sent)}`,
    c.use,
  ].join('\n\n');
}

// ── Asking. The three answers are logic, not layout, so they live here where
//    scripts/validate-ai-consent.ts can press each one under bun with a fake
//    alert: "Allow AI features" is the ONLY yes. "Not now", a dismissed alert
//    and a second press are all no / ignored — a regression that turned one of
//    them into a silent grant is exactly what 5.1.2(i) forbids. ───────────────

export interface AiConsentAlertButton {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress: () => void;
}

/** The app's showAlert (utils/alert), or a fake in the validator. */
export type AiConsentShowAlert = (
  title: string,
  message: string,
  buttons: AiConsentAlertButton[],
  options: { cancelable: boolean; onDismiss: () => void },
) => void;

/** What one question shows: its title, its full text and its three answers. */
interface AiQuestionCopy {
  title: string;
  message: string;
  privacyLink: string;
  allow: string;
  notNow: string;
}

/** Shows a question and resolves with the answer: true only for its allow
 *  button. The policy button opens the policy and asks again (reading it is
 *  not an answer). Android has no tap-outside dismissal (cancelable: false);
 *  if the system dismisses the alert anyway, that is "not now". */
function askOnce(show: AiConsentShowAlert, openPolicy: () => void, copy: AiQuestionCopy): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const ask = (): void => {
      let settled = false;
      const done = (yes: boolean) => {
        if (settled) return;
        settled = true;
        resolve(yes);
      };
      show(
        copy.title,
        copy.message,
        [
          {
            text: copy.privacyLink,
            onPress: () => {
              if (settled) return;
              settled = true; // this alert is spent; the next one carries the answer
              try { openPolicy(); } catch { /* the question below still asks */ }
              ask();
            },
          },
          { text: copy.notNow, style: 'cancel', onPress: () => done(false) },
          { text: copy.allow, onPress: () => done(true) },
        ],
        { cancelable: false, onDismiss: () => done(false) },
      );
    };
    ask();
  });
}

/** Shows the phone's question and resolves with the answer: true only for
 *  "Allow AI features". "Privacy policy" opens the policy and asks again
 *  (reading it is not an answer); "Not now" and a dismissed alert are no. */
export function askAiConsentOnce(show: AiConsentShowAlert, openPolicy: () => void): Promise<boolean> {
  return askOnce(show, openPolicy, {
    title: AI_CONSENT_COPY.title,
    message: aiConsentAlertMessage(),
    privacyLink: AI_CONSENT_COPY.privacyLink,
    allow: AI_CONSENT_COPY.allow,
    notNow: AI_CONSENT_COPY.notNow,
  });
}

/** The web app's account question (AI_ACCOUNT_CONSENT_COPY), same three
 *  answers: only "Allow" is a yes. */
export function askAiAccountConsentOnce(show: AiConsentShowAlert, openPolicy: () => void): Promise<boolean> {
  return askOnce(show, openPolicy, {
    title: AI_ACCOUNT_CONSENT_COPY.title,
    message: aiAccountConsentAlertMessage(),
    privacyLink: AI_ACCOUNT_CONSENT_COPY.privacyLink,
    allow: AI_ACCOUNT_CONSENT_COPY.allow,
    notNow: AI_ACCOUNT_CONSENT_COPY.notNow,
  });
}

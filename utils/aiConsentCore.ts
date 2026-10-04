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
 *  data: consent belongs to a person, not to the phone. */
export const AI_CONSENT_STORAGE_KEY = 'mageid_ai_consent_v1';

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
  use: 'It is used only to answer that request. Nothing is sent until you allow it, and you can turn AI features off any time in Settings → AI features.',
  privacyLink: 'Privacy policy',
  allow: 'Allow AI features',
  notNow: 'Not now',
} as const;

/** Title for a blocked AI button's alert (the body is AI_CONSENT_OFF_MESSAGE). */
export const AI_CONSENT_OFF_TITLE = 'AI features are off';

/** The question's full text (components/AiConsentSheet shows it as the system
 *  alert's message; the Privacy policy button opens AI_CONSENT_PRIVACY_URL). */
export function aiConsentAlertMessage(): string {
  const c = AI_CONSENT_COPY;
  const list = (items: readonly string[]) => items.map((s) => `• ${s}`).join('\n');
  return [
    c.intro,
    `${c.providersHeading}:\n${list(c.providers)}`,
    `${c.sentHeading}:\n${list(c.sent)}`,
    c.use,
  ].join('\n\n');
}

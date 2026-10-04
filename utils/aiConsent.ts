// utils/aiConsent.ts — the app's one AI-consent gate (App Store 5.1.2(i)).
//
// The logic is utils/aiConsentCore.ts (pure, validated under bun); this file
// only wires it to AsyncStorage. Every native AI entry point calls
// ensureAiConsent() / requireAiConsent() BEFORE its network call — see
// scripts/validate-ai-consent.ts for the list it enforces. The question is
// asked by components/AiConsentSheet.tsx (a system alert), mounted once in app/_layout.tsx; it
// registers itself as the host (how to ask, and whether this is the web build,
// where the gate always says yes).
//
// No react-native import on purpose: ~50 bun validators import AI utils with
// react-native stubbed or absent, and a static import here would break every
// one of them. The host (a component) reads Platform and hands it over.
// For the same reason this file must NOT import utils/aiConsentAccount,
// lib/supabase or utils/offlineQueue: telling the account the answer is
// components/AiConsentAccountSync's job, which listens to subscribeAiConsentAnswer.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAiConsentGate, type AiConsentHost, type AiConsentState } from '@/utils/aiConsentCore';

export {
  AI_ACCOUNT_CONSENT_COPY,
  AI_ACCOUNT_COPY,
  AI_CONSENT_COPY,
  AI_CONSENT_DECLINED_CODE,
  AI_CONSENT_META_KEY,
  AI_CONSENT_OFF_MESSAGE,
  AI_CONSENT_OFF_ROW,
  AI_CONSENT_OFF_TITLE,
  AI_CONSENT_PRIVACY_URL,
  AI_CONSENT_QUESTION_VERSION,
  AI_CONSENT_STORAGE_KEY,
  AiConsentDeclinedError,
  aiAccountConsentAlertMessage,
  aiConsentAlertMessage,
  aiConsentErrorText,
  aiFailureError,
  aiConsentReason,
  askAiAccountConsentOnce,
  askAiConsentOnce,
  isAiConsentDeclinedError,
  isAiConsentRefusal,
  type AiConsentState,
} from '@/utils/aiConsentCore';

const gate = createAiConsentGate({ storage: AsyncStorage });

/** True when an AI request may go out (asks once on a phone). Never throws. */
export const ensureAiConsent = (): Promise<boolean> => gate.ensure();
/** ensureAiConsent(), but a refusal throws AiConsentDeclinedError. */
export const requireAiConsent = (): Promise<void> => gate.require();

export const getAiConsentState = (): AiConsentState => gate.getState();
export const loadAiConsent = (): Promise<AiConsentState> => gate.load();
export const subscribeAiConsent = (fn: (s: AiConsentState) => void): (() => void) => gate.subscribe(fn);
/** Fires only when the PERSON answers (the question, grant, decline); never on a re-read or a reset. */
export const subscribeAiConsentAnswer = (fn: (a: 'granted' | 'declined') => void): (() => void) => gate.onAnswer(fn);
export const grantAiConsent = (): Promise<void> => gate.grant();
export const declineAiConsent = (): Promise<void> => gate.decline();
export const resetAiConsent = (): Promise<void> => gate.reset();
/** components/AiConsentSheet.tsx registers here while mounted. */
export const setAiConsentHost = (h: AiConsentHost | null): void => gate.setHost(h);

/** The spec's names, as one object. */
export const aiConsent = {
  ensure: ensureAiConsent,
  require: requireAiConsent,
  getState: getAiConsentState,
  load: loadAiConsent,
  subscribe: subscribeAiConsent,
  onAnswer: subscribeAiConsentAnswer,
  grant: grantAiConsent,
  decline: declineAiConsent,
  reset: resetAiConsent,
};

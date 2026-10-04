// components/AiConsentAccountSync.tsx — tells the ACCOUNT the answer to "Use AI
// features?" and keeps trying until it has heard (App Store 5.1.2(i)).
//
// Mounted ONCE in app/_layout.tsx, inside AuthProvider, beside AiConsentSheet.
// The server reads the account's answer before the weekly client recap and Ask
// Your Home use AI (supabase/functions/_shared/aiConsent.ts). The phone is the
// queue (utils/aiConsentAccount): the stored answer plus a small record of who
// answered, when, and whether the account has heard it. This component only
// decides WHEN a run happens:
//   - the person answered on this phone (the gate's answer event);
//   - sign-in / app start;
//   - the app comes to the foreground;
//   - before sign-out (a no only: a yes is never rushed out on the way out);
//   - the phone's stored answer was wiped with no sign-in run (a same-user
//     magic-link or password-reset sign-in clears it and the user id does not
//     change): the same run, so Settings still says what the account says.
// A send that got NO ANSWER is tried again on a timer by utils/aiConsentAccount
// itself while the app stays open (30 s, 60 s, 120 s, then every 5 minutes); a
// send the server answered and did not take waits for the next start or
// foreground. There is deliberately no "back online" listener here: the app has
// no NetInfo, and react-query's onlineManager only hears the browser's
// online/offline events, so on an iPhone it never fires. The timer is the
// trigger that is real on a phone.
// On the web app the device holds no answer, so nothing is sent at start; the
// web's own writes are the two buttons on a job's Client portal screen.
//
// It never grants on the phone's gate: a yes on the account is never copied
// onto a phone. Renders nothing.

import { useEffect, useRef } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import { useAuth } from '@/contexts/AuthContext';
import { isSupabaseConfigured } from '@/lib/supabase';
import { showAlert } from '@/utils/alert';
import { AI_CONSENT_PRIVACY_URL, askAiAccountConsentOnce, loadAiConsent, subscribeAiConsent, subscribeAiConsentAnswer } from '@/utils/aiConsent';
import {
  noteAiAnswer,
  reconcileAiConsent,
  reconcileIfAiAnswerWiped,
  refreshAccountAiConsent,
  resetAccountAi,
  setAccountAiHost,
} from '@/utils/aiConsentAccount';
import { registerPreSignOutFlush } from '@/utils/preSignOutFlush';

/** The foreground re-read of the account happens at most this often. */
const REFRESH_MIN_GAP_MS = 60_000;
/** The pre-sign-out send never holds sign-out longer than this. */
const SIGN_OUT_SEND_MS = 4000;

const openPrivacyPolicy = (): void => {
  Linking.openURL(AI_CONSENT_PRIVACY_URL).catch(() => { /* the question comes back either way */ });
};

export function AiConsentAccountSync() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const userIdRef = useRef<string | null>(userId);
  userIdRef.current = userId;
  const lastRefreshRef = useRef(0);

  // A — the person answered on this phone.
  useEffect(() => subscribeAiConsentAnswer((answer) => {
    void noteAiAnswer(userIdRef.current, answer);
  }), []);

  // B — sign-in / app start: read the account, then send what it has not heard.
  useEffect(() => {
    resetAccountAi(userId);
    if (!userId || !isSupabaseConfigured) return;
    let cancelled = false;
    void (async () => {
      lastRefreshRef.current = Date.now();
      await refreshAccountAiConsent(userId);
      if (cancelled || userIdRef.current !== userId) return;
      await reconcileAiConsent(userId);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // C — keep trying: back in the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      const uid = userIdRef.current;
      if (state !== 'active' || !uid || !isSupabaseConfigured) return;
      void (async () => {
        // The phone's gate re-reads its stored answer first, so the screens and
        // this run look at the same one. An answer that was wiped while the app
        // was away is noticed here (F below then does the run for a wipe).
        await loadAiConsent();
        const now = Date.now();
        if (now - lastRefreshRef.current >= REFRESH_MIN_GAP_MS) {
          lastRefreshRef.current = now;
          await refreshAccountAiConsent(uid);
        }
        if (userIdRef.current !== uid) return;
        await reconcileAiConsent(uid);
      })();
    });
    return () => { sub.remove(); };
  }, []);

  // D — before sign-out: an undelivered no goes out first (never a yes).
  useEffect(() => registerPreSignOutFlush(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
      reconcileAiConsent(userIdRef.current, { onlyDeclined: true }),
      new Promise<void>((resolve) => { timer = setTimeout(resolve, SIGN_OUT_SEND_MS); }),
    ]).finally(() => { if (timer) clearTimeout(timer); });
  }), []);

  // F — the phone's answer went away with no answer event. A same-user
  // magic-link or password-reset sign-in wipes the stored answer and its record
  // while the user id stays the same, so B does not run again; without this
  // Settings would say nothing about the account until the next app start.
  // utils/aiConsentAccount does the run only when the record is gone too (a
  // wipe), not while the question is on screen. The gate notices at its next
  // read: an AI tap, a screen that mounts, or the foreground handler above.
  useEffect(() => subscribeAiConsent((state) => {
    if (state !== 'unknown' || !isSupabaseConfigured) return;
    void reconcileIfAiAnswerWiped(userIdRef.current);
  }), []);

  // E — how the web app asks its account-scoped question.
  useEffect(() => {
    setAccountAiHost({
      isWeb: Platform.OS === 'web',
      askAccount: () => askAiAccountConsentOnce(showAlert, openPrivacyPolicy),
    });
    return () => setAccountAiHost(null);
  }, []);

  return null;
}

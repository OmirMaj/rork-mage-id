// hooks/useAccountAi.ts — what the phone says and what the ACCOUNT says about
// AI, for the two places that show it: a job's Client portal screen and
// Settings → AI features. The server obeys the account's answer for the weekly
// client recap and Ask Your Home (supabase/functions/_shared/aiConsent.ts); the
// phone's own gate (utils/aiConsent) rules this app's AI buttons.
//
// The rules for what each screen says are pure (utils/aiConsentSyncCore
// portalAccountNote / settingsAccountLine, run under bun by
// scripts/validate-ai-consent-server.ts). This hook only feeds them.

import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { useAuth } from '@/contexts/AuthContext';
import { getAiConsentState, loadAiConsent, subscribeAiConsent, type AiConsentState } from '@/utils/aiConsent';
import { getAccountAiSnapshot, subscribeAccountAi, type AccountAiSnapshot } from '@/utils/aiConsentAccount';
import {
  portalAccountNote,
  settingsAccountLine,
  type AccountAiConsent,
  type AiAnswer,
} from '@/utils/aiConsentSyncCore';

export interface AccountAi {
  userId: string | null;
  /** This phone's own answer (the gate). */
  device: AiConsentState;
  /** What the account says, or why it could not be read. */
  account: AccountAiConsent | 'unread';
  /** The answer this phone still has to deliver to the account. */
  pending: AiAnswer | null;
  /** An attempt to deliver `pending` has failed, and none has succeeded since. */
  sendFailed: boolean;
  /** The phone answer `pending` was worked out from (null = not looked yet). */
  seen: AiConsentState | null;
  /** True only when the snapshot is for the signed-in person, a reconcile run
   *  has looked at this phone's answer, AND the phone's own answer has been
   *  loaded once: a note can never flash before the phone's answer is known. */
  ready: boolean;
}

export function useAccountAi(): AccountAi {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [device, setDevice] = useState<AiConsentState>(getAiConsentState);
  const [deviceLoaded, setDeviceLoaded] = useState(false);
  const [snap, setSnap] = useState<AccountAiSnapshot>(getAccountAiSnapshot);

  useEffect(() => {
    // No state update after unmount.
    let alive = true;
    const offDevice = subscribeAiConsent((s) => { if (alive) setDevice(s); });
    const offAccount = subscribeAccountAi(() => { if (alive) setSnap(getAccountAiSnapshot()); });
    setSnap(getAccountAiSnapshot());
    void loadAiConsent().then((s) => {
      if (!alive) return;
      setDevice(s);
      setDeviceLoaded(true);
    });
    return () => {
      alive = false;
      offDevice();
      offAccount();
    };
  }, []);

  return {
    userId,
    device,
    account: snap.account,
    pending: snap.pending,
    sendFailed: snap.sendFailed,
    seen: snap.seen,
    ready: deviceLoaded && snap.ready && snap.userId === userId,
  };
}

/** The note on a job's Client portal screen (owner only). */
export function usePortalAccountNote(owner: boolean): ReturnType<typeof portalAccountNote> & { userId: string | null } {
  const ai = useAccountAi();
  return {
    ...portalAccountNote({
      owner,
      isWeb: Platform.OS === 'web',
      ready: ai.ready,
      device: ai.device,
      account: ai.account,
      pending: ai.pending,
    }),
    userId: ai.userId,
  };
}

/** The line under Settings → AI features (phones). */
export function useSettingsAccountLine(): ReturnType<typeof settingsAccountLine> & { userId: string | null } {
  const ai = useAccountAi();
  return {
    ...settingsAccountLine({
      ready: ai.ready,
      device: ai.device,
      seen: ai.seen,
      account: ai.account,
      pending: ai.pending,
      sendFailed: ai.sendFailed,
    }),
    userId: ai.userId,
  };
}

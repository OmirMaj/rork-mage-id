// components/AiConsentSheet.tsx — the one-time "Use AI features?" question
// (App Store 5.1.2(i): say who receives the data and what is sent, and get
// explicit permission before sharing it with a third-party AI).
//
// Mounted ONCE in app/_layout.tsx. It registers itself as the host for
// utils/aiConsent: the first native AI request with no stored answer waits on
// this question; "Allow AI features" stores 'granted', "Not now" stores
// 'declined'. Both change any time in Settings → AI features. The web app
// never asks (the gate is always yes there).
//
// WHY A SYSTEM ALERT AND NOT A <Sheet>. Most AI buttons live inside a Modal or
// a modal route (the estimate wizard, project-detail's section sheets, the
// voice capture sheet). A Modal mounted here, at the root, presents from the
// root view controller (RCTModalHostViewComponentView -presentViewController:
// uses its own reactViewController), and UIKit refuses to present a second
// controller from one that is already presenting — the question would never
// appear and the AI button would wait on it forever. The system alert is
// presented from the TOPMOST controller, over any sheet, on iPhone and
// Android alike. The words are AI_CONSENT_COPY, the same ones the validator
// reads (utils/aiConsentCore.ts).
//
// Renders nothing.

import { useEffect } from 'react';
import { Linking, Platform } from 'react-native';
import { showAlert } from '@/utils/alert';
import { AI_CONSENT_COPY, AI_CONSENT_PRIVACY_URL, aiConsentAlertMessage, setAiConsentHost } from '@/utils/aiConsent';

function askOnce(resolve: (yes: boolean) => void): void {
  let settled = false;
  const done = (yes: boolean) => {
    if (settled) return;
    settled = true;
    resolve(yes);
  };
  showAlert(
    AI_CONSENT_COPY.title,
    aiConsentAlertMessage(),
    [
      {
        text: AI_CONSENT_COPY.privacyLink,
        onPress: () => {
          // Reading the policy is not an answer: the question comes back.
          settled = true;
          Linking.openURL(AI_CONSENT_PRIVACY_URL).catch(() => { /* the alert below still asks */ });
          askOnce(resolve);
        },
      },
      { text: AI_CONSENT_COPY.notNow, style: 'cancel', onPress: () => done(false) },
      { text: AI_CONSENT_COPY.allow, onPress: () => done(true) },
    ],
    // Android: no tap-outside dismissal — he answers one way or the other. If
    // the system dismisses it anyway, that is "not now".
    { cancelable: false, onDismiss: () => done(false) },
  );
}

export default function AiConsentSheet() {
  useEffect(() => {
    setAiConsentHost({
      isWeb: Platform.OS === 'web',
      prompt: () => new Promise<boolean>((resolve) => askOnce(resolve)),
    });
    return () => setAiConsentHost(null);
  }, []);
  return null;
}

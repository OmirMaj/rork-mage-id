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
// Android alike. The words AND the three answers are utils/aiConsentCore.ts
// (AI_CONSENT_COPY, askAiConsentOnce): pure logic, so scripts/validate-ai-consent
// presses each button under bun — only "Allow AI features" is a yes. This file
// hands that logic the app's alert and how to open the privacy policy.
//
// Renders nothing.

import { useEffect } from 'react';
import { Linking, Platform } from 'react-native';
import { showAlert } from '@/utils/alert';
import { AI_CONSENT_PRIVACY_URL, askAiConsentOnce, setAiConsentHost } from '@/utils/aiConsent';

const openPrivacyPolicy = (): void => {
  Linking.openURL(AI_CONSENT_PRIVACY_URL).catch(() => { /* the question comes back either way */ });
};

export default function AiConsentSheet() {
  useEffect(() => {
    setAiConsentHost({
      isWeb: Platform.OS === 'web',
      prompt: () => askAiConsentOnce(showAlert, openPrivacyPolicy),
    });
    return () => setAiConsentHost(null);
  }, []);
  return null;
}

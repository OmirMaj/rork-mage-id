// utils/prequalMail.ts — Q5 (founder: "what is prequal link?", 2026-09-24).
// The prequal invite, renewal and decision note all open the GC's mail app
// with a composed message. Nothing is sent until he taps Send there, and the
// link must never be lost when the mail app does not open.
//
// Behaviour is proven by __tests__/smoke/prequal-mail.test.tsx; wiring is
// pinned by scripts/validate-prequal-q5.ts.

import { Linking, Platform } from 'react-native';
import { copyToClipboard } from '@/utils/clipboard';
import { showAlert } from '@/utils/alert';

/**
 * Q5 (review r1): open the mail app with a composed message, and ALWAYS offer
 * the link. On react-native-web Linking.openURL resolves whenever window.open
 * does not throw — it cannot see whether any mail client took the mailto — so
 * on app.mageid.app the "opened" branch runs even when nothing opened. There
 * the alert says the mail app SHOULD open and hands over the link; on the
 * phone a resolved open means it did open, and the link is still one tap away.
 */
export async function composeMailOrOfferLink(p: {
  mailto: string;
  link: string;
  /** The open resolved. `nativeBody` may say it opened; `webBody` must not. */
  ready: { title: string; nativeBody: string; webBody: string };
  /** The open rejected: nothing went out, the link is the way forward. */
  failed: { title: string; body: string };
}): Promise<void> {
  const copyLink = { text: 'Copy link', onPress: () => { void copyToClipboard(p.link); } };
  let opened = true;
  try {
    await Linking.openURL(p.mailto);
  } catch {
    opened = false;
  }
  if (!opened) {
    showAlert(p.failed.title, p.failed.body, [{ text: 'Close', style: 'cancel' }, copyLink]);
    return;
  }
  showAlert(
    p.ready.title,
    Platform.OS === 'web' ? p.ready.webBody : p.ready.nativeBody,
    [{ text: 'Done', style: 'cancel' }, copyLink],
  );
}

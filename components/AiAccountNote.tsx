// components/AiAccountNote.tsx — what the ACCOUNT says about AI, where it
// matters to the contractor (App Store 5.1.2(i)).
//
// The weekly client recap and Ask Your Home run on our server and obey the
// answer stored on the account (supabase/functions/_shared/aiConsent.ts), not
// the answer on this phone. Two places say what that stored answer is, each
// only in the state it describes and only when the account could be read:
//   AiAccountNote          a job's Client portal screen, under "Send weekly
//                          recap": the account has not allowed AI (with "Allow
//                          AI features"), or, on the web app, it has (with
//                          "Turn off"). Owner only.
//   AiAccountSettingsLine  Settings → AI features (phones), the line beneath
//                          the row's own sentence.
// WHICH sentence shows is pure logic (utils/aiConsentSyncCore, run under bun by
// scripts/validate-ai-consent-server.ts); the words are AI_ACCOUNT_COPY
// (utils/aiConsentCore). "Allow" always shows a question first; it is never a
// silent grant.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/ui';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { usePortalAccountNote, useSettingsAccountLine } from '@/hooks/useAccountAi';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { AI_ACCOUNT_COPY } from '@/utils/aiConsent';
import { askAiConsentForAccount, turnOffAiForAccount } from '@/utils/aiConsentAccount';
import { showAlert } from '@/utils/alert';

/** Runs one account call at a time; a failure says so. No state update after unmount. */
function useAccountAction(userId: string | null): { busy: boolean; allow: () => void; turnOff: () => void } {
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const running = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const run = useCallback((call: () => Promise<boolean>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    void (async () => {
      let saved = false;
      try { saved = await call(); } catch { saved = false; }
      running.current = false;
      if (alive.current) setBusy(false);
      if (!saved) showAlert(AI_ACCOUNT_COPY.saveFailedTitle, AI_ACCOUNT_COPY.saveFailed);
    })();
  }, []);

  const allow = useCallback(() => {
    // 'not_allowed' is an answer (he said "Not now"), not a failure.
    run(async () => (await askAiConsentForAccount(userId)) !== 'failed');
  }, [run, userId]);
  const turnOff = useCallback(() => {
    run(() => turnOffAiForAccount(userId));
  }, [run, userId]);

  return { busy, allow, turnOff };
}

/** A job's Client portal screen: the note under "Send weekly recap". */
export function AiAccountNote({ owner }: { owner: boolean }) {
  const { note, action, userId } = usePortalAccountNote(owner);
  const { busy, allow, turnOff } = useAccountAction(userId);
  const styles = useThemedStyles(makeStyles);
  if (note === 'none') return null;
  return (
    <View style={styles.note} testID="ai-account-note">
      <Text style={styles.text}>
        {note === 'not_allowed' ? AI_ACCOUNT_COPY.recapNote : AI_ACCOUNT_COPY.webOn}
      </Text>
      {action === 'allow' ? (
        <Button
          label={AI_ACCOUNT_COPY.allow}
          onPress={allow}
          variant="secondary"
          size="sm"
          disabled={busy}
          containerStyle={styles.action}
          testID="ai-account-allow"
        />
      ) : action === 'turn_off' ? (
        <Button
          label={AI_ACCOUNT_COPY.turnOff}
          onPress={turnOff}
          variant="ghost"
          size="sm"
          disabled={busy}
          containerStyle={styles.action}
          testID="ai-account-turn-off"
        />
      ) : null}
    </View>
  );
}

const SETTINGS_LINE_TEXT = {
  also_allowed: AI_ACCOUNT_COPY.settingsAlso,
  allowed: AI_ACCOUNT_COPY.settingsAllowed,
  not_told_yet: AI_ACCOUNT_COPY.settingsNotToldYet,
  not_allowed: AI_ACCOUNT_COPY.settingsNotAllowed,
} as const;

/** Settings → AI features: the account's state, beneath the row's own sentence. */
export function AiAccountSettingsLine() {
  const { line, action, userId } = useSettingsAccountLine();
  const { busy, allow, turnOff } = useAccountAction(userId);
  const styles = useThemedStyles(makeStyles);
  if (line === 'none') return null;
  return (
    <View style={styles.settingsLine} testID="ai-account-settings-line">
      <Text style={styles.text}>{SETTINGS_LINE_TEXT[line]}</Text>
      {action === 'allow' ? (
        <Button
          label={AI_ACCOUNT_COPY.allowForAccount}
          onPress={allow}
          variant="secondary"
          size="sm"
          disabled={busy}
          containerStyle={styles.action}
          testID="ai-account-settings-action"
        />
      ) : action === 'turn_off' ? (
        <Button
          label={AI_ACCOUNT_COPY.turnOffForAccount}
          onPress={turnOff}
          variant="secondary"
          size="sm"
          disabled={busy}
          containerStyle={styles.action}
          testID="ai-account-settings-action"
        />
      ) : null}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  note: { marginTop: 10 },
  // Lines up with the row's own sentence (settings' sectionSubtext: 20 px in).
  settingsLine: { paddingHorizontal: 20, marginBottom: 10 },
  text: { fontSize: Type.footnote.fontSize, lineHeight: 18, color: t.textMuted },
  action: { alignSelf: 'flex-start', marginTop: 8 },
});

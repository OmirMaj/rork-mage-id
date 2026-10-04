// components/whoson/PresenceChoiceCard.tsx — the one-time question (whoson
// spec 1.4): "Show when you have a project open?"
//
// Until one of the two buttons is pressed the server stores nothing about this
// person and nobody sees a dot or a time for them. Either button calls
// set_share_presence; the card goes away when the next read carries the
// answer. A write that does not land says so and leaves the question up.
import React, { useCallback, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Card, Button } from '@/components/ui';
import { Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useOffline } from '@/hooks/useOnline';
import { useSharePresence } from '@/hooks/useSharePresence';
import { useWhosOnCopy } from '@/hooks/useWhosOnCopy';
import { WHOS_ON_ENABLED } from '@/constants/featureFlags';

function PresenceChoiceCardInner() {
  const styles = useThemedStyles(makeStyles);
  const copy = useWhosOnCopy();
  const { setChoice } = useSharePresence({ read: false });
  // The app has an offline signal on web only (hooks/useOnline.ts).
  const offlineNow = useOffline();
  const webOffline = Platform.OS === 'web' && offlineNow;
  const [busy, setBusy] = useState<'yes' | 'no' | null>(null);
  const [note, setNote] = useState<'failed' | 'offline' | null>(null);

  const answer = useCallback(async (value: boolean) => {
    if (busy) return;
    setBusy(value ? 'yes' : 'no');
    setNote(null);
    const result = await setChoice(value);
    setBusy(null);
    if (result === 'offline') setNote('offline');
    else if (result === 'failed') setNote('failed');
  }, [busy, setChoice]);

  const line = webOffline || note === 'offline' ? copy.shareOfflineWeb : note === 'failed' ? copy.shareFailed : null;
  return (
    <Card testID="whoson-choice" radius="card" pad={Tokens.spacing.sm} style={styles.card}>
      <Text style={styles.title} accessibilityRole="header">{copy.choiceTitle}</Text>
      <Text style={styles.body}>{copy.choiceBody}</Text>
      <View style={styles.actions}>
        <Button
          label={copy.choiceYes}
          size="sm"
          variant="primary"
          onPress={() => { void answer(true); }}
          loading={busy === 'yes'}
          disabled={webOffline || busy === 'no'}
          testID="whoson-choice-yes"
        />
        <Button
          label={copy.choiceNo}
          size="sm"
          variant="secondary"
          onPress={() => { void answer(false); }}
          loading={busy === 'no'}
          disabled={webOffline || busy === 'yes'}
          testID="whoson-choice-no"
        />
      </View>
      {line ? <Text style={styles.note} accessibilityLiveRegion="polite" testID="whoson-choice-note">{line}</Text> : null}
    </Card>
  );
}

export function PresenceChoiceCard() {
  if (!WHOS_ON_ENABLED) return null;
  return <PresenceChoiceCardInner />;
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  card: { gap: Tokens.spacing.xs },
  title: { ...Type.subheadEmphasized, color: t.text },
  body: { ...Type.footnote, color: t.textSecondary },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Tokens.spacing.xs, marginTop: Tokens.spacing.xxs },
  note: { ...Type.footnote, color: t.dangerLabel },
});

export default PresenceChoiceCard;

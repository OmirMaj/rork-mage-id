// components/whoson/SharePresenceSwitchRow.tsx — the switch behind the
// one-time question (whoson spec 1.4): "Show when I have a project open".
//
// `value` is the account's own choice as the server last said it: true, false,
// or null (not asked yet, which reads as off). Flipping it calls
// set_share_presence. The switch shows the new position while the write is on
// its way; a write that does not land puts it back and says
// "Couldn't save that. Try again."
//
// The app has an offline signal on web only (hooks/useOnline.ts: there is no
// NetInfo), so "Needs a connection." and the disabled switch are web-only. On
// an iPhone the switch is always enabled and the write itself answers.
import React, { useCallback, useEffect, useState } from 'react';
import { Platform, StyleSheet, Switch, Text, View } from 'react-native';
import { Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import type { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useOffline } from '@/hooks/useOnline';
import { useSharePresence } from '@/hooks/useSharePresence';
import { useWhosOnCopy } from '@/hooks/useWhosOnCopy';
import { WHOS_ON_ENABLED } from '@/constants/featureFlags';

export interface SharePresenceSwitchRowProps {
  value: boolean | null;
  /** Leading content (the Settings row's icon tile). */
  leading?: React.ReactNode;
  /** 'callout' matches a Settings row label; the Team section uses the smaller one. */
  labelSize?: 'callout' | 'subhead';
  testID?: string;
}

function SharePresenceSwitchRowInner({ value, leading, labelSize = 'subhead', testID = 'whoson-share-row' }: SharePresenceSwitchRowProps) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const copy = useWhosOnCopy();
  const { setChoice } = useSharePresence({ read: false });
  const offlineNow = useOffline();
  const webOffline = Platform.OS === 'web' && offlineNow;
  const [pending, setPending] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<'failed' | 'offline' | null>(null);

  // The server's answer arrived: it is the position now.
  useEffect(() => { setPending(null); }, [value]);

  const onChange = useCallback(async (next: boolean) => {
    if (saving) return;
    setSaving(true);
    setPending(next);
    setNote(null);
    const result = await setChoice(next);
    setSaving(false);
    if (result === 'saved') return;
    // Not saved: back to where it was.
    setPending(null);
    setNote(result === 'offline' ? 'offline' : 'failed');
  }, [saving, setChoice]);

  const shown = pending ?? (value === true);
  const line = webOffline || note === 'offline' ? copy.shareOfflineWeb : note === 'failed' ? copy.shareFailed : null;
  return (
    <View style={styles.row} testID={testID}>
      {leading}
      <View style={styles.textCol}>
        <Text style={labelSize === 'callout' ? styles.labelCallout : styles.label}>{copy.shareLabel}</Text>
        <Text style={styles.helper}>{copy.shareHelper}</Text>
        {line ? <Text style={styles.note} accessibilityLiveRegion="polite" testID="whoson-share-note">{line}</Text> : null}
      </View>
      <Switch
        value={shown}
        onValueChange={(next) => { void onChange(next); }}
        disabled={webOffline || saving}
        accessibilityLabel={copy.shareLabel}
        trackColor={{ false: colors.line, true: colors.accent }}
        thumbColor={colors.surface}
        ios_backgroundColor={colors.line}
        testID="whoson-share-switch"
      />
    </View>
  );
}

export function SharePresenceSwitchRow(props: SharePresenceSwitchRowProps) {
  if (!WHOS_ON_ENABLED) return null;
  return <SharePresenceSwitchRowInner {...props} />;
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.sm },
  textCol: { flex: 1, minWidth: 0, gap: Tokens.spacing.hairline },
  label: { ...Type.subheadEmphasized, color: t.text },
  labelCallout: { ...Type.callout, color: t.text },
  helper: { ...Type.caption1, color: t.textSecondary },
  note: { ...Type.caption1, color: t.dangerLabel },
});

export default SharePresenceSwitchRow;

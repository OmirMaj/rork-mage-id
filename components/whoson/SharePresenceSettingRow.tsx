// components/whoson/SharePresenceSettingRow.tsx — the same switch, as one row
// of Settings (the Legal group, after "Do not sell my info"; whoson spec 1.4).
//
// It carries its own separator, so the Settings screen adds one element and
// nothing else, and it returns null until the server has answered what this
// account chose: a row that guessed "off" for someone who said yes would be a
// lie about a privacy setting. With the feature off, or where the profile
// column cannot be read, there is no row at all (the Team section's switch
// still works; it reads through the people rows).
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Eye } from 'lucide-react-native';
import { Tokens } from '@/constants/designTokens';
import type { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useSharePresence } from '@/hooks/useSharePresence';
import { WHOS_ON_ENABLED } from '@/constants/featureFlags';
import { SharePresenceSwitchRow } from './SharePresenceSwitchRow';
import { WhosOnBoundary } from './WhosOnBoundary';

function SharePresenceSettingRowInner() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { choice, known } = useSharePresence();
  if (!known) return null;
  return (
    <View testID="whoson-setting">
      <View style={styles.separator} />
      <View style={styles.pad}>
        <SharePresenceSwitchRow
          value={choice}
          labelSize="callout"
          testID="whoson-setting-row"
          leading={(
            <View style={styles.iconWrap}>
              <Eye size={14} color={colors.textSecondary} strokeWidth={1.75} />
            </View>
          )}
        />
      </View>
    </View>
  );
}

export function SharePresenceSettingRow() {
  if (!WHOS_ON_ENABLED) return null;
  return <WhosOnBoundary><SharePresenceSettingRowInner /></WhosOnBoundary>;
}

// The numbers are the Settings screen's own row (app/(tabs)/settings/index.tsx
// `row`, `iconWrap`, `rowSeparator`), so this row sits in the group as one of them.
const makeStyles = (t: ThemeColors) => StyleSheet.create({
  separator: { height: 0.5, backgroundColor: t.line, marginLeft: 58 },
  pad: { paddingHorizontal: Tokens.spacing.md, paddingVertical: Tokens.spacing.sm, minHeight: 52, justifyContent: 'center' },
  iconWrap: {
    width: 30,
    height: 30,
    borderRadius: Tokens.radius.sm,
    backgroundColor: t.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default SharePresenceSettingRow;

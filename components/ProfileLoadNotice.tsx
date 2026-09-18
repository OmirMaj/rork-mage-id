// components/ProfileLoadNotice.tsx — what a company-profile screen shows
// INSTEAD of its form until his profile has loaded.
//
// WHY A WHOLE-SCREEN STAND-IN, NOT A DISABLED FORM (finding 14). Company
// Profile and Get Verified seed their fields once, at mount, from `settings`.
// Mounted before the load, every field was blank (DEFAULT_SETTINGS), and the
// state picker, logo, signature and Save each wrote a whole `branding` object
// built from those blanks — replacing his saved company name, contact, phone,
// address and licence with ''. Rendering the form only once the profile is in
// state means it is seeded from the real values, and there is no control to
// press in the window where they are unknown.
//
// Two states, said plainly (finding 105): still loading, or could not be
// loaded — with what still works and a Retry that re-reads it.

import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { CloudOff } from 'lucide-react-native';
import type { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useCoreData } from '@/contexts/ProjectContext';
import { Button } from '@/components/ui';
import { Type } from '@/constants/typography';
import { PROFILE_FAILED_REASON, PROFILE_FAILED_TITLE } from '@/utils/settingsLoadGuard';

export default function ProfileLoadNotice({ testID }: { testID?: string }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { settingsLoadFailed, sourceFailed, retryRemoteReads } = useCoreData();
  const failed = settingsLoadFailed || sourceFailed;

  if (!failed) {
    return (
      <View style={styles.wrap} testID={testID ?? 'profile-load-notice'} accessibilityLiveRegion="polite">
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.body}>Loading your company profile{'…'}</Text>
      </View>
    );
  }
  return (
    <View style={styles.wrap} testID={testID ?? 'profile-load-notice'} accessibilityLiveRegion="polite">
      <CloudOff size={28} color={colors.textSecondary} strokeWidth={1.75} />
      <Text style={styles.title}>{PROFILE_FAILED_TITLE}</Text>
      <Text style={styles.body}>{PROFILE_FAILED_REASON}</Text>
      <Button label="Retry" variant="secondary" onPress={retryRemoteReads} testID="profile-load-retry" />
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 14,
    backgroundColor: t.bg,
  },
  title: {
    ...Type.headline,
    color: t.text,
    textAlign: 'center',
  },
  body: {
    ...Type.subhead,
    color: t.textSecondary,
    textAlign: 'center',
  },
});

// trial-offer.tsx — "We offer 7 Days Free" beat. Frame 5 of the
// activation sequence (welcome → onboarding → feature → offer →
// reminder → design).
//
// Visual model: minimalist whitespace, headline with a green pill
// highlighting "7 Days Free", subhead, Continue button.
//
// Why a separate screen: the message "free for everyone" is not just
// a checkbox — it's a moment of trust-building before we surface the
// actual subscription terms on /trial-design. Roamy isolates this
// frame for the same reason.

import React from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Colors } from '@/constants/colors';
import { Type } from '@/constants/typography';

export default function TrialOfferScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const handleContinue = () => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
    router.push('/trial-reminder');
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 24 }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.brandRow}>
        <View style={styles.brandLogoBg}>
          <Text style={styles.brandLogo}>MAGE</Text>
        </View>
      </View>

      <View style={styles.copyWrap}>
        <Text style={styles.line}>We give you</Text>
        <View style={styles.pill}>
          <Text style={styles.pillText}>7 Days Free</Text>
        </View>
        <Text style={styles.lineLarge}>so every contractor</Text>
        <Text style={styles.lineLarge}>can try MAGE ID</Text>
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          style={styles.continueBtn}
          onPress={handleContinue}
          activeOpacity={0.9}
          accessibilityRole="button"
          testID="trial-offer-continue"
        >
          <Text style={styles.continueBtnText}>Continue</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, paddingHorizontal: 24 },

  brandRow: { alignItems: 'center' as const },
  brandLogoBg: { backgroundColor: Colors.surfaceAlt, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 14 },
  brandLogo: { fontSize: 18, fontWeight: '900' as const, color: Colors.text, letterSpacing: -0.5 },

  copyWrap: { flex: 1, justifyContent: 'center' as const, alignItems: 'center' as const, gap: 6 },
  line: { fontSize: 28, fontWeight: '800' as const, color: Colors.text, textAlign: 'center' as const, letterSpacing: -0.6 },
  lineLarge: { fontSize: 28, fontWeight: '800' as const, color: Colors.text, textAlign: 'center' as const, letterSpacing: -0.6 },
  pill: {
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: '#22C55E',
    marginVertical: 14,
    shadowColor: '#22C55E',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 4,
    borderWidth: 4,
    borderColor: 'rgba(34,197,94,0.18)',
  },
  pillText: { fontSize: 28, fontWeight: '800' as const, color: Colors.surface, letterSpacing: -0.6 },

  footer: { paddingTop: 12 },
  continueBtn: { minHeight: 56, borderRadius: 999, backgroundColor: Colors.primary, alignItems: 'center' as const, justifyContent: 'center' as const },
  continueBtnText: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: Colors.textOnPrimary },
});

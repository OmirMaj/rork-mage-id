// trial-feature.tsx — Roamy-style "Plan Trips Stress Free" feature
// highlight, transposed for MAGE ID. Frame 4 of the 4-screen activation
// sequence (welcome → onboarding → feature → trial-offer →
// trial-reminder → trial-design).
//
// Visual model: a phone-in-frame mockup of one of MAGE ID's hero
// screens (Create Project), with title + tagline below + a Continue
// button that advances to /trial-offer.
//
// Why a separate screen vs. an in-line carousel page on /onboarding:
//   The existing /onboarding has its own 9-step pre-RC slot-fill
//   carousel. This screen is the single visual "here's what the app
//   does" beat that lands AFTER the user has signed in but BEFORE we
//   pitch the trial. Keeps the trial funnel tight and self-contained.

import React from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Platform, Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Search, Calendar, X, HelpCircle, Briefcase } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

export default function TrialFeatureScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const handleContinue = () => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
    router.push('/trial-offer');
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <LinearGradient
        colors={['#A6D7F2', '#C9E6F5', '#E8F2F9']}
        style={StyleSheet.absoluteFill}
      />

      <View style={[styles.frameWrap, { marginTop: insets.top + 32 }]}>
        {/* Phone bezel — Roamy-style. We render a single device-shaped
            container with rounded corners + side buttons, then the
            "screen" content as a child. This is a static mockup,
            not a live preview, so we keep it simple. */}
        <View style={styles.phoneFrame}>
          <View style={styles.phoneNotch} />
          <View style={styles.phoneScreen}>
            {/* Mocked Create-Trip-style header */}
            <View style={styles.mockHeader}>
              <Text style={styles.mockHeaderTime}>9:41</Text>
              <View style={styles.mockHeaderRight} />
            </View>
            <View style={styles.mockTitleRow}>
              <View style={styles.mockIconBtn}><X size={16} color={Colors.text} /></View>
              <Text style={styles.mockTitle}>Create Project</Text>
              <View style={styles.mockIconBtn}><HelpCircle size={16} color={Colors.text} /></View>
            </View>

            {/* Hero illustration — uses an emoji-rich panel like Roamy's
                palm + suitcase. We can swap to a 3D-rendered asset
                later; for now an emoji row keeps the bundle small. */}
            <View style={styles.heroIllo}>
              <View style={styles.heroBubbleLeft}>
                <Text style={styles.heroBubbleText}>¡Listo!</Text>
              </View>
              <Text style={styles.heroEmoji}>🏗️</Text>
              <View style={styles.heroBubbleRight}>
                <Text style={styles.heroBubbleText}>Let&apos;s go</Text>
              </View>
            </View>
            <Text style={styles.mockH1}>Spin up a project in 60s</Text>
            <Text style={styles.mockH2}>Add the address, pick a start date, and we&apos;ll prep the schedule + estimate.</Text>

            <View style={styles.mockField}>
              <Text style={styles.mockFieldLabel}>Project address</Text>
              <View style={styles.mockFieldInput}>
                <Search size={14} color={Colors.textMuted} />
                <Text style={styles.mockFieldPlaceholder}>Search address or APN</Text>
              </View>
            </View>
            <View style={styles.mockFieldRow}>
              <Briefcase size={14} color={Colors.textMuted} />
              <Text style={styles.mockFieldRowLabel}>Start date</Text>
              <View style={{ flex: 1 }} />
              <Text style={styles.mockFieldRowValue}>Add</Text>
              <Calendar size={14} color={Colors.primary} />
            </View>
          </View>
        </View>
      </View>

      <View style={[styles.copyWrap, { paddingBottom: insets.bottom + 28 }]}>
        <Text style={styles.title}>Run jobs stress-free</Text>
        <Text style={styles.subtitle}>You handle the work.{'\n'}We&apos;ll handle the paper.</Text>

        <TouchableOpacity
          style={styles.continueBtn}
          onPress={handleContinue}
          activeOpacity={0.9}
          accessibilityRole="button"
          testID="trial-feature-continue"
        >
          <Text style={styles.continueBtnText}>Continue</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#A6D7F2' },

  frameWrap: { alignItems: 'center' as const, paddingHorizontal: 16 },

  phoneFrame: {
    width: 290,
    height: 580,
    borderRadius: 48,
    backgroundColor: '#0F0F12',
    padding: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.22,
    shadowRadius: 28,
    elevation: 12,
  },
  phoneNotch: {
    position: 'absolute' as const,
    top: 14,
    alignSelf: 'center' as const,
    width: 110,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#0F0F12',
    zIndex: 2,
  },
  phoneScreen: {
    flex: 1,
    borderRadius: 40,
    backgroundColor: '#F0FAF4',
    padding: 16,
    overflow: 'hidden' as const,
  },

  mockHeader: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, paddingTop: 8, paddingHorizontal: 8 },
  mockHeaderTime: { fontSize: 12, fontWeight: '700' as const, color: Colors.text },
  mockHeaderRight: { width: 60, height: 12, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.06)' },

  mockTitleRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginTop: 24 },
  mockIconBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.06)', alignItems: 'center' as const, justifyContent: 'center' as const },
  mockTitle: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },

  heroIllo: { alignItems: 'center' as const, justifyContent: 'center' as const, marginTop: 12, height: 130, position: 'relative' as const },
  heroEmoji: { fontSize: 80 },
  heroBubbleLeft: { position: 'absolute' as const, left: 6, top: 22, backgroundColor: Colors.surface, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 4 },
  heroBubbleRight: { position: 'absolute' as const, right: 6, top: 56, backgroundColor: Colors.surface, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 4 },
  heroBubbleText: { fontSize: 11, fontWeight: '700' as const, color: Colors.text },

  mockH1: { fontSize: 18, fontWeight: '900' as const, color: Colors.text, textAlign: 'center' as const, marginTop: 4, letterSpacing: -0.4 },
  mockH2: { fontSize: 11, color: Colors.textMuted, textAlign: 'center' as const, marginTop: 4, lineHeight: 14 },

  mockField: { marginTop: 14, padding: 10, backgroundColor: Colors.surface, borderRadius: 12 },
  mockFieldLabel: { fontSize: 12, fontWeight: '800' as const, color: Colors.text, marginBottom: 6 },
  mockFieldInput: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, padding: 10, borderRadius: 10, backgroundColor: Colors.background },
  mockFieldPlaceholder: { fontSize: 11, color: Colors.textMuted },

  mockFieldRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, paddingHorizontal: 10, paddingVertical: 12, marginTop: 8, backgroundColor: Colors.surface, borderRadius: 12 },
  mockFieldRowLabel: { fontSize: 11, fontWeight: '700' as const, color: Colors.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.4 },
  mockFieldRowValue: { fontSize: 11, fontWeight: '700' as const, color: Colors.primary },

  copyWrap: { paddingHorizontal: 24, paddingTop: 24, marginTop: 'auto' as const },
  title: { fontSize: 26, fontWeight: '900' as const, color: Colors.text, textAlign: 'center' as const, letterSpacing: -0.7 },
  subtitle: { fontSize: Type.bodyCompact.fontSize, color: Colors.textSecondary, textAlign: 'center' as const, marginTop: 6, lineHeight: 22 },

  continueBtn: { marginTop: 22, minHeight: 56, borderRadius: 999, backgroundColor: Colors.primary, alignItems: 'center' as const, justifyContent: 'center' as const, shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 10, elevation: 4 },
  continueBtnText: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: Colors.textOnPrimary, letterSpacing: -0.2 },
});

void Tokens;
void Image;

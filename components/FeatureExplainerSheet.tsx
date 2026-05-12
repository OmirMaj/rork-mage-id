// FeatureExplainerSheet — the "what is this term?" half-sheet.
//
// Triggered by the (?) chip in <FeatureHeader>. Opens a bottom sheet
// containing:
//   - the formal/industry term + its definition
//   - 2-3 bullet points on "when you'd use this"
//   - optional 30-second video link (CompanyCam / MobiKwik pattern)
//   - optional "Open the tour" deep-link into Tutorial.tsx
//
// Renders as a Modal with a slide-up animation rather than a full nav
// push — modal sheets are the iOS-native pattern for incidental
// information that shouldn't take the user off the current screen
// (Stripe / Apple Maps / Files all use this).

import React, { memo } from 'react';
import {
  Modal, View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Linking, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, ExternalLink, PlayCircle } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

export interface FeatureExplainerSheetProps {
  /** Modal visibility — managed by parent (FeatureHeader handles it). */
  visible: boolean;
  /** Close callback. */
  onClose: () => void;
  /** Industry term being explained, e.g. "Lien Waiver". */
  term: string;
  /** Plain-English definition (1-2 sentences). */
  definition: string;
  /** "When you'd use this" bullets — 2-4 ideal. */
  whenToUse?: string[];
  /** Optional URL to a 30-60s explainer video. */
  videoUrl?: string;
  /** Optional "Open the tour" deep-link target (Tutorial step key). */
  tourStepKey?: string;
  /** Called when user taps the tour CTA. Pass tourStepKey along. */
  onOpenTour?: (stepKey: string) => void;
}

function FeatureExplainerSheetImpl({
  visible,
  onClose,
  term,
  definition,
  whenToUse,
  videoUrl,
  tourStepKey,
  onOpenTour,
}: FeatureExplainerSheetProps) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();

  const handleVideo = () => {
    if (!videoUrl) return;
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    void Linking.openURL(videoUrl);
  };

  const handleTour = () => {
    if (!tourStepKey || !onOpenTour) return;
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    onClose();
    // Defer to next tick so the modal animation completes before the
    // tour modal opens — iOS can't present two modals simultaneously.
    setTimeout(() => onOpenTour(tourStepKey), 320);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <TouchableOpacity
        style={styles.backdrop}
        activeOpacity={1}
        onPress={onClose}
      />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.handle} />

        <View style={styles.header}>
          <Text style={[Type.eyebrow, { color: themeColors.accent }]}>What is this?</Text>
          <TouchableOpacity
            onPress={onClose}
            style={styles.closeBtn}
            activeOpacity={0.7}
            testID="feature-explainer-close" accessibilityRole="button" accessibilityLabel="Close"><X size={18} color={themeColors.text} /></TouchableOpacity>
        </View>

        <ScrollView
          style={{ maxHeight: '70%' as any }}
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
        >
          <Text style={[Type.title2, { color: themeColors.text, marginBottom: 8 }]}>{term}</Text>
          <Text style={[Type.body, { color: themeColors.textSecondary, marginBottom: 16 }]}>
            {definition}
          </Text>

          {whenToUse && whenToUse.length > 0 && (
            <View style={styles.bullets}>
              <Text style={[Type.subheadEmphasized, { color: themeColors.text, marginBottom: 8 }]}>
                When you&apos;d use this
              </Text>
              {whenToUse.map((b, i) => (
                <View key={i} style={styles.bulletRow}>
                  <View style={styles.bulletDot} />
                  <Text style={[Type.subhead, { color: themeColors.textSecondary, flex: 1 }]}>
                    {b}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {videoUrl && (
            <TouchableOpacity
              onPress={handleVideo}
              style={styles.actionRow}
              activeOpacity={0.7}
              testID="feature-explainer-video"
            >
              <PlayCircle size={18} color={themeColors.accent} />
              <Text style={[Type.subheadEmphasized, { color: themeColors.accent, flex: 1 }]}>
                Watch a 30-second example
              </Text>
              <ExternalLink size={14} color={themeColors.textMuted} />
            </TouchableOpacity>
          )}

          {tourStepKey && onOpenTour && (
            <TouchableOpacity
              onPress={handleTour}
              style={styles.actionRow}
              activeOpacity={0.7}
              testID="feature-explainer-tour"
            >
              <PlayCircle size={18} color={themeColors.accent} />
              <Text style={[Type.subheadEmphasized, { color: themeColors.accent, flex: 1 }]}>
                Walk me through it
              </Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

export const FeatureExplainerSheet = memo(FeatureExplainerSheetImpl);

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    backgroundColor: t.surface,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  handle: {
    alignSelf: 'center',
    width: 36, height: 5,
    borderRadius: 3,
    backgroundColor: t.line,
    marginBottom: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  closeBtn: {
    width: 32, height: 32, borderRadius: Tokens.radius.panel,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.surfaceAlt,
  },
  body: {
    paddingTop: 14,
    paddingBottom: 8,
  },
  bullets: { marginBottom: 18 },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 8,
  },
  bulletDot: {
    width: 5, height: 5, borderRadius: 3,
    backgroundColor: t.accent,
    marginTop: 9,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: Tokens.radius.card,
    backgroundColor: t.accent + '0E',
    marginBottom: 8,
  },
});

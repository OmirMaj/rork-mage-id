// DemoSeedPickerModal — half-sheet that lets a brand-new user pick which
// sample project to load. Two cards by default — Small (~$420K) and
// Large (~$14M) — so they can see whichever maps to their real work.
// Medium (Henderson) is preserved as a hidden third option but isn't
// surfaced in the picker; it's the legacy default for anyone calling
// `seedDemoProject` without a flavor.
//
// Renders nothing when not visible. Tap a card → fires onPick(flavor)
// which the parent uses to invoke `seedDemoProject({ ..., flavor })`.

import React, { memo, useCallback } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { X, ChevronRight, HardHat, Building2, Sparkles } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { DEMO_FLAVORS, type DemoFlavor } from '@/utils/demoSeed';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

export interface DemoSeedPickerModalProps {
  visible: boolean;
  onClose: () => void;
  onPick: (flavor: DemoFlavor) => void;
  /** Whether to surface the medium ("Henderson") flavor in the picker.
   *  Off by default — keeps the new-user choice clean to two options. */
  showMedium?: boolean;
}

/** Map flavor → icon + accent color for the card grid. */
const FLAVOR_VISUAL: Record<DemoFlavor, {
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  accent: string;
  pitch: string;
  bullets: string[];
}> = {
  small: {
    Icon: HardHat,
    accent: Colors.success,
    pitch: 'Bread-and-butter residential remodel. Solo operator or small crew.',
    bullets: [
      '2 invoices, 4 daily reports',
      '6 punch items mid-project',
      '2 RFIs, 1 change order',
      '8 photos across the timeline',
    ],
  },
  medium: {
    Icon: Sparkles,
    accent: Colors.primary,
    pitch: 'Premium full-gut renovation. Architect-led, multi-trade.',
    bullets: [
      '3 invoices, 3 daily reports',
      '3 punch items mid-project',
      '2 RFIs, 1 change order',
      '5 photos across the timeline',
    ],
  },
  large: {
    Icon: Building2,
    accent: Colors.warning,
    pitch: 'Ground-up multi-unit condo. AIA pay-app cadence, deep buyout, big crew.',
    bullets: [
      '6 invoices on AIA cadence ($8.6M billed)',
      '8 daily reports across 5 levels',
      '18 punch items by trade',
      '4 change orders ($383K total)',
      '6 RFIs, 25 photos',
    ],
  },
};

function formatMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n.toLocaleString('en-US')}`;
}

function DemoSeedPickerModalImpl({ visible, onClose, onPick, showMedium = false }: DemoSeedPickerModalProps) {
  const insets = useSafeAreaInsets();

  const flavors: DemoFlavor[] = showMedium ? ['small', 'medium', 'large'] : ['small', 'large'];

  const handlePick = useCallback((flavor: DemoFlavor) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onPick(flavor);
  }, [onPick]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.handle} />
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Pick a sample project</Text>
            <Text style={styles.subtitle}>
              Both load instantly. Wipe anytime from Settings → Reset, or tap Delete on the project tile.
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={8} style={styles.closeBtn} testID="demo-picker-close" accessibilityRole="button" accessibilityLabel="Close"><X size={18} color={Colors.text} /></TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} style={styles.scroll}>
          {flavors.map(flavor => {
            const meta = DEMO_FLAVORS[flavor];
            const visual = FLAVOR_VISUAL[flavor];
            const Icon = visual.Icon;
            return (
              <TouchableOpacity
                key={flavor}
                style={[styles.card, { borderColor: visual.accent + '40' }]}
                onPress={() => handlePick(flavor)}
                activeOpacity={0.85}
                testID={`demo-picker-${flavor}`}
              >
                <View style={styles.cardHead}>
                  <View style={[styles.cardIcon, { backgroundColor: visual.accent + '14' }]}>
                    <Icon size={20} color={visual.accent} strokeWidth={2.2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardName}>{meta.name.replace('Sample — ', '')}</Text>
                    <Text style={styles.cardScope}>{meta.scope}</Text>
                  </View>
                  <ChevronRight size={16} color={Colors.textMuted} />
                </View>

                <View style={styles.cardStats}>
                  <View style={styles.cardStat}>
                    <Text style={styles.cardStatLabel}>Total</Text>
                    <Text style={[styles.cardStatValue, { color: visual.accent }]}>{formatMoney(meta.total)}</Text>
                  </View>
                  <View style={styles.cardStatDiv} />
                  <View style={styles.cardStat}>
                    <Text style={styles.cardStatLabel}>SF</Text>
                    <Text style={styles.cardStatValue}>{meta.squareFootage.toLocaleString('en-US')}</Text>
                  </View>
                  <View style={styles.cardStatDiv} />
                  <View style={styles.cardStat}>
                    <Text style={styles.cardStatLabel}>Duration</Text>
                    <Text style={styles.cardStatValue}>{meta.durationLabel}</Text>
                  </View>
                </View>

                <Text style={styles.cardPitch}>{visual.pitch}</Text>

                <View style={styles.bulletList}>
                  {visual.bullets.map((b, i) => (
                    <View key={i} style={styles.bulletRow}>
                      <View style={[styles.bulletDot, { backgroundColor: visual.accent }]} />
                      <Text style={styles.bulletText}>{b}</Text>
                    </View>
                  ))}
                </View>

                <View style={[styles.cta, { backgroundColor: visual.accent }]}>
                  <Text style={styles.ctaText}>Load this sample</Text>
                  <ChevronRight size={14} color="#FFF" />
                </View>
              </TouchableOpacity>
            );
          })}

          <Text style={styles.disclaimer}>
            Sample projects are local-only. They don&apos;t consume any of your monthly AI quota.
            Both prepend &quot;Sample —&quot; in the project name so you can never confuse them with real work.
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

export const DemoSeedPickerModal = memo(DemoSeedPickerModalImpl);

const styles = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    maxHeight: '90%' as const,
    backgroundColor: Colors.background,
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingHorizontal: Tokens.spacing.md, paddingTop: 10,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center', marginBottom: Tokens.spacing.xs,
  },
  head: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 14,
  },
  title: { fontSize: Type.subheadline.fontSize, fontWeight: '800', color: Colors.text, letterSpacing: -0.2 },
  subtitle: { fontSize: Type.caption1.fontSize, color: Colors.textMuted, marginTop: Tokens.spacing.xxs, lineHeight: 17 },
  closeBtn: {
    width: 32, height: 32, borderRadius: Tokens.radius.sm,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.card,
  },
  scroll: { },

  card: {
    backgroundColor: Colors.card,
    borderRadius: Tokens.radius.panel, padding: Tokens.spacing.md,
    borderWidth: 1.5,
    marginBottom: Tokens.spacing.sm, gap: Tokens.spacing.sm,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.sm },
  cardIcon: {
    width: 42, height: 42, borderRadius: Tokens.radius.card,
    alignItems: 'center', justifyContent: 'center',
  },
  cardName: { fontSize: Type.subhead.fontSize, fontWeight: '800', color: Colors.text, letterSpacing: -0.2 },
  cardScope: { fontSize: Type.caption1.fontSize, color: Colors.textMuted, marginTop: Tokens.spacing.hairline, lineHeight: 16 },

  cardStats: {
    flexDirection: 'row', alignItems: 'stretch',
    backgroundColor: Colors.background,
    borderRadius: Tokens.radius.md,
    borderWidth: 1, borderColor: Colors.border,
    overflow: 'hidden',
  },
  cardStat: { flex: 1, alignItems: 'center', paddingVertical: 10 },
  cardStatDiv: { width: 1, alignSelf: 'stretch', backgroundColor: Colors.border },
  cardStatLabel: { fontSize: 9, fontWeight: '800', color: Colors.textMuted, letterSpacing: 0.6, textTransform: 'uppercase' },
  cardStatValue: { fontSize: Type.callout.fontSize, fontWeight: '800', color: Colors.text, marginTop: Tokens.spacing.xxs, letterSpacing: -0.2 },

  cardPitch: { fontSize: Type.footnote.fontSize, color: Colors.text, lineHeight: 18, fontStyle: 'italic' },

  bulletList: { gap: Tokens.spacing.xxs },
  bulletRow: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xs },
  bulletDot: { width: 5, height: 5, borderRadius: 3 },
  bulletText: { flex: 1, fontSize: Type.caption1.fontSize, color: Colors.text, lineHeight: 16 },

  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 11, borderRadius: Tokens.radius.md, marginTop: Tokens.spacing.xxs,
  },
  ctaText: { color: '#FFF', fontSize: Type.footnote.fontSize, fontWeight: '800', letterSpacing: 0.2 },

  disclaimer: {
    fontSize: Type.caption2.fontSize, color: Colors.textMuted, fontStyle: 'italic',
    textAlign: 'center', lineHeight: 16, paddingHorizontal: Tokens.spacing.sm, paddingVertical: Tokens.spacing.sm,
  },
});

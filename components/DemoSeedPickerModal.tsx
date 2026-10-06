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
import { X, ChevronRight, HardHat, Building2 } from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { Colors } from '@/constants/colors';
import { SheetOverlay, useSheetFrame } from '@/components/ui/Sheet';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
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

/** Map flavor → icon + accent color for the card grid.
 *
 *  `accent: 'brand'` resolves through the THEME at render (accentLabel for the
 *  icon / total / bullets, accentFill under the white CTA label), not a hex.
 *  A literal cannot serve both jobs in both themes: the light brand #2F6B3A is
 *  under 3:1 on the dark card, and the dark brand gives white 2.58:1.
 *
 *  Small was the old success green #2E7D44 and Medium the retired brand orange.
 *  After the 2026-09-16 rebrand that green sits ΔE 9.2 from the brand — the
 *  same swatch — so Small is now simply the brand, and so is Medium (it wears
 *  the MAGE mark). The two only meet when `showMedium` is set, and their icon
 *  and name carry the difference there. Neither is a state, so neither is the
 *  success teal. */
const FLAVOR_VISUAL: Record<DemoFlavor, {
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  accent: 'brand' | string;
  pitch: string;
  bullets: string[];
}> = {
  small: {
    Icon: HardHat,
    accent: 'brand',
    pitch: 'Bread-and-butter residential remodel. Solo operator or small crew.',
    bullets: [
      '2 invoices, 4 daily reports',
      '6 punch items mid-project',
      '2 RFIs, 1 change order',
      '8 photos across the timeline',
    ],
  },
  medium: {
    Icon: MageAIMark as React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>,
    accent: 'brand',
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
    accent: Colors.warningLabel,
    pitch: 'Ground-up multi-unit condo. AIA-style pay-app cadence, deep buyout, big crew.',
    bullets: [
      '6 invoices on AIA-style cadence ($8.6M billed)',
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
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Desktop web: a centred card in the content column, the scrim over the
  // sidebar. Phone: every part is null — today's bottom sheet, byte for byte.
  const fX = useSheetFrame('form', { visible, animationType: 'slide' });

  const flavors: DemoFlavor[] = showMedium ? ['small', 'medium', 'large'] : ['small', 'large'];

  const handlePick = useCallback((flavor: DemoFlavor) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onPick(flavor);
  }, [onPick]);

  return (
    <Modal visible={visible} transparent animationType={fX.animationType} onRequestClose={onClose}>
      <SheetOverlay frame={fX}>
      <TouchableOpacity style={[styles.backdrop, fX.backdrop]} activeOpacity={1} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }, fX.card]}>
        {fX.showHandle && <View style={styles.handle} />}
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Pick a Sample Project</Text>
            <Text style={styles.subtitle}>
              Each loads right away. Remove one later from Settings &gt; Reset, or tap Delete on its project tile.
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={8} style={styles.closeBtn} testID="demo-picker-close" accessibilityRole="button" accessibilityLabel="Close"><X size={18} color={themeColors.text} strokeWidth={1.75} /></TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} style={styles.scroll}>
          {flavors.map(flavor => {
            const meta = DEMO_FLAVORS[flavor];
            const visual = FLAVOR_VISUAL[flavor];
            const Icon = visual.Icon;
            const ink = visual.accent === 'brand' ? themeColors.accentLabel : visual.accent;
            const fill = visual.accent === 'brand' ? themeColors.accentFill : visual.accent;
            return (
              <TouchableOpacity
                key={flavor}
                style={[styles.card, { borderColor: ink + '40' }]}
                onPress={() => handlePick(flavor)}
                activeOpacity={0.85}
                testID={`demo-picker-${flavor}`}
              >
                <View style={styles.cardHead}>
                  <View style={[styles.cardIcon, { backgroundColor: ink + '14' }]}>
                    <Icon size={20} color={ink} strokeWidth={2.2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardName}>{meta.name.replace('Sample — ', '')}</Text>
                    <Text style={styles.cardScope}>{meta.scope}</Text>
                  </View>
                  <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
                </View>

                <View style={styles.cardStats}>
                  <View style={styles.cardStat}>
                    <Text style={styles.cardStatLabel}>Total</Text>
                    <Text style={[styles.cardStatValue, { color: ink }]}>{formatMoney(meta.total)}</Text>
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
                      <View style={[styles.bulletDot, { backgroundColor: ink }]} />
                      <Text style={styles.bulletText}>{b}</Text>
                    </View>
                  ))}
                </View>

                <View style={[styles.cta, { backgroundColor: fill }]}>
                  <Text style={styles.ctaText}>Load This Sample</Text>
                  <ChevronRight size={14} color="#FFF" strokeWidth={1.75} />
                </View>
              </TouchableOpacity>
            );
          })}

          <Text style={styles.disclaimer}>
            Sample projects stay on this device and don&apos;t use any of your monthly AI allowance.
            Each name starts with &quot;Sample —&quot; so it never mixes with real work.
          </Text>
        </ScrollView>
      </View>
      </SheetOverlay>
    </Modal>
  );
}

export const DemoSeedPickerModal = memo(DemoSeedPickerModalImpl);

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    maxHeight: '90%' as const,
    backgroundColor: t.bg,
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingHorizontal: 16, paddingTop: 10,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: t.line,
    alignSelf: 'center', marginBottom: 8,
  },
  head: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 14,
  },
  title: { fontSize: Type.subheadline.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.2 },
  subtitle: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 4, lineHeight: 17 },
  closeBtn: {
    width: 32, height: 32, borderRadius: Tokens.radius.sm,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.card,
  },
  scroll: { },

  card: {
    backgroundColor: Colors.card,
    borderRadius: Tokens.radius.panel, padding: 16,
    borderWidth: 1.5,
    marginBottom: 12, gap: 12,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardIcon: {
    width: 42, height: 42, borderRadius: Tokens.radius.card,
    alignItems: 'center', justifyContent: 'center',
  },
  cardName: { fontSize: Type.subhead.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.2 },
  cardScope: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 2, lineHeight: 16 },

  cardStats: {
    flexDirection: 'row', alignItems: 'stretch',
    backgroundColor: t.bg,
    borderRadius: Tokens.radius.md,
    borderWidth: 1, borderColor: t.line,
    overflow: 'hidden',
  },
  cardStat: { flex: 1, alignItems: 'center', paddingVertical: 10 },
  cardStatDiv: { width: 1, alignSelf: 'stretch', backgroundColor: t.line },
  cardStatLabel: { fontSize: 9, fontWeight: '800', color: t.textMuted, letterSpacing: 0.6, textTransform: 'uppercase' },
  cardStatValue: { fontSize: Type.callout.fontSize, fontWeight: '800', color: t.text, marginTop: 4, letterSpacing: -0.2 },

  cardPitch: { fontSize: Type.footnote.fontSize, color: t.text, lineHeight: 18, fontStyle: 'italic' },

  bulletList: { gap: 4 },
  bulletRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bulletDot: { width: 5, height: 5, borderRadius: 3 },
  bulletText: { flex: 1, fontSize: Type.caption1.fontSize, color: t.text, lineHeight: 16 },

  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 11, borderRadius: Tokens.radius.md, marginTop: 4,
  },
  ctaText: { color: '#FFF', fontSize: Type.footnote.fontSize, fontWeight: '800', letterSpacing: 0.2 },

  disclaimer: {
    fontSize: Type.caption2.fontSize, color: t.textMuted, fontStyle: 'italic',
    textAlign: 'center', lineHeight: 16, paddingHorizontal: 12, paddingVertical: 12,
  },
});

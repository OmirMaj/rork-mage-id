// HomeFabStack — a single speed-dial that consolidates the three home-screen
// floating buttons (AI Copilot, Voice action, Help) into ONE footprint.
//
// The problem it fixes: previously AICopilot, UniversalMicButton and HelpFab
// each mounted their own absolutely-positioned FAB in a hand-tuned vertical
// stack at the bottom-right. All three showed at once and overlapped the
// scrolling project cards on the right edge.
//
// The design:
//   • The AI Copilot stays the always-visible MAIN fab — <AICopilot /> is
//     rendered untouched, so its modal + all its logic are unchanged. It
//     self-positions at insets.bottom + 70 (56pt circle, right: 20).
//   • A small "expander" toggle sits just above the main fab. Collapsed, the
//     whole control is one button's width — the cards are clear.
//   • Tapping the toggle expands the dial UP to reveal two labeled mini-FABs:
//       – Voice  → opens UniversalMicButton's existing voice modal
//       – Help   → opens HelpFab's existing help sheet
//     Both secondary components are mounted here with `hideFab` (no FAB of
//     their own) and are opened via an incrementing `openSignal` — so their
//     modals/handlers run exactly as before; only their trigger moved.
//   • Selecting an action, or tapping the scrim, collapses the dial.
//   • Reduce-motion is respected (Apple HIG): the LayoutAnimation is skipped
//     when the OS accessibility setting is on.

import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Platform, Pressable,
  LayoutAnimation, UIManager, AccessibilityInfo,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Mic, HelpCircle, Plus, X } from 'lucide-react-native';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import AICopilot from '@/components/AICopilot';
import UniversalMicButton from '@/components/UniversalMicButton';
import { HelpFab } from '@/components/HelpFab';

// Enable LayoutAnimation on Android (no-op on iOS — already enabled).
// Mirrors the guard in project-detail.tsx.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface Props {
  /** Threaded straight through to HelpFab — reopens the in-app tutorial. */
  onReplayTutorial?: () => void;
  /** Auto-hide while the host list scrolls down (sim-audit fix #4) — the
   *  stacked FABs were covering list dismiss buttons and card chevrons.
   *  Hiding removes the whole dial footprint; modals stay mounted. */
  hidden?: boolean;
}

function HomeFabStackImpl({ onReplayTutorial, hidden }: Props) {
  const insets = useSafeAreaInsets();
  const styles = useThemedStyles(makeStyles);

  const [expanded, setExpanded] = useState(false);

  // Collapse an open dial when the stack hides mid-scroll so it doesn't
  // reappear pre-expanded later.
  useEffect(() => {
    if (hidden && expanded) setExpanded(false);
  }, [hidden, expanded]);
  // Bumped to signal the (otherwise self-contained) secondary components to
  // open their modals. Starts at 0; the components ignore the initial value.
  const [voiceSignal, setVoiceSignal] = useState(0);
  const [helpSignal, setHelpSignal] = useState(0);

  // Reduce-motion — same pattern as onboarding.tsx / persona-select.tsx.
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then(v => { if (mounted) setReduceMotion(v); });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { mounted = false; sub.remove(); };
  }, []);

  const animate = useCallback(() => {
    if (reduceMotion) return;
    LayoutAnimation.configureNext({
      duration: Tokens.motion.duration.micro,
      create: { type: 'easeInEaseOut', property: 'opacity' },
      update: { type: 'easeInEaseOut' },
      delete: { type: 'easeInEaseOut', property: 'opacity' },
    });
  }, [reduceMotion]);

  const toggle = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    animate();
    setExpanded(e => !e);
  }, [animate]);

  const collapse = useCallback(() => {
    animate();
    setExpanded(false);
  }, [animate]);

  const openVoice = useCallback(() => {
    collapse();
    setVoiceSignal(n => n + 1);
  }, [collapse]);

  const openHelp = useCallback(() => {
    collapse();
    setHelpSignal(n => n + 1);
  }, [collapse]);

  // Geometry — align to AICopilot's own FAB so the dial reads as one column.
  // AICopilot renders at bottom: insets.bottom + 70 (+48 on web), right: 20,
  // 56pt circle. We anchor the expander toggle just above its top edge and
  // grow the mini-FABs upward from there.
  const webLift = Platform.OS === 'web' ? 48 : 0;
  const copilotBottom = insets.bottom + 70 + webLift;
  const copilotSize = 56;
  // Toggle sits above the copilot circle with an 8pt gap.
  const toggleBottom = copilotBottom + copilotSize + Tokens.spacing.xs;

  return (
    <>
      {/* Scrim — tap anywhere to collapse. Only mounted while expanded so it
          never blocks touches on the cards in the resting state. Sits BELOW
          the dial controls (they render after it). */}
      {expanded && (
        <Pressable
          style={styles.scrim}
          onPress={collapse}
          accessibilityRole="button"
          accessibilityLabel="Close quick actions"
        />
      )}

      {/* Main fab — the AI Copilot. Hides with the stack while scrolling. */}
      <AICopilot hidden={hidden} />

      {/* Secondary components — no FAB of their own; opened via signals. Their
          modals + all handlers live inside them. Mounted unconditionally so
          their internal hook trees stay stable regardless of `expanded`. */}
      <UniversalMicButton hideFab openSignal={voiceSignal} />
      <HelpFab hideFab openSignal={helpSignal} onReplayTutorial={onReplayTutorial} />

      {/* Mini-FAB column — revealed above the copilot when expanded. */}
      {!hidden && expanded && (
        <View
          style={[styles.miniColumn, { bottom: toggleBottom + Tokens.touchTarget.min + Tokens.spacing.sm }]}
          pointerEvents="box-none"
        >
          <MiniAction
            icon={<Mic size={18} color="#FFFFFF" strokeWidth={1.8} />}
            label="Voice"
            onPress={openVoice}
            styles={styles}
            testID="home-fab-voice"
          />
          <MiniAction
            icon={<HelpCircle size={18} color="#FFFFFF" strokeWidth={2.2} />}
            label="Help"
            onPress={openHelp}
            styles={styles}
            testID="home-fab-help"
          />
        </View>
      )}

      {/* Expander toggle — the one control that grows/collapses the dial.
          Rotates to an X while open. Hidden with the rest of the stack. */}
      {!hidden && <TouchableOpacity
        style={[styles.toggle, { bottom: toggleBottom }]}
        onPress={toggle}
        activeOpacity={0.85}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={expanded ? 'Close quick actions' : 'More quick actions'}
        testID="home-fab-toggle"
      >
        {expanded
          ? <X size={18} color="#FFFFFF" strokeWidth={2.2} />
          : <Plus size={18} color="#FFFFFF" strokeWidth={2.2} />}
      </TouchableOpacity>}
    </>
  );
}

interface MiniActionProps {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
  testID?: string;
}

function MiniAction({ icon, label, onPress, styles, testID }: MiniActionProps) {
  return (
    <View style={styles.miniRow} pointerEvents="box-none">
      <View style={styles.miniLabelWrap}>
        <Text style={styles.miniLabel} numberOfLines={1}>{label}</Text>
      </View>
      <TouchableOpacity
        style={styles.miniButton}
        onPress={onPress}
        activeOpacity={0.85}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel={label}
        testID={testID}
      >
        {icon}
      </TouchableOpacity>
    </View>
  );
}

export const HomeFabStack = memo(HomeFabStackImpl);
export default HomeFabStack;

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFillObject,
    // Nearly transparent — the point is to catch the outside tap, not to
    // dim the screen. A visible scrim would fight the copilot modal styling.
    backgroundColor: 'transparent',
    zIndex: 998,
  },
  toggle: {
    position: 'absolute',
    right: 20,
    width: Tokens.touchTarget.min,
    height: Tokens.touchTarget.min,
    borderRadius: Tokens.radius.full,
    backgroundColor: t.text,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.30,
    shadowRadius: 10,
    elevation: 6,
    zIndex: 1000,
  },
  miniColumn: {
    position: 'absolute',
    right: 20,
    alignItems: 'flex-end',
    gap: Tokens.spacing.sm,
    zIndex: 1000,
  },
  miniRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Tokens.spacing.xs,
  },
  miniLabelWrap: {
    backgroundColor: t.text,
    paddingHorizontal: Tokens.spacing.sm,
    paddingVertical: Tokens.spacing.xxs + 2,
    borderRadius: Tokens.radius.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.20,
    shadowRadius: 6,
    elevation: 3,
  },
  miniLabel: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  miniButton: {
    width: Tokens.touchTarget.min,
    height: Tokens.touchTarget.min,
    borderRadius: Tokens.radius.full,
    backgroundColor: t.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.30,
    shadowRadius: 10,
    elevation: 6,
  },
});

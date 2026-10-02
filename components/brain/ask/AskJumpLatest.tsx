// components/brain/ask/AskJumpLatest.tsx — "Jump to latest" (lane AILOOK).
//
// When he has scrolled more than 160 pt above the end and a new turn lands,
// Ask does not yank him down: this pill appears above the composer instead,
// and tapping it scrolls to the newest turn. It fades in and out over 160 ms
// (Reduce Motion: no fade). At rest it renders nothing at all.
//
// Placement: the host renders it between the ScrollView and the composer; it
// takes no height (a zero-height anchor) and floats 8 pt above the composer.

import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ChevronDown } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { cardSurface } from '@/components/ui/Card';
import { nativeDriver, motionCurve, useReducedMotion } from '@/components/ui/motion';
import { ASK_MOTION } from './askMotion';

export interface AskJumpLatestProps {
  visible: boolean;
  label: string;
  onPress: () => void;
}

export function AskJumpLatest({ visible, label, onPress }: AskJumpLatestProps): React.JSX.Element | null {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(visible);
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current;

  useEffect(() => {
    if (visible) setMounted(true);
    if (reduced) {
      opacity.setValue(visible ? 1 : 0);
      if (!visible) setMounted(false);
      return undefined;
    }
    const anim = Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: ASK_MOTION.jump.fadeMs,
      easing: visible ? motionCurve.out : motionCurve.in,
      useNativeDriver: nativeDriver,
    });
    anim.start();
    if (visible) return () => anim.stop();
    const done = setTimeout(() => setMounted(false), ASK_MOTION.jump.fadeMs);
    return () => { anim.stop(); clearTimeout(done); };
  }, [visible, reduced, opacity]);

  if (!mounted) return null;
  return (
    <View style={styles.anchor} pointerEvents="box-none">
      <Animated.View style={[styles.float, { opacity }]} pointerEvents={visible ? 'box-none' : 'none'}>
        <TouchableOpacity
          style={styles.pill}
          onPress={onPress}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={label}
          testID="ask-jump-latest"
        >
          <ChevronDown size={14} color={t.textSecondary} strokeWidth={2.2} />
          <Text style={styles.label}>{label}</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  anchor: { height: 0, alignItems: 'center', zIndex: 2 },
  float: { position: 'absolute', bottom: 8 },
  pill: {
    ...cardSurface(t, { radius: 'full', pad: 'none' }),
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 7,
  },
  label: { fontSize: Type.footnote.fontSize, fontWeight: '600', color: t.textSecondary },
});

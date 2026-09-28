// ConsentRow — the "I agree to sign electronically" checkbox.
//
// LEGAL: a consent box renders ONLY when its answer is stored with a version.
// No version (empty or whitespace) = this component renders nothing — never a
// box whose tick goes nowhere. The GC and in-person paths show it only once the
// adopting caller persists { version, acceptedAt }; the portal stays typed-name
// only until an RPC stores it.
//
// Look (approved preview .consent/.cbox): a 22 pt box, radius 7, 1.5 pt line
// border; checked = the capsule's brand fill with a two-leg check in the
// on-fill colour, the short leg over 120 ms then the long leg over 120 ms after
// a 100 ms delay. Opacity and transform only, on the native driver.

import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';
import { nativeDriver, useReducedMotion } from '@/components/ui/motion';
import { TwoLegCheck } from '@/components/moments/core/contract';
import { momentColors } from '@/utils/moments/colors';
import { consentRenderable } from '@/utils/moments/signatureInk';
import { CEREMONY_TIMING } from '@/utils/moments/signTimeline';

export { consentRenderable };

export interface ConsentRowProps {
  /** The stored disclosure version. Empty = no box at all. */
  version: string;
  text: string;
  linkLabel?: string;
  onOpenDisclosure?: () => void;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  testID?: string;
}

export function ConsentRow(p: ConsentRowProps) {
  if (!consentRenderable(p.version)) return null;
  return <ConsentRowBox {...p} />;
}

function ConsentRowBox({ text, linkLabel, onOpenDisclosure, checked, onChange, disabled, testID }: ConsentRowProps) {
  const { colors, resolved } = useTheme();
  const mc = momentColors(colors, resolved);
  const reduced = useReducedMotion();
  const fill = useRef(new Animated.Value(checked ? 1 : 0)).current;
  const short = useRef(new Animated.Value(checked ? 1 : 0)).current;
  const long = useRef(new Animated.Value(checked ? 1 : 0)).current;
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const to = checked ? 1 : 0;
    if (reduced || !checked) {
      fill.setValue(to);
      short.setValue(to);
      long.setValue(to);
      return;
    }
    Animated.parallel([
      Animated.timing(fill, { toValue: 1, duration: CEREMONY_TIMING.consentShort, useNativeDriver: nativeDriver }),
      Animated.timing(short, { toValue: 1, duration: CEREMONY_TIMING.consentShort, useNativeDriver: nativeDriver }),
      Animated.timing(long, {
        toValue: 1,
        duration: CEREMONY_TIMING.consentLong,
        delay: CEREMONY_TIMING.consentLongDelay,
        useNativeDriver: nativeDriver,
      }),
    ]).start();
  }, [checked, reduced, fill, short, long]);

  return (
    <Pressable
      onPress={() => onChange(!checked)}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: !!disabled }}
      accessibilityLabel={linkLabel ? `${text} ${linkLabel}` : text}
      style={s.row}
      testID={testID}
    >
      <View style={[s.box, { backgroundColor: colors.surface }]}>
        <Animated.View style={[s.boxFill, { backgroundColor: mc.capFill.brand, opacity: fill }]} />
        <Animated.View
          style={[s.boxRim, { borderColor: colors.line, opacity: fill.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}
          pointerEvents="none"
        />
        <View style={s.check} pointerEvents="none">
          <TwoLegCheck short={short} long={long} width={11} height={5.5} color={mc.capOn.brand} />
        </View>
      </View>
      <Text style={[s.text, { color: colors.textSecondary }]}>
        {text}
        {linkLabel ? (
          <Text
            style={[s.link, { color: colors.accentLabel }]}
            onPress={onOpenDisclosure}
            accessibilityRole="link"
            suppressHighlighting
          >
            {` ${linkLabel}`}
          </Text>
        ) : null}
      </Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 12 },
  box: { width: 22, height: 22, borderRadius: 7, overflow: 'hidden', marginTop: 1 },
  boxFill: { ...StyleSheet.absoluteFillObject },
  boxRim: { ...StyleSheet.absoluteFillObject, borderRadius: 7, borderWidth: 1.5 },
  check: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  text: { ...Type.footnote, flex: 1 },
  link: { ...Type.footnoteEmphasized },
});

export default ConsentRow;

import React, { useEffect, useRef } from 'react';
import { View, PanResponder, StyleSheet, Platform, type GestureResponderEvent } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/contexts/ThemeContext';

interface PercentSliderProps {
  value: number;            // 0-100
  onChange: (v: number) => void;   // live, per 5% step (cheap — update draft)
  onCommit?: (v: number) => void;  // on release (persist here)
  color: string;
  trackColor?: string;
}

// Drag-to-set progress slider built on RN core PanResponder (OTA-safe — no
// native slider dependency). Snaps to 5% steps with a haptic tick per step.
export function PercentSlider({ value, onChange, onCommit, color, trackColor }: PercentSliderProps) {
  const { colors } = useTheme();
  const widthRef = useRef(0);
  const x0Ref = useRef(0);
  const lastRef = useRef(value);
  const containerRef = useRef<View>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  // Keep our "last emitted" snapshot in sync with external updates so an
  // outside change doesn't get swallowed by the de-dupe in setFromPageX.
  useEffect(() => { lastRef.current = value; }, [value]);

  const setFromPageX = useRef((pageX: number) => {
    const w = widthRef.current;
    if (w <= 0) return;
    let pct = Math.round(((pageX - x0Ref.current) / w) * 20) * 5; // snap to 5
    pct = Math.max(0, Math.min(100, pct));
    if (pct !== lastRef.current) {
      lastRef.current = pct;
      if (Platform.OS !== 'web') void Haptics.selectionAsync();
      onChangeRef.current(pct);
    }
  });

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e: GestureResponderEvent) => {
        // Re-measure on grab so the % is correct even if layout shifted or the
        // slide-up modal was mid-animation when onLayout first fired.
        const pageX = e.nativeEvent.pageX;
        containerRef.current?.measureInWindow((x, _y, w) => { x0Ref.current = x; widthRef.current = w; setFromPageX.current(pageX); });
      },
      onPanResponderMove: (e: GestureResponderEvent) => setFromPageX.current(e.nativeEvent.pageX),
      onPanResponderRelease: () => onCommitRef.current?.(lastRef.current),
    }),
  ).current;

  const onLayout = () => {
    containerRef.current?.measureInWindow((x, _y, w) => { x0Ref.current = x; widthRef.current = w; });
  };

  const clamped = Math.max(0, Math.min(100, value));
  const track = trackColor ?? colors.line;

  return (
    <View
      ref={containerRef}
      onLayout={onLayout}
      hitSlop={{ top: 14, bottom: 14, left: 4, right: 4 }}
      style={styles.hit}
      {...pan.panHandlers}
    >
      <View style={[styles.track, { backgroundColor: track }]}>
        <View style={[styles.fill, { width: `${clamped}%`, backgroundColor: color }]} />
        <View style={[styles.thumb, { left: `${clamped}%`, borderColor: color }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hit: { paddingVertical: 10, justifyContent: 'center' as const },
  track: { height: 8, borderRadius: 4, justifyContent: 'center' as const },
  fill: { height: 8, borderRadius: 4 },
  thumb: {
    position: 'absolute' as const,
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: '#FFFFFF', borderWidth: 3,
    marginLeft: -10,
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2,
  },
});

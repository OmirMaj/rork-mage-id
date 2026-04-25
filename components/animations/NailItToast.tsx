// NailItToast — a success toast where a hammer flies in from the right,
// strikes a nail, and the message fades in beneath. Used after important
// "you did the thing" moments: saved an estimate, sent an invoice,
// generated a packet, etc.
//
// Why a custom toast rather than Alert.alert? Alerts demand a tap to
// dismiss and break the user's flow for an action that just succeeded.
// This auto-dismisses after ~2.2s and feels rewarding rather than
// nagging. The hammer-strike timing maps to the haptic, so on iOS the
// confirmation is felt and seen at the same instant.
//
// Mount-anywhere usage: render the <NailItToastHost/> once high in the
// tree (we mount it in app/_layout.tsx), then call `nailIt('Saved!')`
// from any screen via the exported helper. No props, no provider.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View, Dimensions } from 'react-native';
import { Hammer, CheckCircle2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import * as Haptics from 'expo-haptics';

interface ToastEvent {
  message: string;
  id: number;
}

let listeners: ((e: ToastEvent) => void)[] = [];
let nextId = 1;

/**
 * Trigger a NailIt toast from anywhere in the app. The host must be mounted
 * (we put it in app/_layout.tsx). Calls before mount are silently dropped —
 * intentional, since by definition the user hasn't seen anything yet.
 */
export function nailIt(message: string): void {
  if (!message || message.length === 0) return;
  const event: ToastEvent = { message: message.length > 80 ? message.slice(0, 77) + '…' : message, id: nextId++ };
  listeners.forEach(l => l(event));
}

export function NailItToastHost() {
  const [active, setActive] = useState<ToastEvent | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const hammerX = useRef(new Animated.Value(80)).current;
  const hammerRotate = useRef(new Animated.Value(0)).current;
  const sparkScale = useRef(new Animated.Value(0)).current;
  const sparkOpacity = useRef(new Animated.Value(0)).current;

  const showToast = useCallback((event: ToastEvent) => {
    setActive(event);
    opacity.setValue(0);
    hammerX.setValue(80);
    hammerRotate.setValue(0);
    sparkScale.setValue(0);
    sparkOpacity.setValue(0);

    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    Animated.sequence([
      // Fade the card in.
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      // Hammer flies in.
      Animated.parallel([
        Animated.timing(hammerX, { toValue: 0, duration: 240, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(hammerRotate, { toValue: 1, duration: 240, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]),
      // Strike — sparks burst at impact.
      Animated.parallel([
        Animated.timing(hammerRotate, { toValue: 0.4, duration: 80, useNativeDriver: true }),
        Animated.timing(sparkScale, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.timing(sparkOpacity, { toValue: 1, duration: 80, useNativeDriver: true }),
      ]),
      // Sparks fade.
      Animated.timing(sparkOpacity, { toValue: 0, duration: 280, useNativeDriver: true }),
      // Hold the message visible.
      Animated.delay(900),
      // Fade everything.
      Animated.timing(opacity, { toValue: 0, duration: 240, useNativeDriver: true }),
    ]).start(() => setActive(null));
  }, [opacity, hammerX, hammerRotate, sparkScale, sparkOpacity]);

  useEffect(() => {
    const listener = (e: ToastEvent) => showToast(e);
    listeners.push(listener);
    return () => {
      listeners = listeners.filter(l => l !== listener);
    };
  }, [showToast]);

  if (!active) return null;

  const screenWidth = Dimensions.get('window').width;

  return (
    <View pointerEvents="none" style={[styles.host, { width: screenWidth }]}>
      <Animated.View style={[styles.toast, { opacity }]}>
        <View style={styles.checkBubble}>
          <CheckCircle2 size={18} color={Colors.success} fill={Colors.successLight} />
        </View>
        <Text style={styles.message} numberOfLines={2}>{active.message}</Text>
        {/* Hammer strikes from the right. */}
        <Animated.View
          style={[
            styles.hammerWrap,
            {
              transform: [
                { translateX: hammerX },
                { rotate: hammerRotate.interpolate({ inputRange: [0, 1], outputRange: ['-30deg', '20deg'] }) },
              ],
            },
          ]}
        >
          <Hammer size={20} color={Colors.warning} />
        </Animated.View>
        {/* Spark burst at impact point. */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.sparkWrap,
            { opacity: sparkOpacity, transform: [{ scale: sparkScale }] },
          ]}
        >
          {[0, 60, 120, 180, 240, 300].map(deg => (
            <View
              key={deg}
              style={[
                styles.spark,
                {
                  transform: [{ rotate: `${deg}deg` }, { translateY: -10 }],
                },
              ]}
            />
          ))}
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    top: 64,
    left: 0,
    alignItems: 'center',
    zIndex: 9000,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    minWidth: 240,
    maxWidth: 360,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
    overflow: 'visible',
  },
  checkBubble: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.successLight,
  },
  message: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
  },
  hammerWrap: {
    position: 'absolute',
    right: 14,
    top: 12,
    width: 24,
    height: 24,
  },
  sparkWrap: {
    position: 'absolute',
    right: 22,
    top: 22,
    width: 4,
    height: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spark: {
    position: 'absolute',
    width: 2,
    height: 6,
    backgroundColor: Colors.warning,
    borderRadius: 1,
  },
});

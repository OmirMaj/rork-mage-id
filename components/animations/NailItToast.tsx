// NailItToast — the app's success (and error) toast. Used after the
// "you did the thing" moments: saved an estimate, sent an invoice, approved a
// change order, submitted a daily report.
//
// Why a custom toast rather than Alert.alert? Alerts demand a tap to
// dismiss and break the user's flow for an action that just succeeded.
// This one drops in, holds ~1.6 s and lifts away on its own.
//
// Motion (round 2, 'slicker' — the hammer, sparks and rotate are gone): the
// card drops 14 pt in on Motion.spring.rise while it fades up, the check
// bubble lands on spring.snap, the icon arrives 60 ms later; it holds
// HOLD_MS (errors ERROR_HOLD_MS) and lifts 8 pt away as it fades. ONE message
// at a time: a message that arrives while a toast is up — even one already
// lifting away — REPLACES it in place (full opacity, home, new words, a small
// re-landing of the bubble) and restarts the hold. There is no queue.
// Reduce Motion: no translate or scale; it is simply there for the same hold.
// The haptic fires as it appears, so on iOS it is felt and seen together.
//
// Mount-anywhere usage: render the <NailItToastHost/> once high in the
// tree (we mount it in app/_layout.tsx), then call `nailIt('Saved!')`
// from any screen via the exported helper. No props, no provider.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, View, Dimensions } from 'react-native';
import { CheckCircle2, AlertTriangle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import * as Haptics from 'expo-haptics';
import { Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import { nativeDriver, reducedMotion } from '@/components/ui/motion';

type ToastKind = 'success' | 'error';

interface ToastEvent {
  message: string;
  id: number;
  kind: ToastKind;
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
  const event: ToastEvent = {
    message: message.length > 80 ? message.slice(0, 77) + '…' : message,
    id: nextId++,
    kind: 'success',
  };
  listeners.forEach(l => l(event));
}

/**
 * Trigger an error variant — same toast slot, danger tint and warning icon
 * (errors don't celebrate). Use for surfacing non-network sync failures or
 * other "tried to save but couldn't" moments where Alert would be too
 * disruptive but a silent log would lose the user.
 */
export function oops(message: string): void {
  if (!message || message.length === 0) return;
  const event: ToastEvent = {
    message: message.length > 120 ? message.slice(0, 117) + '…' : message,
    id: nextId++,
    kind: 'error',
  };
  listeners.forEach(l => l(event));
}

// hoist into Motion.duration after round 2
/** How long a success message stays up (restarted by a replacing message). */
const HOLD_MS = 1600;
// hoist into Motion.duration after round 2
/** Errors hold longer: they are read, not glanced at. */
const ERROR_HOLD_MS = 2400;
// hoist into Motion.duration after round 2
const ENTER_FADE_MS = 140;
// hoist into Motion.duration after round 2
const ICON_DELAY_MS = 60;
// hoist into Motion.duration after round 2
const ICON_FADE_MS = 100;
// hoist into Motion.duration after round 2
const REPLACE_MS = 120;
// hoist into Motion.duration after round 2
const EXIT_MS = 180;
/** The card drops this far in, and lifts EXIT_LIFT away. */
const ENTER_DROP = -14;
const EXIT_LIFT = -8;

export function NailItToastHost() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [active, setActive] = useState<ToastEvent | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(ENTER_DROP)).current;
  const bubbleScale = useRef(new Animated.Value(0.5)).current;
  const iconOpacity = useRef(new Animated.Value(0)).current;
  const messageOpacity = useRef(new Animated.Value(1)).current;
  /** The id on screen — null once the card has fully lifted away. A message
   *  that arrives while this is set (even mid-exit) REPLACES it in place. */
  const idRef = useRef<number | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const running = useRef<Animated.CompositeAnimation | null>(null);

  const play = useCallback((anim: Animated.CompositeAnimation, done?: Animated.EndCallback) => {
    running.current?.stop();
    running.current = anim;
    anim.start((r) => {
      if (running.current === anim) running.current = null;
      done?.(r);
    });
  }, []);

  const exit = useCallback((id: number) => {
    if (idRef.current !== id) return;
    if (reducedMotion()) {
      running.current?.stop();
      opacity.setValue(0);
      idRef.current = null;
      setActive(null);
      return;
    }
    play(
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: EXIT_MS, easing: Easing.in(Easing.cubic), useNativeDriver: nativeDriver }),
        Animated.timing(translateY, { toValue: EXIT_LIFT, duration: EXIT_MS, easing: Easing.in(Easing.cubic), useNativeDriver: nativeDriver }),
      ]),
      // A stopped exit reports finished=false, and a replacing message has a
      // new id — either way this cannot clear the message that replaced it.
      ({ finished }) => {
        if (finished && idRef.current === id) {
          idRef.current = null;
          setActive(null);
        }
      },
    );
  }, [opacity, translateY, play]);

  const showToast = useCallback((event: ToastEvent) => {
    // ONE message at a time: a new event REPLACES the active one — no queue.
    const replacing = idRef.current !== null;
    idRef.current = event.id;
    setActive(event);

    if (Platform.OS !== 'web') {
      const kind = event.kind === 'error'
        ? Haptics.NotificationFeedbackType.Error
        : Haptics.NotificationFeedbackType.Success;
      Haptics.notificationAsync(kind).catch(() => {});
    }

    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      exit(event.id);
    }, event.kind === 'error' ? ERROR_HOLD_MS : HOLD_MS);

    if (reducedMotion()) {
      // No translate, no scale: everything is simply there, for the same hold.
      running.current?.stop();
      opacity.setValue(1);
      translateY.setValue(0);
      bubbleScale.setValue(1);
      iconOpacity.setValue(1);
      messageOpacity.setValue(1);
      return;
    }

    if (!replacing) {
      // ENTER: the card drops 14 pt in on the rise spring and fades up; the
      // check bubble lands with it; the icon arrives a beat later.
      opacity.setValue(0);
      translateY.setValue(ENTER_DROP);
      bubbleScale.setValue(0.5);
      iconOpacity.setValue(0);
      messageOpacity.setValue(1);
      play(Animated.parallel([
        Animated.spring(translateY, { toValue: 0, useNativeDriver: nativeDriver, ...Tokens.motion.spring.rise }),
        Animated.timing(opacity, { toValue: 1, duration: ENTER_FADE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver }),
        Animated.spring(bubbleScale, { toValue: 1, useNativeDriver: nativeDriver, ...Tokens.motion.spring.snap }),
        Animated.sequence([
          Animated.delay(ICON_DELAY_MS),
          Animated.timing(iconOpacity, { toValue: 1, duration: ICON_FADE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver }),
        ]),
      ]));
      return;
    }

    // REPLACE (a toast is up, even one lifting away): stop the exit, bring the
    // card back to full and home, and swap the words in place. No re-drop.
    running.current?.stop();
    messageOpacity.setValue(0);
    bubbleScale.setValue(0.85);
    iconOpacity.setValue(1);
    play(Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: REPLACE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver }),
      Animated.spring(translateY, { toValue: 0, useNativeDriver: nativeDriver, ...Tokens.motion.spring.rise }),
      Animated.timing(messageOpacity, { toValue: 1, duration: REPLACE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver }),
      Animated.spring(bubbleScale, { toValue: 1, useNativeDriver: nativeDriver, ...Tokens.motion.spring.snap }),
    ]));
  }, [opacity, translateY, bubbleScale, iconOpacity, messageOpacity, exit, play]);

  useEffect(() => {
    const listener = (e: ToastEvent) => showToast(e);
    listeners.push(listener);
    return () => {
      listeners = listeners.filter(l => l !== listener);
    };
  }, [showToast]);

  // Unmount: no timer fires and no animation completes into a dead host.
  useEffect(() => () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    idRef.current = null;
    running.current?.stop();
    running.current = null;
  }, []);

  if (!active) return null;

  const screenWidth = Dimensions.get('window').width;
  const isError = active.kind === 'error';

  return (
    <View pointerEvents="none" style={[styles.host, { width: screenWidth }]}>
      <Animated.View style={[
        styles.toast,
        { opacity, transform: [{ translateY }] },
        isError && {
          backgroundColor: themeColors.danger + '15',
          borderColor: themeColors.danger + '40',
        },
      ]}>
        <Animated.View style={[styles.checkBubble, { transform: [{ scale: bubbleScale }] }]}>
          <Animated.View style={{ opacity: iconOpacity }}>
            {isError ? (
              <AlertTriangle size={18} color={themeColors.danger} strokeWidth={1.75} />
            ) : (
              <CheckCircle2 size={18} color={themeColors.success} fill={Colors.successLight} strokeWidth={1.75} />
            )}
          </Animated.View>
        </Animated.View>
        <Animated.Text style={[styles.message, { opacity: messageOpacity }]} numberOfLines={2}>{active.message}</Animated.Text>
      </Animated.View>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
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
    borderColor: t.line,
    borderRadius: Tokens.radius.lg,
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
    borderRadius: Tokens.radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.successLight,
  },
  message: {
    flex: 1,
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600',
    color: t.text,
  },
});

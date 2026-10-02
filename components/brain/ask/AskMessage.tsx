// components/brain/ask/AskMessage.tsx — one turn of the Ask MAGE conversation
// (lane AILOOK).
//
// A user turn is a neutral bubble on the right (surfaceAlt, never the accent:
// "accent never becomes the background"). An assistant turn is plain,
// full-width, selectable text with no bubble, and whatever sits under it (the
// do-it card, See plans / Sign in, Sources, follow-ups) comes in as children.
//
// MOTION. Only a LIVE turn moves — one ask() created in this session, whose key
// the host holds in its liveKeys set. A live user turn glides up out of the
// composer (sendEntry: 56 pt on the page, 44 in the dock, scale 0.98 -> 1 on
// the rise spring, opacity over 120 ms); a live answer fades in (answerEntry:
// +60 ms, 220 ms, 8 pt). When the entrance ends, onEntered fires once and the
// host drops the key, so a re-render, a Recent recall or a dock remount never
// replays it. A turn that is not live renders with no motion style at all.
// Reduce Motion: the same states, an opacity fade of 100 ms, no travel.
//
// Numbers: ./askMotion.ts. Every Animated call uses the native driver where it
// exists (nativeDriver), and only opacity and transform ever animate.

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { AlertTriangle } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Layout, Tokens } from '@/constants/designTokens';
import { nativeDriver, motionCurve, useReducedMotion } from '@/components/ui/motion';
import { useIsDesktopWeb } from '@/components/ui/desktop';
import { ASK_MOTION, answerEntry, sendEntry } from './askMotion';

export interface AskMessageProps {
  role: 'user' | 'assistant';
  /** True only for a turn ask() just created (its key is in the host's liveKeys). */
  live: boolean;
  variant: 'page' | 'panel';
  error?: boolean;
  /** Fires once when the entrance finishes; the host drops the key from liveKeys. */
  onEntered?: () => void;
  children?: React.ReactNode;
  text: string;
  testID?: string;
}

/** The answer's line height: Type.callout's 16 pt, opened up for long reads. */
const READ_LINE = 23;

export function AskMessage(props: AskMessageProps): React.JSX.Element {
  const { role, live, variant, error, children, text, testID } = props;
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const reduced = useReducedMotion();
  const isDesktopPage = useIsDesktopWeb() && variant === 'page';

  // Armed once, at mount: a turn that mounts live plays its entrance; one that
  // mounts static never will, whatever `live` does later.
  const armed = useRef(live).current;
  const plan = useRef({
    reduced,
    send: sendEntry(variant, reduced),
    answer: answerEntry(reduced),
  }).current;
  const opacity = useRef(new Animated.Value(armed ? 0 : 1)).current;
  const travel = useRef(new Animated.Value(
    armed ? (role === 'user' ? plan.send.fromY : plan.answer.fromY) : 0,
  )).current;
  const scale = useRef(new Animated.Value(armed && role === 'user' ? plan.send.fromScale : 1)).current;
  const onEnteredRef = useRef(props.onEntered);
  onEnteredRef.current = props.onEntered;

  useEffect(() => {
    if (!armed) return undefined;
    let anim: Animated.CompositeAnimation;
    if (role === 'user') {
      anim = plan.send.spring
        ? Animated.parallel([
          Animated.spring(travel, { toValue: 0, ...ASK_MOTION.send.spring, useNativeDriver: nativeDriver }),
          Animated.spring(scale, { toValue: 1, ...ASK_MOTION.send.spring, useNativeDriver: nativeDriver }),
          Animated.timing(opacity, { toValue: 1, duration: plan.send.fadeMs, easing: motionCurve.out, useNativeDriver: nativeDriver }),
        ])
        : Animated.timing(opacity, { toValue: 1, duration: plan.send.fadeMs, easing: motionCurve.out, useNativeDriver: nativeDriver });
    } else {
      const a = plan.answer;
      anim = Animated.parallel([
        Animated.timing(opacity, { toValue: 1, delay: a.delayMs, duration: a.fadeMs, easing: motionCurve.out, useNativeDriver: nativeDriver }),
        Animated.timing(travel, { toValue: 0, delay: a.delayMs, duration: a.fadeMs, easing: motionCurve.out, useNativeDriver: nativeDriver }),
      ]);
    }
    // Whatever ends it (finished, or stopped by an unmount), the key is
    // dropped, so the entrance can never replay.
    anim.start(() => { onEnteredRef.current?.(); });
    return () => anim.stop();
  }, [armed, role, plan, opacity, travel, scale]);

  // Null at rest: no motion style unless this mount is a live entrance.
  let motion: StyleProp<ViewStyle> = null;
  if (armed && live) {
    motion = plan.reduced
      ? { opacity }
      : role === 'user'
        ? { opacity, transform: [{ translateY: travel }, { scale }] }
        : { opacity, transform: [{ translateY: travel }] };
  }

  if (role === 'user') {
    return (
      <Animated.View style={[styles.userRow, motion]} testID={testID ?? 'ask-turn-user'}>
        <View style={[styles.userBubble, isDesktopPage && styles.userBubbleDesktop]}>
          <Text style={styles.userText} selectable>{text}</Text>
        </View>
      </Animated.View>
    );
  }

  return (
    <Animated.View style={[styles.aiWrap, isDesktopPage && styles.aiWrapDesktop, motion]} testID={testID ?? 'ask-turn-assistant'}>
      <View style={styles.aiLine}>
        {error && (
          <AlertTriangle size={14} color={t.danger} strokeWidth={1.75} style={styles.aiAlert} />
        )}
        <Text style={styles.aiText} selectable>{text}</Text>
      </View>
      {children}
    </Animated.View>
  );
}

/**
 * A chip (a source, a follow-up) under a live answer, fading in on its own
 * delay (chipDelay). Under a turn that mounted static it adds nothing at all.
 * Once armed it keeps its own value (it ends at 1), so the host dropping the
 * turn's key mid-fade never snaps it.
 */
export function AskFade({ live, delayMs, children }: { live: boolean; delayMs: number; children: React.ReactNode }): React.JSX.Element {
  const reduced = useReducedMotion();
  const armed = useRef(live).current;
  const opacity = useRef(new Animated.Value(armed ? 0 : 1)).current;
  // Read once, at mount, like the rest of the entrance.
  const fadeMs = useRef(reduced ? ASK_MOTION.reduced.fadeMs : ASK_MOTION.chips.fadeMs).current;
  const delay = useRef(delayMs).current;
  useEffect(() => {
    if (!armed) return undefined;
    const anim = Animated.timing(opacity, { toValue: 1, delay, duration: fadeMs, easing: motionCurve.out, useNativeDriver: nativeDriver });
    anim.start();
    return () => anim.stop();
  }, [armed, opacity, fadeMs, delay]);
  if (!armed) return <>{children}</>;
  return <Animated.View style={{ opacity }}>{children}</Animated.View>;
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  userRow: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 14, maxWidth: '100%' },
  userBubble: {
    maxWidth: '82%',
    backgroundColor: t.surfaceAlt,
    borderRadius: Tokens.radius.xl,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  userBubbleDesktop: { maxWidth: 560 },
  userText: { color: t.text, fontSize: Type.callout.fontSize, lineHeight: READ_LINE },

  aiWrap: { alignSelf: 'stretch', marginBottom: 14 },
  aiWrapDesktop: { maxWidth: Layout.prose },
  aiLine: { flexDirection: 'row', alignItems: 'flex-start' },
  aiAlert: { marginTop: 4, marginRight: 8 },
  aiText: { flex: 1, color: t.text, fontSize: Type.callout.fontSize, lineHeight: READ_LINE },
});

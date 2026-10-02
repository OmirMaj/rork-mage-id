// ChatTurn — one turn of the Chat Message Stack (pattern 1; the Ask MAGE motion).
//
// A LIVE user turn (one this session just sent) glides up out of the composer:
// translateY 56 pt (page) / 44 pt (panel) → 0 and scale 0.98 → 1 on
// Motion.spring.rise, opacity over 120 ms. A live answer fades in whole after a
// 60 ms beat (220 ms, 8 pt) — nothing types out. History, a recalled thread, a
// demo replay and every re-render render static: the turn arms on mount when
// `live` is true, and never again.
//
// Always ONE Animated.View: its style is null when not live, not armed or
// finished, so the tree equals a plain View's (the golden contract).
// onEntered fires once when the entrance ends (the host drops the key from its
// live set then); the kit itself never sets state on completion.
//
// Web: the send56 / send44 / rise8 classes at every width — a live turn exists
// only after a send, so no golden's first render ever carries one.

import React from 'react';
import { Animated, type StyleProp, type ViewStyle } from 'react-native';
import { useReducedMotion } from '@/components/ui/motion';
import { entranceOf, planChatTurn } from '@/utils/motion/kit/plans';
import type { ChatVariant } from '@/utils/motion/kit/chatStack';
import { useEntrance } from './useEntrance';

export type ChatTurnProps = {
  role: 'user' | 'assistant';
  live: boolean;
  variant: ChatVariant;
  onEntered?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  children: React.ReactNode;
};

export function ChatTurn({ role, live, variant, onEntered, style, testID, children }: ChatTurnProps) {
  const reduce = useReducedMotion();
  const plan = planChatTurn(reduce, role, variant);
  const e = entranceOf(plan.steps[0]);
  const web = role === 'user' ? (variant === 'panel' ? 'send44' : 'send56') : 'rise8';
  const motion = useEntrance(live, { ...e, web }, { onDone: onEntered });
  return (
    <Animated.View testID={testID} style={motion ? [style, motion] : style}>
      {children}
    </Animated.View>
  );
}

export default ChatTurn;

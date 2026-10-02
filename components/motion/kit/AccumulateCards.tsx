// AccumulateCards — Accumulating Cards and Counter (pattern 3).
//
// Cards arrive one at a time, 70 ms apart (slower than a list, so each count
// beat is legible), and the running total steps in lockstep: one CountRoll step
// per landed card, half an entrance after the card starts. Six steps at most —
// cards 7+ land with the 6th, whose step is the total (5·70 + 220 = 570 ms).
// The closing badge (the pattern's summary) arrives 120 ms after the last step:
// opacity + scale 0.98 → 1 on Motion.spring.rise.
//
// Every figure is real: the counter's steps are partialSums() of the cards'
// own cents, and it ends exactly on the total.
//
// items[i].render receives the card's entrance style for an Animated.View it
// renders (null at rest). Reduce Motion: the cards fade in together over
// 100 ms and the counter shows the total at once.

import React from 'react';
import { Animated, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { useReducedMotion } from '@/components/ui/motion';
import { partialSums, stepSchedule, shownSteps } from '@/utils/motion/kit/accumulate';
import { entranceOf, planAccumulateCards, stepFor } from '@/utils/motion/kit/plans';
import { CountRoll } from './CountRoll';
import { useEntrance } from './useEntrance';

export type AccumulateItem = {
  key: string;
  /** The card's amount in integer cents. */
  cents: number;
  render: (enterStyle: ViewStyle | null) => React.ReactNode;
};

export type AccumulateCardsProps = {
  items: readonly AccumulateItem[];
  armed: boolean;
  format: (cents: number) => string;
  /** Where the counter sits: gets the CountRoll node. */
  renderTotal: (rollNode: React.ReactNode) => React.ReactNode;
  badge?: React.ReactNode;
  totalStyle?: StyleProp<TextStyle>;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

function Card({ item, index, armed, n }: { item: AccumulateItem; index: number; armed: boolean; n: number }) {
  const reduce = useReducedMotion();
  const s = stepFor(planAccumulateCards(reduce, n, false), `card-${index}`);
  const style = useEntrance(armed && !!s, s ? { ...entranceOf(s), web: 'rise8' } : { fadeMs: 0 }, { desktopWebOnly: true });
  return <>{item.render(style)}</>;
}

function Badge({ armed, n, children }: { armed: boolean; n: number; children: React.ReactNode }) {
  const reduce = useReducedMotion();
  const s = stepFor(planAccumulateCards(reduce, n, true), 'badge');
  const style = useEntrance(armed && !!s, s ? { ...entranceOf(s), web: 'pop98' } : { fadeMs: 0 }, { desktopWebOnly: true });
  return <Animated.View style={style}>{children}</Animated.View>;
}

export function AccumulateCards({ items, armed, format, renderTotal, badge, totalStyle, style, testID }: AccumulateCardsProps) {
  const reduce = useReducedMotion();
  const n = items.length;
  const plan = planAccumulateCards(reduce, n, !!badge);
  const sums = partialSums(items.map((i) => i.cents));
  const times = reduce ? undefined : stepSchedule(shownSteps(sums).length);
  return (
    <View testID={testID} style={style}>
      {items.map((it, i) => <Card key={it.key} item={it} index={i} armed={armed} n={n} />)}
      {renderTotal(<CountRoll steps={sums} format={format} armed={armed && plan.steps.length > 0} stepTimes={times} style={totalStyle} />)}
      {badge ? <Badge armed={armed} n={n}>{badge}</Badge> : null}
    </View>
  );
}

export default AccumulateCards;

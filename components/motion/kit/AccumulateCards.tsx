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
//
// In a grid (lane KITFIX, KG2). A desktop TileGrid sizes its DIRECT children
// (it clones each with the column width), so a wrapper View would take one
// column and squeeze every card into it. Two wrapper-free ways in:
//   • useAccumulate({ items, armed, format }) → { cards, total, badge }: the
//     cards are elements to put straight into the grid (each one forwards the
//     `style` the grid clones onto it to the node its render() returns), and
//     the total / badge go wherever the screen wants them;
//   • <AccumulateCards asChild …>: the same parts as siblings in the CALLER's
//     layout (no wrapper View); `style` then goes onto every card, not a wrapper.
// Without asChild the tree is the shipped one: one View (testID, style) around
// the cards, the total and the badge.

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
  /** The wrapper's style; with asChild, every card's (there is no wrapper). */
  style?: StyleProp<ViewStyle>;
  testID?: string;
  /** No wrapper View: the cards, the total and the badge join the caller's own layout. */
  asChild?: boolean;
};

type CardProps = { item: AccumulateItem; index: number; armed: boolean; n: number; style?: StyleProp<ViewStyle> };

/** Lay `style` (a grid's column width) onto the card's own node, after the node's own style. */
export function withLayout(node: React.ReactNode, style: StyleProp<ViewStyle> | undefined): React.ReactNode {
  if (style == null || !React.isValidElement(node)) return node;
  const own = (node.props as { style?: StyleProp<ViewStyle> }).style;
  return React.cloneElement(node as React.ReactElement<{ style?: StyleProp<ViewStyle> }>, { style: own == null ? style : [own, style] });
}

function Card({ item, index, armed, n, style: layout }: CardProps) {
  const reduce = useReducedMotion();
  const s = stepFor(planAccumulateCards(reduce, n, false), `card-${index}`);
  const style = useEntrance(armed && !!s, s ? { ...entranceOf(s), web: 'rise8' } : { fadeMs: 0 }, { desktopWebOnly: true });
  return <>{withLayout(item.render(style), layout)}</>;
}

function Badge({ armed, n, children }: { armed: boolean; n: number; children: React.ReactNode }) {
  const reduce = useReducedMotion();
  const s = stepFor(planAccumulateCards(reduce, n, true), 'badge');
  const style = useEntrance(armed && !!s, s ? { ...entranceOf(s), web: 'pop98' } : { fadeMs: 0 }, { desktopWebOnly: true });
  return <Animated.View style={style}>{children}</Animated.View>;
}

export type UseAccumulateArgs = {
  items: readonly AccumulateItem[];
  armed: boolean;
  format: (cents: number) => string;
  badge?: React.ReactNode;
  totalStyle?: StyleProp<TextStyle>;
  /** Laid onto every card's node (a grid's own clone does the same). */
  cardStyle?: StyleProp<ViewStyle>;
};

/**
 * The accumulate pattern with NO container: `cards` go straight into the
 * caller's grid / row (a TileGrid's clone style reaches each card's node),
 * `total` is the CountRoll stepping through the real partial sums, `badge` the
 * closing badge (null without one). Same numbers, same plan as AccumulateCards.
 */
export function useAccumulate({ items, armed, format, badge, totalStyle, cardStyle }: UseAccumulateArgs): {
  cards: React.ReactElement[];
  total: React.ReactNode;
  badge: React.ReactNode | null;
} {
  const reduce = useReducedMotion();
  const n = items.length;
  const plan = planAccumulateCards(reduce, n, !!badge);
  const sums = partialSums(items.map((i) => i.cents));
  const times = reduce ? undefined : stepSchedule(shownSteps(sums).length);
  return {
    cards: items.map((it, i) => <Card key={it.key} item={it} index={i} armed={armed} n={n} style={cardStyle} />),
    total: <CountRoll steps={sums} format={format} armed={armed && plan.steps.length > 0} stepTimes={times} style={totalStyle} />,
    badge: badge ? <Badge armed={armed} n={n}>{badge}</Badge> : null,
  };
}

export function AccumulateCards({ items, armed, format, renderTotal, badge, totalStyle, style, testID, asChild }: AccumulateCardsProps) {
  const parts = useAccumulate({ items, armed, format, badge, totalStyle, cardStyle: asChild ? style : undefined });
  if (asChild) {
    return (
      <>
        {parts.cards}
        {renderTotal(parts.total)}
        {parts.badge}
      </>
    );
  }
  return (
    <View testID={testID} style={style}>
      {parts.cards}
      {renderTotal(parts.total)}
      {parts.badge}
    </View>
  );
}

export default AccumulateCards;

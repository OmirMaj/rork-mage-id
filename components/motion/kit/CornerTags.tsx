// CornerTags — Center and Corner Tags (pattern 11).
//
// A fixed centre statement — it never moves, it is the anchor — framed by up
// to four tags, one per corner. Each tag arrives from 12 pt further out along
// its own diagonal (translate ±12, ±12 → 0) with opacity 0 → 1 over 220 ms,
// clockwise from top-left, 60 ms apart (done by 3·60 + 220 = 400 ms). The
// tags sit in flow above and below the centre, so they frame it without ever
// covering it.
//
// Reduce Motion: the tags fade in together over 100 ms.
// Web (desktop): the tagTL / tagTR / tagBR / tagBL classes.

import React from 'react';
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useReducedMotion } from '@/components/ui/motion';
import { CORNER_ORDER, entranceOf, planCornerTags, stepFor, type Corner } from '@/utils/motion/kit/plans';
import type { KitWebKey } from './css/kitCss';
import { useEntrance } from './useEntrance';

export type CornerTagsProps = {
  center: React.ReactNode;
  tags: Partial<Record<Corner, React.ReactNode>>;
  armed: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const WEB: Record<Corner, KitWebKey> = { tl: 'tagTL', tr: 'tagTR', br: 'tagBR', bl: 'tagBL' };

function Tag({ corner, armed, present, children }: { corner: Corner; armed: boolean; present: readonly Corner[]; children: React.ReactNode }) {
  const reduce = useReducedMotion();
  const s = stepFor(planCornerTags(reduce, present), `tag-${corner}`);
  const style = useEntrance(armed && !!s, s ? { ...entranceOf(s), web: WEB[corner] } : { fadeMs: 0 }, { desktopWebOnly: true });
  return <Animated.View testID={`corner-tag-${corner}`} style={style}>{children}</Animated.View>;
}

export function CornerTags({ center, tags, armed, style, testID }: CornerTagsProps) {
  const present = CORNER_ORDER.filter((c) => tags[c] != null);
  const tag = (c: Corner) => (tags[c] != null ? <Tag corner={c} armed={armed} present={present}>{tags[c]}</Tag> : <View />);
  const top = tags.tl != null || tags.tr != null;
  const bottom = tags.bl != null || tags.br != null;
  return (
    <View testID={testID} style={style}>
      {top ? <View style={styles.edge}>{tag('tl')}{tag('tr')}</View> : null}
      <View>{center}</View>
      {bottom ? <View style={styles.edge}>{tag('bl')}{tag('br')}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  edge: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});

export default CornerTags;

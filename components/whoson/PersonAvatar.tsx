// components/whoson/PersonAvatar.tsx — one person on a project: a circle with
// two initials, and (only when the app KNOWS) the "has it open" dot.
//
// - The initials come from what the account typed about itself (its name,
//   else its company). With nothing typed the circle shows a person mark,
//   never an invented letter.
// - The fill is a hash of the user id over the project-chip palette minus the
//   teal, which sits too close to the dot (utils/whoson/people.ts).
// - The dot is `t.success`, static (no pulse, no glow), with a ring in the
//   ground's colour: the ring, not the hue, is what separates dot from avatar
//   in both themes. There is no grey dot. A caller that does not know passes
//   nothing and nothing is drawn.
// - Decorative for a screen reader: the row or the stack that holds it carries
//   the words.
//
// Stays in components/whoson for v1; a components/ui Avatar belongs with the
// clean-up of the hand-rolled avatar circles (whoson spec, section 4).
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { User } from 'lucide-react-native';
import { Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { labelOn } from '@/components/ui/ink';
import { WHOS_ON_ENABLED } from '@/constants/featureFlags';
import type { ProjectPerson } from '@/types';
import { personColor, personInitials } from '@/utils/whoson/people';

export type PersonAvatarSize = 24 | 28 | 32;

/** The dot's own size, and the ring around it and around each avatar. */
export const PRESENCE_DOT = 9;
export const PRESENCE_RING = 2;

export interface PersonAvatarProps {
  person: Pick<ProjectPerson, 'userId' | 'displayName' | 'companyName' | 'invitedEmail'> | null | undefined;
  size?: PersonAvatarSize;
  /** true only when the app knows this person has the project open. */
  open?: boolean;
  /** Points this avatar slides under the one before it (a stack). */
  overlap?: number;
  /** The ground the rings are drawn in: a card (`surface`) or the page (`bg`). */
  ground?: 'surface' | 'bg';
  /** Stacking order in a stack: an earlier avatar sits ABOVE the next one, so
   *  its dot (bottom right) is never covered by the avatar that overlaps it. */
  layer?: number;
}

/** The "has it open" dot on its own, for a line of text. */
export function PresenceDot({ ground = 'surface', testID }: { ground?: 'surface' | 'bg'; testID?: string }) {
  const styles = useThemedStyles(makeStyles);
  if (!WHOS_ON_ENABLED) return null;
  return <View style={[styles.dot, ground === 'bg' ? styles.ringBg : styles.ringSurface]} testID={testID} accessible={false} />;
}

export function PersonAvatar({ person, size = 28, open = false, overlap = 0, ground = 'surface', layer }: PersonAvatarProps) {
  const styles = useThemedStyles(makeStyles);
  if (!WHOS_ON_ENABLED || !person) return null;
  const fill = personColor(person.userId);
  const ink = labelOn(fill);
  const initials = personInitials(person);
  const ring = ground === 'bg' ? styles.ringBg : styles.ringSurface;
  const outer = size + PRESENCE_RING * 2;
  return (
    <View
      style={[styles.wrap, { width: outer, height: outer, marginLeft: overlap > 0 ? -overlap : 0 }, layer !== undefined ? { zIndex: layer } : null]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      testID={`whoson-avatar-${person.userId}`}
    >
      <View style={[styles.circle, ring, { width: outer, height: outer, backgroundColor: fill }]}>
        {initials
          ? <Text style={[styles.initials, { color: ink }]} numberOfLines={1} allowFontScaling={false}>{initials}</Text>
          : <User size={Math.round(size / 2)} strokeWidth={2} color={ink} />}
      </View>
      {open ? <View style={[styles.dot, styles.dotOnAvatar, ring]} testID={`whoson-dot-${person.userId}`} /> : null}
    </View>
  );
}

/** The "+n" chip that closes a stack. Carries the dot when a hidden person has it open. */
export function PeopleOverflowChip({ count, size = 28, open = false, overlap = 0, ground = 'surface' }: {
  count: number; size?: PersonAvatarSize; open?: boolean; overlap?: number; ground?: 'surface' | 'bg';
}) {
  const styles = useThemedStyles(makeStyles);
  if (!WHOS_ON_ENABLED || !(count > 0)) return null;
  const ring = ground === 'bg' ? styles.ringBg : styles.ringSurface;
  const outer = size + PRESENCE_RING * 2;
  return (
    <View
      style={[styles.wrap, { minWidth: outer, height: outer, marginLeft: overlap > 0 ? -overlap : 0 }]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      testID="whoson-overflow"
    >
      <View style={[styles.circle, styles.chip, ring, { minWidth: outer, height: outer }]}>
        <Text style={styles.chipText} numberOfLines={1} allowFontScaling={false}>{`+${count}`}</Text>
      </View>
      {open ? <View style={[styles.dot, styles.dotOnAvatar, ring]} testID="whoson-dot-overflow" /> : null}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  wrap: { flexShrink: 0 },
  circle: {
    borderRadius: Tokens.radius.full,
    borderWidth: PRESENCE_RING,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  ringSurface: { borderColor: t.surface },
  ringBg: { borderColor: t.bg },
  initials: { ...Type.caption2, fontWeight: '700', letterSpacing: 0.2 },
  chip: { backgroundColor: t.surfaceAlt, paddingHorizontal: Tokens.spacing.xxs },
  chipText: { ...Type.caption2, fontWeight: '700', color: t.textSecondary },
  dot: {
    width: PRESENCE_DOT + PRESENCE_RING * 2,
    height: PRESENCE_DOT + PRESENCE_RING * 2,
    borderRadius: Tokens.radius.full,
    borderWidth: PRESENCE_RING,
    backgroundColor: t.success,
  },
  dotOnAvatar: { position: 'absolute', right: -1, bottom: -1 },
});

export default PersonAvatar;

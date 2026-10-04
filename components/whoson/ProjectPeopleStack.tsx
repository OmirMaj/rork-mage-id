// components/whoson/ProjectPeopleStack.tsx — the small round initials of the
// people on a shared project (whoson spec 1.1, 1.2).
//
//   hero    the phone: under the project name, 28 pt avatars, the short text,
//           a chevron, and (once per account) the question card under the row;
//   header  the desktop workspace header: 24 pt avatars beside the name, the
//           text only at content width 1280 and up. No new row.
//
// One Pressable, root testID "whoson-stack". Pressing it calls `onOpen`, which
// the project page wires to the Team section it already has. There is no sheet
// of its own: a second modal on an iPhone is dropped by UIKit.
//
// It returns NULL whenever the read is unknown: not settled, failed, or zero
// rows. Not a zero-height view. Under the jest default (an empty rpc answer)
// and with the feature off, nothing renders and no golden changes.
//
// Who sees what is decided by the server and locked again in
// utils/whoson/people.ts peopleModel: the project owner gets the list; a team
// member gets the owner and himself, never a chip, never a count.
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import type { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { useProjectPeople } from '@/hooks/useProjectPeople';
import { useWhosOnCopy } from '@/hooks/useWhosOnCopy';
import { WHOS_ON_ENABLED } from '@/constants/featureFlags';
import { WHOSON, stackSlots } from '@/utils/whoson/people';
import { PeopleOverflowChip, PersonAvatar, PRESENCE_RING } from './PersonAvatar';
import { PresenceChoiceCard } from './PresenceChoiceCard';
import { WhosOnBoundary } from './WhosOnBoundary';

export interface ProjectPeopleStackProps {
  projectId: string | null | undefined;
  variant: 'hero' | 'header';
  /** Show the word "Invite" to an owner nobody has joined. The project page
   *  passes false when this project's client portal is on (spec D10). */
  inviteNudge: boolean;
  /** Open the Team section. */
  onOpen: () => void;
}

/** Content width at which the desktop header has room for the text and a fourth slot. */
const HEADER_WIDE = 1280;

function ProjectPeopleStackInner({ projectId, variant, inviteNudge, onOpen }: ProjectPeopleStackProps) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const copy = useWhosOnCopy();
  const { width, sidebarWidth } = useResponsiveLayout();
  const { model, view } = useProjectPeople(projectId);

  if (view !== 'list' || !model.known || !model.owner || !model.self) return null;

  const hero = variant === 'hero';
  const wide = hero || width - sidebarWidth >= HEADER_WIDE;
  const size = hero ? 28 : 24;
  const overlap = (hero ? 8 : 6) + PRESENCE_RING * 2;
  // The phone hero is a card (surface); the desktop header sits on the page.
  const ground = hero ? 'surface' : 'bg';
  const max = hero ? WHOSON.STACK_MAX_PHONE : wide ? WHOSON.STACK_MAX_DESKTOP : WHOSON.STACK_MAX_DESKTOP - 1;
  const slots = stackSlots(model, max);
  const ownerAlone = model.viewerIsOwner && !model.shared;
  // The question is for anyone on a shared project who has not answered it.
  const unanswered = model.shared && model.choice === null;

  let text: string | null = null;
  const a11y: string[] = [];
  if (ownerAlone) {
    text = copy.stackEmpty;
    a11y.push(copy.stackA11yEmpty);
  } else if (model.viewerIsOwner) {
    if (model.openOthers > 0) text = copy.stackOpen(model.openOthers);
    a11y.push(copy.stackA11y(model.members.length + 1));
    if (model.openOthers > 0) a11y.push(copy.stackA11yOpen(model.openOthers));
  } else {
    const ownerOpen = model.openIds.includes(model.owner.userId);
    if (ownerOpen) text = copy.stackOwnerOpen;
    a11y.push(copy.stackA11yMember);
    if (ownerOpen) a11y.push(`${copy.stackOwnerOpen}.`);
  }
  const showInvite = ownerAlone && inviteNudge;
  if (showInvite) a11y.push(`${copy.stackInvite}.`);
  const showChoose = !hero && unanswered;
  if (showChoose) a11y.push(`${copy.stackChoose}.`);

  return (
    <>
      <Pressable
        testID="whoson-stack"
        accessibilityRole="button"
        accessibilityLabel={a11y.join(' ')}
        onPress={onOpen}
        hitSlop={hero ? { top: 8, bottom: 8 } : { top: 6, bottom: 6 }}
        style={hero ? styles.heroRow : styles.headerRow}
      >
        <View style={styles.avatars}>
          {slots.shown.map((p, i) => (
            <PersonAvatar
              key={p.userId}
              person={p}
              size={size}
              overlap={i === 0 ? 0 : overlap}
              open={model.openIds.includes(p.userId)}
              ground={ground}
              layer={slots.shown.length - i}
            />
          ))}
          <PeopleOverflowChip count={slots.overflow} size={size} overlap={overlap} open={slots.overflowOpen} ground={ground} />
        </View>
        {wide && text ? <Text style={styles.text} numberOfLines={1}>{text}</Text> : null}
        {wide && showInvite ? <Text style={styles.accentText} numberOfLines={1}>{copy.stackInvite}</Text> : null}
        {wide && showChoose ? <Text style={styles.accentText} numberOfLines={1}>{copy.stackChoose}</Text> : null}
        {hero ? <View style={styles.spacer} /> : null}
        {hero ? <ChevronRight {...Tokens.iconSize.small} color={colors.textMuted} /> : null}
      </Pressable>
      {hero && unanswered ? <View style={styles.choice}><PresenceChoiceCard /></View> : null}
    </>
  );
}

export function ProjectPeopleStack(props: ProjectPeopleStackProps) {
  if (!WHOS_ON_ENABLED) return null;
  return <WhosOnBoundary><ProjectPeopleStackInner {...props} /></WhosOnBoundary>;
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xs, marginTop: Tokens.spacing.xs, minHeight: 28 + PRESENCE_RING * 2 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xs, flexShrink: 0 },
  avatars: { flexDirection: 'row', alignItems: 'center', flexShrink: 0 },
  text: { ...Type.footnote, color: t.textSecondary, flexShrink: 1 },
  accentText: { ...Type.footnoteEmphasized, color: t.accentLabel, flexShrink: 0 },
  spacer: { flex: 1 },
  choice: { marginTop: Tokens.spacing.sm },
});

export default ProjectPeopleStack;

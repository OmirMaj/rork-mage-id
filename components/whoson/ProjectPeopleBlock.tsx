// components/whoson/ProjectPeopleBlock.tsx — the top of the Team card (whoson
// spec 1.3 a). Root testID "whoson-people". Returns NULL when the read is
// unknown, so the Team section looks exactly as it does today until the
// server has answered.
//
// The project owner sees:
//   - the one-time question, if he has not answered and somebody has joined;
//   - the switch, if somebody has joined;
//   - with nobody joined: one sentence on what makes a person show up here
//     (the invite form is right below, in the roster);
//   - three footnotes once somebody has joined: what "has it open" means,
//     what does not show, and who is not listed.
//
// A team member sees:
//   - the question, if not answered;
//   - `Project owner: {name}, {company}` (left out when the owner's profile
//     has neither), with "Has it open now" and the dot under it when true.
//     With no owner line above it the dot row names its subject, "The project
//     owner has it open": a bare "Has it open now" directly over the member's
//     own switch would read as the member's own status;
//   - the switch;
//   - the first footnote only.
//
// A team member never sees another team member here: the model holds none.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useProjectPeople } from '@/hooks/useProjectPeople';
import { useWhosOnCopy } from '@/hooks/useWhosOnCopy';
import { WHOS_ON_ENABLED } from '@/constants/featureFlags';
import { personNameParts } from '@/utils/whoson/people';
import { PresenceDot } from './PersonAvatar';
import { PresenceChoiceCard } from './PresenceChoiceCard';
import { SharePresenceSwitchRow } from './SharePresenceSwitchRow';
import { WhosOnBoundary } from './WhosOnBoundary';

export interface ProjectPeopleBlockProps {
  projectId: string | null | undefined;
}

function ProjectPeopleBlockInner({ projectId }: ProjectPeopleBlockProps) {
  const styles = useThemedStyles(makeStyles);
  const copy = useWhosOnCopy();
  const { model, view } = useProjectPeople(projectId);

  if (view !== 'list' || !model.known || !model.owner || !model.self) return null;

  const unanswered = model.shared && model.choice === null;

  if (model.viewerIsOwner) {
    return (
      <View style={styles.root} testID="whoson-people">
        {unanswered ? <PresenceChoiceCard /> : null}
        {model.shared ? <SharePresenceSwitchRow value={model.choice} /> : null}
        {!model.shared ? <Text style={styles.body} testID="whoson-people-empty">{copy.emptyBody}</Text> : null}
        {model.shared ? (
          <View style={styles.foot}>
            <Text style={styles.footText}>{copy.footMeaning}</Text>
            <Text style={styles.footText}>{copy.footGaps}</Text>
            <Text style={styles.footText}>{copy.footWho}</Text>
          </View>
        ) : null}
      </View>
    );
  }

  const { name, company } = personNameParts(model.owner);
  const ownerLine = copy.ownerLine(name, company);
  const ownerOpen = model.openIds.includes(model.owner.userId);
  return (
    <View style={styles.root} testID="whoson-people">
      {unanswered ? <PresenceChoiceCard /> : null}
      {ownerLine || ownerOpen ? (
        <View style={styles.ownerBlock} testID="whoson-people-owner">
          {ownerLine ? <Text style={styles.ownerLine} numberOfLines={2}>{ownerLine}</Text> : null}
          {ownerOpen ? (
            <View style={styles.openRow}>
              <PresenceDot testID="whoson-people-owner-dot" />
              <Text style={styles.open}>{ownerLine ? copy.rowOpen : copy.stackOwnerOpen}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
      <SharePresenceSwitchRow value={model.choice} />
      <View style={styles.foot}>
        <Text style={styles.footText}>{copy.footMeaning}</Text>
      </View>
    </View>
  );
}

export function ProjectPeopleBlock(props: ProjectPeopleBlockProps) {
  if (!WHOS_ON_ENABLED) return null;
  return <WhosOnBoundary><ProjectPeopleBlockInner {...props} /></WhosOnBoundary>;
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { gap: Tokens.spacing.sm, marginBottom: Tokens.spacing.sm },
  body: { ...Type.footnote, color: t.textSecondary },
  ownerBlock: { gap: Tokens.spacing.hairline },
  ownerLine: { ...Type.subhead, color: t.text },
  openRow: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xxs },
  open: { ...Type.caption1, fontWeight: '600', color: t.successLabel },
  foot: { gap: Tokens.spacing.xxs },
  footText: { ...Type.caption1, color: t.textMuted },
});

export default ProjectPeopleBlock;

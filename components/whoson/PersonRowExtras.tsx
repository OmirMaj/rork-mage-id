// components/whoson/PersonRowExtras.tsx — up to three lines under an ACCEPTED
// roster row in the Team section (whoson spec 1.3 b). The roster renders for
// the project owner only, and these lines come from the owner's own read.
//
//   1  `{name} · {company}`: what that account typed on its own profile.
//      Never an email (the row's title, the invited email, is the one thing
//      that is verified).
//   2  `Joined from your invite · Oct 3, 2026`, or `Joined Oct 3, 2026`.
//   3  `Has it open now` with the dot / `Last seen online here 12 min ago` /
//      a date / NOTHING. Nothing means: never opened, chose not to show it,
//      or an older app version. There is no line that says a person is absent.
//
// Root testID `whoson-row-<userId>`. Returns null without a person.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useWhosOnCopy } from '@/hooks/useWhosOnCopy';
import { WHOS_ON_ENABLED } from '@/constants/featureFlags';
import type { ProjectPerson } from '@/types';
import { activityLine, membershipLine, personNameParts } from '@/utils/whoson/people';
import { PresenceDot } from './PersonAvatar';
import { WhosOnBoundary } from './WhosOnBoundary';

export interface PersonRowExtrasProps {
  person: ProjectPerson | null | undefined;
  /** When the read behind `person` was SENT (useProjectPeople().fetchedAtMs). */
  fetchedAtMs: number | null | undefined;
}

function PersonRowExtrasInner({ person, fetchedAtMs }: { person: ProjectPerson; fetchedAtMs: number | null | undefined }) {
  const styles = useThemedStyles(makeStyles);
  const copy = useWhosOnCopy();
  const { name, company } = personNameParts(person);
  const who = copy.nameCompany(name, company);
  const joined = membershipLine(person);
  const activity = activityLine(person, fetchedAtMs, Date.now());
  if (!who && !joined && !activity) return null;
  return (
    <View style={styles.root} testID={`whoson-row-${person.userId}`}>
      {who ? <Text style={styles.who} numberOfLines={1}>{who}</Text> : null}
      {joined ? <Text style={styles.meta} numberOfLines={1}>{copy.membership(joined)}</Text> : null}
      {activity ? (
        <View style={styles.activityRow}>
          {activity.key === 'open' ? <PresenceDot testID={`whoson-row-dot-${person.userId}`} /> : null}
          <Text style={activity.key === 'open' ? styles.open : styles.meta} numberOfLines={1}>{copy.activity(activity)}</Text>
        </View>
      ) : null}
    </View>
  );
}

export function PersonRowExtras({ person, fetchedAtMs }: PersonRowExtrasProps) {
  if (!WHOS_ON_ENABLED || !person) return null;
  return <WhosOnBoundary><PersonRowExtrasInner person={person} fetchedAtMs={fetchedAtMs} /></WhosOnBoundary>;
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { marginTop: Tokens.spacing.hairline, gap: Tokens.spacing.hairline },
  who: { ...Type.footnote, color: t.text },
  meta: { ...Type.caption1, color: t.textSecondary },
  activityRow: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xxs },
  open: { ...Type.caption1, fontWeight: '600', color: t.successLabel },
});

export default PersonRowExtras;

// components/learn/SkillsProfileRow.tsx — the "MAGE ID skills · 3 of 15" row
// that sits directly under the profile hero in Settings and opens
// /skills-certificates.
//
// STATES (the rule behind each: a failed read never looks like "none")
//   signed out → nothing (the hero is not there either);
//   loading    → the label only, no number;
//   error      → "Couldn't load" (only when there is no earlier good list),
//                and the row still opens the screen, which retries;
//   loaded     → "{n} of 15", n = topics whose newest certificate is not
//                revoked (utils/learn/certificateDoc earnedCount).
//
// Looks like the Settings rows around it (a 52 pt row in a hairline group,
// a quiet icon tile, the value right, a chevron), drawn with the Card
// primitive rather than a hand-rolled surface.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { BookOpen, ChevronRight } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useT } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { Type } from '@/constants/typography';
import { Card } from '@/components/ui/Card';
import { useMyCertificates } from '@/utils/learn/certificateClient';
import { SKILL_TOPIC_COUNT, earnedCount } from '@/utils/learn/certificateDoc';

export function SkillsProfileRow() {
  const { isAuthenticated, user } = useAuth();
  if (!isAuthenticated || !user) return null;
  return <SkillsProfileRowBody />;
}

function SkillsProfileRowBody() {
  const { colors } = useTheme();
  const { t } = useT();
  const router = useRouter();
  const certsQ = useMyCertificates();

  const label = t('settings.learn.profileRow', 'MAGE ID skills');
  let value: string | null = null;
  if (certsQ.data) {
    value = t('settings.learn.profileRowValue', '{n} of {total}', {
      n: String(earnedCount(certsQ.data)),
      total: String(SKILL_TOPIC_COUNT),
    });
  } else if (certsQ.isError) {
    value = t('settings.learn.profileRowError', "Couldn't load");
  }

  return (
    <Card
      pressable
      onPress={() => router.push('/skills-certificates')}
      radius="card"
      pad="none"
      accessibilityLabel={value ? `${label}, ${value}` : label}
      style={styles.group}
      testID="settings-skills-row"
    >
      <View style={styles.row}>
        <View style={[styles.iconWrap, { backgroundColor: colors.surfaceAlt }]}>
          <BookOpen size={14} color={colors.textSecondary} strokeWidth={1.75} />
        </View>
        <Text style={[Type.callout, styles.label, { color: colors.text }]} numberOfLines={1}>{label}</Text>
        {value ? (
          <Text
            style={[Type.subhead, styles.value, { color: certsQ.data ? colors.textSecondary : colors.warningLabel }]}
            numberOfLines={1}
            testID="settings-skills-row-value"
          >
            {value}
          </Text>
        ) : null}
        <ChevronRight size={18} color={colors.textMuted} strokeWidth={1.75} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  group: { marginHorizontal: 16, marginBottom: 20, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12, minHeight: 52 },
  iconWrap: { width: 30, height: 30, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  label: { flex: 1 },
  value: { marginRight: 4 },
});

export default SkillsProfileRow;

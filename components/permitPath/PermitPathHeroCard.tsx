// components/permitPath/PermitPathHeroCard.tsx — the way into Permit Path from
// Construction AI's "Permit Path" segment, the Permits screen and the project
// hub (lane PPUI, M8). A mini spine of the next three stations (take D's login
// mini spine), what is not known yet, and "Open Permit Path".
//
// Renders nothing without a job. Free on every tier (PLAN F1): no gate.

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { MapPin } from 'lucide-react-native';
import type { ThemeColors } from '@/constants/colors';
import type { Project } from '@/types';
import { Type } from '@/constants/typography';
import { useTheme } from '@/contexts/ThemeContext';
import { useT } from '@/contexts/LanguageContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { usePermitPath } from '@/hooks/usePermitPath';
import { Button, Card } from '@/components/ui';
import { RouteSpine } from '@/components/permitPath/RouteSpine';
import type { PermitRoute, StationId } from '@/utils/permitPath/types';

export interface PermitPathHeroCardProps {
  project: Project | null | undefined;
  /** The Permits screen's one-row form: no mini spine. */
  compact?: boolean;
  testID?: string;
}

/** The next three stations from "You are here" (skipping the ones not needed). */
export function nextStations(route: PermitRoute, n = 3): StationId[] {
  const live = route.stations.filter((s) => s.state !== 'not_needed');
  const at = Math.max(0, live.findIndex((s) => s.state === 'current'));
  return live.slice(at, at + n).map((s) => s.id);
}

export function PermitPathHeroCard({ project, compact = false, testID = 'permit-path-hero' }: PermitPathHeroCardProps) {
  if (!project) return null;
  return <HeroBody project={project} compact={compact} testID={testID} />;
}

function HeroBody({ project, compact, testID }: { project: Project; compact: boolean; testID: string }) {
  const styles = useThemedStyles(makeStyles);
  const { colors: c } = useTheme();
  const { t, tn } = useT();
  const router = useRouter();
  const pp = usePermitPath(project);
  const route = pp.route;
  const only = useMemo(() => (route ? nextStations(route) : []), [route]);
  if (!route) return null;

  const live = route.stations.filter((s) => s.state !== 'not_needed');
  const here = live.find((s) => s.state === 'current') ?? null;
  const open = () => router.push({ pathname: '/permit-path', params: { projectId: project.id } });

  return (
    <Card style={styles.card} testID={testID}>
      <View style={styles.head}>
        <MapPin size={18} color={c.accent} />
        <Text style={styles.heroHead}>{t('office.permitPath.hero.heading', 'Permit Path')}</Text>
      </View>
      <Text style={styles.line} testID={`${testID}-where`}>
        {here
          ? tn('office.permitPath.hero.where', live.length, { one: '1 station · you’re at {station}', other: '{count} stations · you’re at {station}' }, { station: here.title })
          : tn('office.permitPath.hero.stations', live.length, { one: '1 station', other: '{count} stations' })}
      </Text>
      {!compact && only.length ? (
        <RouteSpine route={route} selected={null} onSelect={open} only={only} compact testID={`${testID}-spine`} />
      ) : null}
      {route.unknownCount > 0 ? (
        <Text style={styles.unknown} testID={`${testID}-unknown`}>
          {tn('office.permitPath.hero.unknown', route.unknownCount, { one: '1 not known yet', other: '{count} not known yet' })}
        </Text>
      ) : null}
      <Button
        label={t('office.permitPath.hero.open', 'Open Permit Path')}
        size="sm"
        variant={compact ? 'secondary' : 'primary'}
        onPress={open}
        containerStyle={styles.alignStart}
        testID={`${testID}-open`}
      />
    </Card>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    card: { marginBottom: 16, gap: 6 },
    head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    heroHead: { ...Type.serifHeadline, color: c.text },
    line: { ...Type.footnote, color: c.textSecondary },
    unknown: { ...Type.footnoteEmphasized, color: c.warningLabel },
    alignStart: { alignSelf: 'flex-start', marginTop: 4 },
  });
}

export default PermitPathHeroCard;

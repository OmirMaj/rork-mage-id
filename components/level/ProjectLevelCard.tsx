// components/level/ProjectLevelCard.tsx — The Level on the project hub.
//
// The hub is the one screen about ONE job, so it shows the same instrument as
// the Home rows and the desktop portfolio (utils/jobLevel + JobLevel), read the
// same way:
//   • the SCHEDULE half comes from utils/portfolio/portfolioRow's own
//     buildPortfolioRows, exactly as hooks/useJobLevel derives it, so the hub
//     and Home read one slip;
//   • the MARGIN half comes from the job page's one pulse (hooks/useProjectPulse,
//     read once in app/project-detail and passed in) through
//     jobLevelFromPulse — the same risk object ProjectHero prints as its
//     "Margin risk" band, so the colour and the words can never disagree;
//   • open punch and late RFIs are LISTED in the reasons, never drawn.
//
// It always renders for a real project, including no data: then it is the
// grey, hollow vial and "Not enough data yet" — never a level-and-fine bubble
// by default. Tap the Level for the reasons sheet (with the full legend).
//
// Phone: a full-width card (the hero card's 20 pt margins), the Level centred,
// two legend lines under it. Desktop: a compact row under the KPI strip — the
// Level on the left, the legend on the right.
//
// No writes, no storage, no AI. Theme + Type tokens only.

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Project } from '@/types';
import type { ProjectPulse } from '@/utils/projectWorkspaceLayout';
import { Card } from '@/components/ui';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useT } from '@/contexts/LanguageContext';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { buildPortfolioRows } from '@/utils/portfolio/portfolioRow';
import { jobLevelFromPulse } from '@/utils/jobLevel';
import { JobLevel } from './JobLevel';

const NO_BURN = new Map<string, never>();

export interface ProjectLevelCardProps {
  project: Project;
  pulse: ProjectPulse;
  testID?: string;
}

export function ProjectLevelCard({ project, pulse, testID = 'project-level-card' }: ProjectLevelCardProps) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useT();
  const { isDesktop } = useResponsiveLayout();

  // The schedule half, derived exactly as hooks/useJobLevel derives it.
  const schedule = useMemo(() => buildPortfolioRows({
    projects: [project], invoices: [], changeOrders: [], rfis: [], punchItems: [],
    burnByProject: NO_BURN, now: new Date(),
  })[0]?.schedule ?? null, [project]);

  const { canSeeMoney, roleLoading, costSourcesReady, risk, overdueRfis, punch } = pulse;
  const openPunch = punch.open + punch.inProgress + punch.readyForReview;
  const reading = useMemo(
    () => jobLevelFromPulse(schedule, { canSeeMoney, roleLoading, costSourcesReady, risk, openPunch, overdueRfis }),
    [schedule, canSeeMoney, roleLoading, costSourcesReady, risk, openPunch, overdueRfis],
  );

  if (!pulse.hasProject) return null;

  const level = (
    <JobLevel projectId={project.id} reading={reading} size="detail" showLabel projectName={project.name} testID="project-level" />
  );
  const legend = (
    <View style={styles.legend} testID="project-level-legend">
      <Text style={styles.legendLine}>{t('office.projectHealth.legend.bubble', 'The bubble moves right when the finish slips past the baseline.')}</Text>
      <Text style={styles.legendLine}>{t('office.projectHealth.legend.colour', 'The color is margin risk.')}</Text>
    </View>
  );

  return (
    <Card radius="panel" pad={16} style={isDesktop ? styles.wrapDesktop : styles.wrap} testID={testID}>
      <Text style={styles.eyebrow} accessibilityRole="header">{t('office.projectHealth.title', 'Project health')}</Text>
      {isDesktop ? (
        <View style={styles.levelRow}>
          <View style={styles.levelSide}>{level}</View>
          {legend}
        </View>
      ) : (
        <>
          <View style={styles.levelPhone}>{level}</View>
          {legend}
        </>
      )}
    </Card>
  );
}

export default ProjectLevelCard;

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  wrap: { marginHorizontal: 20, marginTop: 16, gap: Tokens.spacing.sm },
  wrapDesktop: { gap: Tokens.spacing.sm },
  eyebrow: { ...Type.monoCaption, color: t.textMuted, letterSpacing: 1.4, textTransform: 'uppercase' },
  levelPhone: { alignItems: 'center', paddingVertical: Tokens.spacing.sm },
  levelRow: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.lg },
  levelSide: { flexShrink: 0, maxWidth: '50%' },
  legend: { gap: 4, flexShrink: 1, minWidth: 0 },
  legendLine: { ...Type.footnote, color: t.textSecondary },
});

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Easing } from 'react-native';
import {
  Building2, Hammer, Plus, PenLine, Store, Trees, Home,
  LayoutGrid, Paintbrush, Droplets, Zap, Boxes, ChevronRight, MapPin,
} from 'lucide-react-native';
import { formatMoney, displayText } from '@/utils/formatters';
import type { Project, ProjectType } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { EyebrowLabel } from '@/components/ui/EyebrowLabel';
import type { ThemeColors } from '@/constants/colors';

const ICON_MAP: Record<string, React.ComponentType<{ size: number; color: string; strokeWidth?: number }>> = {
  Building2, Hammer, Plus, PenLine, Store, Trees, Home, LayoutGrid, Paintbrush, Droplets, Zap, Boxes,
};

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  estimated: 'Estimated',
  in_progress: 'In Progress',
  completed: 'Completed',
  closed: 'Closed',
};

const STATUS_BADGE_TONE: Record<string, BadgeTone> = {
  draft: 'warn',
  estimated: 'success',
  in_progress: 'info',
  completed: 'warn',
  closed: 'neutral',
};

const TYPE_ICON_MAP: Record<ProjectType, string> = {
  new_build: 'Building2', renovation: 'Hammer', addition: 'Plus', remodel: 'PenLine',
  commercial: 'Store', landscape: 'Trees', roofing: 'Home', flooring: 'LayoutGrid',
  painting: 'Paintbrush', plumbing: 'Droplets', electrical: 'Zap', concrete: 'Boxes',
};

function getTypeIcon(type: ProjectType) {
  return ICON_MAP[TYPE_ICON_MAP[type]] ?? Building2;
}

interface ProjectCardProps {
  project: Project;
  onPress: () => void;
  onLongPress?: () => void;
  /** Index in the parent list — used to stagger the mount-fade so cards
   *  cascade in (40ms apart) instead of all appearing at once. */
  index?: number;
}

function ProjectCard({ project, onPress, onLongPress, index = 0 }: ProjectCardProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const scaleAnim = useRef(new Animated.Value(1)).current;
  // Mount-time fade + slide so cards feel like they're being laid down
  // instead of just appearing. Subtle (140ms, 8px) — premium without
  // being theatrical.
  const enterAnim = useRef(new Animated.Value(0)).current;
  // Animated burn-bar on the bottom edge of the card. Drives a width
  // interpolation so the bar "fills up" on first render.
  const burnAnim = useRef(new Animated.Value(0)).current;

  const IconComponent = getTypeIcon(project.type);
  const statusLabel = STATUS_LABEL[project.status] ?? 'Draft';
  const statusTone: BadgeTone = STATUS_BADGE_TONE[project.status] ?? 'neutral';

  const linkedEstimate = project.linkedEstimate;
  const legacyEstimate = project.estimate;
  const hasEstimate = !!(linkedEstimate && linkedEstimate.items.length > 0) || !!legacyEstimate;
  const estimateTotal = linkedEstimate && linkedEstimate.items.length > 0
    ? linkedEstimate.grandTotal
    : legacyEstimate?.grandTotal ?? 0;

  // Gross-margin pill — markupTotal / grandTotal as a percent. Only shows
  // when we have a LinkedEstimate with items (legacy `estimate` doesn't
  // carry a cost/profit split). Color-coded so a glance at the home tab
  // surfaces the at-risk jobs: red < 10 %, amber 10-20 %, green ≥ 20 %.
  // Pre-fix the project list had no profit-margin surface anywhere —
  // the data was computed but never shown. Audit's #1 "quick win."
  const showMarginPill = !!(linkedEstimate && linkedEstimate.items.length > 0 && linkedEstimate.grandTotal > 0);
  const marginPct = showMarginPill
    ? Math.round((linkedEstimate!.markupTotal / linkedEstimate!.grandTotal) * 100)
    : 0;
  const marginTone: BadgeTone = marginPct >= 20 ? 'success'
    : marginPct >= 10 ? 'warn'
    : 'danger';

  // Budget burn — invoiced ÷ estimate.
  const invoicedTotal = (project as { invoicedTotal?: number }).invoicedTotal ?? 0;
  const burnRatio = hasEstimate && estimateTotal > 0
    ? Math.min(1, invoicedTotal / estimateTotal)
    : 0;
  const showBurnBar = hasEstimate && burnRatio > 0;
  const burnIsHigh = burnRatio >= 0.9;

  useEffect(() => {
    // Stagger cap at index 8 so a 50-project list still feels snappy (max 320ms total cascade).
    const stagger = Math.min(index, 8) * 40;
    Animated.timing(enterAnim, {
      toValue: 1,
      duration: 220,
      delay: stagger,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    if (showBurnBar) {
      Animated.timing(burnAnim, {
        toValue: burnRatio,
        duration: 900,
        delay: 120 + stagger,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start();
    }
  }, [enterAnim, burnAnim, burnRatio, showBurnBar, index]);

  const handlePressIn = () => {
    Animated.spring(scaleAnim, { toValue: 0.975, useNativeDriver: true, speed: 60, bounciness: 0 }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
  };

  const enterTranslate = enterAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [8, 0],
  });
  const burnWidth = burnAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <Animated.View
      style={[
        styles.wrapper,
        {
          opacity: enterAnim,
          transform: [{ scale: scaleAnim }, { translateY: enterTranslate }],
        },
      ]}
    >
      <TouchableOpacity
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={350}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={1}
        testID={`project-card-${project.id}`}
        accessibilityRole="button"
        accessibilityLabel={`Open project: ${project.name}, status ${statusLabel}`}
      >
        <View style={styles.card}>
          <View style={styles.topRow}>
            <View style={styles.iconWrap}>
              <IconComponent size={20} color={colors.accent} strokeWidth={1.8} />
            </View>
            <View style={styles.titleBlock}>
              <EyebrowLabel tone="amber">Project</EyebrowLabel>
              <Text style={[Type.serifHeadline, { color: colors.text, marginTop: 2 }]} numberOfLines={2}>
                {project.name}
              </Text>
              {displayText(project.location) ? (
                <View style={styles.locationRow}>
                  <MapPin size={11} color={colors.textMuted} strokeWidth={1.75} />
                  <Text style={[Type.monoCaption, { color: colors.textMuted }]} numberOfLines={1}>
                    {displayText(project.location)}
                  </Text>
                </View>
              ) : null}
            </View>
            <View style={styles.statusCol}>
              <Badge tone={statusTone} dot>{statusLabel}</Badge>
              {showMarginPill && (
                <Badge tone={marginTone}>
                  {`GP ${marginPct}%`}
                </Badge>
              )}
            </View>
          </View>

          <View style={styles.separator} />

          <View style={styles.bottomRow}>
            <View style={styles.metaItem}>
              <Text style={[Type.caption2, { color: colors.textMuted }]}>Area</Text>
              <Text style={[styles.metaValue, { color: colors.text }]}>
                {project.squareFootage > 0 ? `${project.squareFootage.toLocaleString()} sf` : '—'}
              </Text>
            </View>
            <View style={styles.metaDivider} />
            <View style={styles.metaItem}>
              <Text style={[Type.caption2, { color: colors.textMuted }]}>Quality</Text>
              <Text style={[styles.metaValue, { color: colors.text }]}>
                {project.quality.charAt(0).toUpperCase() + project.quality.slice(1)}
              </Text>
            </View>
            <View style={styles.metaDivider} />
            <View style={styles.metaItem}>
              <Text style={[Type.caption2, { color: colors.textMuted }]}>Estimate</Text>
              <Text style={[styles.metaValue, hasEstimate && { color: colors.accentLabel }]}>
                {hasEstimate ? formatMoney(estimateTotal) : '—'}
              </Text>
            </View>
            <ChevronRight size={16} color={colors.textMuted} strokeWidth={1.8} style={styles.chevron} />
          </View>

          {/* Burn bar — slim track at the bottom edge of the card showing
              what % of the estimate has been billed. Color shifts to
              danger at 90%+ to signal you're nearing scope. */}
          {showBurnBar && (
            <View style={styles.burnTrack}>
              <Animated.View
                style={[
                  styles.burnFill,
                  {
                    width: burnWidth,
                    backgroundColor: burnIsHigh ? colors.danger : colors.accent,
                  },
                ]}
              />
            </View>
          )}
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

export default React.memo(ProjectCard);

const makeStyles = (t: ThemeColors) =>
  StyleSheet.create({
    wrapper: {
      marginHorizontal: 16,
      marginBottom: 10,
    },
    card: {
      backgroundColor: t.surface,
      borderRadius: Tokens.radius.panel,
      borderWidth: 1,
      borderColor: t.line,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.06,
      shadowRadius: 12,
      elevation: 5,
      overflow: 'hidden' as const,
      ...Tokens.continuousCorners,
    },
    topRow: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 16,
      gap: 12,
    },
    // Stacks status badge over the gross-margin pill. Both right-aligned
    // so the eye lands on the workflow state first, then the money state.
    statusCol: {
      alignItems: 'flex-end' as const,
      gap: 6,
    },
    iconWrap: {
      width: 42,
      height: 42,
      borderRadius: Tokens.radius.card,
      backgroundColor: t.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    titleBlock: {
      flex: 1,
      gap: 2,
    },
    locationRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      marginTop: 2,
    },
    separator: {
      height: 0.5,
      backgroundColor: t.line,
      marginHorizontal: 16,
    },
    bottomRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 14,
      gap: 4,
    },
    metaItem: {
      flex: 1,
      gap: 2,
    },
    metaValue: {
      fontSize: Type.subhead.fontSize,
      fontWeight: '700' as const,
      letterSpacing: -0.2,
    },
    metaDivider: {
      width: 0.5,
      height: 28,
      backgroundColor: t.line,
      marginHorizontal: 8,
    },
    chevron: {
      marginLeft: 4,
    },
    burnTrack: {
      height: 3,
      backgroundColor: t.line,
      width: '100%' as const,
    },
    burnFill: {
      height: 3,
    },
  });

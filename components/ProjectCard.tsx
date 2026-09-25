import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Easing } from 'react-native';
import {
  Building2, Hammer, Plus, PenLine, Store, Trees, Home,
  LayoutGrid, Paintbrush, Droplets, Zap, Boxes, Wrench, ChevronRight, MapPin,
} from 'lucide-react-native';
import { formatMoney, displayText } from '@/utils/formatters';
import type { Project, ProjectType } from '@/types';
import { projectTypeLabel } from '@/utils/projectTypes';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { nativeDriver, reducedMotion } from '@/components/ui/motion';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { EyebrowLabel } from '@/components/ui/EyebrowLabel';
// Wave 6c (C2): the badge speaks utils/projectStage's words — the same ones as
// the Home chips and the job page ('Construction', 'Post-Con', 'Closeout').
import { statusLabel as stageStatusLabel } from '@/utils/projectStage';
import type { ThemeColors } from '@/constants/colors';

const ICON_MAP: Record<string, React.ComponentType<{ size: number; color: string; strokeWidth?: number }>> = {
  Building2, Hammer, Plus, PenLine, Store, Trees, Home, LayoutGrid, Paintbrush, Droplets, Zap, Boxes, Wrench,
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
  other: 'Wrench',
};

function getTypeIcon(type: ProjectType) {
  return ICON_MAP[TYPE_ICON_MAP[type]] ?? Building2;
}

interface ProjectCardProps {
  project: Project;
  onPress: () => void;
  onLongPress?: () => void;
  /** Index in the parent list — used to stagger the mount-fade so cards
   *  cascade in (30ms apart, the first five) instead of all appearing at once. */
  index?: number;
  /** Mount already settled: no fade-and-rise. Home passes it once the list has
   *  painted, so a card a stage chip brings back does not replay its entrance
   *  beside the cards gliding to their new rows. */
  skipEntrance?: boolean;
  /** Billed to date on this job (non-draft invoices). `undefined` until the
   *  invoices have been read — no bar is drawn from a number with no source
   *  (audit wave 5, #151). */
  invoicedToDate?: number;
  /** Estimate + approved change orders — the burn denominator. */
  revisedContract?: number;
}

/** The entrance delay for the card at `index`: 30 ms apart, the first five
 *  only, so even a 50-job list has settled 120 ms after the first card. */
export function entranceStagger(index: number): number {
  return Math.min(Math.max(0, index), 4) * 30;
}

function ProjectCard({ project, onPress, onLongPress, index = 0, skipEntrance = false, invoicedToDate, revisedContract }: ProjectCardProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const scaleAnim = useRef(new Animated.Value(1)).current;
  // Mount-time fade + slide so cards feel like they're being laid down
  // instead of just appearing. Subtle (140ms, 8px) — premium without
  // being theatrical.
  const enterAnim = useRef(new Animated.Value(0)).current;
  // Animated burn-bar on the bottom edge of the card. The fill is laid out at
  // its final width and scaleX runs 0 → 1 from the left edge on the native
  // driver: a width animation re-laid-out up to 8 cards every frame on the JS
  // thread during hydration, which is what stalled the first scroll.
  const burnAnim = useRef(new Animated.Value(0)).current;
  const shownBurnRatio = useRef(0);

  const IconComponent = getTypeIcon(project.type);
  const statusLabel = stageStatusLabel(project.status);
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

  // Budget burn — billed ÷ revised contract (estimate + approved COs). This
  // read `project.invoicedTotal`, a field nothing ever wrote, so the bar never
  // drew (#151). Both numbers now come from the caller; unknown either side =
  // no bar.
  const burnRatio = invoicedToDate != null && revisedContract != null && revisedContract > 0
    ? Math.min(1, Math.max(0, invoicedToDate / revisedContract))
    : 0;
  const showBurnBar = burnRatio > 0;
  const burnIsHigh = burnRatio >= 0.9;

  // The entrance plays once, when the card mounts: a card re-rendered with a
  // new index (a filter change) is already in place. Skipped (skipEntrance, or
  // Reduce Motion) it is the same animation at zero duration and no delay, so
  // the card lands in place on its first frame through the one code path.
  useEffect(() => {
    const instant = skipEntrance || reducedMotion();
    Animated.timing(enterAnim, {
      toValue: 1,
      duration: instant ? 0 : 220,
      delay: instant ? 0 : entranceStagger(index),
      easing: Easing.out(Easing.cubic),
      useNativeDriver: nativeDriver,
    }).start();
    // Mount-only on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!showBurnBar) {
      shownBurnRatio.current = 0;
      return;
    }
    const was = shownBurnRatio.current;
    shownBurnRatio.current = burnRatio;
    if (reducedMotion()) {
      burnAnim.setValue(1);
      return;
    }
    // First show: fill from empty. A later change (an invoice landed): grow or
    // shrink from the old fill, which at the new width is was / now.
    burnAnim.setValue(was > 0 ? was / burnRatio : 0);
    Animated.timing(burnAnim, {
      toValue: 1,
      duration: 450,
      delay: was > 0 || skipEntrance ? 0 : entranceStagger(index),
      easing: Easing.out(Easing.cubic),
      useNativeDriver: nativeDriver,
    }).start();
    // index / skipEntrance only shape the first delay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [burnAnim, burnRatio, showBurnBar]);

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
              {/* Q6: an Other job's icon is a generic wrench, so the eyebrow
                  carries its words ("Whole-house repipe"), never "other". */}
              <EyebrowLabel tone="amber">{project.type === 'other' ? projectTypeLabel(project) : 'Project'}</EyebrowLabel>
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
                    width: `${Math.round(burnRatio * 1000) / 10}%` as const,
                    backgroundColor: burnIsHigh ? colors.danger : colors.accent,
                    transform: [{ scaleX: burnAnim }],
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
      transformOrigin: 'left',
    },
  });

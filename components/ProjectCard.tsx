import React, { useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Easing } from 'react-native';
import {
  Building2, Hammer, Plus, PenLine, Store, Trees, Home,
  LayoutGrid, Paintbrush, Droplets, Zap, Boxes, ChevronRight, MapPin,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useThemedColors, type ThemedPalette } from '@/hooks/useThemedColors';
import { formatMoney } from '@/utils/formatters';
import type { Project, ProjectType } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

const ICON_MAP: Record<string, React.ComponentType<{ size: number; color: string; strokeWidth?: number }>> = {
  Building2, Hammer, Plus, PenLine, Store, Trees, Home, LayoutGrid, Paintbrush, Droplets, Zap, Boxes,
};

// Type-color map stays fixed across themes — the type accent is a brand
// signal (renovation = amber, plumbing = sky, etc.), not surface chrome.
const TYPE_COLOR_MAP: Record<ProjectType, string> = {
  new_build:  '#059669', // emerald — fresh build
  renovation: '#D97706', // amber   — sawdust / heat-of-work
  addition:   '#1A6B3C', // brand primary — extension of an existing job
  remodel:    '#7C3AED', // violet  — design-led refresh
  commercial: '#4F46E5', // indigo  — office / retail
  landscape:  '#16A34A', // green   — trees
  roofing:    '#E11D48', // rose    — alarm of weather / tarp
  flooring:   '#0D9488', // teal    — surface / cool tones
  painting:   '#F97316', // orange  — pigment
  plumbing:   '#0284C7', // sky     — water
  electrical: '#EAB308', // yellow  — spark
  concrete:   '#475569', // slate   — material
};

const TYPE_ICON_MAP: Record<ProjectType, string> = {
  new_build: 'Building2', renovation: 'Hammer', addition: 'Plus', remodel: 'PenLine',
  commercial: 'Store', landscape: 'Trees', roofing: 'Home', flooring: 'LayoutGrid',
  painting: 'Paintbrush', plumbing: 'Droplets', electrical: 'Zap', concrete: 'Boxes',
};

function getTypeIcon(type: ProjectType) {
  return ICON_MAP[TYPE_ICON_MAP[type]] ?? Building2;
}

function statusConfigFor(status: string, c: ThemedPalette) {
  const map: Record<string, { label: string; color: string }> = {
    draft:       { label: 'Draft',       color: c.warning },
    estimated:   { label: 'Estimated',   color: c.success },
    in_progress: { label: 'In Progress', color: c.info },
    // 'completed' = punch / closeout phase. Brand-orange reads as
    // "delivered, finalize me." 'closed' is the truly archived state —
    // keep that muted.
    completed:   { label: 'Completed',   color: c.primary },
    closed:      { label: 'Closed',      color: c.textSecondary },
  };
  return map[status] ?? map.draft;
}

function makeStyles(c: ThemedPalette) {
  return StyleSheet.create({
    wrapper: {
      marginHorizontal: Tokens.spacing.md,
      marginBottom: 10,
    },
    card: {
      backgroundColor: c.surface,
      borderRadius: Tokens.radius.panel,
      // Match cardBorder (solid black in light, faint cream in dark) used
      // everywhere else. Crisp defined container, not floating tile.
      borderWidth: 1,
      borderColor: c.cardBorder,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: c.isDark ? 0.30 : 0.10,
      shadowRadius: 12,
      elevation: 5,
      overflow: 'hidden' as const,
    },
    topRow: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: Tokens.spacing.md,
      gap: Tokens.spacing.sm,
    },
    iconWrap: {
      width: 42,
      height: 42,
      borderRadius: Tokens.radius.card,
      alignItems: 'center',
      justifyContent: 'center',
    },
    titleBlock: {
      flex: 1,
      gap: 3,
    },
    name: {
      // Bumped from 16/600 → 17/800 with tighter tracking. Project name
      // is the primary identifier on each card; it should feel anchored
      // and confident, not whispered.
      fontSize: Type.body.fontSize,
      fontWeight: '800' as const,
      color: c.text,
      letterSpacing: -0.3,
    },
    locationRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
    },
    locationText: {
      fontSize: Type.caption1.fontSize,
      color: c.textMuted,
    },
    statusDot: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: Tokens.spacing.xs,
      paddingVertical: Tokens.spacing.xxs,
      borderRadius: 20,
    },
    statusDotInner: {
      width: 6,
      height: 6,
      borderRadius: 3,
    },
    statusLabel: {
      fontSize: Type.caption2.fontSize,
      fontWeight: '600' as const,
    },
    separator: {
      height: 0.5,
      backgroundColor: c.borderLight,
      marginHorizontal: Tokens.spacing.md,
    },
    bottomRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: Tokens.spacing.md,
      paddingVertical: 14,
      gap: Tokens.spacing.xxs,
    },
    metaItem: {
      flex: 1,
      gap: Tokens.spacing.hairline,
    },
    metaLabel: {
      fontSize: Type.caption2.fontSize,
      color: c.textMuted,
      fontWeight: '400' as const,
    },
    metaValue: {
      fontSize: Type.subhead.fontSize,
      fontWeight: '700' as const,
      color: c.text,
      letterSpacing: -0.2,
    },
    estimateHighlight: {
      color: c.primary,
      fontWeight: '800' as const,
    },
    metaDivider: {
      width: 0.5,
      height: 28,
      backgroundColor: c.borderLight,
      marginHorizontal: Tokens.spacing.xs,
    },
    chevron: {
      marginLeft: Tokens.spacing.xxs,
    },
    burnTrack: {
      height: 3,
      backgroundColor: c.fillTertiary,
      width: '100%' as const,
    },
    burnFill: {
      height: 3,
    },
  });
}

interface ProjectCardProps {
  project: Project;
  onPress: () => void;
  onLongPress?: () => void;
}

function ProjectCard({ project, onPress, onLongPress }: ProjectCardProps) {
  const c = useThemedColors();
  const styles = useMemo(() => makeStyles(c), [c]);

  const scaleAnim = useRef(new Animated.Value(1)).current;
  // Mount-time fade + slide so cards feel like they're being laid down
  // instead of just appearing. Subtle (140ms, 8px) — premium without
  // being theatrical.
  const enterAnim = useRef(new Animated.Value(0)).current;
  // Animated burn-bar on the bottom edge of the card. Drives a width
  // interpolation so the bar "fills up" on first render, similar to
  // the cash-flow ConcretePour but inline.
  const burnAnim = useRef(new Animated.Value(0)).current;

  const IconComponent = getTypeIcon(project.type);
  // Closed projects mute their type accent to slate so the eye lands on
  // active jobs. Everything else carries its full type-specific color.
  const typeColor =
    project.status === 'closed'
      ? c.textSecondary
      : (TYPE_COLOR_MAP[project.type] ?? c.primary);
  const status = statusConfigFor(project.status, c);

  const linkedEstimate = project.linkedEstimate;
  const legacyEstimate = project.estimate;
  const hasEstimate = !!(linkedEstimate && linkedEstimate.items.length > 0) || !!legacyEstimate;
  const estimateTotal = linkedEstimate && linkedEstimate.items.length > 0
    ? linkedEstimate.grandTotal
    : legacyEstimate?.grandTotal ?? 0;

  // Budget burn — invoiced ÷ estimate. We tap project.invoicedTotal
  // when present, otherwise leave the bar hidden. Capped at 1.0.
  const invoicedTotal = (project as { invoicedTotal?: number }).invoicedTotal ?? 0;
  const burnRatio = hasEstimate && estimateTotal > 0
    ? Math.min(1, invoicedTotal / estimateTotal)
    : 0;
  const showBurnBar = hasEstimate && burnRatio > 0;
  const burnIsHigh = burnRatio >= 0.9;

  useEffect(() => {
    Animated.timing(enterAnim, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    if (showBurnBar) {
      Animated.timing(burnAnim, {
        toValue: burnRatio,
        duration: 900,
        delay: 120,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start();
    }
  }, [enterAnim, burnAnim, burnRatio, showBurnBar]);

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
      >
        <View style={styles.card}>
          <View style={styles.topRow}>
            <View style={[styles.iconWrap, { backgroundColor: typeColor + '14' }]}>
              <IconComponent size={20} color={typeColor} strokeWidth={1.8} />
            </View>
            <View style={styles.titleBlock}>
              <Text style={styles.name} numberOfLines={1}>{project.name}</Text>
              {project.location ? (
                <View style={styles.locationRow}>
                  <MapPin size={11} color={c.textMuted} />
                  <Text style={styles.locationText} numberOfLines={1}>{project.location}</Text>
                </View>
              ) : null}
            </View>
            <View style={[styles.statusDot, { backgroundColor: status.color + '20' }]}>
              <View style={[styles.statusDotInner, { backgroundColor: status.color }]} />
              <Text style={[styles.statusLabel, { color: status.color }]}>{status.label}</Text>
            </View>
          </View>

          <View style={styles.separator} />

          <View style={styles.bottomRow}>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Area</Text>
              <Text style={styles.metaValue}>{project.squareFootage > 0 ? `${project.squareFootage.toLocaleString()} sf` : '—'}</Text>
            </View>
            <View style={styles.metaDivider} />
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Quality</Text>
              <Text style={styles.metaValue}>{project.quality.charAt(0).toUpperCase() + project.quality.slice(1)}</Text>
            </View>
            <View style={styles.metaDivider} />
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Estimate</Text>
              <Text style={[styles.metaValue, hasEstimate && styles.estimateHighlight]}>
                {hasEstimate ? formatMoney(estimateTotal) : '—'}
              </Text>
            </View>
            <ChevronRight size={16} color={c.textMuted} strokeWidth={1.8} style={styles.chevron} />
          </View>

          {/* Burn bar — slim track at the bottom edge of the card showing
              what % of the estimate has been billed. Hidden until there's
              an estimate AND any billing activity, so empty projects don't
              get a useless gray sliver. Color shifts to amber at 90%+ to
              signal you're nearing scope. */}
          {showBurnBar && (
            <View style={styles.burnTrack}>
              <Animated.View
                style={[
                  styles.burnFill,
                  {
                    width: burnWidth,
                    backgroundColor: burnIsHigh ? Colors.warning : c.primary,
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

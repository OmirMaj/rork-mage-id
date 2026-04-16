import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import {
  Building2, Hammer, Plus, PenLine, Store, Trees, Home,
  LayoutGrid, Paintbrush, Droplets, Zap, Boxes, ChevronRight, MapPin,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { formatMoney } from '@/utils/formatters';
import type { Project, ProjectType } from '@/types';

const ICON_MAP: Record<string, React.ComponentType<{ size: number; color: string; strokeWidth?: number }>> = {
  Building2, Hammer, Plus, PenLine, Store, Trees, Home, LayoutGrid, Paintbrush, Droplets, Zap, Boxes,
};

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  draft: { label: 'Draft', color: Colors.warning },
  estimated: { label: 'Estimated', color: Colors.success },
  in_progress: { label: 'In Progress', color: Colors.info },
  completed: { label: 'Completed', color: Colors.textSecondary },
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
}

function ProjectCard({ project, onPress }: ProjectCardProps) {
  const scaleAnim = React.useRef(new Animated.Value(1)).current;
  const IconComponent = getTypeIcon(project.type);
  const status = STATUS_CONFIG[project.status] ?? STATUS_CONFIG.draft;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, { toValue: 0.975, useNativeDriver: true, speed: 60, bounciness: 0 }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
  };

  const linkedEstimate = project.linkedEstimate;
  const legacyEstimate = project.estimate;
  const hasEstimate = !!(linkedEstimate && (linkedEstimate.items ?? []).length > 0) || !!legacyEstimate;
  const estimateTotal = linkedEstimate && (linkedEstimate.items ?? []).length > 0
    ? linkedEstimate.grandTotal
    : legacyEstimate?.grandTotal ?? 0;

  return (
    <Animated.View style={[styles.wrapper, { transform: [{ scale: scaleAnim }] }]}>
      <TouchableOpacity
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={1}
        testID={`project-card-${project.id}`}
      >
        <View style={styles.card}>
          <View style={styles.topRow}>
            <View style={styles.iconWrap}>
              <IconComponent size={20} color={Colors.primary} strokeWidth={1.8} />
            </View>
            <View style={styles.titleBlock}>
              <Text style={styles.name} numberOfLines={1}>{project.name}</Text>
              {project.location ? (
                <View style={styles.locationRow}>
                  <MapPin size={11} color={Colors.textMuted} />
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
            <ChevronRight size={16} color={Colors.textMuted} strokeWidth={1.8} style={styles.chevron} />
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

export default React.memo(ProjectCard);

const styles = StyleSheet.create({
  wrapper: {
    marginHorizontal: 16,
    marginBottom: 10,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 3,
    overflow: 'hidden' as const,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: Colors.primary + '12',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleBlock: {
    flex: 1,
    gap: 3,
  },
  name: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.text,
    letterSpacing: -0.2,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  locationText: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  statusDot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 20,
  },
  statusDotInner: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusLabel: {
    fontSize: 11,
    fontWeight: '600' as const,
  },
  separator: {
    height: 0.5,
    backgroundColor: Colors.borderLight,
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
  metaLabel: {
    fontSize: 11,
    color: Colors.textMuted,
    fontWeight: '400' as const,
  },
  metaValue: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
    letterSpacing: -0.2,
  },
  estimateHighlight: {
    color: Colors.primary,
  },
  metaDivider: {
    width: 0.5,
    height: 28,
    backgroundColor: Colors.borderLight,
    marginHorizontal: 8,
  },
  chevron: {
    marginLeft: 4,
  },
});

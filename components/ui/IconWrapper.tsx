// IconWrapper — the "icon in a tinted rounded box" pattern.
//
// Why this exists: the audit found icons sat naked on surfaces across
// the app, producing a flat/wireframe feel. The polished surfaces
// (ProjectCard, EmptyState, AIHomeBriefing) all wrap their icons in a
// tinted background square. This primitive standardizes that pattern.
//
// Usage:
//   <IconWrapper icon={Calendar} tone="accent" />          // 40×40 amber-soft bg, accent icon
//   <IconWrapper icon={DollarSign} tone="success" size="sm" /> // 32×32 success-soft bg
//   <IconWrapper icon={AlertTriangle} tone="danger" size="lg" /> // 48×48
//
// Tones map to theme tokens — no hardcoded colors. Pass `bg` and `color`
// to override (rare; use a tone first).

import React from 'react';
import { View, StyleSheet } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Tokens } from '@/constants/designTokens';
import { useTheme } from '@/contexts/ThemeContext';
import type { ThemeColors } from '@/constants/colors';

export type IconWrapperTone = 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';
export type IconWrapperSize = 'sm' | 'md' | 'lg';

interface IconWrapperProps {
  icon: LucideIcon;
  tone?: IconWrapperTone;
  size?: IconWrapperSize;
  /** Override the box background (rarely needed). */
  bg?: string;
  /** Override the icon color (rarely needed). */
  color?: string;
}

const SIZE_MAP: Record<IconWrapperSize, { box: number; icon: number; stroke: number; radius: number }> = {
  sm: { box: 32, icon: 14, stroke: 2.0, radius: 8 },
  md: { box: 40, icon: 18, stroke: 1.8, radius: 10 },
  lg: { box: 48, icon: 22, stroke: 2.0, radius: 12 },
};

function tonePalette(t: ThemeColors, tone: IconWrapperTone) {
  switch (tone) {
    case 'accent':  return { bg: t.accentSoft, color: t.accent };
    case 'success': return { bg: t.successSoft, color: t.success };
    case 'warning': return { bg: t.accentSoft, color: t.accentLabel };
    case 'danger':  return { bg: t.danger + '1F', color: t.danger };
    case 'info':    return { bg: t.info + '1F', color: t.info };
    case 'neutral':
    default:        return { bg: t.surfaceAlt, color: t.textSecondary };
  }
}

export function IconWrapper({
  icon: Icon, tone = 'accent', size = 'md', bg, color,
}: IconWrapperProps) {
  const { colors } = useTheme();
  const dims = SIZE_MAP[size];
  const palette = tonePalette(colors, tone);
  const resolvedBg = bg ?? palette.bg;
  const resolvedColor = color ?? palette.color;

  return (
    <View style={[
      styles.box,
      {
        width: dims.box,
        height: dims.box,
        borderRadius: dims.radius,
        backgroundColor: resolvedBg,
      },
    ]}>
      <Icon size={dims.icon} color={resolvedColor} strokeWidth={dims.stroke} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    justifyContent: 'center',
    ...Tokens.continuousCorners,
  },
});

export default IconWrapper;

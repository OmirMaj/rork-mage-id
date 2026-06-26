// MageIcon — the icon-system foundation (see docs/icon-audit.md).
//
// Wraps any lucide icon to enforce ONE stroke weight and a fixed size scale,
// so the app's 151 stock icons stop looking unsystematic (today stroke is set
// in only 95/266 files — the rest default to 2.0, mixed with 1.6/1.8/2.4).
// Phase 3 routes lucide through this; pure-utility glyphs (X, chevrons, Check)
// stay lucide but gain a consistent hand. Bespoke construction glyphs live
// alongside it (MageIntelligence, and the domain set to come).

import React from 'react';
import type { LucideProps } from 'lucide-react-native';

/** One stroke for the whole app — refined, between lucide's 2.0 and the thin 1.6. */
export const MAGE_STROKE = 1.75;

/** Fixed size scale — no ad-hoc sizes. */
export const IconSize = {
  inline: 14, // inside a line of text / a chip
  row: 18,    // list rows
  action: 24, // buttons / toolbar
  header: 36, // screen-header hero icon
} as const;

type LucideIcon = React.ComponentType<LucideProps>;

export interface MageIconProps extends Omit<LucideProps, 'size' | 'strokeWidth'> {
  icon: LucideIcon;
  size?: number;
  strokeWidth?: number;
}

export default function MageIcon({
  icon: Icon,
  size = IconSize.row,
  strokeWidth = MAGE_STROKE,
  ...rest
}: MageIconProps) {
  return <Icon size={size} strokeWidth={strokeWidth} {...rest} />;
}

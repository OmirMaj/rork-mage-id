// TrustBadgeRow — the row of trust signals a homeowner sees on a
// GC's public profile and on the marketplace bid-comparison view.
//
// What's it for: homeowners shopping a contractor want signals beyond
// "they sent a bid." Verified license, COI on file, response time,
// past-project count, review rating. Each one is a one-second
// confidence boost. Houzz and Angi don't bundle these as cleanly.
//
// All signals derive from data the GC already has in MAGE ID:
//   - License: utils/contractorLicenses (existing)
//   - COI: utils/coi-vault (existing)
//   - Response time: derived from CommunicationEvent log
//   - Project count: useProjects().projects.length
//   - Reviews: future — placeholder for v2
//
// Renders nothing if no signals are present so the GC profile doesn't
// look empty.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import {
  ShieldCheck, Award, Clock, Hammer, Star, Phone, Mail,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

export interface TrustSignals {
  licenseVerified?: boolean;
  licenseNumber?: string;
  coiOnFile?: boolean;
  coiCoverageLimit?: number;
  /** Average response time in hours, derived from comm events. */
  avgResponseHours?: number;
  /** Number of completed projects on MAGE ID. */
  completedProjectCount?: number;
  /** Average star rating from homeowner reviews. */
  reviewAvg?: number;
  reviewCount?: number;
  /** Years in business. */
  yearsInBusiness?: number;
  /** Has Stripe Connect set up — signals "can take payments". */
  paymentsEnabled?: boolean;
}

interface Props {
  signals: TrustSignals;
  /** If true, render a compact horizontal row instead of a grid. */
  compact?: boolean;
}

interface BadgeDef {
  Icon: React.ComponentType<{ size: number; color: string }>;
  label: string;
  detail?: string;
  tone: 'success' | 'info' | 'warning' | 'accent' | 'neutral';
}

function deriveBadges(s: TrustSignals): BadgeDef[] {
  const out: BadgeDef[] = [];

  if (s.licenseVerified) {
    out.push({
      Icon: ShieldCheck,
      label: 'Licensed',
      detail: s.licenseNumber ? `#${s.licenseNumber}` : undefined,
      tone: 'success',
    });
  }
  if (s.coiOnFile) {
    out.push({
      Icon: Award,
      label: 'Insured',
      detail: s.coiCoverageLimit ? `$${(s.coiCoverageLimit / 1_000_000).toFixed(1)}M cov.` : undefined,
      tone: 'info',
    });
  }
  if (s.avgResponseHours !== undefined && s.avgResponseHours > 0) {
    let label = 'Responsive';
    let detail: string | undefined;
    if (s.avgResponseHours <= 2) {
      label = 'Responds in 2h';
      detail = 'Avg';
    } else if (s.avgResponseHours <= 24) {
      label = 'Responds same day';
    } else if (s.avgResponseHours <= 72) {
      label = 'Responds in 3d';
    }
    out.push({ Icon: Clock, label, detail, tone: 'accent' });
  }
  if (s.completedProjectCount !== undefined && s.completedProjectCount >= 5) {
    out.push({
      Icon: Hammer,
      label: `${s.completedProjectCount}+ projects`,
      tone: 'neutral',
    });
  }
  if (s.reviewAvg !== undefined && s.reviewCount !== undefined && s.reviewCount > 0) {
    out.push({
      Icon: Star,
      label: `${s.reviewAvg.toFixed(1)} (${s.reviewCount})`,
      tone: 'warning',
    });
  }
  if (s.paymentsEnabled) {
    out.push({
      Icon: Award,
      label: 'Accepts cards',
      tone: 'neutral',
    });
  }
  return out;
}

const TONE_BG: Record<BadgeDef['tone'], string> = {
  success: '#34C75920',
  info: '#007AFF20',
  warning: '#FF950020',
  accent: '#FF6A1A20',
  neutral: 'rgba(120,120,128,0.10)',
};
const TONE_FG: Record<BadgeDef['tone'], string> = {
  success: '#1E8E4A',
  info: '#0061CC',
  warning: '#D17C00',
  accent: '#D14E00',
  neutral: '#4B5563',
};

export default function TrustBadgeRow({ signals, compact }: Props) {
  const badges = deriveBadges(signals);
  if (badges.length === 0) return null;

  return (
    <View style={[styles.row, compact && styles.compact]}>
      {badges.map((b, i) => {
        const Icon = b.Icon;
        return (
          <View
            key={`${b.label}-${i}`}
            style={[
              styles.badge,
              { backgroundColor: TONE_BG[b.tone] },
              compact && styles.badgeCompact,
            ]}
          >
            <Icon size={compact ? 11 : 13} color={TONE_FG[b.tone]} />
            <Text style={[styles.label, { color: TONE_FG[b.tone] }]} numberOfLines={1}>
              {b.label}
            </Text>
            {b.detail && !compact && (
              <Text style={[styles.detail, { color: TONE_FG[b.tone] }]}>{b.detail}</Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 6,
  },
  compact: { gap: 4 },
  badge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: Tokens.radius.full,
  },
  badgeCompact: { paddingHorizontal: 7, paddingVertical: 3 },
  label: {
    ...Type.caption1,
    fontWeight: '700' as const,
    letterSpacing: 0.2,
  },
  detail: {
    ...Type.caption2,
    fontWeight: '500' as const,
    opacity: 0.85,
  },
});

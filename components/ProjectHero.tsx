// components/ProjectHero.tsx — the "number-as-hero" financial pulse for a project.
//
// One big number as the subject: projected final margin %, counted up in
// Fraunces, framed by a drafting dimension bracket that measures out to its
// health label. Below it, a spirit level whose bubble settles toward centre when
// the job reads healthy and drifts off as margin risk climbs — then a compact
// row of the numbers that move the finish: owed, schedule, open RFIs, punch.
//
// Self-contained: give it a project and it pulls the collections from context
// and computes everything (computeLivingEstimate + computeMarginRisk). Renders
// nothing when there's no margin basis yet (no budget = no financial pulse).
// RN Animated only (no reanimated); theme + Type tokens (no raw hex / inline
// fontSize).

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import type { Project } from '@/types';
import { useProjects } from '@/contexts/ProjectContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { computeLivingEstimate, type MarginHealth } from '@/utils/livingEstimate';
import { computeMarginRisk, riskBandLabel } from '@/utils/marginRiskScore';
import { getOutstandingBalance } from '@/utils/projectFinancials';
import { useProjectRole } from '@/hooks/useProjectRole';
import { canViewFinancials } from '@/utils/roleBlinding';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

function fmtMoney(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}K`;
  return `${sign}$${Math.round(abs)}`;
}

const HEALTH_LABEL: Record<MarginHealth, string> = { healthy: 'HEALTHY', watch: 'WATCH', critical: 'CRITICAL' };

export default function ProjectHero({ project }: { project: Project }) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { getInvoicesForProject, getChangeOrdersForProject, getCommitmentsForProject, getRFIsForProject, getPunchItemsForProject } = useProjects();
  const role = useProjectRole(project.id);

  const invoices = getInvoicesForProject(project.id);
  const changeOrders = getChangeOrdersForProject(project.id);
  const commitments = getCommitmentsForProject(project.id);
  const rfis = getRFIsForProject(project.id);
  const punch = getPunchItemsForProject(project.id);

  const { living, risk } = useMemo(() => ({
    living: computeLivingEstimate({ project, changeOrders, commitments, invoices }),
    risk: computeMarginRisk({ project, changeOrders, commitments, invoices }),
  }), [project, changeOrders, commitments, invoices]);

  const marginPct = living.projected.marginPct * 100;
  const erosion = living.marginErosionPoints; // pts, negative = eroded from bid
  const health = living.health;

  const owed = getOutstandingBalance(invoices);
  const openRfis = rfis.filter(r => r.status === 'open').length;
  const openPunch = punch.filter(p => p.status !== 'closed').length;
  const tasks = project.schedule?.tasks ?? [];
  const doneTasks = tasks.filter(x => x.status === 'done').length;
  const schedulePct = tasks.length ? Math.round((doneTasks / tasks.length) * 100) : null;

  // ── count the margin number up on mount ──
  const anim = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = anim.addListener(({ value }) => setShown(value));
    anim.setValue(0);
    Animated.timing(anim, { toValue: marginPct, duration: 1100, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    return () => anim.removeListener(id);
  }, [anim, marginPct]);

  // ── dimension bracket draws out ──
  const bracket = useRef(new Animated.Value(0)).current;
  // ── spirit-level bubble settles toward its risk position ──
  const bubble = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(bracket, { toValue: 1, duration: 900, delay: 250, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    Animated.spring(bubble, { toValue: Math.max(0, Math.min(1, risk.score / 100)), friction: 5, tension: 40, delay: 350, useNativeDriver: true }).start();
  }, [bracket, bubble, risk.score]);

  // Field-role collaborators never see the money hero. canViewFinancials fails
  // CLOSED (null role while loading → hidden) so a margin never flashes before
  // the role resolves. The owner viewing their own project resolves to 'owner'.
  if (!canViewFinancials(role)) return null;
  if (!risk.hasBasis) return null;

  const healthColor = health === 'healthy' ? t.success : health === 'watch' ? t.accent : t.danger;
  // Bubble travels within the vial; 0 (no risk) sits centred, 1 (max) drifts right.
  const bubbleX = bubble.interpolate({ inputRange: [0, 1], outputRange: [0, 92] });
  const bracketW = bracket.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  const erosionLabel = Math.abs(erosion) < 0.1
    ? 'On bid'
    : `${erosion < 0 ? '▼' : '▲'} ${Math.abs(erosion).toFixed(1)} pts from bid`;
  const erosionColor = Math.abs(erosion) < 0.1 ? t.textMuted : erosion < 0 ? t.danger : t.success;

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>PROJECTED MARGIN</Text>
      <View style={styles.numRow}>
        <Text style={styles.num}>{shown.toFixed(1)}</Text>
        <Text style={styles.pct}>%</Text>
      </View>

      {/* drafting dimension bracket → health. The bar lives inside a flex:1
          line so it can grow to full width WITHOUT pushing the label off the
          right edge (that overflow truncated "HEALTHY" → "HEAL"). */}
      <View style={styles.bracket}>
        <View style={styles.bracketLine}>
          <View style={[styles.tick, { backgroundColor: healthColor }]} />
          <Animated.View style={[styles.bracketBar, { width: bracketW, backgroundColor: healthColor }]} />
          <View style={[styles.tick, { backgroundColor: healthColor }]} />
        </View>
        <Text style={[styles.bracketLabel, { color: healthColor }]} numberOfLines={1}>{HEALTH_LABEL[health]}</Text>
      </View>

      <Text style={[styles.erosion, { color: erosionColor }]}>{erosionLabel}</Text>

      {/* spirit level → margin risk */}
      <View style={styles.levelWrap}>
        <View style={styles.levelHead}>
          <Text style={styles.levelLabel}>MARGIN RISK</Text>
          <Text style={[styles.levelBand, { color: healthColor }]}>{riskBandLabel(risk.band)}</Text>
        </View>
        <View style={styles.vial}>
          <View style={[styles.centerMark, styles.centerA]} />
          <View style={[styles.centerMark, styles.centerB]} />
          <Animated.View style={[styles.bubble, { backgroundColor: healthColor, transform: [{ translateX: bubbleX }] }]} />
        </View>
      </View>

      {/* the numbers that move the finish */}
      <View style={styles.statRow}>
        <Stat label="Owed" value={owed > 0 ? fmtMoney(owed) : '$0'} tone={owed > 0 ? 'down' : 'muted'} styles={styles} />
        <Stat label="Schedule" value={schedulePct != null ? `${schedulePct}%` : '—'} tone="default" styles={styles} />
        <Stat label="Open RFIs" value={String(openRfis)} tone={openRfis > 0 ? 'default' : 'muted'} styles={styles} />
        <Stat label="Punch" value={String(openPunch)} tone={openPunch > 0 ? 'default' : 'muted'} styles={styles} />
      </View>
    </View>
  );
}

function Stat({ label, value, tone, styles }: { label: string; value: string; tone: 'default' | 'down' | 'muted'; styles: ReturnType<typeof makeStyles> }) {
  const { colors: t } = useTheme();
  const color = tone === 'down' ? t.danger : tone === 'muted' ? t.textMuted : t.text;
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel} numberOfLines={1} adjustsFontSizeToFit>{label}</Text>
      <Text style={[styles.statValue, { color }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  card: {
    marginHorizontal: 20, marginTop: 16,
    backgroundColor: t.surface, borderWidth: 1, borderColor: t.line,
    borderRadius: 20, padding: 22,
  },
  eyebrow: { ...Type.monoCaption, color: t.textMuted, letterSpacing: 1.4 },
  numRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 6 },
  num: { ...Type.serifHero, color: t.text, fontVariant: ['tabular-nums'] },
  pct: { ...Type.serifLargeTitle, color: t.textMuted, marginTop: 6, marginLeft: 2 },

  bracket: { flexDirection: 'row', alignItems: 'center', height: 14, marginTop: 4 },
  bracketLine: { flex: 1, flexDirection: 'row', alignItems: 'center', overflow: 'hidden' },
  tick: { width: 1.5, height: 12, borderRadius: 1 },
  bracketBar: { height: 1.5, marginHorizontal: 0 },
  bracketLabel: { ...Type.monoCaption, letterSpacing: 1, marginLeft: 8, flexShrink: 0 },

  erosion: { fontSize: Type.footnote.fontSize, fontWeight: '600', marginTop: 12 },

  levelWrap: { marginTop: 18 },
  levelHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 },
  levelLabel: { ...Type.monoCaption, color: t.textMuted, letterSpacing: 1.2 },
  levelBand: { ...Type.monoCaption, letterSpacing: 0.6, fontWeight: '700' },
  vial: {
    height: 22, borderRadius: 11, backgroundColor: t.bg,
    borderWidth: 1, borderColor: t.line, justifyContent: 'center', overflow: 'hidden',
  },
  centerMark: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: t.line },
  centerA: { left: '50%', marginLeft: -13 },
  centerB: { left: '50%', marginLeft: 12 },
  bubble: { position: 'absolute', left: '50%', marginLeft: -13, width: 26, height: 14, borderRadius: 8 },

  statRow: { flexDirection: 'row', gap: 10, marginTop: 20 },
  stat: {
    flex: 1, backgroundColor: t.bg, borderWidth: 1, borderColor: t.line,
    borderRadius: Tokens.radius.md, paddingVertical: 11, paddingHorizontal: 10,
  },
  statLabel: { ...Type.monoCaption, color: t.textMuted, letterSpacing: 0.2, marginBottom: 5 },
  statValue: { fontSize: Type.subhead.fontSize, fontWeight: '700', fontVariant: ['tabular-nums'] },
});

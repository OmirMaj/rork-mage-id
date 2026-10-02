// components/ProjectHero.tsx — the "number-as-hero" financial pulse for a project.
//
// One big number as the subject: projected final margin %, counted up in the
// display face, framed by a drafting dimension bracket that measures out to its
// health label. Below it, the "Margin risk" band in words — then a compact row
// of the numbers that move the finish: owed, schedule, open RFIs, punch.
//
// It draws NO spirit level. That used to be a second, private level here whose
// bubble meant "margin risk score" while The Level everywhere else means
// schedule slip. The hub's Level now lives in components/level/ProjectLevelCard
// (the same engine and drawing as the Home rows): there a bubble is schedule
// slip and its colour follows this card's margin-risk band, read from the
// same pulse risk — one bubble, one meaning.
//
// Fed by hooks/useProjectPulse (wave 6c): the screen reads the job's pulse
// once — computeLivingEstimate + computeMarginRisk on the full cost streams,
// the role, and THE one % complete — and hands it here. Renders nothing when
// there's no margin basis yet (no budget = no financial pulse).
// RN Animated only (no reanimated); theme + Type tokens (no raw hex / inline
// fontSize).

import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, InteractionManager, StyleSheet, Text, View } from 'react-native';
import type { Project } from '@/types';
import type { ProjectPulse } from '@/hooks/useProjectPulse';
import { useTheme } from '@/contexts/ThemeContext';
import LockedAccessCard from '@/components/LockedAccessCard';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import type { MarginHealth } from '@/utils/livingEstimate';
import { riskBandLabel } from '@/utils/marginRiskScore';
import { canViewFinancials } from '@/utils/roleBlinding';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { motionCurve, nativeDriver, reducedMotion } from '@/components/ui/motion';

/**
 * Run `start` once the screen's push transition has settled, so the entrance
 * never competes with the native push of a 6,800-line screen. A backstop timer
 * starts it anyway: on web, and wherever a JS-driven loop keeps an interaction
 * handle open, runAfterInteractions can wait forever — and a margin that never
 * counts up reads 0.0 %. Returns the cancel for the effect cleanup.
 */
const AFTER_PUSH_BACKSTOP_MS = 700;
function afterPush(start: () => void): () => void {
  let done = false;
  const once = () => { if (!done) { done = true; start(); } };
  const task = InteractionManager.runAfterInteractions(once);
  const backstop = setTimeout(once, AFTER_PUSH_BACKSTOP_MS);
  return () => { done = true; task?.cancel?.(); clearTimeout(backstop); };
}

function fmtMoney(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}K`;
  return `${sign}$${Math.round(abs)}`;
}

const HEALTH_LABEL: Record<MarginHealth, string> = { healthy: 'Healthy', watch: 'Watch', critical: 'Critical' };

export default function ProjectHero({ project: _project, pulse }: { project: Project; pulse: ProjectPulse }) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  // Everything this card shows comes from hooks/useProjectPulse — the cost
  // streams Job Costing prices (audit round 2, #16: without receipts and
  // priced crew hours a self-perform overrun counted up to the bid margin and
  // read HEALTHY), the role, and the job's one "% complete". project-detail
  // reads the pulse once and hands it here, so this card and the desktop KPI
  // strip can never print two different numbers for the same job.
  const { living, risk, costSourcesReady, role, roleError } = pulse;

  const marginPct = living ? living.projected.marginPct * 100 : 0;
  const erosion = living ? living.marginErosionPoints : 0; // pts, negative = eroded from bid
  const health: MarginHealth = living ? living.health : 'healthy';

  const owed = pulse.owed;
  const openRfis = pulse.openRfis;
  const openPunch = pulse.punch.open + pulse.punch.inProgress + pulse.punch.readyForReview;
  // THE one % complete (utils/projectProgress via the pulse). This stat used
  // to count done tasks while the hub's progress chip weighted by duration —
  // two different "% complete" numbers on one screen.
  const schedulePct = pulse.progress.hasSchedule ? pulse.progress.pct : null;

  // ── count the margin number up on mount ──
  // Both entrances (this count-up and the bracket) start after
  // the push transition (afterPush), not on mount: on mount they were JS-thread
  // work competing with the slide-in. Reduce Motion: final values at once.
  const anim = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(0);
  useEffect(() => {
    // Not until the cost streams are in — see costSourcesReady above.
    if (!costSourcesReady) return;
    const id = anim.addListener(({ value }) => setShown(value));
    if (reducedMotion()) {
      // The listener carries it to the text: the final number, at once.
      anim.setValue(marginPct);
      return () => anim.removeListener(id);
    }
    anim.setValue(0);
    // The number is text, so it counts on the JS driver (a listener per frame).
    let run: Animated.CompositeAnimation | null = null;
    const cancel = afterPush(() => {
      run = Animated.timing(anim, { toValue: marginPct, duration: 1100, easing: Easing.out(Easing.cubic), useNativeDriver: false });
      run.start();
    });
    return () => { cancel(); run?.stop(); anim.removeListener(id); };
  }, [anim, marginPct, costSourcesReady]);

  // ── dimension bracket draws out ──
  const bracket = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!costSourcesReady) return;
    if (reducedMotion()) {
      bracket.setValue(1);
      return;
    }
    let run: Animated.CompositeAnimation | null = null;
    const cancel = afterPush(() => {
      // The bar is laid out at full width; scaleX draws it from the left on
      // the native driver (it was a '0%' → '100%' width on the JS thread).
      run = Animated.timing(bracket, { toValue: 1, duration: 900, delay: 250, easing: motionCurve.out, useNativeDriver: nativeDriver });
      run.start();
    });
    return () => { cancel(); run?.stop(); };
  }, [bracket, costSourcesReady]);

  // Field-role collaborators never see the money hero. canViewFinancials fails
  // CLOSED (null role while loading → hidden) so a margin never flashes before
  // the role resolves. The owner viewing their own project resolves to 'owner'.
  if (!canViewFinancials(role)) {
    // UX-F6 / RT-R2: a FAILED collaborator read is not "still resolving" — the
    // hero used to vanish with no explanation on a flaky link. Say why, keep
    // the numbers hidden.
    // Built-but-unreachable #9 (audit 2026-09-07). This used to `return null`,
    // so a foreman opening the job watched the LARGEST card on the screen
    // silently not exist — indistinguishable from a render bug, and the exact
    // thing components/LockedAccessCard.tsx was written for. Its copy is
    // already right for this reader: field access is something the GC turned
    // on, not a permission they got caught lacking.
    if (!roleError) return <LockedAccessCard what="Margin" />;
    return (
      <View style={styles.card} testID="project-hero-unavailable">
        <Text style={styles.eyebrow}>Projected margin</Text>
        <Text style={styles.unavailable}>
          Couldn't verify your access to this project's financials. Check your connection and pull to refresh.
        </Text>
      </View>
    );
  }
  if (!living || !risk || !risk.hasBasis) return null;
  if (!costSourcesReady) {
    return (
      <View
        style={styles.card}
        testID="project-hero-loading"
        accessibilityRole="progressbar"
        accessibilityLabel="Loading crew hours and receipts"
      >
        <Text style={styles.eyebrow}>Projected margin</Text>
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={t.accent} />
          <Text style={styles.loadingText}>Loading crew hours and receipts…</Text>
        </View>
      </View>
    );
  }

  // Watch is a warning state, so it wears the WARNING ink, never the brand
  // accent (2026-10-02: brand green read as "fine" on a margin to watch).
  // warningLabel is legible as text and solid enough for the bracket's fill.
  const healthColor = health === 'healthy' ? t.success : health === 'watch' ? t.warningLabel : t.danger;
  // The risk readout gets its OWN colour. Until 2026-09-07 both the band label
  // and the (since retired) bubble were painted `healthColor` — the MARGIN
  // band's colour — so a fat margin rendered "Moderate risk" in green and a
  // thin one would have rendered "Low risk" in red. The word and the colour were reporting
  // different variables, which reads as the app contradicting itself on the one
  // card a GC uses to decide whether a job is in trouble (founder report).
  // warningLabel/dangerLabel rather than warning/danger: these are TEXT.
  // Moderate and elevated are both warning states: the WARNING ink, never the
  // brand accent (until 2026-10-02 "Elevated risk" printed in brand green, the
  // color the app uses for "on plan"). The words tell the two apart.
  const riskColor =
    risk.band === 'low' ? t.success
    : risk.band === 'moderate' ? t.warningLabel
    : risk.band === 'elevated' ? t.warningLabel
    : t.dangerLabel;

  const erosionLabel = Math.abs(erosion) < 0.1
    ? 'On bid'
    : `${erosion < 0 ? '▼' : '▲'} ${Math.abs(erosion).toFixed(1)} pts from bid`;
  const erosionColor = Math.abs(erosion) < 0.1 ? t.textMuted : erosion < 0 ? t.danger : t.success;

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>Projected margin</Text>
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
          <Animated.View style={[styles.bracketBar, { backgroundColor: healthColor, transform: [{ scaleX: bracket }] }]} />
          <View style={[styles.tick, { backgroundColor: healthColor }]} />
        </View>
        <Text style={[styles.bracketLabel, { color: healthColor }]} numberOfLines={1}>{HEALTH_LABEL[health]}</Text>
      </View>

      <Text style={[styles.erosion, { color: erosionColor }]}>{erosionLabel}</Text>

      {/* margin risk, in words (the Level card draws it as colour) */}
      <View style={styles.riskRow}>
        <Text style={styles.riskLabel}>Margin risk</Text>
        <Text style={[styles.riskBand, { color: riskColor }]}>{riskBandLabel(risk.band)}</Text>
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
  eyebrow: { ...Type.monoCaption, color: t.textMuted, letterSpacing: 1.4, textTransform: 'uppercase' },
  numRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 6 },
  num: { ...Type.serifHero, color: t.text, fontVariant: ['tabular-nums'] },
  pct: { ...Type.serifLargeTitle, color: t.textMuted, marginTop: 6, marginLeft: 2 },

  bracket: { flexDirection: 'row', alignItems: 'center', height: 14, marginTop: 4 },
  // minWidth: 0 is the whole fix. A `flex: 1` item refuses to shrink below its
  // own content width unless told it may, so this row kept its natural size and
  // pushed the flexShrink:0 label past the card's right edge — which is how
  // "HEALTHY" rendered as "HEAL" again on an iPhone (founder report,
  // 2026-09-07) despite the comment above claiming the overflow was solved.
  // overflow:'hidden' clips the BAR, which is the intent; it never made room.
  bracketLine: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', overflow: 'hidden' },
  tick: { width: 1.5, height: 12, borderRadius: 1 },
  // Full width at rest (the old width animation's end state); the draw-out is
  // a native scaleX from the left edge (the ProjectCard burn-bar recipe — the
  // rounded ends squash while it runs, accepted).
  bracketBar: { height: 1.5, marginHorizontal: 0, width: '100%', transformOrigin: 'left' },
  bracketLabel: { ...Type.monoCaption, letterSpacing: 1, marginLeft: 8, flexShrink: 0, textTransform: 'uppercase' },

  erosion: { fontSize: Type.footnote.fontSize, fontWeight: '600', marginTop: 12 },
  unavailable: { fontSize: Type.footnote.fontSize, color: t.textMuted, marginTop: 8, lineHeight: 19 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  loadingText: { fontSize: Type.footnote.fontSize, color: t.textSecondary },

  riskRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 18 },
  riskLabel: { ...Type.monoCaption, color: t.textMuted, letterSpacing: 1.2, textTransform: 'uppercase' },
  riskBand: { ...Type.monoCaption, letterSpacing: 0.6, fontWeight: '700' },

  statRow: { flexDirection: 'row', gap: 10, marginTop: 20 },
  stat: {
    flex: 1, backgroundColor: t.bg, borderWidth: 1, borderColor: t.line,
    borderRadius: Tokens.radius.md, paddingVertical: 11, paddingHorizontal: 10,
  },
  statLabel: { ...Type.monoCaption, color: t.textMuted, letterSpacing: 0.2, marginBottom: 5 },
  statValue: { fontSize: Type.subhead.fontSize, fontWeight: '700', fontVariant: ['tabular-nums'] },
});

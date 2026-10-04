// components/permitPath/RouteSpine.tsx — the job's permit route as one vertical
// line of eight stations (lane PPUI, M3; take D of the login previews).
//
// Every card sits on ONE left edge, 20 pt right of the line, one width with the
// right edges aligned, and its dot at the card's vertical centre. The line is
// drawn per row (an upper and a lower half in the gutter), so it never needs
// measuring and never drifts from the dots.
//
// States: done (filled dot + check), current (FocusMarker + "You are here"),
// ahead (hollow dot), not needed (dimmed, struck through, with the reason) and
// unknown (dashed dot + "Not known yet").
//
// Motion comes from the kit only: StaggerList for the stations' arrival (it
// animates at most 8 rows) and FocusMarker gliding between "You are here"
// stations. The hook calls layoutNext() before every change that adds or
// removes stations. No motion code lives here.

import React, { useMemo, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { Check } from 'lucide-react-native';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useTheme } from '@/contexts/ThemeContext';
import { useT } from '@/contexts/LanguageContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { cardSurface } from '@/components/ui';
import { FocusMarker, StaggerList, useFocusRects } from '@/components/motion/kit';
import { PP_COPY } from '@/utils/permitPath/copy';
import type { Party, PermitRoute, Station, StationId } from '@/utils/permitPath/types';

export interface RouteSpineProps {
  route: PermitRoute;
  selected: StationId | null;
  onSelect: (id: StationId) => void;
  /** Missing readiness items per station (the count line). */
  missingByStation?: Partial<Record<StationId, number>>;
  /** Draw only these stations (the hero card's mini spine); the rest stay off. */
  only?: readonly StationId[];
  compact?: boolean;
  testID?: string;
}

const MAX_PARTIES = 3;

export function partiesOf(station: Station): Party[] {
  const seen: Party[] = [];
  for (const item of station.items) for (const p of item.who) if (!seen.includes(p)) seen.push(p);
  return seen;
}

type T = ReturnType<typeof useT>['t'];
type TN = ReturnType<typeof useT>['tn'];

export function stationCountLine(tn: TN, missing: number, unknown: number): string | null {
  const parts: string[] = [];
  if (missing > 0) parts.push(tn('office.permitPath.spine.missing', missing, { one: '1 missing', other: '{count} missing' }));
  if (unknown > 0) parts.push(tn('office.permitPath.spine.notKnown', unknown, { one: '1 not known yet', other: '{count} not known yet' }));
  return parts.length ? parts.join(' · ') : null;
}

function stateLabel(t: T, s: Station['state']): string {
  switch (s) {
    case 'done': return t('office.permitPath.state.done', 'Done');
    case 'current': return t('office.permitPath.state.current', 'You are here');
    case 'ahead': return t('office.permitPath.state.ahead', 'Ahead');
    case 'not_needed': return t('office.permitPath.state.notNeeded', 'Not needed');
    case 'unknown': return t('office.permitPath.state.unknown', 'Not known yet');
  }
}

export function RouteSpine({ route, selected, onSelect, missingByStation, only, compact = false, testID = 'permit-path-spine' }: RouteSpineProps) {
  const styles = useThemedStyles(makeStyles);
  const { colors: c } = useTheme();
  const { t, tn } = useT();
  const focus = useFocusRects();
  // The host paints "You are here" itself except while the marker is gliding.
  const [flying, setFlying] = useState(false);

  const stations = useMemo(
    () => (only ? route.stations.filter((s) => only.includes(s.id)) : route.stations),
    [route.stations, only],
  );
  const current = stations.find((s) => s.state === 'current')?.id ?? null;

  const renderStation = (s: Station, i: number, enter: ViewStyle | null) => {
    const first = i === 0;
    const last = i === stations.length - 1;
    const isCurrent = s.state === 'current';
    const dim = s.state === 'not_needed';
    const parties = partiesOf(s);
    const shownParties = parties.slice(0, MAX_PARTIES);
    const extra = parties.length - shownParties.length;
    const counts = stationCountLine(tn, missingByStation?.[s.id] ?? 0, s.unknownCount);
    const label = stateLabel(t, s.state);
    const a11y = [s.title, label, counts].filter(Boolean).join(', ');
    return (
      <Animated.View key={s.id} style={[styles.row, enter]} onLayout={focus.onLayoutFor(s.id)} testID={`${testID}-row-${s.id}`}>
        <View style={styles.gutter} pointerEvents="none">
          {!first ? <View style={[styles.rail, styles.railTop]} /> : null}
          {!last ? <View style={[styles.rail, styles.railBottom]} /> : null}
          <View
            style={[
              styles.dot,
              s.state === 'done' && styles.dotDone,
              isCurrent && (flying ? styles.dotAhead : styles.dotCurrent),
              s.state === 'ahead' && styles.dotAhead,
              s.state === 'not_needed' && styles.dotSkipped,
              s.state === 'unknown' && styles.dotUnknown,
            ]}
            testID={`${testID}-dot-${s.id}-${s.state}`}
          >
            {s.state === 'done' ? <Check size={9} color={c.surface} strokeWidth={3} /> : null}
          </View>
        </View>
        <Pressable
          onPress={() => onSelect(s.id)}
          accessibilityRole="button"
          accessibilityLabel={a11y}
          accessibilityState={{ selected: selected === s.id }}
          style={({ pressed }) => [styles.card, selected === s.id && styles.cardSelected, dim && styles.cardDim, pressed && styles.cardPressed]}
          testID={`${testID}-station-${s.id}`}
        >
          <View style={styles.head}>
            <Text style={[styles.stationName, dim && styles.struck]} numberOfLines={2}>{s.title}</Text>
            {isCurrent ? (
              <View style={styles.herePill} testID={`${testID}-here`}>
                <Text style={styles.hereText}>{label}</Text>
              </View>
            ) : (
              <Text style={[styles.stateText, s.state === 'unknown' && styles.stateUnknown]}>{label}</Text>
            )}
          </View>
          <Text style={styles.summary} numberOfLines={compact ? 1 : 2}>
            {dim && s.notNeededBecause ? s.notNeededBecause : s.summary}
          </Text>
          {!compact && !dim ? (
            <View style={styles.chips}>
              <View style={[styles.chip, s.duration.kind === 'unknown' && styles.chipUnknown]} testID={`${testID}-duration-${s.id}`}>
                <Text style={[styles.chipText, s.duration.kind === 'unknown' && styles.chipUnknownText]} numberOfLines={1}>{s.duration.label}</Text>
              </View>
              {shownParties.map((p) => (
                <View key={p} style={styles.party}>
                  <Text style={styles.partyText} numberOfLines={1}>{PP_COPY.partyLabel(p)}</Text>
                </View>
              ))}
              {extra > 0 ? (
                <View style={styles.party}><Text style={styles.partyText}>{`+${extra}`}</Text></View>
              ) : null}
            </View>
          ) : null}
          {counts && !dim ? <Text style={styles.counts} testID={`${testID}-counts-${s.id}`}>{counts}</Text> : null}
        </Pressable>
      </Animated.View>
    );
  };

  return (
    <View style={styles.wrap} testID={testID}>
      <StaggerList
        items={stations}
        keyOf={(s) => s.id}
        armed
        renderItem={(s, i, enter) => renderStation(s, i, enter)}
      />
      <FocusMarker
        axis="y"
        activeKey={current}
        rects={focus.rects}
        style={styles.marker}
        onFlight={setFlying}
        testID={`${testID}-marker`}
      />
    </View>
  );
}

const GUTTER = 40;
const LINE_X = 20;
const DOT = 14;

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    wrap: { position: 'relative' },
    row: { flexDirection: 'row', alignItems: 'stretch' },
    gutter: { width: GUTTER, alignItems: 'center', justifyContent: 'center' },
    rail: { position: 'absolute', left: LINE_X - 1, width: 2, backgroundColor: c.line },
    railTop: { top: 0, height: '50%' },
    railBottom: { bottom: 0, height: '50%' },
    dot: { width: DOT, height: DOT, borderRadius: Tokens.radius.full, borderWidth: 2, borderColor: c.line, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' },
    dotDone: { backgroundColor: c.accent, borderColor: c.accent },
    dotCurrent: { width: DOT + 4, height: DOT + 4, backgroundColor: c.accent, borderColor: c.accentSoft, borderWidth: 4 },
    dotAhead: { backgroundColor: c.surface, borderColor: c.accent },
    dotSkipped: { backgroundColor: c.neutralSoft, borderColor: c.line },
    dotUnknown: { borderStyle: 'dashed', borderColor: c.warningLabel, backgroundColor: c.surface },
    marker: { left: LINE_X - 5, width: 10, borderRadius: Tokens.radius.full, backgroundColor: c.accent },
    card: { ...cardSurface(c, { radius: 'lg', pad: 12 }), flex: 1, marginVertical: 5, gap: 4 },
    cardSelected: { borderColor: c.accent },
    cardDim: { opacity: 0.6 },
    cardPressed: { opacity: 0.85 },
    head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    stationName: { ...Type.bodyCompactEmphasized, color: c.text, flex: 1 },
    struck: { textDecorationLine: 'line-through', color: c.textSecondary },
    stateText: { ...Type.footnote, color: c.textMuted },
    stateUnknown: { color: c.warningLabel },
    herePill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: Tokens.radius.full, backgroundColor: c.accentSoft },
    hereText: { ...Type.footnoteEmphasized, color: c.accentLabel },
    summary: { ...Type.footnote, color: c.textSecondary },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
    chip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.full, backgroundColor: c.accentSoft },
    chipText: { ...Type.footnoteEmphasized, color: c.accentLabel },
    chipUnknown: { backgroundColor: c.warningSoft },
    chipUnknownText: { color: c.warningLabel },
    party: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.full, backgroundColor: c.neutralSoft },
    partyText: { ...Type.footnote, color: c.text },
    counts: { ...Type.footnoteEmphasized, color: c.warningLabel, marginTop: 2 },
  });
}

export default RouteSpine;

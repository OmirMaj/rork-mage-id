// KitGallery — every motion-kit part with sample data, in one scroll.
//
// A COMPONENT, not a route: the smoke tests render it (light and dark, armed
// and at rest), and for a screen recording the lane mounts it from an
// UNCOMMITTED local route that is deleted before committing. Nothing here
// ships to a screen. The words are sample data for a sample project.

import React, { useMemo, useRef, useState } from 'react';
import { Animated, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { BRAND_ACCENT, Theme, deriveAccentPalette, type ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import {
  AccumulateCards, ChatTurn, CheckSync, CornerTags, FocusMarker, MatrixFill, PriorityGrid,
  RangeSettle, StackPush, StaggerList, ThinkingRow, useFileInto, useFocusRects,
  type CheckRow, type CheckStatus,
} from '@/components/motion/kit';

export type KitGalleryProps = {
  mode?: 'light' | 'dark';
  /** Arm every part (a live event); false renders every part at rest. */
  armed?: boolean;
  /** Show the thinking row. */
  thinking?: boolean;
  testID?: string;
};

const money = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

export function galleryPalette(mode: 'light' | 'dark'): ThemeColors {
  return { ...Theme[mode], ...deriveAccentPalette(BRAND_ACCENT, mode) } as ThemeColors;
}

const REPORTS = Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, title: `Daily report ${i + 1}`, note: i % 3 === 0 ? 'Crew of 6, concrete pour' : 'Framing, second floor' }));
const LINES = [
  { key: 'sill', cents: 140000, label: 'Rotted Sill Plate' },
  { key: 'wire', cents: 82000, label: 'Knob-and-Tube Wiring' },
  { key: 'drain', cents: 61000, label: 'Cast-Iron Drain' },
];
const BIDS = [
  { key: 'b1', label: 'Concrete', evidence: ['$48,200', 'Includes pump'] },
  { key: 'b2', label: 'Framing', evidence: ['$91,500', 'Lumber at today\'s price'] },
  { key: 'b3', label: 'Drywall', evidence: ['$22,750', 'Level 4 finish'] },
];

export function KitGallery({ mode = 'light', armed = true, thinking = true, testID = 'kit-gallery' }: KitGalleryProps) {
  const p = useMemo(() => galleryPalette(mode), [mode]);
  const s = useMemo(() => makeStyles(p), [p]);
  const text = s.text;
  const rows: CheckRow[] = [
    { key: 'footing', status: 'done', render: () => <Text style={text}>Footing inspection passed</Text> },
    { key: 'rebar', status: armed ? 'done' : 'active', render: () => <Text style={text}>Rebar photos uploaded</Text> },
    { key: 'pour', status: armed ? 'active' : 'pending', render: () => <Text style={text}>Pour scheduled for Thursday</Text> },
  ];
  const focus = useFocusRects();
  const [active] = useState('drywall');
  const file = useFileInto();
  const folderRef = useRef<View | null>(null);

  return (
    <ScrollView testID={testID} style={{ backgroundColor: p.bg }} contentContainerStyle={s.page}>
      <Text style={s.h}>Chat</Text>
      <View style={s.turns}>
        <ChatTurn role="user" live={armed} variant="page" style={s.bubble}><Text style={text}>Which RFIs are late?</Text></ChatTurn>
        <ThinkingRow
          visible={thinking}
          label="Reading Your Records"
          stillLabel="Still working on it"
          a11yLabel="Reading your records"
          textStyle={s.muted}
          dotStyle={{ backgroundColor: p.textMuted }}
          testID="gallery-thinking"
        />
        <ChatTurn role="assistant" live={armed} variant="page"><Text style={text}>Two RFIs are past due: RFI-014 (stair rail detail) and RFI-019 (roof drain size).</Text></ChatTurn>
      </View>

      <Text style={s.h}>List</Text>
      <StaggerList
        items={REPORTS}
        keyOf={(r) => r.id}
        armed={armed}
        renderItem={(r, _i, enter) => (
          <Animated.View style={[s.row, enter]}>
            <Text style={text}>{r.title}</Text>
            <Text style={s.muted}>{r.note}</Text>
          </Animated.View>
        )}
      />

      <Text style={s.h}>Checklist</Text>
      <CheckSync
        rows={rows}
        marker
        markerStyle={{ backgroundColor: p.accent }}
        renderCheck={(st: CheckStatus) => <View style={[s.check, st === 'done' ? { backgroundColor: p.success } : null]} />}
      />

      <Text style={s.h}>Hidden conditions</Text>
      <AccumulateCards
        items={LINES.map((l) => ({ key: l.key, cents: l.cents, render: (enter: ViewStyle | null) => (
          <Animated.View style={[s.row, enter]}><Text style={text}>{l.label}</Text><Text style={text}>{money(l.cents)}</Text></Animated.View>
        ) }))}
        armed={armed}
        format={money}
        totalStyle={s.total}
        renderTotal={(roll) => <View style={s.row}><Text style={text}>Contingency</Text>{roll}</View>}
        badge={<Text style={s.muted}>3 conditions priced from your past projects</Text>}
      />

      <Text style={s.h}>Range</Text>
      <RangeSettle low={1840000} high={2310000} expected={2060000} format={money} armed={armed} tone={{ track: p.line, bubble: p.accent }} textStyle={text} />

      <Text style={s.h}>Priority</Text>
      <PriorityGrid
        columns={2}
        armed={armed}
        ruleColor={p.accent}
        priorityKey="invoices"
        cells={[
          { key: 'rfis', render: () => <View style={s.cell}><Text style={text}>Open RFIs</Text><Text style={s.total}>3</Text></View> },
          { key: 'punch', render: () => <View style={s.cell}><Text style={text}>Punch items</Text><Text style={s.total}>12</Text></View> },
          { key: 'invoices', render: () => <View style={s.cell}><Text style={text}>Overdue invoices</Text><Text style={s.total}>1</Text></View> },
          { key: 'insp', render: () => <View style={s.cell}><Text style={text}>Inspections this week</Text><Text style={s.total}>2</Text></View> },
        ]}
      />

      <Text style={s.h}>Status</Text>
      <View>
        {['framing', 'drywall', 'paint'].map((k) => (
          <View key={k} onLayout={focus.onLayoutFor(k)} style={[s.row, k === active ? { borderLeftWidth: 2, borderLeftColor: p.accent } : null]}>
            <Text style={text}>{k === 'framing' ? 'Framing done' : k === 'drywall' ? 'Drywall in progress' : 'Paint next'}</Text>
          </View>
        ))}
        <FocusMarker axis="y" activeKey={active} rects={focus.rects} style={{ left: 0, width: 2, backgroundColor: p.accent }} />
      </View>

      <Text style={s.h}>Stack</Text>
      <StackPush
        index={armed ? 0 : -1}
        count={3}
        chapter={<View style={s.cell}><Text style={s.total}>02</Text><Text style={text}>Schedule</Text></View>}
        renderCard={(i) => <View style={s.card}><Text style={text}>{['Baseline set', 'Critical path', 'Weather days'][i]}</Text></View>}
      />

      <Text style={s.h}>Corner tags</Text>
      <CornerTags
        armed={armed}
        center={<Text style={s.total}>Kitchen remodel, 4th floor</Text>}
        tags={{ tl: <Text style={s.muted}>Permit filed</Text>, tr: <Text style={s.muted}>Sample project</Text>, br: <Text style={s.muted}>14 days left</Text>, bl: <Text style={s.muted}>2 open RFIs</Text> }}
      />

      <Text style={s.h}>Bid leveling</Text>
      <MatrixFill
        armed={armed}
        rows={BIDS.map((b) => ({ key: b.key, label: <Text style={[text, s.labelCell]}>{b.label}</Text>, evidence: b.evidence.map((e) => <Text key={e} style={s.muted}>{e}</Text>) }))}
      />

      <Text style={s.h}>Filing</Text>
      <Animated.View ref={folderRef} style={[s.cell, file.receiveStyle]}><Text style={text}>Inspections folder</Text></Animated.View>
      {file.layer}
    </ScrollView>
  );
}

function makeStyles(p: ThemeColors) {
  return StyleSheet.create({
    page: { padding: 16, gap: 10 },
    h: { ...Type.footnote, color: p.textSecondary, marginTop: 12 },
    text: { ...Type.subhead, color: p.text },
    muted: { ...Type.footnote, color: p.textMuted },
    total: { ...Type.headline, color: p.text, fontVariant: ['tabular-nums'] },
    turns: { gap: 10 },
    bubble: { alignSelf: 'flex-end', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, backgroundColor: p.surfaceAlt },
    row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, paddingLeft: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: p.line },
    cell: { padding: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: p.line, borderRadius: 10, gap: 4 },
    card: { padding: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: p.line, borderRadius: 12, backgroundColor: p.bg },
    check: { width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: p.line, marginRight: 10 },
    labelCell: { width: 96 },
  });
}

export default KitGallery;

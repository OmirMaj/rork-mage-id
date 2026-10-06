/**
 * Two regressions from the 2026-08 iOS pass, pinned where they can actually be
 * observed — in the rendered tree, not in prose.
 *
 *   1. StatusPipeline truncated its stage labels. `stage: { flexShrink: 1 }`
 *      next to `connector: { flex: 1 }` (flex-basis 0) meant the connectors
 *      grew into every spare pixel while the stages absorbed 100% of any
 *      shortfall down to a 48px floor. At Type.caption2 the 5-stage OAC
 *      pipeline read "Schedu… / In Progr… / Conclu… / Distribu…".
 *
 *      RNTL does no layout, so "is it truncated?" is not directly observable.
 *      What IS observable, and is the actual cause, is which box is allowed to
 *      give way. These assertions pin that: the stages never shrink, the
 *      connectors never shrink below their basis, and the row is a horizontal
 *      ScrollView so an overflow becomes a scroll rather than a clip.
 *
 *   2. The OAC agenda dropped items whose `section` was outside the ten known
 *      keys while still counting them, producing "0 of 2 covered" over an
 *      empty list. groupAgendaBySection is the fix and is tested directly.
 */

import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { StatusPipeline } from '@/components/StatusPipeline';
import { stagesFor } from '@/utils/workflowPipelines';
import { groupAgendaBySection } from '@/app/oac-meeting';
import type { OACAgendaItem } from '@/types';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaProvider initialMetrics={METRICS}>
      <ThemeProvider>{children}</ThemeProvider>
    </SafeAreaProvider>
  );
}

function renderOacPipeline() {
  return render(
    <StatusPipeline stages={stagesFor('oac')} current="scheduled" />,
    { wrapper: Wrapper },
  );
}

describe('StatusPipeline — the labels are not the thing that gives way', () => {
  // The pipeline this regressed on. Guard the premise too: if someone shortens
  // the OAC pipeline the assertions below stop meaning what they say.
  it('the OAC pipeline is still 5 stages with multi-word labels', () => {
    const stages = stagesFor('oac');
    expect(stages).toHaveLength(5);
    expect(stages.map(s => s.label)).toEqual(
      ['Draft', 'Scheduled', 'In Progress', 'Concluded', 'Distributed'],
    );
  });

  it('renders every stage label in full', () => {
    const t = renderOacPipeline();
    for (const stage of stagesFor('oac')) {
      expect(t.getByText(stage.label)).toBeTruthy();
    }
  });

  it('no stage may shrink — a stage is sized by its label', () => {
    const t = renderOacPipeline();
    for (const stage of stagesFor('oac')) {
      const style = StyleSheet.flatten(
        t.getByTestId(`pipeline-stage-${stage.key}`).props.style,
      );
      expect(style.flexShrink).toBe(0);
    }
  });

  it('connectors may stretch but may not squeeze a label', () => {
    const t = renderOacPipeline();
    // 5 stages -> 4 connectors, one after each non-final stage.
    const connectors = stagesFor('oac')
      .slice(0, -1)
      .map(s => t.getByTestId(`pipeline-connector-${s.key}`));
    expect(connectors).toHaveLength(4);
    for (const c of connectors) {
      const style = StyleSheet.flatten(c.props.style);
      expect(style.flexGrow).toBe(1);   // takes leftover width
      expect(style.flexShrink).toBe(0); // gives none back
      expect(style.flexBasis).toBeGreaterThan(0); // ...and is never a 0-width hairline
    }
  });

  it('the row is a horizontal scroller, so overflow scrolls instead of clipping', () => {
    const t = renderOacPipeline();
    const scrollers = t.UNSAFE_getAllByType(ScrollView).filter(s => s.props.horizontal);
    expect(scrollers).toHaveLength(1);
    // flexGrow on the content container is what keeps a 2- or 3-stage pipeline
    // filling the card exactly as it did before this change.
    expect(
      StyleSheet.flatten(scrollers[0].props.contentContainerStyle).flexGrow,
    ).toBe(1);
  });
});

describe('groupAgendaBySection — no agenda item is silently dropped', () => {
  const item = (id: string, section: string, covered = false): OACAgendaItem => ({
    id,
    section: section as OACAgendaItem['section'],
    title: `item ${id}`,
    covered,
  } as OACAgendaItem);

  it('groups known sections in the declared order', () => {
    const buckets = groupAgendaBySection([
      item('a', 'budget'),
      item('b', 'safety'),
      item('c', 'safety'),
    ]);
    expect(buckets.map(b => b.label)).toEqual(['Safety', 'Budget']);
    expect(buckets[0].items.map(i => i.id)).toEqual(['b', 'c']);
  });

  it('drops empty sections', () => {
    expect(groupAgendaBySection([])).toEqual([]);
  });

  it("puts a foreign section in a trailing 'Other' bucket instead of dropping it", () => {
    // The audited case: a Supabase-synced row carrying a section this build
    // has never heard of. It used to vanish from the list and still count.
    const buckets = groupAgendaBySection([
      item('sync-1', 'weather_delays'),
      item('sync-2', 'procurement'),
    ]);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].label).toBe('Other');
    expect(buckets[0].items.map(i => i.id)).toEqual(['sync-1', 'sync-2']);
  });

  it("'Other' sorts last, after every known section", () => {
    const buckets = groupAgendaBySection([
      item('x', 'not_a_section'),
      item('y', 'next_meeting'),
      item('z', 'safety'),
    ]);
    expect(buckets.map(b => b.label)).toEqual(['Safety', 'Next Meeting', 'Other']);
  });

  it('is total: every input item lands in exactly one bucket', () => {
    const items = [
      item('1', 'safety'),
      item('2', 'weather_delays'),
      item('3', 'budget'),
      item('4', ''),
      item('5', 'toString'),        // an Object.prototype name, not a section
      item('6', 'constructor'),     // ditto — hasOwnProperty is what makes this safe
    ];
    const shown = groupAgendaBySection(items).flatMap(b => b.items);
    expect(shown).toHaveLength(items.length);
    expect(new Set(shown.map(i => i.id))).toEqual(new Set(items.map(i => i.id)));
  });

  it('the covered count can no longer disagree with the list', () => {
    // "0 of 2 covered" above an empty agenda was exactly this arithmetic run
    // over two different collections. Now it is one collection.
    const items = [item('1', 'weather_delays', true), item('2', 'procurement', false)];
    const shown = groupAgendaBySection(items).flatMap(b => b.items);
    expect(`${shown.filter(i => i.covered).length} of ${shown.length} covered`)
      .toBe('1 of 2 covered');
  });
});

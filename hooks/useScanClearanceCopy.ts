// hooks/useScanClearanceCopy.ts — the ONLY place the Clearance
// Check strings live (Scan The Room, lane CLEARANCE). Every string goes through
// t('office.scanClearance.*', english, vars), surface 'office.scan-clearance',
// Spanish in i18n/catalog/es/office/scanClearance.ts.
// components/roomScan/ClearanceView.tsx imports this and adds no t() key of
// its own.
//
// WORDING (docs/VOICE.md). A key ending in `Label` is a name or an action,
// every word capitalised, no closing period. `Body` and `Note` are whole
// sentences. `Sub` is a caption with no period. `Text` is a fragment that sits
// inside a sentence. No em dashes, no "and" sign, no "e.g.", no arrows.
//
// WHAT THIS SCREEN MAY SAY. It gives a distance as scanned and one of three
// states against a COMMONLY USED figure. It never says anything is fine and
// never says anything is wrong: no "pass", "fail", "compliant", "legal",
// "meets code", "approved", "violation" or "required", in English or Spanish
// (scripts/validate-scan-clearance.ts reads both). It never states a section
// number: the app's checked data holds none for these figures. It always says
// that a phone scan can be off by an inch or more, that a measurement with no
// label has not been checked against anything, and that nothing here stops an
// action. No string says how right a number is.
//
// THE FIGURES. The number in a figure sentence comes from the table
// (utils/roomScan/clearanceRefs) as {value}; no figure is typed into a string
// here. The `called` and `family` fragments below are the table's own English,
// pinned equal by the validator.
//
// Never call t() at module scope: the object is rebuilt when the language
// changes.
import { useMemo } from 'react';
import { useT } from '@/contexts/LanguageContext';
import type { ClearanceLeftOut, ClearanceMargin, ClearanceMeasure, ClearanceState, ClearanceToward } from '@/utils/roomScan/clearanceCore';
import { clearanceRef, type ClearanceFamily, type ClearanceRefId } from '@/utils/roomScan/clearanceRefs';
import { formatFeetInches, formatSqFt, sqMetresToSqFeet } from '@/utils/roomScan/units';

export interface ScanClearanceCopy {
  titleLabel: string;
  openLabel: string;
  introBody: string;
  scanNoticeBody: string;
  notCheckedBody: string;
  neverBlocksBody: string;
  neverClearedBody: string;
  starterBody: string;
  tapBody: string;
  emptyBody: string;
  planA11yLabel: string;
  // ── the states ──
  statesHeadingLabel: string;
  stateLabel: (s: ClearanceState) => string;
  stateMeaningBody: (s: ClearanceState) => string;
  noStateSub: string;
  // ── the margin ──
  marginHeadingLabel: string;
  marginBody: (m: ClearanceMargin) => string;
  tapedMarginBody: (m: ClearanceMargin) => string;
  tapedCountBody: (count: number) => string;
  restsOnTapedSub: string;
  fromScanSub: string;
  // ── one measurement ──
  measuresHeadingLabel: string;
  measureLabel: (m: ClearanceMeasure, counts: { toilets: number; sinks: number; doors: number; windows: number }) => string;
  valueText: (m: ClearanceMeasure) => string;
  measureNote: (m: ClearanceMeasure) => string | null;
  figureBody: (refId: ClearanceRefId) => string;
  figureLocalBody: string;
  rowA11yLabel: (label: string, value: string, state: string) => string;
  // ── left out ──
  leftOutHeadingLabel: string;
  leftOutBody: (l: ClearanceLeftOut) => string;
  // ── the door into Code Check ──
  codeCheckLabel: string;
  codeCheckBody: string;
}

export function useScanClearanceCopy(): ScanClearanceCopy {
  const { t, tn } = useT();
  return useMemo<ScanClearanceCopy>(() => {
    const inches = (n: number): string => String(Math.round(n * 100) / 100);
    const figureValue = (refId: ClearanceRefId): string => {
      const r = clearanceRef(refId);
      if (r.unit === 'sqft') return `${r.value} sq ft`;
      return r.value >= 48 ? `${Math.floor(r.value / 12)} ft ${r.value % 12} in` : `${r.value} in`;
    };
    const called = (refId: ClearanceRefId): string => {
      switch (refId) {
        case 'toilet_side_15': return t('office.scanClearance.called.toiletSideText', 'toilet center line to a side wall or anything beside it');
        case 'toilet_front_21':
        case 'toilet_front_24': return t('office.scanClearance.called.toiletFrontText', 'clear space in front of a toilet');
        case 'sink_front_21': return t('office.scanClearance.called.sinkFrontText', 'clear space in front of a bathroom sink');
        case 'door_clear_32': return t('office.scanClearance.called.doorClearText', 'clear width of a doorway with the door open');
        case 'passage_36': return t('office.scanClearance.called.passageText', 'width of a hallway');
        case 'ceiling_84':
        case 'ceiling_96': return t('office.scanClearance.called.ceilingText', 'ceiling height in a room people live in');
        case 'ceiling_bath_80': return t('office.scanClearance.called.ceilingBathText', 'ceiling height in a bathroom');
        case 'escape_area_5_7': return t('office.scanClearance.called.escapeAreaText', 'net clear area of an emergency escape opening');
        case 'escape_height_24': return t('office.scanClearance.called.escapeHeightText', 'net clear height of an emergency escape opening');
        case 'escape_width_20': return t('office.scanClearance.called.escapeWidthText', 'net clear width of an emergency escape opening');
        default: return t('office.scanClearance.called.escapeSillText', 'height of an emergency escape opening off the floor');
      }
    };
    const family = (f: ClearanceFamily): string => {
      switch (f) {
        case 'residential_model': return t('office.scanClearance.family.residentialModelText', 'the model residential code');
        case 'residential_and_plumbing_model': return t('office.scanClearance.family.residentialAndPlumbingModelText', 'the model residential code and the model plumbing code');
        case 'other_plumbing': return t('office.scanClearance.family.otherPlumbingText', 'some plumbing codes');
        case 'building_model': return t('office.scanClearance.family.buildingModelText', 'the model building code');
        default: return t('office.scanClearance.family.someCityText', 'some city codes');
      }
    };
    const thing = (to: ClearanceToward | null): string => {
      const other = t('office.scanClearance.thing.otherLabel', 'Something The Scan Saw');
      if (!to) return other;
      if (to.kind === 'wall') return t('office.scanClearance.thing.wallLabel', 'Wall {n}', { n: to.label.replace(/\D+/g, '') });
      switch (to.category) {
        case 'toilet': return t('office.scanClearance.thing.toiletLabel', 'The Toilet');
        case 'sink': return t('office.scanClearance.thing.sinkLabel', 'The Sink');
        case 'bathtub': return t('office.scanClearance.thing.bathtubLabel', 'The Tub');
        case 'storage': return t('office.scanClearance.thing.storageLabel', 'A Cabinet');
        case 'stairs': return t('office.scanClearance.thing.stairsLabel', 'The Stairs');
        default: return other;
      }
    };
    const numbered = (one: string, many: (n: number) => string, index: number, count: number): string => (count > 1 ? many(index) : one);
    const stateLabel: ScanClearanceCopy['stateLabel'] = (s) => {
      if (s === 'roomy') return t('office.scanClearance.state.roomyLabel', 'Roomy');
      if (s === 'close') return t('office.scanClearance.state.closeLabel', 'Close, Tape It');
      return t('office.scanClearance.state.tightLabel', 'Tight, Tape It And Check Your Local Code');
    };
    return {
      titleLabel: t('office.scanClearance.titleLabel', 'Clearance Check'),
      openLabel: t('office.scanClearance.openLabel', 'See The Clearance Check'),
      introBody: t('office.scanClearance.introBody', 'These are distances worked out from the scan, each set beside a figure that building codes commonly use. They show you where to put a tape. They do not tell you what an inspector will say.'),
      scanNoticeBody: t('office.scanClearance.scanNoticeBody', 'A phone scan can be off by an inch or more, and several of these figures are a matter of an inch. Tape anything that matters before you build to it.'),
      notCheckedBody: t('office.scanClearance.notCheckedBody', 'A measurement with no label has not been checked against anything.'),
      neverBlocksBody: t('office.scanClearance.neverBlocksBody', 'Nothing here stops you from saving, pricing or sending anything.'),
      neverClearedBody: t('office.scanClearance.neverClearedBody', 'This check never clears a room. It only points at what to tape.'),
      starterBody: t('office.scanClearance.starterBody', 'This is a starting list of figures. No architect or expediter has read it yet.'),
      tapBody: t('office.scanClearance.tapBody', 'Tap a measurement to see it drawn on the plan.'),
      emptyBody: t('office.scanClearance.emptyBody', 'The scan holds nothing this check can measure.'),
      planA11yLabel: t('office.scanClearance.planA11yLabel', 'Floor Plan With The Chosen Measurement'),
      statesHeadingLabel: t('office.scanClearance.statesHeadingLabel', 'What The Labels Mean'),
      stateLabel,
      stateMeaningBody: (s) => {
        if (s === 'roomy') return t('office.scanClearance.state.roomyBody', 'Further from the commonly used figure than the margin, as scanned.');
        if (s === 'close') return t('office.scanClearance.state.closeBody', 'Within the margin of the commonly used figure, on either side of it. A door or a window gets this label whenever the size the scan drew is not past the figure by more than the margin.');
        return t('office.scanClearance.state.tightBody', 'Short of the commonly used figure by more than the margin, as scanned.');
      },
      noStateSub: t('office.scanClearance.noStateSub', 'Not checked against anything'),
      marginHeadingLabel: t('office.scanClearance.marginHeadingLabel', 'The Margin'),
      marginBody: (m) => (m.basis === 'tape_history'
        ? tn('office.scanClearance.marginHistoryBody', m.tapeCount, {
          one: 'The margin is {inches} in, because your own tape has differed from a scan by as much as {largest} in on the 1 wall you taped.',
          other: 'The margin is {inches} in, because your own tape has differed from a scan by as much as {largest} in on the {count} walls you taped.',
        }, { inches: inches(m.scanIn), largest: inches(m.largestIn) })
        : t('office.scanClearance.marginDefaultBody', 'The margin is {inches} in. That is how far off this check takes a scanned distance to be.', { inches: inches(m.scanIn) })),
      tapedMarginBody: (m) => t('office.scanClearance.tapedMarginBody', 'A number you typed from a tape uses a margin of {inches} in. A taped wall does not move a toilet or a sink, so those always use the scan margin.', { inches: inches(m.tapedIn) }),
      tapedCountBody: (count) => tn('office.scanClearance.tapedCountBody', count, {
        one: '1 measurement here rests on a number you taped. It is marked.',
        other: '{count} measurements here rest on a number you taped. Each is marked.',
      }),
      restsOnTapedSub: t('office.scanClearance.restsOnTapedSub', 'Rests on a number you taped'),
      fromScanSub: t('office.scanClearance.fromScanSub', 'From the scan alone'),
      measuresHeadingLabel: t('office.scanClearance.measuresHeadingLabel', 'Measured From The Scan'),
      measureLabel: (m, counts) => {
        const toilet = numbered(t('office.scanClearance.name.toiletLabel', 'Toilet'), (n) => t('office.scanClearance.name.toiletNLabel', 'Toilet {n}', { n }), m.index, counts.toilets);
        const sink = numbered(t('office.scanClearance.name.sinkLabel', 'Sink'), (n) => t('office.scanClearance.name.sinkNLabel', 'Sink {n}', { n }), m.index, counts.sinks);
        const door = numbered(t('office.scanClearance.name.doorLabel', 'Door'), (n) => t('office.scanClearance.name.doorNLabel', 'Door {n}', { n }), m.index, counts.doors);
        const win = numbered(t('office.scanClearance.name.windowLabel', 'Window'), (n) => t('office.scanClearance.name.windowNLabel', 'Window {n}', { n }), m.index, counts.windows);
        switch (m.kind) {
          case 'toilet_side': return t('office.scanClearance.measure.toiletSideLabel', '{name}, Center Line To {thing}', { name: toilet, thing: thing(m.toward) });
          case 'toilet_front':
          case 'sink_front': return t('office.scanClearance.measure.frontLabel', '{name}, Clear Space In Front, To {thing}', { name: m.kind === 'sink_front' ? sink : toilet, thing: thing(m.toward) });
          case 'door_width': return t('office.scanClearance.measure.doorWidthLabel', '{name}, Width As Scanned', { name: door });
          case 'passage_width': return t('office.scanClearance.measure.passageLabel', 'Narrowest Width Between Walls');
          case 'ceiling_low': return t('office.scanClearance.measure.ceilingLabel', 'Lowest Ceiling The Scan Saw');
          case 'window_width': return t('office.scanClearance.measure.windowWidthLabel', '{name}, Opening Width As Scanned', { name: win });
          case 'window_height': return t('office.scanClearance.measure.windowHeightLabel', '{name}, Opening Height As Scanned', { name: win });
          case 'window_area': return t('office.scanClearance.measure.windowAreaLabel', '{name}, Opening Area As Scanned', { name: win });
          default: return t('office.scanClearance.measure.windowSillLabel', '{name}, Sill Height Off The Floor', { name: win });
        }
      },
      valueText: (m) => (m.unit === 'area' ? formatSqFt(sqMetresToSqFeet(m.value)) : formatFeetInches(m.value)),
      measureNote: (m) => {
        switch (m.kind) {
          case 'toilet_side':
          case 'toilet_front':
          case 'sink_front': return t('office.scanClearance.note.fixtureNote', 'Where a fixture sits comes from the scan, even beside a wall you taped.');
          case 'door_width': return t('office.scanClearance.note.doorNote', 'The scan gives one width for a door and cannot tell the door from its frame opening. The clear width with the door open is less than this, so tape it with the door open.');
          case 'passage_width': return m.figures.length
            ? t('office.scanClearance.note.passageNote', 'Between walls only. Furniture and anything standing in the way is not counted.')
            : t('office.scanClearance.note.passagePlainNote', 'This room is not shaped like a hallway, so its width is not set beside the hallway figure.');
          case 'ceiling_low': return null;
          default: return t('office.scanClearance.note.windowNote', 'An emergency escape opening is judged on its net clear opening with the sash open. A scan cannot see that, so a window here is only ever worth a closer look.');
        }
      },
      figureBody: (refId) => t('office.scanClearance.figureBody', '{value}: {called}. From {family}.', { value: figureValue(refId), called: called(refId), family: family(clearanceRef(refId).family) }),
      figureLocalBody: t('office.scanClearance.figureLocalBody', 'A commonly used figure. Your local code may differ.'),
      rowA11yLabel: (label, value, state) => t('office.scanClearance.rowA11yLabel', '{label}, {value}, {state}', { label, value, state }),
      leftOutHeadingLabel: t('office.scanClearance.leftOutHeadingLabel', 'Not Measured Here'),
      leftOutBody: (l) => {
        switch (l.kind) {
          case 'stairs': return l.count > 0
            ? t('office.scanClearance.leftOut.stairsSeenBody', 'The scan saw stairs as one box, with no risers or treads, so the stairs are not measured.')
            : t('office.scanClearance.leftOut.stairsBody', 'Stairs are not measured. A scan does not carry risers or treads.');
          case 'tub_opening': return t('office.scanClearance.leftOut.tubBody', 'The scan gives a tub as a box, not an opening, so the way into a tub or shower is not measured.');
          case 'door_clear': return t('office.scanClearance.leftOut.doorBody', 'The clear width of a doorway with the door open is not measured. The scan cannot see it.');
          case 'window_net_clear': return t('office.scanClearance.leftOut.windowBody', 'The net clear opening of a window with the sash open is not measured. The scan cannot see it.');
          case 'windows_not_bedroom': return t('office.scanClearance.leftOut.windowsOtherRoomBody', 'Windows are set beside the escape opening figures only in a room marked as a bedroom. Change the room type on the plan if this is one.');
          case 'fixture_free': return t('office.scanClearance.leftOut.fixtureFreeBody', 'A toilet or sink that stands away from every wall is not measured. The scan does not say which way it faces.');
          case 'passage_open': return t('office.scanClearance.leftOut.passageOpenBody', 'The outline did not close, so the narrowest width between walls is not measured.');
          default: return t('office.scanClearance.leftOut.ceilingBody', 'The scan gave no ceiling height.');
        }
      },
      codeCheckLabel: t('office.scanClearance.codeCheckLabel', 'Ask Code Check'),
      codeCheckBody: t('office.scanClearance.codeCheckBody', 'Code Check can look into what your place asks for. It has its own plan, its own daily limit and its own notice.'),
    };
  }, [t, tn]);
}

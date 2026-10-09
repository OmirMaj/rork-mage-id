// hooks/useScanOrderCopy.ts — the ONLY place the Scan The Room order list's
// strings live (lane SCANORDER). Every string goes through
// t('office.roomScan.order.*', english, vars) / tn(...), so they sit in the
// same shard as the rest of Scan The Room (surface 'office.room-scan', Spanish
// in i18n/catalog/es/office/roomScan.ts) and the same word rules read them
// (scripts/validate-scan-room.ts W1 to W5, and scripts/validate-scan-order.ts).
// components/roomScan/Order*.tsx, CutLayoutView.tsx and TapeFactsPanel.tsx
// import this and add no t() keys of their own.
//
// WORDING: a key ending in `Label` is a name or an action, every word
// capitalised. `Body` and `Note` are whole sentences. `Sub` is a caption with
// no period. `Value` is a quantity ("7 sheets"). No em dashes, no "&", no
// "e.g.", no arrows.
//
// WHAT AN ORDER LIST MAY SAY ABOUT ITSELF. It is worked out from a phone scan,
// and a phone scan can be off by an inch or more: the list says so at the top,
// in the text it copies and on the share confirm. No string says how right a
// number is. A rule of thumb is CALLED a rule of thumb, with the rule. What
// the phone has learned from his tape is stated as counts and inches about the
// walls he taped, never as a score, and a suggestion says why and waits for a
// yes.
//
// Never call t() at module scope: the object is rebuilt when the language
// changes.
import { useMemo } from 'react';
import { useT } from '@/contexts/LanguageContext';
import type { HangDirection } from '@/utils/roomScan/cutPlanCore';
import type { LongWallSuggestion, TapeFacts } from '@/utils/roomScan/learnCore';
import type { FloorLayout, OrderGap, OrderGroup, OrderLine, OrderTextWords, TrimKind, WasteReason } from '@/utils/roomScan/orderListCore';
import { formatFeetInches, inchesToMetres, round1 } from '@/utils/roomScan/units';

export interface ScanOrderCopy {
  titleLabel: string;
  openLabel: string;
  noticeBody: string;
  introBody: (room: string) => string;
  groupLabel: (g: OrderGroup) => string;
  // ── his choices ──
  choicesHeadingLabel: string;
  includeLabel: string;
  sheetSizeLabel: string;
  hangLabel: string;
  hangName: (h: HangDirection) => string;
  floorKindLabel: string;
  floorKindName: (k: 'tile' | 'flooring') => string;
  layoutLabel: string;
  layoutName: (l: FloorLayout) => string;
  wasteLabel: string;
  wasteAutoLabel: string;
  wastePctLabel: (pct: number) => string;
  wetWallsLabel: string;
  wetHeightLabel: string;
  wetHeightFullLabel: string;
  wetHeightFtLabel: (ft: number) => string;
  coatsLabel: string;
  coatsName: (n: number) => string;
  spreadLabel: string;
  spreadName: (sf: number) => string;
  primerLabel: string;
  crownLabel: string;
  windowCasingLabel: string;
  yesLabel: string;
  noLabel: string;
  stockLabel: string;
  stockName: (ft: number) => string;
  // ── the lines ──
  lineName: (l: Pick<OrderLine, 'key' | 'basis'>) => string;
  quantity: (l: Pick<OrderLine, 'key' | 'unit' | 'quantity'>) => string;
  workedSub: (qty: string) => string;
  typedLabel: string;
  ruleOfThumbLabel: string;
  assumption: (l: OrderLine) => string;
  addedNote: (inchesText: string, walls: number) => string;
  typeQtyLabel: string;
  qtyInputLabel: string;
  useQtyLabel: string;
  clearQtyLabel: string;
  qtyInvalidBody: string;
  priceEachSub: (rate: string) => string;
  priceSqFtSub: (rate: string) => string;
  materialPriceNote: string;
  gapBody: (g: OrderGap) => string;
  nothingBody: string;
  // ── the cut layout ──
  layoutHeadingLabel: string;
  layoutIntroBody: string;
  layoutCeilingLabel: string;
  layoutCountSub: (pieces: number, sheets: number) => string;
  layoutA11y: (what: string) => string;
  legendNewSub: string;
  legendOffcutSub: string;
  legendCutoutSub: string;
  legendShapeSub: string;
  gapNote: (gap: string) => string;
  // ── the trim cut list ──
  cutListHeadingLabel: string;
  trimKindLabel: (k: TrimKind) => string;
  stickSub: (ft: number, cuts: string, drop: string) => string;
  packNote: (naiveFt: number, boughtFt: number) => string;
  // ── what your tape says ──
  tapeHeadingLabel: string;
  tapeFactsBody: (f: TapeFacts) => string;
  tapeFarNote: (count: number) => string;
  tapeScopeNote: string;
  inchesText: (inches: number) => string;
  suggestBody: (s: LongWallSuggestion) => string;
  suggestAcceptLabel: (add: string) => string;
  suggestIgnoreLabel: string;
  suggestAcceptedNote: (add: string) => string;
  suggestRemoveLabel: string;
  wasteOfferBody: (trade: string, jobs: number, pct: number) => string;
  wasteOfferAcceptLabel: (pct: number) => string;
  // ── sending it ──
  copyLabel: string;
  shareLabel: string;
  estimateLabel: string;
  notYetLabel: string;
  confirmCopyTitleLabel: string;
  confirmCopyBody: (lines: number) => string;
  confirmCopyYesLabel: string;
  confirmShareTitleLabel: string;
  confirmShareBody: (lines: number) => string;
  confirmShareYesLabel: string;
  confirmEstimateTitleLabel: string;
  confirmEstimateBody: (lines: number, total: string) => string;
  confirmEstimateStartBody: (lines: number, total: string, markup: number) => string;
  confirmEstimateYesLabel: string;
  copiedNote: string;
  copyFailedBody: string;
  sharedNote: string;
  sharedAsCopyNote: string;
  shareFailedBody: string;
  noPdfNote: string;
  text: OrderTextWords;
}

const n1 = (n: number): string => round1(n).toFixed(1);
const trimInches = (inches: number): string => String(Math.round(inches * 100) / 100);

export function useScanOrderCopy(): ScanOrderCopy {
  const { t, tn } = useT();
  return useMemo<ScanOrderCopy>(() => {
    const groupLabel = (g: OrderGroup): string => {
      switch (g) {
        case 'drywall': return t('office.roomScan.order.group.drywallLabel', 'Drywall');
        case 'flooring': return t('office.roomScan.order.group.flooringLabel', 'Flooring');
        case 'wallTile': return t('office.roomScan.order.group.wallTileLabel', 'Wall Tile');
        case 'paint': return t('office.roomScan.order.group.paintLabel', 'Paint');
        case 'trim': return t('office.roomScan.order.group.trimLabel', 'Trim');
      }
    };
    const trimKindLabel = (k: TrimKind): string => {
      switch (k) {
        case 'baseboard': return t('office.roomScan.order.trim.baseboardLabel', 'Baseboard');
        case 'crown': return t('office.roomScan.order.trim.crownLabel', 'Crown');
        case 'casing': return t('office.roomScan.order.trim.casingLabel', 'Casing');
      }
    };
    const inchesText = (inches: number): string => (inches === 1
      ? t('office.roomScan.order.tape.inchOneValue', '1 inch')
      : t('office.roomScan.order.tape.inchesValue', '{n} inches', { n: trimInches(inches) }));
    const lineName: ScanOrderCopy['lineName'] = (l) => {
      const b = l.basis;
      if (b.kind === 'trim') {
        switch (b.what) {
          case 'baseboard': return t('office.roomScan.order.line.baseboardLabel', 'Baseboard, {ft} Ft Sticks', { ft: b.stockFt });
          case 'crown': return t('office.roomScan.order.line.crownLabel', 'Crown, {ft} Ft Sticks', { ft: b.stockFt });
          case 'casing': return t('office.roomScan.order.line.casingLabel', 'Casing, {ft} Ft Sticks', { ft: b.stockFt });
        }
      }
      switch (l.key) {
        case 'drywall_walls': return t('office.roomScan.order.line.drywallWallsLabel', 'Drywall Sheets {size}, Walls', { size: b.kind === 'sheets' ? b.sheet : '' });
        case 'drywall_ceiling': return t('office.roomScan.order.line.drywallCeilingLabel', 'Drywall Sheets {size}, Ceiling', { size: b.kind === 'sheets' ? b.sheet : '' });
        case 'screws': return t('office.roomScan.order.line.screwsLabel', 'Drywall Screws');
        case 'compound': return t('office.roomScan.order.line.compoundLabel', 'Joint Compound');
        case 'tape': return t('office.roomScan.order.line.tapeLabel', 'Joint Tape');
        case 'corner_bead': return t('office.roomScan.order.line.cornerBeadLabel', 'Corner Bead');
        case 'floor': return b.kind === 'area' && b.floorKind === 'tile'
          ? t('office.roomScan.order.line.floorTileLabel', 'Floor Tile')
          : t('office.roomScan.order.line.flooringLabel', 'Flooring');
        case 'wall_tile': return t('office.roomScan.order.line.wallTileLabel', 'Wall Tile');
        case 'paint_walls': return t('office.roomScan.order.line.paintWallsLabel', 'Paint, Walls');
        case 'paint_ceiling': return t('office.roomScan.order.line.paintCeilingLabel', 'Paint, Ceiling');
        case 'primer': return t('office.roomScan.order.line.primerLabel', 'Primer');
        default: return l.key;
      }
    };
    const quantity: ScanOrderCopy['quantity'] = (l) => {
      const count = l.quantity;
      switch (l.key) {
        case 'screws': return tn('office.roomScan.order.qty.screwsValue', count, { one: '1 box, 5 lb', other: '{count} boxes, 5 lb each' });
        case 'compound': return tn('office.roomScan.order.qty.compoundValue', count, { one: '1 bucket, 5 gal', other: '{count} buckets, 5 gal each' });
        case 'tape': return tn('office.roomScan.order.qty.tapeValue', count, { one: '1 roll, 500 ft', other: '{count} rolls, 500 ft each' });
        case 'corner_bead': return tn('office.roomScan.order.qty.cornerBeadValue', count, { one: '1 stick, 10 ft', other: '{count} sticks, 10 ft each' });
      }
      switch (l.unit) {
        case 'sheet': return tn('office.roomScan.order.qty.sheetValue', count, { one: '1 sheet', other: '{count} sheets' });
        case 'gallon': return tn('office.roomScan.order.qty.gallonValue', count, { one: '1 gallon', other: '{count} gallons' });
        case 'stick': return tn('office.roomScan.order.qty.stickValue', count, { one: '1 stick', other: '{count} sticks' });
        case 'box': return tn('office.roomScan.order.qty.boxValue', count, { one: '1 box', other: '{count} boxes' });
        case 'bucket': return tn('office.roomScan.order.qty.bucketValue', count, { one: '1 bucket', other: '{count} buckets' });
        case 'roll': return tn('office.roomScan.order.qty.rollValue', count, { one: '1 roll', other: '{count} rolls' });
        case 'sqft': return t('office.roomScan.order.qty.sqftValue', '{count} sq ft', { count });
      }
    };
    const reason = (r: WasteReason): string => {
      if (r.kind === 'typed') return t('office.roomScan.order.reason.typedNote', 'You set the allowance to {pct} percent.', { pct: r.pct });
      if (r.kind === 'shape') return r.angled
        ? t('office.roomScan.order.reason.angledNote', 'This room has angled walls, so {pct} percent more.', { pct: r.pct })
        : t('office.roomScan.order.reason.cornersNote', 'This room has {corners} corners, so {pct} percent more.', { corners: r.corners, pct: r.pct });
      switch (r.layout) {
        case 'straight': return t('office.roomScan.order.reason.straightNote', 'A straight layout takes {pct} percent.', { pct: r.pct });
        case 'diagonal': return t('office.roomScan.order.reason.diagonalNote', 'A diagonal layout takes {pct} percent, for the cuts along every wall.', { pct: r.pct });
        case 'herringbone': return t('office.roomScan.order.reason.herringboneNote', 'A herringbone layout takes {pct} percent, for the cuts along every wall.', { pct: r.pct });
      }
    };
    const assumption: ScanOrderCopy['assumption'] = (l) => {
      const b = l.basis;
      switch (b.kind) {
        case 'sheets': return b.where === 'walls'
          ? t('office.roomScan.order.basis.sheetsWallsNote', 'Laid out wall by wall on {hung} sq ft of wall, with doors and windows cut out once. Offcuts of {min} in and over are used again.', { hung: n1(b.hungSF), min: b.minOffcutIn })
          : t('office.roomScan.order.basis.sheetsCeilingNote', 'Laid out on the true shape of the ceiling, {hung} sq ft, with the sheets along the longest wall.', { hung: n1(b.hungSF) });
        case 'screws': return t('office.roomScan.order.basis.screwsNote', 'Rule of thumb: about 1 screw for each square foot of board, on {board} sq ft. A 5 lb box holds about 1,000.', { board: n1(b.boardSF) });
        case 'compound': return t('office.roomScan.order.basis.compoundNote', 'Rule of thumb: about 1 gallon for each 100 sq ft of board, on {board} sq ft.', { board: n1(b.boardSF) });
        case 'tape': return t('office.roomScan.order.basis.tapeNote', 'Rule of thumb: about 370 ft of tape for each 1,000 sq ft of board, on {board} sq ft.', { board: n1(b.boardSF) });
        case 'cornerBead': return t('office.roomScan.order.basis.cornerBeadNote', 'Rule of thumb: one stick for each outside corner. The scan found {corners}. Window and door returns are not counted.', { corners: b.corners });
        case 'area': {
          const why = b.reasons.map(reason).join(' ');
          const head = b.what === 'floor'
            ? t('office.roomScan.order.basis.floorNote', '{net} sq ft of floor plus {pct} percent comes to {order} sq ft.', { net: n1(b.netSF), pct: b.wastePct, order: b.orderSF })
            : tn('office.roomScan.order.basis.wallTileNote', b.walls, {
              one: '{net} sq ft on 1 wet wall plus {pct} percent comes to {order} sq ft.',
              other: '{net} sq ft on {count} wet walls plus {pct} percent comes to {order} sq ft.',
            }, { net: n1(b.netSF), pct: b.wastePct, order: b.orderSF });
          const box = b.boxSF ? ` ${t('office.roomScan.order.basis.boxNote', 'A box covers {box} sq ft.', { box: b.boxSF })}` : '';
          return `${head} ${why}${box}`;
        }
        case 'paint': return b.what === 'primer'
          ? t('office.roomScan.order.basis.primerNote', '{net} sq ft of walls and ceiling, one coat, one gallon to {spread} sq ft, comes to {worked} gallons. Rounded up to whole gallons.', { net: n1(b.netSF), spread: b.spreadSFPerGal, worked: n1(b.workedGal) })
          : tn('office.roomScan.order.basis.paintNote', b.coats, {
            one: '{net} sq ft, 1 coat, one gallon to {spread} sq ft, comes to {worked} gallons. Rounded up to whole gallons.',
            other: '{net} sq ft, {count} coats, one gallon to {spread} sq ft, comes to {worked} gallons. Rounded up to whole gallons.',
          }, { net: n1(b.netSF), spread: b.spreadSFPerGal, worked: n1(b.workedGal) });
        case 'trim': {
          const head = tn('office.roomScan.order.basis.trimNote', b.pieces, {
            one: '{run} ft to cover in 1 piece. {bought} ft of stick bought in all.',
            other: '{run} ft to cover in {count} pieces, packed into the fewest feet of stick. {bought} ft of stick bought in all.',
          }, { run: n1(b.runFt), bought: b.boughtFt });
          const joints = b.joints > 0
            ? ` ${tn('office.roomScan.order.basis.trimJointsNote', b.joints, { one: '1 joint, on a run longer than the longest stick.', other: '{count} joints, on runs longer than the longest stick.' })}`
            : '';
          return `${head}${joints}`;
        }
      }
    };
    const noticeBody = t('office.roomScan.order.noticeBody', 'A phone scan can be off by an inch or more. Check before you order.');
    const typedLabel = t('office.roomScan.order.typedLabel', 'You Typed This');
    const ruleOfThumbLabel = t('office.roomScan.order.ruleOfThumbLabel', 'Rule Of Thumb');
    return {
      titleLabel: t('office.roomScan.order.titleLabel', 'Order List'),
      openLabel: t('office.roomScan.order.openLabel', 'Build The Order List'),
      noticeBody,
      introBody: (room) => t('office.roomScan.order.introBody', 'What to buy for {room}, worked out from the true shape of the room. Change a choice and the list is worked out again.', { room }),
      groupLabel,
      choicesHeadingLabel: t('office.roomScan.order.choices.headingLabel', 'Your Choices'),
      includeLabel: t('office.roomScan.order.choices.includeLabel', 'On This List'),
      sheetSizeLabel: t('office.roomScan.order.choices.sheetSizeLabel', 'Sheet Size'),
      hangLabel: t('office.roomScan.order.choices.hangLabel', 'Sheets On The Walls'),
      hangName: (h) => (h === 'across'
        ? t('office.roomScan.order.choices.hangAcrossLabel', 'Lying Down')
        : t('office.roomScan.order.choices.hangUprightLabel', 'Standing Up')),
      floorKindLabel: t('office.roomScan.order.choices.floorKindLabel', 'Floor'),
      floorKindName: (k) => (k === 'tile'
        ? t('office.roomScan.order.choices.floorTileLabel', 'Tile')
        : t('office.roomScan.order.choices.floorFlooringLabel', 'Flooring')),
      layoutLabel: t('office.roomScan.order.choices.layoutLabel', 'Layout'),
      layoutName: (l) => {
        switch (l) {
          case 'straight': return t('office.roomScan.order.choices.layoutStraightLabel', 'Straight');
          case 'diagonal': return t('office.roomScan.order.choices.layoutDiagonalLabel', 'Diagonal');
          case 'herringbone': return t('office.roomScan.order.choices.layoutHerringboneLabel', 'Herringbone');
        }
      },
      wasteLabel: t('office.roomScan.order.choices.wasteLabel', 'Waste Allowance'),
      wasteAutoLabel: t('office.roomScan.order.choices.wasteAutoLabel', 'Worked Out'),
      wastePctLabel: (pct) => t('office.roomScan.order.choices.wastePctLabel', '{pct} Percent', { pct }),
      wetWallsLabel: t('office.roomScan.order.choices.wetWallsLabel', 'Wet Walls'),
      wetHeightLabel: t('office.roomScan.order.choices.wetHeightLabel', 'Tile Height'),
      wetHeightFullLabel: t('office.roomScan.order.choices.wetHeightFullLabel', 'To The Ceiling'),
      wetHeightFtLabel: (ft) => t('office.roomScan.order.choices.wetHeightFtLabel', '{ft} Ft', { ft }),
      coatsLabel: t('office.roomScan.order.choices.coatsLabel', 'Coats Of Paint'),
      coatsName: (n) => tn('office.roomScan.order.choices.coatsValueLabel', n, { one: '1 Coat', other: '{count} Coats' }),
      spreadLabel: t('office.roomScan.order.choices.spreadLabel', 'One Gallon Covers'),
      spreadName: (sf) => t('office.roomScan.order.choices.spreadValueLabel', '{sf} Sq Ft', { sf }),
      primerLabel: t('office.roomScan.order.choices.primerLabel', 'Primer'),
      crownLabel: t('office.roomScan.order.choices.crownLabel', 'Crown'),
      windowCasingLabel: t('office.roomScan.order.choices.windowCasingLabel', 'Window Casing'),
      yesLabel: t('office.roomScan.order.choices.yesLabel', 'Yes'),
      noLabel: t('office.roomScan.order.choices.noLabel', 'No'),
      stockLabel: t('office.roomScan.order.choices.stockLabel', 'Stick Lengths You Buy'),
      stockName: (ft) => t('office.roomScan.order.choices.stockValueLabel', '{ft} Ft', { ft }),

      lineName,
      quantity,
      workedSub: (qty) => t('office.roomScan.order.workedSub', 'Worked out as {qty}', { qty }),
      typedLabel,
      ruleOfThumbLabel,
      assumption,
      addedNote: (inches, walls) => tn('office.roomScan.order.addedNote', walls, {
        one: 'This list adds {inches} to 1 long wall you have not taped, because your own taped walls ran longer than the scan. The scan keeps its numbers.',
        other: 'This list adds {inches} to each of {count} long walls you have not taped, because your own taped walls ran longer than the scan. The scan keeps its numbers.',
      }, { inches }),
      typeQtyLabel: t('office.roomScan.order.typeQtyLabel', 'Type A Quantity'),
      qtyInputLabel: t('office.roomScan.order.qtyInputLabel', 'Quantity To Buy'),
      useQtyLabel: t('office.roomScan.order.useQtyLabel', 'Use This Quantity'),
      clearQtyLabel: t('office.roomScan.order.clearQtyLabel', 'Use The Worked Number'),
      qtyInvalidBody: t('office.roomScan.order.qtyInvalidBody', 'Type a whole number, zero or more.'),
      priceEachSub: (rate) => t('office.roomScan.order.priceEachSub', 'At {rate} each', { rate }),
      priceSqFtSub: (rate) => t('office.roomScan.order.priceSqFtSub', 'At {rate} a sq ft', { rate }),
      materialPriceNote: t('office.roomScan.order.materialPriceNote', 'A catalog price is a list price for the material in your area. Your own cost book holds installed prices, so it is not used for materials.'),
      gapBody: (g) => {
        switch (g) {
          case 'floor_not_known': return t('office.roomScan.order.gap.floorBody', 'The outline did not close, so the floor and the ceiling cannot be worked out.');
          case 'ceiling_height_missing': return t('office.roomScan.order.gap.ceilingBody', 'There is no ceiling height, so nothing on the walls can be worked out. Type it on the plan.');
          case 'no_wet_wall': return t('office.roomScan.order.gap.wetWallBody', 'Mark at least one wet wall to get wall tile.');
        }
      },
      nothingBody: t('office.roomScan.order.nothingBody', 'Nothing is on the list yet. Turn on at least one kind of material.'),

      layoutHeadingLabel: t('office.roomScan.order.layout.headingLabel', 'Drywall Cut Layout'),
      layoutIntroBody: t('office.roomScan.order.layout.introBody', 'One wall at a time, as the sheets go up. A piece cut from an earlier offcut is shaded. Studs and joists are not on a scan, so check where the joints land.'),
      layoutCeilingLabel: t('office.roomScan.order.layout.ceilingLabel', 'Ceiling'),
      layoutCountSub: (pieces, sheets) => t('office.roomScan.order.layout.countSub', 'Pieces: {pieces}. New sheets opened here: {sheets}', { pieces, sheets }),
      layoutA11y: (what) => t('office.roomScan.order.layout.a11y', 'Drywall cut layout for {what}', { what }),
      legendNewSub: t('office.roomScan.order.layout.legendNewSub', 'From a new sheet'),
      legendOffcutSub: t('office.roomScan.order.layout.legendOffcutSub', 'From an offcut'),
      legendCutoutSub: t('office.roomScan.order.layout.legendCutoutSub', 'Cut out for a door, window or opening'),
      legendShapeSub: t('office.roomScan.order.layout.legendShapeSub', 'Cut to the shape of the room'),
      gapNote: (gap) => t('office.roomScan.order.layout.gapNote', 'A gap of {gap} in is left for the corner or the trim.', { gap }),

      cutListHeadingLabel: t('office.roomScan.order.cutList.headingLabel', 'Trim Cut List'),
      trimKindLabel,
      stickSub: (ft, cuts, drop) => t('office.roomScan.order.cutList.stickSub', '{ft} ft stick: {cuts}. Left over: {drop}', { ft, cuts, drop }),
      packNote: (naiveFt, boughtFt) => t('office.roomScan.order.cutList.packNote', 'Packed longest piece first. One stick for each piece would be {naive} ft of stick. This is {bought} ft.', { naive: naiveFt, bought: boughtFt }),

      tapeHeadingLabel: t('office.roomScan.order.tape.headingLabel', 'What Your Tape Says'),
      tapeFactsBody: (f) => {
        if (!f.enough) {
          if (f.count === 0) return t('office.roomScan.order.tape.noneBody', 'You have not taped a wall on this phone yet. It takes {needed} taped walls to say how your scans run.', { needed: f.needed });
          return tn('office.roomScan.order.tape.notEnoughBody', f.count, {
            one: 'You have taped 1 wall on this phone. That is not enough to tell. It takes {needed}.',
            other: 'You have taped {count} walls on this phone. That is not enough to tell. It takes {needed}.',
          }, { needed: f.needed });
        }
        return t('office.roomScan.order.tape.factsBody', 'Across {count} walls you taped, the scan was within 1 inch on {within}. The largest difference was {largest}. The typical difference was {typical}.', {
          count: f.count, within: f.withinCount, largest: inchesText(f.largestIn), typical: inchesText(f.typicalIn),
        });
      },
      tapeFarNote: (count) => tn('office.roomScan.order.tape.farNote', count, {
        one: '1 more wall taped at more than double or less than half the scan. It is left out of these numbers.',
        other: '{count} more walls taped at more than double or less than half the scan. They are left out of these numbers.',
      }),
      tapeScopeNote: t('office.roomScan.order.tape.scopeNote', 'These numbers are about the walls you taped on this phone. They say nothing about a wall you did not check.'),
      inchesText,
      suggestBody: (s) => t('office.roomScan.order.suggest.body', 'On {short} of the {long} long walls you taped, the tape read longer than the scan. The typical shortfall was {typical}. You can add {add} to each long wall you have not taped. It changes this order list only, not the scan.', {
        short: s.shortCount, long: s.longCount, typical: inchesText(s.typicalIn), add: inchesText(s.addIn),
      }),
      suggestAcceptLabel: (add) => t('office.roomScan.order.suggest.acceptLabel', 'Add {add}', { add }),
      suggestIgnoreLabel: t('office.roomScan.order.suggest.ignoreLabel', 'Not Now'),
      suggestAcceptedNote: (add) => t('office.roomScan.order.suggest.acceptedNote', 'You added {add} to each long wall you have not taped.', { add }),
      suggestRemoveLabel: t('office.roomScan.order.suggest.removeLabel', 'Take It Off'),
      wasteOfferBody: (trade, jobs, pct) => t('office.roomScan.order.wasteOffer.body', 'On your last {jobs} jobs you bought about {pct} percent more {trade} than the scan said.', { trade, jobs, pct }),
      wasteOfferAcceptLabel: (pct) => t('office.roomScan.order.wasteOffer.acceptLabel', 'Use {pct} Percent', { pct }),

      copyLabel: t('office.roomScan.order.send.copyLabel', 'Copy As Text'),
      shareLabel: t('office.roomScan.order.send.shareLabel', 'Share The List'),
      estimateLabel: t('office.roomScan.order.send.estimateLabel', 'Add Materials To Estimate'),
      notYetLabel: t('office.roomScan.order.send.notYetLabel', 'Not Yet'),
      confirmCopyTitleLabel: t('office.roomScan.order.send.copyTitleLabel', 'Copy The Order List'),
      confirmCopyBody: (lines) => tn('office.roomScan.order.send.copyBody', lines, {
        one: 'This copies 1 line as plain text. It goes nowhere until you paste it yourself.',
        other: 'This copies {count} lines as plain text. It goes nowhere until you paste it yourself.',
      }),
      confirmCopyYesLabel: t('office.roomScan.order.send.copyYesLabel', 'Copy'),
      confirmShareTitleLabel: t('office.roomScan.order.send.shareTitleLabel', 'Share The Order List'),
      confirmShareBody: (lines) => tn('office.roomScan.order.send.shareBody', lines, {
        one: 'This opens the share sheet with 1 line as plain text. You choose who gets it. A phone scan can be off by an inch or more, so check the list first.',
        other: 'This opens the share sheet with {count} lines as plain text. You choose who gets it. A phone scan can be off by an inch or more, so check the list first.',
      }),
      confirmShareYesLabel: t('office.roomScan.order.send.shareYesLabel', 'Share'),
      confirmEstimateTitleLabel: t('office.roomScan.order.send.estimateTitleLabel', 'Add Materials To The Estimate'),
      confirmEstimateBody: (lines, total) => tn('office.roomScan.order.send.estimateBody', lines, {
        one: 'This puts 1 material line into the estimate for this project, {total} before markup. It is material only. If the estimate already prices this work installed, the material would be in there twice. The estimate as it stands now is kept in its history. Nothing is sent to your client.',
        other: 'This puts {count} material lines into the estimate for this project, {total} before markup. They are material only. If the estimate already prices this work installed, the material would be in there twice. The estimate as it stands now is kept in its history. Nothing is sent to your client.',
      }, { total }),
      confirmEstimateStartBody: (lines, total, markup) => tn('office.roomScan.order.send.estimateStartBody', lines, {
        one: 'This project has no estimate yet. This starts one with 1 material line, {total} before markup, at your markup of {markup} percent. Nothing is sent to your client.',
        other: 'This project has no estimate yet. This starts one with {count} material lines, {total} before markup, at your markup of {markup} percent. Nothing is sent to your client.',
      }, { total, markup }),
      confirmEstimateYesLabel: t('office.roomScan.order.send.estimateYesLabel', 'Add Materials'),
      copiedNote: t('office.roomScan.order.send.copiedNote', 'Copied.'),
      copyFailedBody: t('office.roomScan.order.send.copyFailedBody', 'The list could not be copied. Try again.'),
      sharedNote: t('office.roomScan.order.send.sharedNote', 'Handed to the share sheet.'),
      sharedAsCopyNote: t('office.roomScan.order.send.sharedAsCopyNote', 'This device has no share sheet, so the list was copied.'),
      shareFailedBody: t('office.roomScan.order.send.shareFailedBody', 'The list could not be shared. Try again.'),
      noPdfNote: t('office.roomScan.order.send.noPdfNote', 'The list goes out as plain text. There is no PDF of it yet.'),
      text: {
        title: (room) => (room
          ? t('office.roomScan.order.text.titleValue', 'Order list, {room}', { room })
          : t('office.roomScan.order.text.titleBareValue', 'Order list')),
        notice: noticeBody,
        group: groupLabel,
        line: (l) => lineName(l),
        quantity,
        typedMark: typedLabel,
        ruleOfThumbMark: ruleOfThumbLabel,
        assumption,
        cutListHeading: (kind) => t('office.roomScan.order.text.cutListValue', 'Cut list, {kind}', { kind: trimKindLabel(kind) }),
        stick: (ft, cuts) => t('office.roomScan.order.text.stickValue', '{ft} ft stick: {cuts}', { ft, cuts: cuts.join(', ') }),
        length: (inches) => formatFeetInches(inchesToMetres(inches)),
      },
    };
  }, [t, tn]);
}

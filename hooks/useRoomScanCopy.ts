// hooks/useRoomScanCopy.ts — the ONLY place the Scan The Room strings live.
// Every string goes through t('office.roomScan.*', english, vars) / tn(...),
// so the i18n registry stays in one file (surface 'office.room-scan', Spanish
// in i18n/catalog/es/office/roomScan.ts). components/roomScan/* and
// app/scan-room.tsx import this and add no t() keys of their own.
//
// WORDING (design-previews/copy-style/COPY-STYLE.md and the founder's sketch,
// design-previews/big-bets/scan-flow.png): a key ending in `Label` is a name
// or an action and is written with every word capitalised ("See The
// Quantities", "Open In Estimate"). A key ending in `Body` or `Note` is one or
// more whole sentences in sentence case. A key ending in `Sub` is a caption:
// capital first letter, no period at the end. No em dashes, no "&", no "e.g.",
// no arrows.
//
// WHAT A SCAN MAY SAY ABOUT ITSELF. A scan is a fast first measure, not a
// survey. No string here says how right a number is: the words "accurate",
// "exact", "precise" and "guaranteed" do not appear, and the plan says in
// plain words that a phone scan can be off by an inch or more. What the app
// knows is stated as a fact ("4 of 4 walls found"), never as a score.
// A price says where it came from: "Your Price, 6 Past Jobs" only for his own
// measured cost book, "Catalog Price" for a list price, "No Price Yet" for a
// blank. When the price came from one of his trades that is not the line's own
// trade, the label names it: "Your Price For Doors, 3 Past Jobs". scripts/validate-scan-room.ts reads the English shard and fails on
// any of these.
//
// Never call t() at module scope: the object is rebuilt when the language
// changes.
import { useMemo } from 'react';
import { useT } from '@/contexts/LanguageContext';
import type { RoomScanUnavailableReason } from '@/utils/roomScan/availability';
import type { DraftBlock, OwnPriceClaim, ScanPriceSource } from '@/utils/roomScan/pricingCore';
import type { RecipeKey } from '@/utils/roomScan/recipesCore';
import type { RoomType, ScanFact } from '@/utils/roomScan/types';
import { formatFeetInches } from '@/utils/roomScan/units';

export type RoomScanEditKind = 'wall' | 'ceiling' | 'width' | 'height';
export type RoomScanPricingBlock = 'not_closed' | 'typed_lengths_do_not_close' | 'low_confidence_wall' | 'ceiling_height_missing' | 'no_name';
export type RoomScanSeatBlock = 'checking' | 'refused' | 'unknown';

export interface RoomScanCopy {
  // ── the start ──
  titleLabel: string;
  /** 'sq ft', 'ft', or '' for a count. */
  unitWord: (unit: 'SF' | 'LF' | 'EA') => string;
  backLabel: string;
  startBody: string;
  tipsHeadingLabel: string;
  tips: string[];
  startScanLabel: string;
  allowCameraLabel: string;
  openSettingsLabel: string;
  unavailableBody: (reason: RoomScanUnavailableReason) => string;
  otherWaysBody: string;
  scanFailedBody: string;
  scanUnreadableBody: string;
  savedHeadingLabel: string;
  savedEmptyBody: string;
  savedRowSub: (date: string, walls: number) => string;
  deleteA11yLabel: (name: string) => string;
  deleteTitleLabel: string;
  deleteBody: (name: string) => string;
  deleteYesLabel: string;
  deleteNoLabel: string;
  deleteFailedBody: string;
  leaveTitleLabel: string;
  leaveBody: string;
  leaveYesLabel: string;
  leaveNoLabel: string;
  seatBody: (b: RoomScanSeatBlock) => string;
  retryLabel: string;
  // ── the plan ──
  scannedSub: (date: string, time: string) => string;
  nameLabel: string;
  namePlaceholder: string;
  nameNeededBody: string;
  roomTypeLabel: string;
  roomTypeName: (t: RoomType) => string;
  ceilingLabel: string;
  floorLabel: string;
  wallsFoundLabel: string;
  wallsFoundValue: (found: number, needed: number) => string;
  notKnownLabel: string;
  planNoteBody: string;
  legendTypedSub: string;
  legendAdjustedSub: string;
  legendLowSub: string;
  doorLabel: string;
  windowLabel: string;
  openingLabel: string;
  objectLabel: (category: string) => string;
  wallName: (label: string) => string;
  dimensionA11y: (what: string, value: string) => string;
  seeQuantitiesLabel: string;
  saveLabel: string;
  savedNote: string;
  saveFailedBody: string;
  fact: (f: ScanFact) => string;
  // ── fixing a number ──
  editTitleLabel: (kind: RoomScanEditKind) => string;
  editScanValueSub: (value: string) => string;
  editReadsAsSub: (value: string) => string;
  editFarBody: (typed: string, scan: string) => string;
  editInputLabel: string;
  editHintBody: string;
  editInvalidBody: string;
  editRecordNote: string;
  editSaveLabel: string;
  cancelLabel: string;
  // ── the quantities ──
  quantitiesTitleLabel: string;
  quantitiesIntroBody: string;
  qFloorLabel: string;
  qFloorSub: string;
  qFloorOpenSub: string;
  qWallLabel: string;
  qWallSub: (gross: string, openings: string) => string;
  qWallUnknownSub: string;
  qCeilingLabel: string;
  qCeilingFlatSub: string;
  qCeilingVariesSub: string;
  qBaseboardLabel: string;
  qBaseboardSub: string;
  qCrownLabel: string;
  qCrownSub: string;
  qCasingLabel: string;
  qCasingSub: string;
  qDoorsLabel: string;
  qWindowsLabel: string;
  qFixturesLabel: string;
  qNoneSub: string;
  qNominalSub: (size: string, nominalIn: number) => string;
  qWasteNote: string;
  priceItLabel: string;
  pricingBlockBody: (b: RoomScanPricingBlock) => string;
  // ── the priced draft ──
  draftTitleLabel: string;
  draftIntroBody: (room: string) => string;
  lineName: (key: RecipeKey) => string;
  lineQtySub: (qty: string, unit: 'SF' | 'LF' | 'EA', rate: string) => string;
  lineNoPriceSub: (qty: string, unit: 'SF' | 'LF' | 'EA') => string;
  lineWasteSub: (pct: number) => string;
  sourceLabel: (source: ScanPriceSource | null, claim: OwnPriceClaim | null) => string;
  noPriceBody: string;
  catalogNote: string;
  typePriceLabel: string;
  priceInputLabel: string;
  usePriceLabel: string;
  priceInvalidBody: string;
  leaveOutLabel: string;
  putBackLabel: string;
  leftOutSub: string;
  totalLabel: string;
  totalSub: (own: number, count: number) => string;
  markupNote: string;
  unpricedNote: (count: number) => string;
  openInEstimateLabel: string;
  draftBlockBody: (b: DraftBlock) => string;
  confirmTitleLabel: string;
  confirmBody: (count: number, total: string) => string;
  /** Shown on the Price It confirm when this room's order list already put material lines in the estimate. */
  confirmMaterialsInBody: string;
  confirmYesLabel: string;
  confirmNoLabel: string;
  startTitleLabel: string;
  startConfirmBody: (count: number, total: string, markup: number) => string;
  startYesLabel: string;
  addedBody: string;
  unconfirmedBody: string;
  addFailedBody: string;
  paywallFeatureLabel: string;
}

export function useRoomScanCopy(): RoomScanCopy {
  const { t, tn } = useT();
  return useMemo<RoomScanCopy>(() => {
    const and = (parts: string[]): string => {
      if (parts.length <= 1) return parts[0] ?? '';
      return t('office.roomScan.list.two', '{first} and {last}', { first: parts.slice(0, -1).join(', '), last: parts[parts.length - 1] });
    };
    const unitWord = (unit: 'SF' | 'LF' | 'EA'): string =>
      unit === 'SF' ? t('office.roomScan.unit.sf', 'sq ft') : unit === 'LF' ? t('office.roomScan.unit.lf', 'ft') : '';
    return {
      titleLabel: t('office.roomScan.titleLabel', 'Scan The Room'),
      unitWord,
      backLabel: t('office.roomScan.backLabel', 'Back'),
      startBody: t('office.roomScan.start.body', 'Walk the room once with this iPhone. You get a floor plan, the quantities and a draft price, from your own past jobs where you have them. A scan is a fast first measure, not a survey.'),
      tipsHeadingLabel: t('office.roomScan.tips.headingLabel', 'Before You Scan'),
      tips: [
        t('office.roomScan.tips.lightsBody', 'Turn on the lights and open the curtains.'),
        t('office.roomScan.tips.doorsBody', 'Close the doors.'),
        t('office.roomScan.tips.slowBody', 'Move slowly and point the phone at every wall, from the floor to the ceiling.'),
        t('office.roomScan.tips.timeBody', 'Keep a scan under five minutes.'),
        t('office.roomScan.tips.mirrorBody', 'Mirrors, large glass and very dark walls can give a wrong wall. Check those with a tape.'),
      ],
      startScanLabel: t('office.roomScan.start.scanLabel', 'Start Scanning'),
      allowCameraLabel: t('office.roomScan.start.allowCameraLabel', 'Allow Camera'),
      openSettingsLabel: t('office.roomScan.start.openSettingsLabel', 'Open Settings'),
      unavailableBody: (reason) => {
        switch (reason) {
          case 'notInThisBuild': return t('office.roomScan.unavailable.notInThisBuildBody', 'This version of the app does not include room scanning. It comes with a newer version from the App Store.');
          case 'osTooOld': return t('office.roomScan.unavailable.osTooOldBody', 'Room scanning needs iOS 16 or later. Update this iPhone to use it.');
          case 'noLidar': return t('office.roomScan.unavailable.noLidarBody', 'This iPhone has no LiDAR sensor. Room scanning needs an iPhone Pro, 12 Pro or newer.');
          case 'simulator': return t('office.roomScan.unavailable.simulatorBody', 'Room scanning only runs on a real iPhone.');
          case 'cameraUndetermined': return t('office.roomScan.unavailable.cameraUndeterminedBody', 'Room scanning uses the camera and the depth sensor to measure the room. The scan keeps the shape and sizes of the room. No video is saved.');
          case 'cameraDenied': return t('office.roomScan.unavailable.cameraDeniedBody', 'Camera access is off for MAGE ID, so a scan cannot start. Turn it on in Settings, under MAGE ID, Camera.');
        }
      },
      otherWaysBody: t('office.roomScan.unavailable.otherWaysBody', 'You can still measure from a plan in Visual Takeoff, or type quantities into the estimate.'),
      scanFailedBody: t('office.roomScan.error.failedBody', 'The scan stopped before it finished. Nothing was saved. Try again.'),
      scanUnreadableBody: t('office.roomScan.error.unreadableBody', 'The scan finished but the app could not read it. Nothing was saved.'),
      savedHeadingLabel: t('office.roomScan.saved.headingLabel', 'Saved Scans'),
      savedEmptyBody: t('office.roomScan.saved.emptyBody', 'No scans are saved for this project on this phone.'),
      savedRowSub: (date, walls) => tn('office.roomScan.saved.rowSub', walls, { one: '{date}, 1 wall', other: '{date}, {count} walls' }, { date }),
      deleteA11yLabel: (name) => t('office.roomScan.saved.deleteA11yLabel', 'Delete {name}', { name }),
      deleteTitleLabel: t('office.roomScan.saved.deleteTitleLabel', 'Delete This Scan'),
      deleteBody: (name) => t('office.roomScan.saved.deleteBody', 'This deletes {name} from this phone. Lines already in the estimate stay there. A deleted scan cannot be brought back.', { name }),
      deleteYesLabel: t('office.roomScan.saved.deleteYesLabel', 'Delete Scan'),
      deleteNoLabel: t('office.roomScan.saved.deleteNoLabel', 'Keep It'),
      deleteFailedBody: t('office.roomScan.saved.deleteFailedBody', 'The phone could not delete the scan. Try again.'),
      leaveTitleLabel: t('office.roomScan.leave.titleLabel', 'Leave Without Saving'),
      leaveBody: t('office.roomScan.leave.body', 'This scan is not saved. If you go back now, it is gone.'),
      leaveYesLabel: t('office.roomScan.leave.yesLabel', 'Discard Scan'),
      leaveNoLabel: t('office.roomScan.leave.noLabel', 'Stay Here'),
      seatBody: (b) => {
        switch (b) {
          case 'checking': return t('office.roomScan.seat.checkingBody', 'Checking your access to this project.');
          case 'refused': return t('office.roomScan.seat.refusedBody', 'Scan The Room adds lines to the estimate for this project. Only the project owner or an editor can do that. Ask the project owner.');
          case 'unknown': return t('office.roomScan.seat.unknownBody', 'Your access to this project could not be checked. Check your signal and try again.');
        }
      },
      retryLabel: t('office.roomScan.seat.retryLabel', 'Try Again'),

      scannedSub: (date, time) => t('office.roomScan.plan.scannedSub', 'Scanned {date}, {time}', { date, time }),
      nameLabel: t('office.roomScan.plan.nameLabel', 'Room Name'),
      namePlaceholder: t('office.roomScan.plan.namePlaceholderLabel', 'Hall Bathroom'),
      nameNeededBody: t('office.roomScan.plan.nameNeededBody', 'Name the room first. The name goes on every estimate line.'),
      roomTypeLabel: t('office.roomScan.plan.roomTypeLabel', 'Room Type'),
      roomTypeName: (rt) => {
        switch (rt) {
          case 'bathroom': return t('office.roomScan.roomType.bathroomLabel', 'Bathroom');
          case 'kitchen': return t('office.roomScan.roomType.kitchenLabel', 'Kitchen');
          case 'bedroom': return t('office.roomScan.roomType.bedroomLabel', 'Bedroom');
          case 'room': return t('office.roomScan.roomType.roomLabel', 'Other Room');
        }
      },
      ceilingLabel: t('office.roomScan.plan.ceilingLabel', 'Ceiling'),
      floorLabel: t('office.roomScan.plan.floorLabel', 'Floor'),
      wallsFoundLabel: t('office.roomScan.plan.wallsFoundLabel', 'Walls Found'),
      wallsFoundValue: (found, needed) => t('office.roomScan.plan.wallsFoundValue', '{found} of {needed}', { found, needed }),
      notKnownLabel: t('office.roomScan.plan.notKnownLabel', 'Not Known'),
      planNoteBody: t('office.roomScan.plan.noteBody', 'A phone scan can be off by an inch or more. Check one wall with a tape. Tap any number to fix it.'),
      legendTypedSub: t('office.roomScan.plan.legendTypedSub', 'Typed by hand'),
      legendAdjustedSub: t('office.roomScan.plan.legendAdjustedSub', 'Moved to keep the outline closed'),
      legendLowSub: t('office.roomScan.plan.legendLowSub', 'The scan was not sure of this wall'),
      doorLabel: t('office.roomScan.plan.doorLabel', 'Door'),
      windowLabel: t('office.roomScan.plan.windowLabel', 'Window'),
      openingLabel: t('office.roomScan.plan.openingLabel', 'Opening'),
      objectLabel: (category) => {
        switch (category) {
          case 'toilet': return t('office.roomScan.object.toiletLabel', 'Toilet');
          case 'sink': return t('office.roomScan.object.sinkLabel', 'Sink');
          case 'bathtub': return t('office.roomScan.object.bathtubLabel', 'Tub');
          case 'stove': return t('office.roomScan.object.stoveLabel', 'Stove');
          case 'oven': return t('office.roomScan.object.ovenLabel', 'Oven');
          case 'refrigerator': return t('office.roomScan.object.refrigeratorLabel', 'Refrigerator');
          case 'dishwasher': return t('office.roomScan.object.dishwasherLabel', 'Dishwasher');
          case 'washerDryer': return t('office.roomScan.object.washerDryerLabel', 'Washer And Dryer');
          default: return '';
        }
      },
      wallName: (label) => {
        const n = label.replace(/\D+/g, '');
        return t('office.roomScan.plan.wallNameLabel', 'Wall {n}', { n });
      },
      dimensionA11y: (what, value) => t('office.roomScan.plan.dimensionA11y', '{what}, {value}. Tap to type a tape measurement.', { what, value }),
      seeQuantitiesLabel: t('office.roomScan.plan.seeQuantitiesLabel', 'See The Quantities'),
      saveLabel: t('office.roomScan.plan.saveLabel', 'Save Scan'),
      savedNote: t('office.roomScan.plan.savedNote', 'Saved with this project on this phone.'),
      saveFailedBody: t('office.roomScan.plan.saveFailedBody', 'The phone could not save the scan. Free some space and try again.'),
      fact: (f) => {
        const wallNames = (f.wallLabels ?? []).map((l) => t('office.roomScan.plan.wallNameLabel', 'Wall {n}', { n: l.replace(/\D+/g, '') }));
        const walls = and(wallNames);
        const gap = formatFeetInches(f.gapM ?? 0);
        switch (f.kind) {
          case 'walls_found': return t('office.roomScan.fact.wallsFoundBody', '{found} of {needed} walls found.', { found: f.found ?? 0, needed: f.needed ?? 0 });
          case 'outline_closed': return t('office.roomScan.fact.closedBody', 'The outline closed.');
          case 'outline_crosses': return t('office.roomScan.fact.crossesBody', 'The walls cross each other, so there is no floor area. Check {walls}.', { walls });
          case 'opening_no_wall': return tn('office.roomScan.fact.openingNoWallBody', f.count ?? 0, { one: '1 door, window or opening matched no wall, so it is not taken off the wall area. Check the wall area.', other: '{count} doors, windows or openings matched no wall, so they are not taken off the wall area. Check the wall area.' });
          case 'outline_open': return t('office.roomScan.fact.openBody', 'The outline did not close. Check {walls}. The gap is {gap}.', { walls, gap });
          case 'typed_open': return t('office.roomScan.fact.typedOpenBody', 'The typed lengths do not close the outline. Check {walls}. The gap is {gap}.', { walls, gap });
          case 'low_confidence': return t('office.roomScan.fact.lowBody', 'The scan was not sure of {walls}. Check with a tape.', { walls });
          case 'ceiling_missing': return t('office.roomScan.fact.ceilingMissingBody', 'The scan gave no ceiling height. Type it in to get the wall area.');
          case 'ceiling_varies': return t('office.roomScan.fact.ceilingVariesBody', 'The ceiling height varies. The ceiling area is shown as if it were flat.');
          case 'curved': return t('office.roomScan.fact.curvedBody', '{walls} is curved and is measured as a straight line.', { walls });
          case 'over_size': return t('office.roomScan.fact.overSizeBody', 'This room is over 30 feet on one side, more than one scan is made for. Check the long walls with a tape.');
          case 'off_outline': return t('office.roomScan.fact.offOutlineBody', '{walls} is not part of the room outline and is left out of the quantities.', { walls });
          case 'typed_by_hand': return tn('office.roomScan.fact.typedBody', f.count ?? 0, { one: '1 number was typed by hand.', other: '{count} numbers were typed by hand.' });
          case 'adjusted': return t('office.roomScan.fact.adjustedBody', '{walls} was moved by the same amount to keep the outline closed.', { walls });
        }
      },

      editTitleLabel: (kind) => {
        switch (kind) {
          case 'wall': return t('office.roomScan.edit.wallLabel', 'Wall Length');
          case 'ceiling': return t('office.roomScan.edit.ceilingLabel', 'Ceiling Height');
          case 'width': return t('office.roomScan.edit.widthLabel', 'Width');
          case 'height': return t('office.roomScan.edit.heightLabel', 'Height');
        }
      },
      editScanValueSub: (value) => t('office.roomScan.edit.scanValueSub', 'The plan shows {value}', { value }),
      editReadsAsSub: (value) => t('office.roomScan.edit.readsAsSub', 'Reads as {value}', { value }),
      editFarBody: (typed, scan) => t('office.roomScan.edit.farBody', 'That reads as {typed}, and the plan shows {scan}. For inches, type the number and in, like 98 in. If the tape does say {typed}, tap Use This Number again.', { typed, scan }),
      editInputLabel: t('office.roomScan.edit.inputLabel', 'Tape Measurement'),
      editHintBody: t('office.roomScan.edit.hintBody', 'Type feet and inches, like 8 ft 2 in or 8 2.'),
      editInvalidBody: t('office.roomScan.edit.invalidBody', 'That does not read as a length. Type feet and inches, like 8 ft 2 in.'),
      editRecordNote: t('office.roomScan.edit.recordNote', 'The scan keeps both numbers and marks this one as typed by hand.'),
      editSaveLabel: t('office.roomScan.edit.saveLabel', 'Use This Number'),
      cancelLabel: t('office.roomScan.cancelLabel', 'Cancel'),

      quantitiesTitleLabel: t('office.roomScan.q.titleLabel', 'Quantities'),
      quantitiesIntroBody: t('office.roomScan.q.introBody', 'Worked out from the scan. Check before you price.'),
      qFloorLabel: t('office.roomScan.q.floorLabel', 'Floor Area'),
      qFloorSub: t('office.roomScan.q.floorSub', 'Inside the room outline'),
      qFloorOpenSub: t('office.roomScan.q.floorOpenSub', 'The outline did not close, so there is no floor area'),
      qWallLabel: t('office.roomScan.q.wallLabel', 'Wall Area'),
      qWallSub: (gross, openings) => t('office.roomScan.q.wallSub', '{gross} less {openings} of doors, windows and openings', { gross, openings }),
      qWallUnknownSub: t('office.roomScan.q.wallUnknownSub', 'Type the ceiling height on the plan to get the wall area'),
      qCeilingLabel: t('office.roomScan.q.ceilingLabel', 'Ceiling Area'),
      qCeilingFlatSub: t('office.roomScan.q.ceilingFlatSub', 'Flat ceiling'),
      qCeilingVariesSub: t('office.roomScan.q.ceilingVariesSub', 'The height varies. Shown as if flat'),
      qBaseboardLabel: t('office.roomScan.q.baseboardLabel', 'Baseboard'),
      qBaseboardSub: t('office.roomScan.q.baseboardSub', 'Around the room, less doors and openings at the floor'),
      qCrownLabel: t('office.roomScan.q.crownLabel', 'Crown'),
      qCrownSub: t('office.roomScan.q.crownSub', 'Around the room, less openings that reach the ceiling'),
      qCasingLabel: t('office.roomScan.q.casingLabel', 'Door Casing'),
      qCasingSub: t('office.roomScan.q.casingSub', 'Two legs and a head for each door, one side'),
      qDoorsLabel: t('office.roomScan.q.doorsLabel', 'Doors'),
      qWindowsLabel: t('office.roomScan.q.windowsLabel', 'Windows'),
      qFixturesLabel: t('office.roomScan.q.fixturesLabel', 'Fixtures Seen'),
      qNoneSub: t('office.roomScan.q.noneSub', 'None seen'),
      qNominalSub: (size, nominalIn) => t('office.roomScan.q.nominalSub', '{size}. Nearest standard width is {nominal} in', { size, nominal: nominalIn }),
      qWasteNote: t('office.roomScan.q.wasteNote', 'No waste is added here. Waste is added once, when you price.'),
      priceItLabel: t('office.roomScan.q.priceItLabel', 'Price It'),
      pricingBlockBody: (b) => {
        switch (b) {
          case 'not_closed': return t('office.roomScan.block.notClosedBody', 'The outline did not close, so there is no floor to price. Fix the walls on the plan first.');
          case 'typed_lengths_do_not_close': return t('office.roomScan.block.typedOpenBody', 'The typed lengths do not close the outline, so there is no floor to price. Check the walls on the plan first.');
          case 'low_confidence_wall': return t('office.roomScan.block.lowBody', 'The scan was not sure of one or more walls. Type each of them from a tape on the plan before you price, even if the number is the same.');
          case 'ceiling_height_missing': return t('office.roomScan.block.ceilingBody', 'Type the ceiling height on the plan before you price.');
          case 'no_name': return t('office.roomScan.block.noNameBody', 'Name the room on the plan before you price. The name goes on every estimate line.');
        }
      },

      draftTitleLabel: t('office.roomScan.price.titleLabel', 'Estimate Draft'),
      draftIntroBody: (room) => t('office.roomScan.price.introBody', '{room}. You review every line before it goes into the estimate.', { room }),
      lineName: (key) => {
        switch (key) {
          case 'floor_tile': return t('office.roomScan.line.floorTileLabel', 'Floor Tile');
          case 'floor': return t('office.roomScan.line.floorLabel', 'Flooring');
          case 'wall_drywall': return t('office.roomScan.line.wallDrywallLabel', 'Drywall, Walls');
          case 'wall_paint': return t('office.roomScan.line.wallPaintLabel', 'Paint, Walls');
          case 'ceiling_paint': return t('office.roomScan.line.ceilingPaintLabel', 'Paint, Ceiling');
          case 'baseboard': return t('office.roomScan.line.baseboardLabel', 'Baseboard');
          case 'door': return t('office.roomScan.line.doorLabel', 'Interior Door, Hung');
          case 'window': return t('office.roomScan.line.windowLabel', 'Window');
          case 'toilet': return t('office.roomScan.line.toiletLabel', 'Set Toilet');
          case 'sink': return t('office.roomScan.line.sinkLabel', 'Set Sink');
          case 'bathtub': return t('office.roomScan.line.bathtubLabel', 'Set Bathtub');
        }
      },
      lineQtySub: (qty, unit, rate) => unit === 'EA'
        ? t('office.roomScan.price.lineEachSub', '{qty} at {rate}', { qty, rate })
        : t('office.roomScan.price.lineQtySub', '{qty} {unit} at {rate}', { qty, unit: unitWord(unit), rate }),
      lineNoPriceSub: (qty, unit) => unit === 'EA'
        ? qty
        : t('office.roomScan.price.lineNoPriceSub', '{qty} {unit}', { qty, unit: unitWord(unit) }),
      lineWasteSub: (pct) => t('office.roomScan.price.lineWasteSub', 'Includes {pct} percent waste', { pct }),
      sourceLabel: (source, claim) => {
        if (source === 'yours' && claim) {
          // Not the line's own trade: the label names which of his trades the price came from.
          const trade = claim.trade;
          if (claim.provenance === 'seeded' || claim.jobCount < 1) return claim.exactTrade
            ? t('office.roomScan.source.yoursSetLabel', 'Your Set Price, No Past Jobs Yet')
            : t('office.roomScan.source.yoursSetForLabel', 'Your Set Price For {trade}, No Past Jobs Yet', { trade });
          if (claim.provenance === 'mixed') return claim.exactTrade
            ? tn('office.roomScan.source.yoursMixedLabel', claim.jobCount, { one: 'Your Price, 1 Past Job, Started From Your Set Price', other: 'Your Price, {count} Past Jobs, Started From Your Set Price' })
            : tn('office.roomScan.source.yoursMixedForLabel', claim.jobCount, { one: 'Your Price For {trade}, 1 Past Job, Started From Your Set Price', other: 'Your Price For {trade}, {count} Past Jobs, Started From Your Set Price' }, { trade });
          if (claim.tone === 'contracted') return claim.exactTrade
            ? tn('office.roomScan.source.yoursSignedLabel', claim.jobCount, { one: 'Your Price, Signed On 1 Job, Not Yet Paid', other: 'Your Price, Signed On {count} Jobs, Not Yet Paid' })
            : tn('office.roomScan.source.yoursSignedForLabel', claim.jobCount, { one: 'Your Price For {trade}, Signed On 1 Job, Not Yet Paid', other: 'Your Price For {trade}, Signed On {count} Jobs, Not Yet Paid' }, { trade });
          return claim.exactTrade
            ? tn('office.roomScan.source.yoursMeasuredLabel', claim.jobCount, { one: 'Your Price, 1 Past Job', other: 'Your Price, {count} Past Jobs' })
            : tn('office.roomScan.source.yoursMeasuredForLabel', claim.jobCount, { one: 'Your Price For {trade}, 1 Past Job', other: 'Your Price For {trade}, {count} Past Jobs' }, { trade });
        }
        if (source === 'engine') return t('office.roomScan.source.catalogLabel', 'No Past Jobs Yet, Catalog Price');
        if (source === 'manual') return t('office.roomScan.source.manualLabel', 'You Typed This Price');
        return t('office.roomScan.source.noneLabel', 'No Price Yet');
      },
      noPriceBody: t('office.roomScan.price.noPriceBody', 'You have no price for this yet and the catalog has none. Type one, or leave the line out.'),
      catalogNote: t('office.roomScan.price.catalogNote', 'A catalog price is a list price for your area. It is not what the work has cost you.'),
      typePriceLabel: t('office.roomScan.price.typePriceLabel', 'Type A Price'),
      priceInputLabel: t('office.roomScan.price.priceInputLabel', 'Price For One Unit'),
      usePriceLabel: t('office.roomScan.price.usePriceLabel', 'Use This Price'),
      priceInvalidBody: t('office.roomScan.price.priceInvalidBody', 'Type a price above zero.'),
      leaveOutLabel: t('office.roomScan.price.leaveOutLabel', 'Leave Out'),
      putBackLabel: t('office.roomScan.price.putBackLabel', 'Put Back'),
      leftOutSub: t('office.roomScan.price.leftOutSub', 'Left out of this draft'),
      totalLabel: t('office.roomScan.price.totalLabel', 'Draft Total'),
      totalSub: (own, count) => tn('office.roomScan.price.totalSub', count, { one: '{own} of 1 line uses your own prices', other: '{own} of {count} lines use your own prices' }, { own }),
      markupNote: t('office.roomScan.price.markupNote', 'This is your cost. Your markup is added in the estimate.'),
      unpricedNote: (count) => tn('office.roomScan.price.unpricedNote', count, { one: '1 line has no price yet and is left out of the total.', other: '{count} lines have no price yet and are left out of the total.' }),
      openInEstimateLabel: t('office.roomScan.price.openLabel', 'Open In Estimate'),
      draftBlockBody: (b) => {
        switch (b) {
          case 'no_project': return t('office.roomScan.block.noProjectBody', 'Open a project to price this scan.');
          case 'nothing_priced': return t('office.roomScan.block.nothingPricedBody', 'No line has a price yet. Type a price on at least one line.');
          case 'no_access': return t('office.roomScan.block.noAccessBody', 'Only the project owner or an editor can add lines to this estimate. Ask the project owner.');
          case 'no_name': return t('office.roomScan.block.noNameBody', 'Name the room on the plan before you price. The name goes on every estimate line.');
          case 'no_markup': return t('office.roomScan.block.noMarkupBody', 'This project has no estimate yet, and you have not chosen a markup. Choose your markup in Estimate, then come back to this scan.');
        }
      },
      confirmTitleLabel: t('office.roomScan.confirm.titleLabel', 'Add To The Estimate'),
      confirmBody: (count, total) => tn('office.roomScan.confirm.body', count, {
        one: 'This puts 1 line into the estimate for this project, {total} before markup. The estimate as it stands now is kept in its history. Nothing is sent to your client.',
        other: 'This puts {count} lines into the estimate for this project, {total} before markup. The estimate as it stands now is kept in its history. Nothing is sent to your client.',
      }, { total }),
      confirmMaterialsInBody: t('office.roomScan.confirm.materialsInBody', 'Material lines from this room\'s order list are already in this estimate, and an installed price includes its material. With these lines the material is in the estimate twice until you take one of the two out.'),
      confirmYesLabel: t('office.roomScan.confirm.yesLabel', 'Add To Estimate'),
      confirmNoLabel: t('office.roomScan.confirm.noLabel', 'Not Yet'),
      startTitleLabel: t('office.roomScan.confirm.startTitleLabel', 'Start The Estimate'),
      startConfirmBody: (count, total, markup) => tn('office.roomScan.confirm.startBody', count, {
        one: 'This project has no estimate yet. This starts one with 1 line, {total} before markup, at your markup of {markup} percent. Nothing is sent to your client.',
        other: 'This project has no estimate yet. This starts one with {count} lines, {total} before markup, at your markup of {markup} percent. Nothing is sent to your client.',
      }, { total, markup }),
      startYesLabel: t('office.roomScan.confirm.startYesLabel', 'Start Estimate'),
      addedBody: t('office.roomScan.price.addedBody', 'Added to the estimate. Check each line there before you send it.'),
      unconfirmedBody: t('office.roomScan.price.unconfirmedBody', 'The estimate has not shown these lines yet. Open the estimate and check it before you price this scan again.'),
      addFailedBody: t('office.roomScan.price.addFailedBody', 'The estimate could not be saved. Nothing was changed.'),
      paywallFeatureLabel: t('office.roomScan.paywallFeatureLabel', 'Scan The Room'),
    };
  }, [t, tn]);
}

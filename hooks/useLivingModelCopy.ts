// hooks/useLivingModelCopy.ts — the ONLY place the Living Model strings live
// (The Living Model, Phase 1). Every string goes through
// t('office.livingModel.*', english, vars) / tn(...), so the i18n registry
// stays in one file (surface 'office.living-model', Spanish in
// i18n/catalog/es/office/livingModel.ts). components/livingModel/* and
// app/living-model.tsx import this and add no t() keys of their own.
//
// WORDING (docs/VOICE.md): a key ending in `Label` is a name or an action in
// Title Case. A key ending in `Body` is one or more whole sentences in sentence
// case. A key ending in `Sub` is a caption: capital first letter, no period.
// No em dashes, no "and" sign, no "e.g.", no arrows.
//
// WHAT THIS SURFACE MAY SAY ABOUT ITSELF. The model is a schematic made from
// typed and scanned sizes. It is not to scale for building, and the progress
// on it is only what was reported in MAGE ID. Two lines say so on every view
// (schematicBody and progressBody). The words "accurate", "exact", "verified",
// "real-time", "live", "as-built", "digital twin" and "BIM" do not appear, in
// English or in Spanish. A task that maps to no stage is shown as "Other
// Work"; a task with nothing reported says "No Progress Reported".
// scripts/validate-living-model.ts reads the English shard and the Spanish
// file and fails on any of these.
//
// Never call t() at module scope: the object is rebuilt when the language changes.
import { useMemo } from 'react';
import { useT } from '@/contexts/LanguageContext';
import type { LivingModelSeat } from '@/utils/livingModel/allowed';
import type { SuggestionReason } from '@/utils/livingModel/linkCore';
import type { OpeningRefusal, RectRoomRefusal } from '@/utils/livingModel/modelCore';
import type { RoomStage } from '@/utils/livingModel/stageCore';
import type { RoomKind } from '@/utils/livingModel/types';

export interface LivingModelCopy {
  // ── the entry row and the screen ──
  entryLabel: string;
  entryPreviewLabel: string;
  entrySub: string;
  titleLabel: string;
  backLabel: string;
  roomsTabLabel: string;
  tasksTabLabel: string;
  replayTabLabel: string;
  tabsA11yLabel: string;
  seatBody: (s: Exclude<LivingModelSeat, 'open'>) => string;
  retryLabel: string;
  loadingBody: string;
  unreadableTitleBody: string;
  unreadableBody: string;
  startNewLabel: string;
  startedNewBody: string;
  // ── the two lines every view carries, and the rest of the plain talk ──
  schematicBody: string;
  progressBody: string;
  ghostBody: string;
  savedLocalBody: string;
  otherDevicesBody: string;
  saveFailedBody: string;
  // ── saving to the account (lane LIVINGSYNC) ──
  syncCheckingBody: string;
  savedAccountBody: string;
  savedAtBody: (time: string) => string;
  changedByYouBody: (time: string) => string;
  changedByNameBody: (name: string, time: string) => string;
  changedByTeammateBody: (time: string) => string;
  syncWaitingBody: string;
  syncFailedBody: string;
  scanNotSentBody: string;
  keptOnPhoneBody: string;
  keptOnPhoneStoppedBody: string;
  keptOnPhoneMayBody: string;
  removeFromAccountLabel: string;
  removeConfirmBody: string;
  removeConfirmLabel: string;
  removedBody: string;
  removeFailedBody: string;
  retryingBody: string;
  viewOnlyBody: string;
  accountTooLargeBody: string;
  accountRemovedBody: string;
  teammateKeptBody: string;
  conflictEmptyTitleBody: string;
  conflictEmptyBody: string;
  scanAskRoomsBody: (names: string) => string;
  accountScanRoomsBody: (names: string) => string;
  accountNewerBody: string;
  scanAskTitleBody: string;
  scanAskBody: string;
  saveToAccountLabel: string;
  keepOnPhoneLabel: string;
  conflictTitleBody: string;
  conflictBody: string;
  conflictDeviceSub: (rooms: number) => string;
  conflictAccountSub: (rooms: number) => string;
  keepDeviceLabel: string;
  useAccountLabel: string;
  keptFromAccountBody: string;
  keptFromDeviceBody: string;
  keptFirstBody: string;
  useKeptLabel: string;
  removeKeptLabel: string;
  choiceFailedBody: string;
  scanCaveatBody: string;
  // ── the Room Editor ──
  addRoomLabel: string;
  addFromScanLabel: string;
  undoLabel: string;
  redoLabel: string;
  rotateLabel: string;
  duplicateLabel: string;
  deleteLabel: string;
  moveLeftLabel: string;
  moveRightLabel: string;
  moveUpLabel: string;
  moveDownLabel: string;
  emptyTitleLabel: string;
  emptyBody: string;
  planA11yLabel: string;
  dragHelpSub: string;
  roomNameLabel: string;
  roomNamePlaceholder: string;
  kindLabel: string;
  kindName: (k: RoomKind) => string;
  widthLabel: string;
  lengthLabel: string;
  ceilingLabel: string;
  sizePlaceholder: string;
  ceilingPlaceholder: string;
  floorLabel: string;
  levelName: (level: number) => string;
  cancelLabel: string;
  roomRefusalBody: (r: RectRoomRefusal | 'unreadable') => string;
  roomSizeSub: (width: string, length: string, sqFt: string | null) => string;
  copyName: (name: string) => string;
  roomsHeadingLabel: string;
  roomLimitBody: string;
  wallsHeadingLabel: string;
  wallName: (n: number) => string;
  wallHelpBody: string;
  addDoorLabel: string;
  addWindowLabel: string;
  doorTitleLabel: string;
  windowTitleLabel: string;
  openingWidthLabel: string;
  doorPlaceholder: string;
  windowPlaceholder: string;
  openingOnWallBody: (wall: string, length: string) => string;
  openingRefusalBody: (r: OpeningRefusal | 'unreadable') => string;
  doorSub: (width: string) => string;
  windowSub: (width: string) => string;
  removeOpeningA11yLabel: (what: string) => string;
  overlapBody: (a: string, b: string) => string;
  outlineOpenBody: (name: string) => string;
  scanSheetTitleLabel: string;
  noScansBody: string;
  noScansWebBody: string;
  scanRowSub: (date: string, walls: number) => string;
  scanUnnamedLabel: string;
  // ── rooms and tasks ──
  tasksIntroBody: string;
  noScheduleBody: string;
  noRoomsBody: string;
  suggestedLabel: string;
  confirmSuggestedLabel: string;
  suggestedBody: (n: number) => string;
  suggestionSub: (r: SuggestionReason) => string;
  tickedCountSub: (n: number, total: number) => string;
  goneBody: (n: number) => string;
  tickA11yLabel: (task: string, room: string) => string;
  stageName: (s: RoomStage) => string;
  stageHelpBody: string;
  stagePickA11yLabel: (task: string) => string;
  stagePickerLabel: string;
  stagePickedSub: (stage: string) => string;
  stageFromTitleLabel: string;
  // ── Job Replay ──
  weekLabel: (n: number, total: number) => string;
  weekShortLabel: (n: number) => string;
  todayLabel: string;
  playLabel: string;
  pauseLabel: string;
  previousWeekLabel: string;
  nextWeekLabel: string;
  plannedLabel: string;
  reportedLabel: string;
  modeA11yLabel: string;
  cutWallsLabel: string;
  fullWallsLabel: string;
  resetViewLabel: string;
  legendHeadingLabel: string;
  orbitHelpSub: string;
  touchHelpSub: string;
  contextLostBody: string;
  reloadViewLabel: string;
  canvasA11yBody: string;
  noStartBody: string;
  setStartLabel: string;
  nothingTickedBody: string;
  loading3dBody: string;
  noWebglBody: string;
  phoneNoteTitleBody: string;
  phoneNoteBody: string;
  planStageSub: (stage: string) => string;
  // ── the room card ──
  roomReportedLabel: string;
  roomPlannedLabel: string;
  planAheadLabel: string;
  asOfTodaySub: string;
  forWeekSub: (week: number, total: number) => string;
  undatedReportedSub: string;
  planOnlyBody: string;
  averageReportedBody: (n: number) => string;
  averagePlannedBody: (n: number) => string;
  plannedPctSub: (n: number) => string;
  nextHereLabel: string;
  nextBody: (task: string, week: number) => string;
  allDoneBody: string;
  noTasksRoomBody: string;
  tasksInRoomLabel: string;
  plannedDatesSub: (from: string, to: string) => string;
  plannedWeeksSub: (from: number, to: number) => string;
  reportedPctSub: (n: number) => string;
  noProgressLabel: string;
  unreportedBody: (n: number) => string;
  closeLabel: string;
  roomA11yLabel: (name: string, stage: string) => string;
}

export function useLivingModelCopy(): LivingModelCopy {
  const { t, tn } = useT();
  return useMemo<LivingModelCopy>(() => {
    const kinds: Record<RoomKind, string> = {
      kitchen: t('office.livingModel.kind.kitchenLabel', 'Kitchen'),
      bathroom: t('office.livingModel.kind.bathroomLabel', 'Bathroom'),
      bedroom: t('office.livingModel.kind.bedroomLabel', 'Bedroom'),
      living: t('office.livingModel.kind.livingLabel', 'Living Room'),
      dining: t('office.livingModel.kind.diningLabel', 'Dining Room'),
      hall: t('office.livingModel.kind.hallLabel', 'Hall'),
      closet: t('office.livingModel.kind.closetLabel', 'Closet'),
      laundry: t('office.livingModel.kind.laundryLabel', 'Laundry'),
      garage: t('office.livingModel.kind.garageLabel', 'Garage'),
      basement: t('office.livingModel.kind.basementLabel', 'Basement'),
      office: t('office.livingModel.kind.officeLabel', 'Office'),
      other: t('office.livingModel.kind.otherLabel', 'Other Room'),
    };
    const stages: Record<RoomStage, string> = {
      no_tasks: t('office.livingModel.stage.noTasksLabel', 'No Tasks Ticked'),
      not_started: t('office.livingModel.stage.notStartedLabel', 'Not Started'),
      demolition: t('office.livingModel.stage.demolitionLabel', 'Demolition'),
      framing: t('office.livingModel.stage.framingLabel', 'Framing'),
      rough_in: t('office.livingModel.stage.roughInLabel', 'Rough-In'),
      insulation: t('office.livingModel.stage.insulationLabel', 'Insulation'),
      drywall: t('office.livingModel.stage.drywallLabel', 'Drywall'),
      finishes: t('office.livingModel.stage.finishesLabel', 'Finishes'),
      other: t('office.livingModel.stage.otherLabel', 'Other Work'),
      done: t('office.livingModel.stage.doneLabel', 'Done'),
    };
    return {
      entryLabel: t('office.livingModel.entry.label', 'Living Model'),
      entryPreviewLabel: t('office.livingModel.entry.previewLabel', 'Living Model (Owner Preview)'),
      entrySub: t('office.livingModel.entry.sub', 'A schematic of the job, room by room, with the schedule on it'),
      titleLabel: t('office.livingModel.titleLabel', 'Living Model'),
      backLabel: t('office.livingModel.backLabel', 'Back'),
      roomsTabLabel: t('office.livingModel.tab.roomsLabel', 'Rooms'),
      tasksTabLabel: t('office.livingModel.tab.tasksLabel', 'Tasks'),
      replayTabLabel: t('office.livingModel.tab.replayLabel', 'Job Replay'),
      tabsA11yLabel: t('office.livingModel.tab.a11yLabel', 'Living Model Views'),
      seatBody: (s) => {
        switch (s) {
          case 'checking': return t('office.livingModel.seat.checkingBody', 'Checking your access to this project.');
          case 'unknown': return t('office.livingModel.seat.unknownBody', 'Your access to this project could not be checked. Check your signal and try again.');
          default: return t('office.livingModel.seat.refusedBody', 'The Living Model is built on this project’s schedule. Only the project owner or an editor can open it. Ask the project owner.');
        }
      },
      retryLabel: t('office.livingModel.seat.retryLabel', 'Try Again'),
      loadingBody: t('office.livingModel.loadingBody', 'Reading the model saved on this device.'),
      unreadableTitleBody: t('office.livingModel.load.unreadableTitleBody', 'The model saved on this device could not be read.'),
      unreadableBody: t('office.livingModel.load.unreadableBody', 'It has not been changed or removed, and a copy of it is kept on this device. You can start a new model for this job. Nothing is saved over the old one until you do.'),
      startNewLabel: t('office.livingModel.load.startNewLabel', 'Start a New Model'),
      startedNewBody: t('office.livingModel.load.startedNewBody', 'You started a new model. A copy of the one that could not be read is still kept on this device.'),
      schematicBody: t('office.livingModel.honesty.schematicBody', 'Schematic made from typed and scanned sizes. Not to scale for building.'),
      progressBody: t('office.livingModel.honesty.progressBody', 'Progress shown is what was reported in MAGE ID.'),
      ghostBody: t('office.livingModel.honesty.ghostBody', 'Past today, the faint shapes are the plan.'),
      savedLocalBody: t('office.livingModel.honesty.savedLocalBody', 'Saved on this device only for now.'),
      otherDevicesBody: t('office.livingModel.honesty.otherDevicesBody', 'It will not appear on your other devices.'),
      saveFailedBody: t('office.livingModel.honesty.saveFailedBody', 'This change could not be saved on this device.'),
      syncCheckingBody: t('office.livingModel.sync.checkingBody', 'Saved on this device. Checking your account.'),
      savedAccountBody: t('office.livingModel.sync.savedBody', 'Saved to your account.'),
      savedAtBody: (time) => t('office.livingModel.sync.savedAtBody', 'Last saved at {time}.', { time }),
      changedByYouBody: (time) => t('office.livingModel.sync.changedByYouBody', 'Last changed by you at {time}.', { time }),
      changedByNameBody: (name, time) => t('office.livingModel.sync.changedByNameBody', 'Last changed by {name} at {time}.', { name, time }),
      changedByTeammateBody: (time) => t('office.livingModel.sync.changedByTeammateBody', 'Last changed by a teammate at {time}.', { time }),
      syncWaitingBody: t('office.livingModel.sync.waitingBody', 'Waiting to send. It is saved on this device.'),
      syncFailedBody: t('office.livingModel.sync.failedBody', 'Could not save to your account. It is saved on this device.'),
      scanNotSentBody: t('office.livingModel.sync.scanNotSentBody', 'Not sent to your account yet. It is saved on this device.'),
      keptOnPhoneBody: t('office.livingModel.sync.keptOnPhoneBody', 'Kept on this phone only, as you chose. It will not appear on your other devices.'),
      keptOnPhoneStoppedBody: t('office.livingModel.sync.keptOnPhoneStoppedBody', 'Nothing more will be sent from this phone, as you chose.'),
      keptOnPhoneMayBody: t('office.livingModel.sync.keptOnPhoneMayBody', 'A copy may already be in your account.'),
      removeFromAccountLabel: t('office.livingModel.sync.removeFromAccountLabel', 'Remove It From My Account'),
      removeConfirmBody: t('office.livingModel.sync.removeConfirmBody', 'This removes the model from your account for everyone on this project. The model on this phone stays. Your other devices and your team keep the copies they already have, and they will no longer find one in the account.'),
      removeConfirmLabel: t('office.livingModel.sync.removeConfirmLabel', 'Yes, Remove It'),
      removedBody: t('office.livingModel.sync.removedBody', 'Removed from your account. The model on this phone has not been changed.'),
      removeFailedBody: t('office.livingModel.sync.removeFailedBody', 'Could not remove it from your account. Nothing was changed. Try again when this phone is online.'),
      retryingBody: t('office.livingModel.sync.retryingBody', 'Saved on this device. Your account could not be checked yet. MAGE ID will try again shortly.'),
      viewOnlyBody: t('office.livingModel.sync.viewOnlyBody', 'You can view this model. Only the owner and editors can change it.'),
      accountTooLargeBody: t('office.livingModel.sync.accountTooLargeBody', 'The model in your account is larger than MAGE ID allows, so it was not opened here. The model on this device has not been changed.'),
      accountRemovedBody: t('office.livingModel.sync.accountRemovedBody', 'The copy of this model in your account was removed. It is saved on this device only.'),
      teammateKeptBody: t('office.livingModel.sync.teammateKeptBody', 'Your teammate changed this model. Your previous copy is kept.'),
      conflictEmptyTitleBody: t('office.livingModel.sync.conflictEmptyTitleBody', 'Your account has a model for this job.'),
      conflictEmptyBody: t('office.livingModel.sync.conflictEmptyBody', 'The model on this device is empty. Nothing has been replaced. Choose which model to keep.'),
      scanAskRoomsBody: (names) => t('office.livingModel.sync.scanAskRoomsBody', 'Scanned rooms that would be sent: {names}.', { names }),
      accountScanRoomsBody: (names) => t('office.livingModel.sync.accountScanRoomsBody', 'Rooms in your account that came from a scan: {names}.', { names }),
      accountNewerBody: t('office.livingModel.sync.accountNewerBody', 'The model in your account was saved by a newer version of MAGE ID. Update the app to open it. The model on this device has not been changed.'),
      scanAskTitleBody: t('office.livingModel.sync.scanAskTitleBody', 'This model includes a room you scanned.'),
      scanAskBody: t('office.livingModel.sync.scanAskBody', 'Saving it to your account sends the room’s name and its sizes: floor outline, ceiling height, walls, doors, windows and fixtures, and that the room came from a scan. They go to MAGE ID’s servers so your other devices and your team on this project can see them. No photo or video is sent. You are asked again for each scanned room you add later.'),
      saveToAccountLabel: t('office.livingModel.sync.saveToAccountLabel', 'Save to My Account'),
      keepOnPhoneLabel: t('office.livingModel.sync.keepOnPhoneLabel', 'Keep on This Phone'),
      conflictTitleBody: t('office.livingModel.sync.conflictTitleBody', 'This device has changes that are not in your account.'),
      conflictBody: t('office.livingModel.sync.conflictBody', 'The model in your account has changed too. Nothing has been replaced. Choose which model to keep. The other one stays on this device until you remove it.'),
      conflictDeviceSub: (rooms) => tn('office.livingModel.sync.conflictDeviceSub', rooms, { one: 'This device has 1 room', other: 'This device has {count} rooms' }),
      conflictAccountSub: (rooms) => tn('office.livingModel.sync.conflictAccountSub', rooms, { one: 'Your account has 1 room', other: 'Your account has {count} rooms' }),
      keepDeviceLabel: t('office.livingModel.sync.keepDeviceLabel', 'Keep This Device’s Model'),
      useAccountLabel: t('office.livingModel.sync.useAccountLabel', 'Use the One in Your Account'),
      keptFromAccountBody: t('office.livingModel.sync.keptFromAccountBody', 'The model from your account that you did not keep is still on this device.'),
      keptFromDeviceBody: t('office.livingModel.sync.keptFromDeviceBody', 'The model you did not keep is still on this device.'),
      keptFirstBody: t('office.livingModel.sync.keptFirstBody', 'Decide what to do with it before you choose again.'),
      useKeptLabel: t('office.livingModel.sync.useKeptLabel', 'Use the Kept Model Instead'),
      removeKeptLabel: t('office.livingModel.sync.removeKeptLabel', 'Remove the Kept Model'),
      choiceFailedBody: t('office.livingModel.sync.choiceFailedBody', 'That could not be done because this device could not keep a copy of the other model. Nothing was replaced.'),
      scanCaveatBody: t('office.livingModel.honesty.scanCaveatBody', 'This room came from a phone scan. A phone scan can be off by an inch or more.'),
      addRoomLabel: t('office.livingModel.editor.addRoomLabel', 'Add Room'),
      addFromScanLabel: t('office.livingModel.editor.addFromScanLabel', 'Add from Scan'),
      undoLabel: t('office.livingModel.editor.undoLabel', 'Undo'),
      redoLabel: t('office.livingModel.editor.redoLabel', 'Redo'),
      rotateLabel: t('office.livingModel.editor.rotateLabel', 'Rotate'),
      duplicateLabel: t('office.livingModel.editor.duplicateLabel', 'Duplicate'),
      deleteLabel: t('office.livingModel.editor.deleteLabel', 'Delete'),
      moveLeftLabel: t('office.livingModel.editor.moveLeftLabel', 'Move Left'),
      moveRightLabel: t('office.livingModel.editor.moveRightLabel', 'Move Right'),
      moveUpLabel: t('office.livingModel.editor.moveUpLabel', 'Move Up'),
      moveDownLabel: t('office.livingModel.editor.moveDownLabel', 'Move Down'),
      emptyTitleLabel: t('office.livingModel.editor.emptyTitleLabel', 'No Rooms Yet'),
      emptyBody: t('office.livingModel.editor.emptyBody', 'Add a room by typing its size, or drop in a scan saved for this job.'),
      planA11yLabel: t('office.livingModel.editor.planA11yLabel', 'Floor Plan of the Model'),
      dragHelpSub: t('office.livingModel.editor.dragHelpSub', 'Drag a room to move it. It snaps every 6 inches'),
      roomNameLabel: t('office.livingModel.form.nameLabel', 'Room Name'),
      roomNamePlaceholder: t('office.livingModel.form.namePlaceholder', 'Kitchen'),
      kindLabel: t('office.livingModel.form.kindLabel', 'Room Kind'),
      kindName: (k) => kinds[k],
      widthLabel: t('office.livingModel.form.widthLabel', 'Width'),
      lengthLabel: t('office.livingModel.form.lengthLabel', 'Length'),
      ceilingLabel: t('office.livingModel.form.ceilingLabel', 'Ceiling Height'),
      sizePlaceholder: t('office.livingModel.form.sizePlaceholder', '12 ft 6 in'),
      ceilingPlaceholder: t('office.livingModel.form.ceilingPlaceholder', '8 ft'),
      floorLabel: t('office.livingModel.form.floorLabel', 'Floor'),
      levelName: (level) => (level >= 0
        ? t('office.livingModel.level.upLabel', 'Floor {n}', { n: level + 1 })
        : t('office.livingModel.level.downLabel', 'Lower Floor {n}', { n: -level })),
      cancelLabel: t('office.livingModel.form.cancelLabel', 'Cancel'),
      roomRefusalBody: (r) => {
        switch (r) {
          case 'name_missing': return t('office.livingModel.form.nameNeededBody', 'Type a name for the room.');
          case 'bad_width': return t('office.livingModel.form.widthBadBody', 'Type a width between 2 ft and 200 ft, like 12 ft 6 in.');
          case 'bad_length': return t('office.livingModel.form.lengthBadBody', 'Type a length between 2 ft and 200 ft, like 12 ft 6 in.');
          case 'bad_height': return t('office.livingModel.form.heightBadBody', 'Type a ceiling height between 4 ft and 40 ft, like 8 ft.');
          default: return t('office.livingModel.form.unreadableBody', 'Type each size the way you read a tape, like 12 ft 6 in.');
        }
      },
      roomSizeSub: (width, length, sqFt) => (sqFt
        ? t('office.livingModel.room.sizeSub', '{width} by {length}, about {sqFt}', { width, length, sqFt })
        : t('office.livingModel.room.sizeNoAreaSub', '{width} by {length}', { width, length })),
      copyName: (name) => t('office.livingModel.editor.copyName', '{name} Copy', { name }),
      roomsHeadingLabel: t('office.livingModel.editor.roomsHeadingLabel', 'Rooms'),
      roomLimitBody: t('office.livingModel.editor.roomLimitBody', 'A model holds up to 60 rooms.'),
      wallsHeadingLabel: t('office.livingModel.editor.wallsHeadingLabel', 'Walls'),
      wallName: (n) => t('office.livingModel.editor.wallName', 'Wall {n}', { n }),
      wallHelpBody: t('office.livingModel.editor.wallHelpBody', 'Tap a wall on the plan, or pick one here, to add a door or a window.'),
      addDoorLabel: t('office.livingModel.editor.addDoorLabel', 'Add Door'),
      addWindowLabel: t('office.livingModel.editor.addWindowLabel', 'Add Window'),
      doorTitleLabel: t('office.livingModel.opening.doorTitleLabel', 'Add a Door'),
      windowTitleLabel: t('office.livingModel.opening.windowTitleLabel', 'Add a Window'),
      openingWidthLabel: t('office.livingModel.opening.widthLabel', 'Width'),
      doorPlaceholder: t('office.livingModel.opening.doorPlaceholder', '2 ft 8 in'),
      windowPlaceholder: t('office.livingModel.opening.windowPlaceholder', '3 ft'),
      openingOnWallBody: (wall, length) => t('office.livingModel.opening.onWallBody', 'On {wall}, which is {length} long.', { wall, length }),
      openingRefusalBody: (r) => {
        switch (r) {
          case 'too_narrow': return t('office.livingModel.opening.tooNarrowBody', 'Type a width of 1 ft or more.');
          case 'wider_than_wall': return t('office.livingModel.opening.widerBody', 'That is wider than the wall. Type a smaller width.');
          case 'no_room_left': return t('office.livingModel.opening.noRoomBody', 'There is no room left on this wall for that width.');
          case 'no_wall': return t('office.livingModel.opening.noWallBody', 'That wall is no longer in the model.');
          default: return t('office.livingModel.opening.unreadableBody', 'Type a width the way you read a tape, like 2 ft 8 in.');
        }
      },
      doorSub: (width) => t('office.livingModel.opening.doorSub', 'Door, {width}', { width }),
      windowSub: (width) => t('office.livingModel.opening.windowSub', 'Window, {width}', { width }),
      removeOpeningA11yLabel: (what) => t('office.livingModel.opening.removeA11yLabel', 'Remove {what}', { what }),
      overlapBody: (a, b) => t('office.livingModel.check.overlapBody', '{a} and {b} overlap. Rooms may touch, but one should not sit on another.', { a, b }),
      outlineOpenBody: (name) => t('office.livingModel.check.outlineOpenBody', 'The outline of {name} does not close, so its floor is not drawn.', { name }),
      scanSheetTitleLabel: t('office.livingModel.scan.titleLabel', 'Add from Scan'),
      noScansBody: t('office.livingModel.scan.noneBody', 'No scans are saved for this job on this device. Scans are made in the phone app and stay on the phone that made them.'),
      noScansWebBody: t('office.livingModel.scan.noneWebBody', 'Scans stay on the phone that made them. Add the room on that phone, save the model to your account, and it will appear here.'),
      scanRowSub: (date, walls) => tn('office.livingModel.scan.rowSub', walls, { one: '{date}, 1 wall', other: '{date}, {count} walls' }, { date }),
      scanUnnamedLabel: t('office.livingModel.scan.unnamedLabel', 'Unnamed Scan'),
      tasksIntroBody: t('office.livingModel.tasks.introBody', 'Tick the tasks that happen in each room. The replay colors a room only from the tasks you tick.'),
      noScheduleBody: t('office.livingModel.tasks.noScheduleBody', 'This job has no schedule yet. Build one, then tick its tasks here.'),
      noRoomsBody: t('office.livingModel.tasks.noRoomsBody', 'Add a room first, then tick its tasks here.'),
      suggestedLabel: t('office.livingModel.tasks.suggestedLabel', 'Suggested'),
      confirmSuggestedLabel: t('office.livingModel.tasks.confirmSuggestedLabel', 'Confirm Suggested'),
      suggestedBody: (n) => tn('office.livingModel.tasks.suggestedBody', n, {
        one: '1 task looks like it belongs in this room. Nothing is ticked until you confirm it.',
        other: '{count} tasks look like they belong in this room. Nothing is ticked until you confirm them.',
      }),
      suggestionSub: (r) => {
        switch (r) {
          case 'room_name': return t('office.livingModel.tasks.reasonNameSub', 'Suggested because its name has this room in it');
          case 'room_kind': return t('office.livingModel.tasks.reasonKindSub', 'Suggested because its name fits this kind of room');
          default: return t('office.livingModel.tasks.reasonTradeSub', 'Suggested because its trade usually works in this kind of room');
        }
      },
      tickedCountSub: (n, total) => t('office.livingModel.tasks.tickedCountSub', '{n} of {total} tasks ticked', { n, total }),
      goneBody: (n) => tn('office.livingModel.tasks.goneBody', n, {
        one: '1 ticked task is no longer in the schedule and is left out.',
        other: '{count} ticked tasks are no longer in the schedule and are left out.',
      }),
      tickA11yLabel: (task, room) => t('office.livingModel.tasks.tickA11yLabel', '{task}, in {room}', { task, room }),
      stageName: (s) => stages[s],
      stageHelpBody: t('office.livingModel.tasks.stageHelpBody', 'Each task takes its stage from its name. If a name reads wrong, tap the stage beside it and pick the right one.'),
      stagePickA11yLabel: (task) => t('office.livingModel.tasks.stagePickA11yLabel', 'Change Stage of {task}', { task }),
      stagePickerLabel: t('office.livingModel.tasks.stagePickerLabel', 'Stage of This Task'),
      stagePickedSub: (stage) => t('office.livingModel.tasks.stagePickedSub', '{stage}, picked by you', { stage }),
      stageFromTitleLabel: t('office.livingModel.tasks.stageFromTitleLabel', 'Read from the Title'),
      weekLabel: (n, total) => t('office.livingModel.replay.weekLabel', 'Week {n} of {total}', { n, total }),
      weekShortLabel: (n) => t('office.livingModel.replay.weekShortLabel', 'Week {n}', { n }),
      todayLabel: t('office.livingModel.replay.todayLabel', 'Today'),
      playLabel: t('office.livingModel.replay.playLabel', 'Play'),
      pauseLabel: t('office.livingModel.replay.pauseLabel', 'Pause'),
      previousWeekLabel: t('office.livingModel.replay.previousWeekLabel', 'Previous Week'),
      nextWeekLabel: t('office.livingModel.replay.nextWeekLabel', 'Next Week'),
      plannedLabel: t('office.livingModel.replay.plannedLabel', 'Planned'),
      reportedLabel: t('office.livingModel.replay.reportedLabel', 'Reported'),
      modeA11yLabel: t('office.livingModel.replay.modeA11yLabel', 'Planned or Reported'),
      cutWallsLabel: t('office.livingModel.replay.cutWallsLabel', 'Cut Away Walls'),
      fullWallsLabel: t('office.livingModel.replay.fullWallsLabel', 'Full Height Walls'),
      resetViewLabel: t('office.livingModel.replay.resetViewLabel', 'Reset View'),
      legendHeadingLabel: t('office.livingModel.replay.legendHeadingLabel', 'Stages'),
      orbitHelpSub: t('office.livingModel.replay.orbitHelpSub', 'Drag to turn. Hold Shift and drag to move. To zoom with the wheel, click the model first or hold Ctrl or Cmd'),
      touchHelpSub: t('office.livingModel.replay.touchHelpSub', 'One finger scrolls the page. Two fingers move, turn and zoom the model'),
      contextLostBody: t('office.livingModel.replay.contextLostBody', 'The 3D view stopped because the browser took back its graphics memory. Reload the view to draw it again.'),
      reloadViewLabel: t('office.livingModel.replay.reloadViewLabel', 'Reload View'),
      canvasA11yBody: t('office.livingModel.replay.canvasA11yBody', 'Schematic 3D model of the job. Arrow keys turn it, plus and minus zoom. The room list below reads each room.'),
      noStartBody: t('office.livingModel.replay.noStartBody', 'Daily reports cannot be placed without a start date. Reported shows only the schedule’s own progress.'),
      setStartLabel: t('office.livingModel.replay.setStartLabel', 'Set a Start Date'),
      nothingTickedBody: t('office.livingModel.replay.nothingTickedBody', 'No tasks are ticked for any room yet. Open Tasks and tick them, and the replay will have something to play.'),
      loading3dBody: t('office.livingModel.replay.loading3dBody', 'Loading the 3D view.'),
      noWebglBody: t('office.livingModel.replay.noWebglBody', 'This browser could not start the 3D view. The same replay is drawn flat below.'),
      phoneNoteTitleBody: t('office.livingModel.replay.phoneNoteTitleBody', 'The 3D view is on the web for now.'),
      phoneNoteBody: t('office.livingModel.replay.phoneNoteBody', 'Open this job in the web app to turn the model and play it in 3D. Here is the same replay, drawn flat.'),
      planStageSub: (stage) => t('office.livingModel.replay.planStageSub', 'Plan: {stage}', { stage }),
      roomReportedLabel: t('office.livingModel.card.reportedLabel', 'Reported in This Room'),
      roomPlannedLabel: t('office.livingModel.card.plannedLabel', 'Planned in This Room'),
      planAheadLabel: t('office.livingModel.card.planAheadLabel', 'Planned by This Week'),
      asOfTodaySub: t('office.livingModel.card.asOfTodaySub', 'As of today'),
      forWeekSub: (week, total) => t('office.livingModel.card.forWeekSub', 'For week {n} of {total}', { n: week, total }),
      undatedReportedSub: t('office.livingModel.card.undatedReportedSub', 'From the schedule’s own progress, which carries no date'),
      planOnlyBody: t('office.livingModel.card.planOnlyBody', 'This week is past today, so the card shows the plan only.'),
      averageReportedBody: (n) => tn('office.livingModel.card.averageReportedBody', n, {
        one: 'This is the 1 ticked task. A task with nothing reported counts as 0.',
        other: 'Average of the {count} ticked tasks. A task with nothing reported counts as 0.',
      }),
      averagePlannedBody: (n) => tn('office.livingModel.card.averagePlannedBody', n, {
        one: 'This is the 1 ticked task, by its planned dates.',
        other: 'Average of the {count} ticked tasks, each by its planned dates.',
      }),
      plannedPctSub: (n) => t('office.livingModel.card.plannedPctSub', 'Planned {n} percent', { n }),
      nextHereLabel: t('office.livingModel.card.nextHereLabel', 'Next Here'),
      nextBody: (task, week) => t('office.livingModel.card.nextBody', '{task}, planned for week {week}.', { task, week }),
      allDoneBody: t('office.livingModel.card.allDoneBody', 'Every ticked task is reported finished.'),
      noTasksRoomBody: t('office.livingModel.card.noTasksBody', 'No tasks are ticked for this room. Open Tasks to tick them.'),
      tasksInRoomLabel: t('office.livingModel.card.tasksLabel', 'Tasks in This Room'),
      plannedDatesSub: (from, to) => t('office.livingModel.card.plannedDatesSub', 'Planned {from} to {to}', { from, to }),
      plannedWeeksSub: (from, to) => t('office.livingModel.card.plannedWeeksSub', 'Planned week {from} to week {to}', { from, to }),
      reportedPctSub: (n) => t('office.livingModel.card.reportedPctSub', 'Reported {n} percent', { n }),
      noProgressLabel: t('office.livingModel.card.noProgressLabel', 'No Progress Reported'),
      unreportedBody: (n) => tn('office.livingModel.card.unreportedBody', n, {
        one: '1 ticked task has no progress reported.',
        other: '{count} ticked tasks have no progress reported.',
      }),
      closeLabel: t('office.livingModel.card.closeLabel', 'Close'),
      roomA11yLabel: (name, stage) => t('office.livingModel.card.roomA11yLabel', '{name}, {stage}', { name, stage }),
    };
  }, [t, tn]);
}

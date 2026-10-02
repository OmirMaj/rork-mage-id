// utils/tutorial/learn/laneC.ts — tutorial fragment for lane C.
// OWNER: LEARNDEFS-C (schedule-say-it, time-clock-in, punch-list-close).
//
// THE FRAGMENT SEAM (see the header of utils/tutorial/types.ts). Four content
// lanes add tutorials in parallel without touching the shared engine files:
// each one fills ONLY its own fragment, its own def files and its own screens.
//   types.ts     StaticTargetId / AssistId union in LaneCTargetId / LaneCAssistId,
//                and SignalPayloadMap extends LaneCSignalPayloadMap;
//   registry.ts  TARGETS / SIGNALS / ASSISTS spread LANE_C_* after the core;
//   defs/index   TUTORIAL_DEF_LIST appends ...LANE_C_DEFS;
//   validator    FULL_PAYLOADS spreads LANE_C_FULL_PAYLOADS (every signal
//                needs one) and fails an id declared twice across fragments.
// Keep the export names exactly as they are (the engine imports them).
//
// Pure data. Only `import type` from '../registry' and '../types': registry.ts
// imports THIS file at runtime, so a runtime import back would be a cycle
// (scripts/validate-tutorial-defs.ts refuses one). Def files a lane imports
// here may import '../types' as types only, plus fixtures / stats.
//
// THE SCREENS (each wraps its targets ONLY while a run is live on that very
// project, so a real job — and every phone golden — renders byte-identical):
//   app/(tabs)/schedule/index.tsx + components/schedule/mobile/
//     MobileScheduleScreen.tsx  root layer: the "Tell me what to change" bar,
//     the phone's back-to-the-job link, the blocker sentinel (both files wrap
//     the same ids: the phone renders the mobile screen, a wider window the
//     classic one).
//   components/copilot/ScheduleEditPanel.tsx  mounts <TutorialLayer
//     host="scheduleEdit"/> inside its sheet (and the docked pane) during a
//     run, and fires 'schedule.edit.applied' only after the host's commit
//     reports success.
//   components/copilot/CopilotShell.tsx  the FIXTURE SEAM (defs/scheduleSayIt
//     scheduleSampleTurn): on the sample during the run the sample sentence is
//     answered from SCHEDULE_SAMPLE with no relay call; other words are refused.
//   components/copilot/ScheduleDiffView.tsx  the ripple and Apply.
//   app/time-tracking.tsx, app/punch-list.tsx  root layer (tiny edits: these
//     are slide-fix files — wraps, signals after the existing success points,
//     one blocker sentinel, the practice pass OR'd into the gate).

import type { AssistSpec, SignalSpec, TargetSpec } from '../registry';
import type { PayloadRecord, TutorialDef } from '../types';
import { scheduleSayIt } from '../defs/scheduleSayIt';
import { timeClockIn } from '../defs/timeClockIn';
import { punchListClose } from '../defs/punchListClose';

/** Static target ids this lane's screens wrap in <TutorialTarget id=…>. */
export type LaneCTargetId =
  // the schedule tab (root layer)
  | 'schedule.sayIt'
  | 'schedule.backToJob'
  | 'schedule.modalUp'
  // the schedule editor (layer scheduleEdit)
  | 'scheduleEdit.input'
  | 'scheduleEdit.diff'
  | 'scheduleEdit.apply'
  | 'scheduleEdit.modalUp'
  // app/time-tracking.tsx
  | 'time.clockIn'
  | 'time.noCrew'
  | 'time.running'
  | 'time.clockOut'
  | 'time.modalUp'
  // app/punch-list.tsx
  | 'punchList.addBar'
  | 'punchList.row'
  | 'punchList.markDone'
  | 'punchList.modalUp';

/** Assist ids this lane's screens register with useTutorialAssist. */
export type LaneCAssistId = 'schedule.useSampleSentence' | 'punchList.useSampleLine';

/** Signal payloads (WITHOUT projectId) this lane's screens emit. */
export interface LaneCSignalPayloadMap {
  /** The editor's review is on screen with the BUNDLED answer (no relay call):
   *  `ops` is how many edit ops it holds. Only ever source 'sample'. */
  'schedule.edit.previewed': { ops: number; source: 'sample' };
  /** ScheduleEditPanel, after the host's commit() returned success (never on a
   *  refused CommitOutcome). moved = tasks whose own start changed; deltaDays
   *  when they all moved one amount; finishShiftDays = CPM finish after − before. */
  'schedule.edit.applied': { moved: number; deltaDays?: number; finishShiftDays?: number };
  /** After the clock-in write(s) returned an entry: how many were clocked in. */
  'time.clockedIn': { count: number };
  /** After the clock-out write landed (synced, queued or kept on this phone).
   *  `hours` is the net time recorded. */
  'time.clockedOut': { hours?: number; offline?: boolean };
  /** handleSave after addPunchItem (a NEW item). */
  'punchList.saved': { itemId: string; offline?: boolean };
  /** handleSave after updatePunchItem on an existing item that now names a sub. */
  'punchList.assigned': { itemId: string; sub?: string };
  /** handleStatusChange after updatePunchItem moved an item to closed. */
  'punchList.closed': { itemId: string };
}

const SCHED_TAB = 'app/(tabs)/schedule/index.tsx';
const SCHED_PHONE = 'components/schedule/mobile/MobileScheduleScreen.tsx';
const SHELL = 'components/copilot/CopilotShell.tsx';
const DIFF = 'components/copilot/ScheduleDiffView.tsx';
const PANEL = 'components/copilot/ScheduleEditPanel.tsx';
const TT = 'app/time-tracking.tsx';
const PL = 'app/punch-list.tsx';

export const LANE_C_TARGETS: Record<LaneCTargetId, TargetSpec> = {
  'schedule.sayIt': { file: SCHED_PHONE, layer: 'root', note: "the 'Tell me what to change' bar (mobile-schedule-copilot-bar; schedule-copilot-bar on the classic screen)" },
  'schedule.backToJob': { file: SCHED_PHONE, layer: 'root', note: 'schedule-back-to-job — the from=job link to the sample hub (phone only: HiddenTabBackLink draws none on a desktop)' },
  'schedule.modalUp': { file: SCHED_TAB, layer: 'root', blocker: true, note: 'any of the tab\'s layer-less modals (task detail, add task, pickers, calendar, scenarios); NEVER the editor sheet, which has its own layer' },

  'scheduleEdit.input': { file: SHELL, layer: 'scheduleEdit', note: 'copilot-compose plus Continue (copilot-send), scheduleEdit capability only' },
  'scheduleEdit.diff': { file: DIFF, layer: 'scheduleEdit', note: "the ripple: 'Understood 1 change' (schedule-edit-understood) and the moved lines" },
  'scheduleEdit.apply': { file: DIFF, layer: 'scheduleEdit', note: 'schedule-edit-apply' },
  'scheduleEdit.modalUp': { file: SHELL, layer: 'scheduleEdit', blocker: true, note: 'the voice capture or date picker modal over the editor sheet' },

  'time.clockIn': { file: TT, layer: 'root', note: "time-tracking-clock-in ('Clock in crew'), with crew on his list" },
  'time.noCrew': { file: TT, layer: 'root', note: 'the same button when his crew list is empty — the card says to add crew first' },
  'time.running': { file: TT, layer: 'root', note: "the sample's live time card (running clock)" },
  'time.clockOut': { file: TT, layer: 'root', note: "that card's Clock out (opens clock-out-sheet; the slide is never wrapped)" },
  'time.modalUp': { file: TT, layer: 'root', blocker: true, note: 'any of: crew sheet, clock-out sheet, out-time sheet, rates, correction, alert picker, batch out, export, job picker' },

  'punchList.addBar': { file: PL, layer: 'root', note: "add-punch-item ('Add') in punch-add-bar" },
  'punchList.row': { file: PL, layer: 'root', note: "punch-item-<id> — the run's own item (opens the edit form)" },
  'punchList.markDone': { file: PL, layer: 'root', note: "that item's status badge (each tap advances one step to Closed)" },
  'punchList.modalUp': { file: PL, layer: 'root', blocker: true, note: 'any of: item form, walk, task picker, reject, photo viewer, templates, filters, bulk pickers, close sheet' },
};

export const LANE_C_SIGNALS: { [N in keyof LaneCSignalPayloadMap]: SignalSpec<N> } = {
  'schedule.edit.previewed': { file: SHELL, payloadKeys: ['ops', 'source'], outbound: false },
  'schedule.edit.applied': { file: PANEL, payloadKeys: ['moved', 'deltaDays', 'finishShiftDays'], outbound: false },
  'time.clockedIn': { file: TT, payloadKeys: ['count'], outbound: false },
  'time.clockedOut': { file: TT, payloadKeys: ['hours', 'offline'], outbound: false },
  'punchList.saved': { file: PL, payloadKeys: ['itemId', 'offline'], outbound: false },
  // A sub is never told on an assign (no notify trigger fires on it); the
  // sub's portal is per project and the sample has none it did not make.
  'punchList.assigned': { file: PL, payloadKeys: ['itemId', 'sub'], outbound: false },
  'punchList.closed': { file: PL, payloadKeys: ['itemId'], outbound: false },
};

export const LANE_C_ASSISTS: Record<LaneCAssistId, AssistSpec> = {
  'schedule.useSampleSentence': { file: SHELL, what: 'fills SCHEDULE_SAMPLE.sentence into the compose box (sample run only) — never presses Continue' },
  'punchList.useSampleLine': { file: PL, what: 'opens the add form with PUNCH_LIST_SAMPLE (line + Hall), sample run only — he taps Save' },
};

/** Long-but-plausible payloads for every signal above: the defs validator
 *  renders every copy slot with these (and with none) to prove it fits. */
export const LANE_C_FULL_PAYLOADS: PayloadRecord = {
  'schedule.edit.previewed': { projectId: 's', ops: 12, source: 'sample' },
  'schedule.edit.applied': { projectId: 's', moved: 24, deltaDays: 120, finishShiftDays: -365 },
  'time.clockedIn': { projectId: 's', count: 48 },
  'time.clockedOut': { projectId: 's', hours: 23.99, offline: false },
  'punchList.saved': { projectId: 's', itemId: 'p', offline: false },
  'punchList.assigned': { projectId: 's', itemId: 'p', sub: 'Riverbend Drywall & Acoustical Ceilings of Northern New Jersey LLC' },
  'punchList.closed': { projectId: 's', itemId: 'p' },
};

/** This lane's tutorial defs, in the order they join TUTORIAL_DEF_LIST. */
export const LANE_C_DEFS: readonly TutorialDef[] = [scheduleSayIt, timeClockIn, punchListClose];

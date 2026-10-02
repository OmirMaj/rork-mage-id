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

import type { AssistSpec, SignalSpec, TargetSpec } from '../registry';
import type { PayloadRecord, TutorialDef } from '../types';

/** Static target ids this lane's screens wrap in <TutorialTarget id=…>. */
export type LaneCTargetId = never;

/** Assist ids this lane's screens register with useTutorialAssist. */
export type LaneCAssistId = never;

/** Signal payloads (WITHOUT projectId) this lane's screens emit. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface LaneCSignalPayloadMap {}

export const LANE_C_TARGETS: Record<LaneCTargetId, TargetSpec> = {};

export const LANE_C_SIGNALS: { [N in keyof LaneCSignalPayloadMap]: SignalSpec<N> } = {};

export const LANE_C_ASSISTS: Record<LaneCAssistId, AssistSpec> = {};

/** Long-but-plausible payloads for every signal above: the defs validator
 *  renders every copy slot with these (and with none) to prove it fits. */
export const LANE_C_FULL_PAYLOADS: PayloadRecord = {};

/** This lane's tutorial defs, in the order they join TUTORIAL_DEF_LIST. */
export const LANE_C_DEFS: readonly TutorialDef[] = [];

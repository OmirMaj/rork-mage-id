// utils/tutorial/learn/laneA.ts — tutorial fragment for lane A.
// OWNER: LEARNDEFS-A (estimate-first, change-order-draft, field-ticket-log).
//
// THE FRAGMENT SEAM (see the header of utils/tutorial/types.ts). Four content
// lanes add tutorials in parallel without touching the shared engine files:
// each one fills ONLY its own fragment, its own def files and its own screens.
//   types.ts     StaticTargetId / AssistId union in LaneATargetId / LaneAAssistId,
//                and SignalPayloadMap extends LaneASignalPayloadMap;
//   registry.ts  TARGETS / SIGNALS / ASSISTS spread LANE_A_* after the core;
//   defs/index   TUTORIAL_DEF_LIST appends ...LANE_A_DEFS;
//   validator    FULL_PAYLOADS spreads LANE_A_FULL_PAYLOADS (every signal
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
export type LaneATargetId = never;

/** Assist ids this lane's screens register with useTutorialAssist. */
export type LaneAAssistId = never;

/** Signal payloads (WITHOUT projectId) this lane's screens emit. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface LaneASignalPayloadMap {}

export const LANE_A_TARGETS: Record<LaneATargetId, TargetSpec> = {};

export const LANE_A_SIGNALS: { [N in keyof LaneASignalPayloadMap]: SignalSpec<N> } = {};

export const LANE_A_ASSISTS: Record<LaneAAssistId, AssistSpec> = {};

/** Long-but-plausible payloads for every signal above: the defs validator
 *  renders every copy slot with these (and with none) to prove it fits. */
export const LANE_A_FULL_PAYLOADS: PayloadRecord = {};

/** This lane's tutorial defs, in the order they join TUTORIAL_DEF_LIST. */
export const LANE_A_DEFS: readonly TutorialDef[] = [];

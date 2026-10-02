// utils/tutorial/learn/laneB.ts — tutorial fragment for lane B.
// OWNER: LEARNDEFS-B (takeoff-to-estimate, ask-your-plans, construction-ai-ask).
//
// THE FRAGMENT SEAM (see the header of utils/tutorial/types.ts). Four content
// lanes add tutorials in parallel without touching the shared engine files:
// each one fills ONLY its own fragment, its own def files and its own screens.
//   types.ts     StaticTargetId / AssistId union in LaneBTargetId / LaneBAssistId,
//                and SignalPayloadMap extends LaneBSignalPayloadMap;
//   registry.ts  TARGETS / SIGNALS / ASSISTS spread LANE_B_* after the core;
//   defs/index   TUTORIAL_DEF_LIST appends ...LANE_B_DEFS;
//   validator    FULL_PAYLOADS spreads LANE_B_FULL_PAYLOADS (every signal
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
export type LaneBTargetId = never;

/** Assist ids this lane's screens register with useTutorialAssist. */
export type LaneBAssistId = never;

/** Signal payloads (WITHOUT projectId) this lane's screens emit. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface LaneBSignalPayloadMap {}

export const LANE_B_TARGETS: Record<LaneBTargetId, TargetSpec> = {};

export const LANE_B_SIGNALS: { [N in keyof LaneBSignalPayloadMap]: SignalSpec<N> } = {};

export const LANE_B_ASSISTS: Record<LaneBAssistId, AssistSpec> = {};

/** Long-but-plausible payloads for every signal above: the defs validator
 *  renders every copy slot with these (and with none) to prove it fits. */
export const LANE_B_FULL_PAYLOADS: PayloadRecord = {};

/** This lane's tutorial defs, in the order they join TUTORIAL_DEF_LIST. */
export const LANE_B_DEFS: readonly TutorialDef[] = [];

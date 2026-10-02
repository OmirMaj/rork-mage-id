// utils/tutorial/learn/laneD.ts — tutorial fragment for lane D.
// OWNER: LEARNDEFS-D (contract-from-estimate, pay-app-period, closeout-binder).
//
// THE FRAGMENT SEAM (see the header of utils/tutorial/types.ts). Four content
// lanes add tutorials in parallel without touching the shared engine files:
// each one fills ONLY its own fragment, its own def files and its own screens.
//   types.ts     StaticTargetId / AssistId union in LaneDTargetId / LaneDAssistId,
//                and SignalPayloadMap extends LaneDSignalPayloadMap;
//   registry.ts  TARGETS / SIGNALS / ASSISTS spread LANE_D_* after the core;
//   defs/index   TUTORIAL_DEF_LIST appends ...LANE_D_DEFS;
//   validator    FULL_PAYLOADS spreads LANE_D_FULL_PAYLOADS (every signal
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
export type LaneDTargetId = never;

/** Assist ids this lane's screens register with useTutorialAssist. */
export type LaneDAssistId = never;

/** Signal payloads (WITHOUT projectId) this lane's screens emit. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface LaneDSignalPayloadMap {}

export const LANE_D_TARGETS: Record<LaneDTargetId, TargetSpec> = {};

export const LANE_D_SIGNALS: { [N in keyof LaneDSignalPayloadMap]: SignalSpec<N> } = {};

export const LANE_D_ASSISTS: Record<LaneDAssistId, AssistSpec> = {};

/** Long-but-plausible payloads for every signal above: the defs validator
 *  renders every copy slot with these (and with none) to prove it fits. */
export const LANE_D_FULL_PAYLOADS: PayloadRecord = {};

/** This lane's tutorial defs, in the order they join TUTORIAL_DEF_LIST. */
export const LANE_D_DEFS: readonly TutorialDef[] = [];

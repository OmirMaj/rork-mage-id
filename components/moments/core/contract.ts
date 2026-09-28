// contract.ts: the Commit Capsule's public contract (moments wave, lane CAPSULE).
//
// The ONE import path the skins code against. SIGNLINE (the signing line skin,
// components/moments/signing/**) builds on top of exactly these names; they
// are never renamed or removed after core.done. Additive changes only, each
// logged in scratchpad/moments/signal/contract-changes.txt.
//
// Everything is re-exported from its implementation file; nothing is defined
// here. There is deliberately no components/moments/index.ts barrel.

// utils/moments/commitResult.ts (pure TS; bun loads it)
export {
  COMMIT_TIMEOUT_MS,
  COMMIT_MIN_BUSY_MS,
  runCommit,
  timeoutCopy,
  transportCopy,
  legalQueuedCopy,
  genericRefusedCopy,
  offlineLegalReason,
  resolvePlan,
  // Step 0 (MOMSTEP0, additive): the whole-sentence resolvers the primitives use.
  offlineReasonLine,
  legalQueuedLine,
} from '@/utils/moments/commitResult';
export type { CommitStatus, CommitResult, CommitWriteOptions, ResolvePlan, CommitOutcomeCopy, OfflineLegalKind } from '@/utils/moments/commitResult';

// utils/moments/commitAdapters.ts (pure; Step 0): a data-layer answer as one CommitResult.
export { fromWriteOutcome, fromOnlineOutcome } from '@/utils/moments/commitAdapters';
export type {
  WriteOutcomeLike,
  OnlineOutcome,
  OnlineOutcomeWithCode,
  OnlineRefusalCode,
  ConfirmedCopy,
  WriteOutcomeWords,
  OnlineOutcomeWords,
} from '@/utils/moments/commitAdapters';

// utils/moments/motionSpec.ts (pure literals)
export { MOMENT_SPRING, MOMENT_EASE, MOMENT_TIMING, CAPSULE_GEOMETRY, CAPSULE_RULES, dampingRatio } from '@/utils/moments/motionSpec';
export type { SpringCfg } from '@/utils/moments/motionSpec';

// utils/moments/capsuleMath.ts (pure)
export {
  rubber,
  resist,
  resistanceTable,
  disabledTable,
  labelOpacityTable,
  labelDriftTable,
  shouldCommit,
  lockStep,
  notchStep,
  bodyScale,
} from '@/utils/moments/capsuleMath';

// utils/moments/colors.ts (pure; theme tokens in, token values out)
export { momentColors } from '@/utils/moments/colors';
export type { MomentColors, CapsuleTone } from '@/utils/moments/colors';

// utils/moments/copy.ts (pure)
export {
  lintMomentCopy,
  MOMENT_COPY,
  // Step 0 (MOMSTEP0, additive)
  LOCAL_ONLY_TITLE,
  LOCAL_ONLY_NEXT,
  EARLIER_CHANGE_PENDING_REASON,
  EARLIER_CHANGE_UNSAVED_REASON,
  // wave-next W2 (ESTOOLS, additive): the same words in the app's language, read at call time
  momentCopy,
  localOnlyTitle,
  localOnlyNext,
  earlierChangePendingReason,
  earlierChangeUnsavedReason,
} from '@/utils/moments/copy';
export type { MomentCopyDefaults, MomentWords } from '@/utils/moments/copy';
export type { MomentFrameWords } from '@/utils/moments/commitResult';
// wave-next W2 (ESTOOLS, additive): binds the language providers above (idempotent).
export { installMomentLanguage } from '@/utils/moments/sealText';

// utils/moments/haptics.ts (RN + expo-haptics; web-safe)
export { momentHaptic, announce } from '@/utils/moments/haptics';
export type { MomentHaptic } from '@/utils/moments/haptics';

// components/moments/core (RN)
export { useCommitCapsule, MOMENT_ABORT, stripEllipsis } from '@/components/moments/core/useCommitCapsule';
export type {
  CapsuleSkin,
  CapsuleSize,
  CapsuleResultIcon,
  CapsulePhase,
  CapsuleCopy,
  CapsuleGeometryLive,
  CapsuleValues,
  ConfirmedContext,
  UseCommitCapsuleOptions,
  CommitCapsule,
  CapsuleDisplay,
} from '@/components/moments/core/useCommitCapsule';
export { CapsuleShape } from '@/components/moments/core/CapsuleShape';
export type { CapsuleShapeProps } from '@/components/moments/core/CapsuleShape';
export { BusyRing, TwoLegCheck, BangMark, CommitIconStack } from '@/components/moments/core/CommitDot';
export type { CommitIconStackProps } from '@/components/moments/core/CommitDot';
export { useScreenReaderMode } from '@/components/moments/core/useScreenReaderMode';
export { Shimmer } from '@/components/moments/core/Shimmer';
export type { ShimmerProps } from '@/components/moments/core/Shimmer';

// The track skin (re-export OK: this lane owns both files)
export { SlideToConfirm } from '@/components/moments/SlideToConfirm';
export type { SlideToConfirmProps, SlideToConfirmHandle } from '@/components/moments/SlideToConfirm';

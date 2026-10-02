// components/motion/kit — MAGE ID's motion kit (lane MOTIONKIT).
//
// Thirteen parts for things that ARRIVE in front of the reader, each one built
// from a motion pattern and redesigned in MAGE ID's own brand: transform and
// opacity only, the native driver everywhere, a Reduce Motion path that keeps
// the same information, nothing moving at rest, and long lists that only ever
// animate their first 8 rows. Numbers: utils/motion/kit (pure, bun-loadable).
// Guard: scripts/validate-motion-kit.ts. Adopters add NO motion code of their
// own: they import from here and pass real data / real events.

export { ChatTurn, type ChatTurnProps } from './ChatTurn';
export { ThinkingRow, ThinkingDots, useDotClock, dotClockStats, type ThinkingRowProps, type ThinkingDotsProps } from './ThinkingRow';
export { StaggerList, useStagger, type StaggerListProps } from './StaggerList';
export { CheckSync, useCheckBeat, useCheckBeats, type CheckRow, type CheckStatus, type CheckSyncProps } from './CheckSync';
export { CountRoll, type CountRollProps } from './CountRoll';
export { AccumulateCards, type AccumulateCardsProps, type AccumulateItem } from './AccumulateCards';
export { RangeSettle, type RangeSettleProps } from './RangeSettle';
export { useFileInto, FileIntoLayer, type FileIntoArgs, type MeasureRef, type UseFileIntoOptions } from './FileInto';
export { PriorityGrid, type PriorityCell, type PriorityGridProps } from './PriorityGrid';
export { FocusMarker, useFocusRects, type FocusMarkerProps, type FocusRects } from './FocusMarker';
export { StackPush, type StackPushProps } from './StackPush';
export { useFocusPush, type FocusPush, type Scrollable } from './FocusPush';
export { CornerTags, type CornerTagsProps } from './CornerTags';
export { MatrixFill, type MatrixFillProps, type MatrixRow } from './MatrixFill';
export { useEntrance, entranceMs, reducedEntrance, type EntranceSpec, type EntranceOpts } from './useEntrance';
export { useSeenKeys, type SeenKeys } from './useSeenKeys';
export { acquire, release, budgetInFlight, resetBudget } from './budget';
export { kitWebStyle, kitTravel, kitFadeOut, kitFlight, kitPose, KIT_WEB_KEYS, type KitWebKey, type KitPose } from './css/kitCss';

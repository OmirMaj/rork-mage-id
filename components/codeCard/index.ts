// components/codeCard — the code-card components (lane CCKIT). Built on the
// primitives in components/ui (Card, Sheet, Button, SegmentedControl, the
// motion kit) and the pure logic in utils/codeCard.

export { CodeCard, CLOSE_TO_LINE_NOTE, EDITION_NOT_CONFIRMED, type CodeCardProps } from './CodeCard';
export { CodeCardRow, askTarget, type CodeCardRowProps } from './CodeCardRow';
export {
  CodeCardList,
  LOOK_RIGHT_NOTE,
  ANSWER_FINE_PRINT,
  type CodeCardListProps,
  type CodeBulkAction,
  type CodeBulkIcon,
} from './CodeCardList';
export { CodeCardSheet, NO_SUBS_REASON, NO_SEND_REASON, type CodeCardSheetProps } from './CodeCardSheet';
export {
  JurisdictionBlock,
  EDITION_MISSING,
  EDITION_MISSING_LINE,
  OFFICE_MISSING,
  OFFICE_UNVERIFIED,
  type JurisdictionBlockProps,
} from './JurisdictionBlock';
export { EvidenceMeter, EvidenceBars, type EvidenceMeterProps } from './EvidenceMeter';
export { ThresholdTape, tapePercent, type ThresholdTapeProps } from './ThresholdTape';
export { VerdictTag, SampleTag, VERDICT_LABEL, type VerdictTagProps } from './VerdictTag';
export {
  SunlightToggle,
  ConfirmBlock,
  BlockedNote,
  NOT_AFFILIATED,
  readyAction,
  doneAction,
  blockedAction,
  type CodeCardAction,
} from './parts';
export { codeCardPalette, useCodeCardPalette, useSunlight, type CodeCardPalette } from './palette';

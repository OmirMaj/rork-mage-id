// utils/livingModel/measure.ts — feet and inches for the Living Model's screens.
//
// The scanner's own unit helpers and saved-scan shape, passed through as they
// are (nothing is forked). The screens import them from here so the one place
// that reaches into the scanner is utils/livingModel, as the scanner's own
// guard (scripts/validate-scan-room.ts rule N3) asks of every other feature.
export { formatFeetInches, formatSqFt, parseTapeMeasure, sqMetresToSqFeet } from '@/utils/roomScan/units';
export type { SavedScan } from '@/utils/roomScan/storeCore';

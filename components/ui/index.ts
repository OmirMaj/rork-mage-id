// components/ui — the primitive layer.
//
// WHY THIS FILE EXISTS. Until 2026-09-07 there was no index here, so
// `import { Card, Button } from '@/components/ui'` — the import every design
// system in the world is written to be used with, and the one a new screen's
// author reaches for first — did not RESOLVE. It failed at bundle time with a
// module-not-found, which reads as "these primitives don't exist" rather than
// "the barrel is missing", so the author wrote the card by hand and moved on.
// Five primitives had 1, 6, 3, 3 and 5 importers between them against ~700
// hand-rolled `backgroundColor: t.surface` recipes in app/ and components/.
//
// The deep paths (`@/components/ui/Button`) still work and are not being
// rewritten — this only adds the door that was missing.
//
// Adoption is ratcheted by scripts/validate-ui-adoption.ts, which fails the
// build if this barrel stops resolving or if the hand-rolled count rises.

export { Card, cardSurface } from './Card';
export { Button, type ButtonVariant, type ButtonSize } from './Button';
export { Badge, type BadgeTone } from './Badge';
export { EyebrowLabel } from './EyebrowLabel';
export { IconWrapper, type IconWrapperTone, type IconWrapperSize } from './IconWrapper';
export { StatusPill, type StatusTone, type StatusPillProps } from './StatusPill';
export { ScreenHeader, type ScreenHeaderProps, type ScreenHeaderVariant } from './ScreenHeader';

// Colour decisions a chip cannot get right by eye — see ./ink.ts.
export { labelOn, neutralInk, taskStatusInk, INK_ON_LIGHT_FILL, CHIP_TINT_SUFFIX } from './ink';

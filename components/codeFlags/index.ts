// components/codeFlags — Code Flags (Big Bets, Bet 4, Phase 1).
// app/change-order.tsx and app/(tabs)/estimate/full.tsx load this barrel only
// while CODE_FLAGS_ENABLED is true. Every component returns null when it is not.
export { default as CodeFlagChip } from '@/components/codeFlags/CodeFlagChip';
export { default as CodeFlagsProbe } from '@/components/codeFlags/CodeFlagsProbe';
export { default as CodeFlagAgeRow } from '@/components/codeFlags/CodeFlagAgeRow';

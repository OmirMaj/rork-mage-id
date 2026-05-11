# components/ui — design system primitives

The **floor** of the MAGE ID component layer. Every screen and every feature component composes from here.

## Why this exists

A 2026-05 audit found:
- **105 components** in the app, none composed from a shared primitive layer.
- **~7,143 hardcoded `padding`/`margin` values** across the codebase.
- **0 usages** of `Tokens.spacing` / `Tokens.shadow` / `Tokens.motion` — tokens existed but nothing used them.
- The top 5 components were each over 1,000 LOC, each re-implementing the same card/sheet/row patterns inline.

`components/ui/` is the fix. Build new screens on these primitives; migrate existing screens opportunistically when you're already in the file.

## The eight primitives

| Primitive | Purpose | Docs |
|---|---|---|
| `<Card>` | Any rectangular surface that groups content. | [Card.docs.md](./Card.docs.md) |
| `<Sheet>` | Modal-route chrome — back-chevron header + scroll body. | [Sheet.docs.md](./Sheet.docs.md) |
| `<NavRow>` | Tap-to-navigate row with icon + title + chevron. | [NavRow.docs.md](./NavRow.docs.md) |
| `<Pill>` | Small status chip with tone + icon. | [Pill.docs.md](./Pill.docs.md) |
| `<Field>` | Form field — label + input + helper/error. | [Field.docs.md](./Field.docs.md) |
| `<Section>` | Eyebrow + title + stacked children. | [Section.docs.md](./Section.docs.md) |
| `<EmptyState>` | Centered empty / first-use state with icon + CTA. | [EmptyState.docs.md](./EmptyState.docs.md) |
| `<TrustRow>` | Shield + reassurance footnote. | [TrustRow.docs.md](./TrustRow.docs.md) |

## Import

One namespace, one import:

```tsx
import { Card, Sheet, NavRow, Pill, Field, Section, EmptyState, TrustRow } from '@/components/ui';
```

## Principles

1. **Tokens-only.** Every primitive consumes `Colors`, `Type`, and `Tokens.spacing/radius/shadow` directly. No hardcoded hex, no inline shadow recipes, no arbitrary padding numbers.
2. **One source of truth per pattern.** If you find yourself building a card-like surface, a sheet-like header, a navigation row, or a status badge, stop and use the primitive. If the primitive doesn't cover your case, extend it via props — don't fork it.
3. **Composition over configuration.** Primitives accept children. They don't bake in domain logic. The Card doesn't know about projects; the project tile knows about cards.
4. **Accessibility is baked in.** Every interactive primitive sets `accessibilityRole`, supports `accessibilityLabel`, respects disabled state, and meets Apple HIG hit-target minimums.
5. **iOS-first polish.** Continuous corners (`borderCurve: 'continuous'`) on every Pressable. Safe-area insets handled. Subtle pressed-state opacity dips.

## When to extend

A new primitive earns its place in `components/ui/` when:

- The pattern shows up in 3+ places, and
- It's a leaf-level primitive (doesn't compose other domain components), and
- It can be described in one sentence ("a tappable status chip", "a back-header modal chrome").

If a pattern is feature-specific (e.g. "a paywall plan card with pricing toggle"), it belongs in `components/`, not `components/ui/`.

## What's next

The eight primitives above cover the patterns the audit flagged. Migration is the work remaining:

- **Form-heavy screens** → migrate ad-hoc `<Text label> + <TextInput>` stacks onto `<Field>`.
- **Tab screens with section headers** → replace local `function Section()` definitions with `<Section>`.
- **Empty states with custom JSX** → consolidate onto `<EmptyState>`.
- **Modal routes** → migrate bespoke headers onto `<Sheet>`.

The audit's spacing-token codemod also remains — `padding: 16` → `Tokens.spacing.md` across the top 5 offender files (`project-detail.tsx`, `(tabs)/schedule/index.tsx`, `client-view.tsx`, `(tabs)/estimate/index.tsx`, `takeoff.tsx`). 7,000+ raw spacing values across the codebase.

If a new pattern shows up 3+ times and meets the "leaf-level primitive" bar described above, it earns a spot here — with its `.docs.md` and a barrel export.

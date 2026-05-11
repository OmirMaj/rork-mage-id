# components/ui — design system primitives

The **floor** of the MAGE ID component layer. Every screen and every feature component composes from here.

## Why this exists

A 2026-05 audit found:
- **105 components** in the app, none composed from a shared primitive layer.
- **~7,143 hardcoded `padding`/`margin` values** across the codebase.
- **0 usages** of `Tokens.spacing` / `Tokens.shadow` / `Tokens.motion` — tokens existed but nothing used them.
- The top 5 components were each over 1,000 LOC, each re-implementing the same card/sheet/row patterns inline.

`components/ui/` is the fix. Build new screens on these primitives; migrate existing screens opportunistically when you're already in the file.

## The four primitives

| Primitive | Purpose | Docs |
|---|---|---|
| `<Card>` | Any rectangular surface that groups content. | [Card.docs.md](./Card.docs.md) |
| `<Sheet>` | Modal-route chrome — back-chevron header + scroll body. | [Sheet.docs.md](./Sheet.docs.md) |
| `<NavRow>` | Tap-to-navigate row with icon + title + chevron. | [NavRow.docs.md](./NavRow.docs.md) |
| `<Pill>` | Small status chip with tone + icon. | [Pill.docs.md](./Pill.docs.md) |

## Import

One namespace, one import:

```tsx
import { Card, Sheet, NavRow, Pill } from '@/components/ui';
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

The audit identified these as future primitive candidates, in priority order:

1. **`<Field>`** — label + input + helper/error. Replaces 40+ ad-hoc form rows.
2. **`<Section>`** — eyebrow + title + stacked children. Replaces the ad-hoc `<Text><View>` section patterns.
3. **`<EmptyState>`** — icon + title + message + optional CTA. Replaces ~20 bespoke empty states.
4. **`<TrustRow>`** — shield/lock icon + footnote. Replaces ~10 bespoke trust footers (paywall, legal, compliance).

Each one would land here with its `.docs.md` and a barrel export in `index.ts`.

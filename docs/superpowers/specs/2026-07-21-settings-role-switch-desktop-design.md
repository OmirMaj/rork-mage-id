# Settings Role-Switch — Desktop/Laptop UX Fix — Design

**Date:** 2026-07-21
**Status:** Approved (design); ready for implementation plan
**Branch target:** off `main`

## Goal

Fix the "very bad on the laptop" experience when switching between the **contractor** and **property-owner** personas, and the Settings screen generally on wide screens. Presentation-only: no logic, no data, no role-switch behavior changes.

## Background — audit findings (2026-07-21)

The persona picker and the Settings screen are **mobile layouts stretched full-bleed** across the laptop. There is no desktop treatment — `useResponsiveLayout` exists but neither screen constrains its content.

- **`app/persona-select.tsx`** (the role picker reached from Settings → "Account Type"): full-bleed, no `maxWidth`; role cards span the entire window (up to ~2500px on a 27" display); rendered as a tall vertical stack instead of a grid; headline/lede scale poorly and float in empty space; no hover feedback on web.
- **`app/(tabs)/settings/index.tsx`**: the ScrollView content has no centered `maxWidth`; every row (including the "Account Type" role-switch row, `:554–593`) spans edge-to-edge with 16px padding; the ChevronRight affordance sits far right across a huge row; no hover state.
- **Both personas share this container.** The Settings screen renders ~24 sections that are essentially identical for contractor vs property-owner (role gating is light — only the Account-Type row's subscription text and an owner-only Developer section differ). **So one responsive fix covers both role variants.**

## The fix

Presentation-only responsive pass, using the existing `useResponsiveLayout` breakpoints and `Colors`/`Type`/`Tokens` (anti-slop compliant — no raw hex, inline `fontSize`, or `borderRadius`).

### `app/persona-select.tsx`
- Wrap the content in a **centered container with `maxWidth`** (~640–720px) so the picker reads as a focused card on desktop, not a full-bleed sheet.
- Render the four role cards as a **2×2 grid on wide screens** (single column on mobile) via a width check.
- Constrain each **role card** with a `maxWidth` and give it a **web hover state** (subtle elevation/border on `onMouseEnter`, respecting `Pressable`/`activeOpacity` on native).
- Scale the **headline/lede** for desktop (cap the headline, center the lede within the container instead of a fixed 520px in a void).

### `app/(tabs)/settings/index.tsx`
- Wrap the ScrollView content in a **centered `maxWidth` container** (~720–860px) on wide screens so rows have a natural reading width.
- Give the **"Account Type" role-switch row** (`:554–593`) a **web hover state** and ensure the chevron/label read as one clear clickable unit at the constrained width.
- No change to which sections render or to the switch behavior.

## Files

- **Modify** `app/persona-select.tsx` — responsive container, 2×2 card grid, card `maxWidth` + hover, headline/lede scaling.
- **Modify** `app/(tabs)/settings/index.tsx` — centered `maxWidth` content container; hover on the Account-Type row.
- Reuse `utils/useResponsiveLayout.ts` for breakpoints; `constants/colors`, `constants/typography`, `constants/designTokens` for tokens.

## Testing

- **Anti-slop lint** must pass (no raw hex / inline `fontSize` / `borderRadius`).
- **Visual verification on laptop width** (RN-web ≥900px): persona-select is a centered card with a 2×2 grid and hover; Settings content is centered at a readable width; the role switch flow (Settings → Account Type → persona-select → tap "Property Owner" → returns) still works.
- `bun run ship-check` green. OTA-safe (JS/style only).
- Regression check: mobile (<900px) layout is unchanged (single-column, full-width as today).

## Out of scope

- **Content relevance by role** — a property owner still sees contractor-oriented sections (Estimate Defaults, Supplier Marketplace, PDF Naming). This is a product decision, noted but not changed here.
- Any change to role-switch behavior, subscriptions, or persona data.

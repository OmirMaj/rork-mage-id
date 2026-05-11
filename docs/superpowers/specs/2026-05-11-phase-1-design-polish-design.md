# Phase 1 — App Design Polish

**Date:** 2026-05-11
**Status:** Approved for implementation planning
**Scope:** Visual identity overhaul of the MAGE ID app (Expo iOS/Android/web). No backend changes. No marketing site changes.

---

## Goal

Transform MAGE ID's app from utilitarian to editorial: **Fraunces serif + amber + JetBrains Mono**, on a warm cream/paper light theme. Match the marketing site's brand DNA without losing legibility on a jobsite. Dark mode available as opt-in.

Today the app reads as competent SaaS — token system exists in `constants/colors.ts`, `constants/designTokens.ts`, `constants/typography.ts`, but tokens aren't enforced via primitives and the visual language doesn't match the marketing site (mageid.app). After Phase 1, the two surfaces share one brand: contractors and homeowners feel the same product across web and app.

---

## Non-goals

- Marketing-site changes (Phase 2)
- Desktop/web Kanban view (Phase 3)
- New product features or screens
- Backend changes: offline queue, MONTHLY_CAPS refactor, tier-gate hardening (Phase 3)
- Migrating screens beyond the 6 hero screens listed below — those happen in Phase 1.5+

---

## Design tokens

### Colors — `constants/colors.ts`

Extend the existing module; do not replace. Keep the flat `Colors.*` keys for back-compat so unmigrated screens keep working.

Add a `Theme` shape with `light` and `dark` variants:

| Token | Light | Dark | Use |
|---|---|---|---|
| `bg` | `#FBF8F2` (paper) | `#0B0D10` (ink) | App background |
| `surface` | `#FFFFFF` | `#14181D` (steel) | Cards, modals |
| `surfaceAlt` | `#F4EFE6` (cream) | `#1A1F26` | Pressed/hover surface |
| `text` | `#2B3038` (slate) | `#F4EFE6` (cream) | Primary text |
| `textSecondary` | `rgba(43,48,56,0.6)` | `#9AA3AD` (fog) | Secondary text |
| `textMuted` | `rgba(43,48,56,0.4)` | `rgba(154,163,173,0.6)` | Captions |
| `line` | `rgba(43,48,56,0.12)` | `rgba(255,255,255,0.06)` | Borders, separators |
| `accent` | `#FF6A1A` (amber) | `#FF6A1A` (amber) | Primary action |
| `accentHot` | `#FF8533` | `#FF8533` | Hover/pressed |
| `accentSoft` | `rgba(255,106,26,0.12)` | `rgba(255,106,26,0.16)` | Tinted backgrounds |
| `accentLabel` | `#C44A0F` (amber-deep) | `#FF6A1A` | Text on light/dark |
| `success` | `#2E7D44` | `#4ED37A` | Positive states |
| `successSoft` | `rgba(46,125,68,0.12)` | `rgba(78,211,122,0.12)` | Success badge bg |
| `danger` | `#C84038` | `#FF5A51` | Errors, destructive |
| `info` | `#1565C0` | `#4EA7FF` | Informational |

Keep `Colors.primary` (green `#1A6B3C`) as a legacy export for unmigrated screens, but the new design system never uses it. Eventually retired in Phase 2/3.

Custom-color theming (`setCustomColors`) stays — it's used for the client portal letting GCs match company brand. Document that it only overrides `primary` and `accent`, not the full theme.

### Typography — `constants/typography.ts`

Add Fraunces + JetBrains Mono variants. Existing `Type.*` Inter-based tokens stay.

| New token | Font | Size / weight | Use |
|---|---|---|---|
| `Type.serifLargeTitle` | Fraunces 500 | 36/40px, -0.025em | Large screen titles |
| `Type.serifTitle` | Fraunces 500 | 28/32px, -0.02em | Screen titles |
| `Type.serifHeadline` | Fraunces 500 | 22/26px, -0.01em | Card titles in hero cards, project names |
| `Type.monoEyebrow` | JetBrains Mono 500 | 11px, 0.14em tracking, uppercase | Eyebrow labels |
| `Type.monoLabel` | JetBrains Mono 500 | 10px, 0.18em tracking, uppercase | Section labels, status |
| `Type.monoCaption` | JetBrains Mono 400 | 12px, 0.06em | Timestamps, metadata |

`@expo-google-fonts/fraunces` is already in `package.json`. Add `@expo-google-fonts/jetbrains-mono` and load both in `app/_layout.tsx` font preload alongside the existing Fraunces load.

### Spacing, radius, shadow, motion — `constants/designTokens.ts`

No changes. The existing tokens are excellent and well-documented.

---

## Theme system

### `contexts/ThemeContext.tsx` (new)

Built with `@nkzw/create-context-hook` (project convention). Exports `useTheme()`:

```ts
type ThemePref = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

{
  pref: ThemePref,
  resolved: ResolvedTheme,
  colors: ThemeColors,    // the resolved palette
  setPref: (p: ThemePref) => Promise<void>,
}
```

- Persists `pref` to `AsyncStorage` under `mageid_theme` (use the legacy `buildwise_*` prefix? No — this is new, use `mageid_theme`).
- When `pref === 'system'`, listens to `Appearance.addChangeListener` from React Native.
- Default for new installs: `'light'` (note: not `'system'` — we want a deliberate, opinionated default).
- Mounted in `app/_layout.tsx` provider stack, **above** `AuthProvider` (theme is universal, not auth-scoped) but **below** `ThemeLoader` so the existing theme load logic keeps working.

### `hooks/useThemedStyles.ts` (new)

```ts
function useThemedStyles<T>(make: (theme: ThemeColors) => T): T
```

Pattern: `const styles = useThemedStyles(makeStyles)` where `makeStyles` is a top-of-file `(theme) => StyleSheet.create({...})`. Memoized per theme; re-runs only when theme changes.

### `app/settings/appearance.tsx` (new screen)

Segmented control: **Light / Dark / System**. Live preview swatch showing background + text + amber CTA. Shipping at the same step as foundation so dark is reachable from day one.

Routed from existing Settings screen — add a "Appearance" row.

---

## Primitives library — `components/ui/`

New folder. Each primitive consumes `useTheme()` + `useThemedStyles`, supports both themes, and bakes in tokens so consumers can't drift.

### `Button.tsx`

Variants: `primary | secondary | ghost | destructive`
Sizes: `sm | md | lg`

- `primary`: amber pill, white text, subtle shadow (`Shadow.medium`), `Radius.full`, `Tokens.touchTarget.comfortable` height
- `secondary`: `surface` bg, `line` border, `text` text, `Radius.full`
- `ghost`: transparent bg, no border, `text` color
- `destructive`: `danger` bg, white text

Built-in `Haptics.selectionAsync()` on press (iOS only via `Platform.select`). Props: `onPress`, `disabled`, `loading` (replaces label with spinner), `iconLeft`, `iconRight`, `fullWidth`. Uses `continuousCorners` from tokens for the iOS squircle look.

### `Card.tsx`

Compositional: `<Card>` is the surface; `<Card.Label>`, `<Card.Title>`, `<Card.Meta>`, `<Card.Footer>` are slots. Uses `surface` bg, `line` 1px border, `Radius.lg`, `Spacing.md` padding by default. Optional `pressable` prop wires `Pressable` with haptic + 0.98 scale on press.

### `Input.tsx`

Single-line + multi-line (`multiline` prop). Floating label that animates up on focus. Focus state: amber `borderColor`, slight glow. Error state: danger border + red helper text. Uses `Type.body` for input text, `Type.monoEyebrow` for the floating label when small.

### `Badge.tsx`

Variants: `success | warn | info | danger | neutral`. Mono uppercase text (`Type.monoLabel`), soft tinted bg (e.g., `accentSoft`), matching 1px border, `Radius.full`, tight padding. Optional dot prefix (the pulsing dot pattern from the marketing site).

### `EyebrowLabel.tsx`

The recurring "dot + mono-uppercase" pattern. Tiny component; takes `children` + optional `tone` (`amber | success | neutral`).

### Existing primitives — token audit only

`Skeleton.tsx`, `IconButton.tsx`, `StatusPill.tsx`, `NavRow.tsx` stay but get an internal rewrite to use new tokens. Public API unchanged.

---

## Migration sequence

Each step is its own commit/PR. The app must be shippable after every step — no broken intermediate states.

1. **Foundation (PR 1)**
   - Extend `colors.ts`, `typography.ts` with new tokens
   - Add `contexts/ThemeContext.tsx`, `hooks/useThemedStyles.ts`
   - Build `components/ui/{Button,Card,Input,Badge,EyebrowLabel}.tsx`
   - Add `app/settings/appearance.tsx`
   - Add font preload for JetBrains Mono
   - **No visible UI change yet** — unmigrated screens still use legacy `Colors.*`
   - Verify: `bun run lint` clean, `npx tsc --noEmit` clean, app boots, Appearance toggle changes theme of itself (only).

2. **ProjectCard (PR 2)** — `components/ProjectCard.tsx`
   - Migrate to new tokens, Fraunces title, mono label, amber accents, both themes
   - High-impact because it's used on every project list

3. **Home tab (PR 3)** — `app/(tabs)/(home)/index.tsx`
   - Migrate screen header, list scaffolding; ProjectCard already migrated
   - Add `ProjectCardSkeleton` for loading state

4. **Project Detail (PR 4)** — `app/project-detail.tsx`
   - Most-used screen. Migrate the tile grid, all four tile groups (Field/Money/Docs/People), tile modals
   - Largest scope of any single step

5. **Onboarding (PR 5)** — `app/onboarding.tsx`
   - First impression for new installs. Fraunces is already used here; expand to full token migration

6. **Paywall (PR 6)** — `app/paywall.tsx`
   - Purchase moment requires highest polish. Token-migrate; lean into amber + Fraunces

7. **Everything else (Phase 1.5+)**
   - Track remaining screens in `docs/superpowers/plans/migration-checklist.md`
   - Migrated as each screen is touched for any other reason (feature work, bug fixes, etc.)

---

## Haptics

Built into the `Button` primitive — every press triggers `Haptics.selectionAsync()` on iOS (no-op on Android/web). Confirmation actions (invoice sent, contract signed, payment received) trigger `Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)` from the calling screen.

Not added to: scrolling, text input, drag handles. Reason: haptic fatigue.

---

## Skeleton loaders

`components/Skeleton.tsx` already exists. Add:

- `ProjectCardSkeleton` — mimics the new ProjectCard shape (Fraunces-height title, two metric rows, progress bar)
- `ListSkeleton count={n}` — renders `n` placeholder rows
- `TileGridSkeleton rows={n}` — for Project Detail's tile groups

Applied to:
- Home tab (Project list while `react-query` fetches projects)
- Project Detail (tile groups while domain data hydrates)
- Daily Reports list, Invoices list, RFI list — any `react-query`-backed list that today renders blank during load

---

## Architecture & isolation

- **`constants/colors.ts`** owns palette tokens. Two consumers: legacy `Colors.*` (back-compat) and the new `Colors.theme.{light,dark}` (resolved by ThemeContext).
- **`contexts/ThemeContext.tsx`** owns resolved theme + persistence. Pure read-side dependency on `colors.ts`. No other context depends on it; it's a leaf in the provider stack.
- **`hooks/useThemedStyles.ts`** is the only sanctioned way for components to consume the theme. Components never read `Colors.theme.light.bg` directly — they call `useThemedStyles(theme => ...)`. This makes adding a third theme later trivial.
- **`components/ui/*`** primitives are the only place tokens are spread into specific style values. Consumer screens compose primitives and don't touch tokens directly. This is what enforces consistency — a developer can't write `padding: 13` if they're using `<Card>`.

A screen file should be able to be read top-to-bottom and tell you "this screen shows X, composed of primitives Y and Z" — without scrolling into a StyleSheet block of inline color literals.

---

## Testing

- **Type check**: `npx tsc --noEmit` after each PR. Strict mode is on.
- **Lint**: `bun run lint`.
- **Manual smoke per PR**:
  - Light mode: every migrated screen renders correctly, no missing colors, no fontFamily fallbacks
  - Dark mode: flip toggle in Settings → Appearance, every migrated screen renders correctly
  - System mode: change iOS device appearance, app follows
- **Regression sweep at PR 2**: ProjectCard appears in ~12 places. Verify all render sites (home, search results, project picker, dashboard) look correct in both themes.

No automated visual regression in scope for Phase 1 — too much setup for the value. Phase 3 candidate.

---

## Open questions deferred to implementation

- Exact font-loading order (JetBrains Mono adds ~40KB; consider lazy-loading)
- Whether `setCustomColors` should be reworked to override the theme's `accent` only, or also override `accentHot`/`accentLabel`/`accentSoft` (probably yes, derive from base — same hex→hsl helpers already in `colors.ts`)
- Whether to deprecate `Colors.primary` (green) immediately or wait until all screens migrated

These get resolved in the writing-plans step.

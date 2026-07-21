# Settings Role-Switch — Desktop/Laptop UX Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the persona picker and the Settings screen read as a real laptop layout (centered, max-width, 2×2 role grid, hover) instead of a phone screen stretched wall-to-wall.

**Architecture:** Presentation-only. Reuse the existing `useResponsiveLayout()` hook for the desktop breakpoint, and `Colors`/`Type`/`Tokens` for all values. Add a centered max-width content container to both screens, render the four role cards as a responsive grid, and add web hover states via RN-web `Pressable`'s `hovered` style-callback. No logic, data, or role-switch behavior changes. Mobile (<900px web / phones) must render exactly as today.

**Tech Stack:** React Native / Expo (RN-web for laptop), TypeScript strict, `useResponsiveLayout`, `constants/colors|typography|designTokens`.

---

## Repo conventions (read before starting)

- Package manager **bun**. Type-check: `npx tsc --noEmit`. Lint: `bun run lint` (expo lint; **anti-slop** `no-restricted-syntax` forbids raw hex, inline `fontSize`, and `borderRadius` — use `Colors`/`Type`/`Tokens`. Raw `padding`/`gap`/`minHeight`/`maxWidth`/`width` numbers are allowed).
- Full gate: `bun run ship-check` must stay green.
- No jest. This plan is presentation-only, so its "tests" are: `tsc` clean + lint clean + a documented visual check at ≥900px web width and unchanged mobile.
- Desktop breakpoint truth (`utils/useResponsiveLayout.ts`): `isDesktop === true` when `width >= 1024 || (isWeb && width >= 900)`. The hook returns `{ isPhone, isTablet, isDesktop, width, contentMaxWidth, sidebarWidth, showSidebar, ganttRowHeight }`.

## File Structure

- **Modify** `app/persona-select.tsx` — the role picker (reached from Settings → "Account Type"). Add a centered max-width container, a 2×2 role-card grid on desktop, per-card max-width + hover, and headline/lede desktop scaling.
- **Modify** `app/(tabs)/settings/index.tsx` — wrap the settings ScrollView content in a centered max-width container on desktop; add a hover state to the "Account Type" row (`~:554–593`).

---

### Task 1: persona-select — centered desktop container

**Files:**
- Modify: `app/persona-select.tsx`

- [ ] **Step 1: Read the current structure**

Run: `sed -n '160,360p' app/persona-select.tsx`
Expected: see the root `View`/`ScrollView`, the `body` content (`paddingHorizontal: 24`, ~`:279–282`), the `cardList`/`roleCard` styles (~`:324–349`), and the `headline`/`lede` styles (~`:296–320`).

- [ ] **Step 2: Add the responsive hook**

At the top of the component body (after existing hooks), add:

```tsx
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
// ...inside the component:
const { isDesktop } = useResponsiveLayout();
```

- [ ] **Step 3: Wrap the content in a centered max-width container**

Wrap the existing body content (headline + lede + card list) in a `View` whose style applies a max-width and centers on desktop only. Add this style to the `StyleSheet.create` block:

```tsx
centerWrap: { width: '100%', alignSelf: 'center', maxWidth: 680 },
```

Apply it to the container that holds the headline/lede/cards: `<View style={[styles.body, isDesktop && styles.centerWrap]}>`. Do NOT change `styles.body` itself (mobile must keep full-width behavior).

- [ ] **Step 4: Type-check + lint**

Run: `npx tsc --noEmit && bun run lint`
Expected: no new errors. If lint flags a raw number in a style, confirm it is `maxWidth`/`width`/`padding` (allowed) and not `borderRadius`/`fontSize`/hex.

- [ ] **Step 5: Commit**

```bash
git add app/persona-select.tsx
git commit -m "settings(persona): centered max-width container on desktop

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: persona-select — 2×2 role-card grid on desktop

**Files:**
- Modify: `app/persona-select.tsx`

- [ ] **Step 1: Make the card list a responsive grid**

The cards currently render in a `cardList` (`flexDirection: 'column'`, `gap: 10`). Add a desktop grid variant. Add these styles:

```tsx
cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
cardHalf: { flexBasis: '48%', flexGrow: 1, minWidth: 200 },
```

Apply `styles.cardGrid` to the list container on desktop: `<View style={[styles.cardList, isDesktop && styles.cardGrid]}>`, and add `isDesktop && styles.cardHalf` to each role card wrapper so two cards sit per row. On mobile (`isDesktop === false`) the existing single-column stack is unchanged.

- [ ] **Step 2: Constrain the headline/lede on desktop**

The headline uses `fontSize: Math.min(56, SCREEN_WIDTH * 0.13)` and the lede has `maxWidth: 520`. Center the lede inside the new 680px container (it already has `maxWidth: 520`, which now sits centered — verify it is `alignSelf: 'center'` or wrapped by the centered container). No fontSize edits needed (the `Type` scale governs elsewhere); leave the existing headline expression.

- [ ] **Step 3: Type-check + lint**

Run: `npx tsc --noEmit && bun run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add app/persona-select.tsx
git commit -m "settings(persona): 2x2 role-card grid on desktop

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: persona-select — per-card hover state (web)

**Files:**
- Modify: `app/persona-select.tsx`

- [ ] **Step 1: Confirm the card element**

Run: `sed -n '210,250p' app/persona-select.tsx`
Expected: each role card is a `TouchableOpacity` (or `Pressable`) calling `handlePick(role)`.

- [ ] **Step 2: Give cards a hover affordance**

If the card is a `TouchableOpacity`, convert the card element to `Pressable` (import `Pressable` from `react-native`) and use the `hovered` style callback (RN-web supplies it; native ignores it):

```tsx
import { Pressable } from 'react-native';
// ...
<Pressable
  onPress={() => handlePick(role.value)}
  style={({ hovered }) => [styles.roleCard, isDesktop && styles.cardHalf, hovered && styles.roleCardHover]}
  accessibilityRole="button"
>
  {/* existing card inner content unchanged */}
</Pressable>
```

Add the hover style (border shifts to accent; use tokens, no raw hex):

```tsx
roleCardHover: { borderColor: Colors.light.accent, backgroundColor: Colors.light.surfaceAlt },
```

Use whatever the file's existing themed color source is (match how `roleCard` already pulls its `borderColor`/`backgroundColor` — reuse that token, do not hardcode a hex). If the file uses `useTheme()` colors, put the hover colors inline in the style array using those theme values instead of a static style.

- [ ] **Step 3: Type-check + lint**

Run: `npx tsc --noEmit && bun run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add app/persona-select.tsx
git commit -m "settings(persona): card hover state on web

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Settings screen — centered max-width content + row hover

**Files:**
- Modify: `app/(tabs)/settings/index.tsx`

- [ ] **Step 1: Read the ScrollView + Account-Type row**

Run: `sed -n '455,595p' "app/(tabs)/settings/index.tsx"`
Expected: the `ScrollView` (`~:455–459`) and the ACCOUNT TYPE section with the role-switch `TouchableOpacity` (`~:560–564`, `router.push('/persona-select')`).

- [ ] **Step 2: Add the responsive hook + centered container**

Add `import { useResponsiveLayout } from '@/utils/useResponsiveLayout';` and `const { isDesktop } = useResponsiveLayout();` in the component. Give the ScrollView a `contentContainerStyle` that centers content at a max width on desktop. Add:

```tsx
contentDesktop: { width: '100%', maxWidth: 760, alignSelf: 'center' },
```

Apply it via the ScrollView's `contentContainerStyle={[styles.scrollContent, isDesktop && styles.contentDesktop]}` (create/keep `scrollContent` if the ScrollView has an existing content style; otherwise add `contentContainerStyle={isDesktop ? styles.contentDesktop : undefined}`). Mobile unchanged.

- [ ] **Step 3: Hover on the Account-Type row**

Convert the ACCOUNT TYPE row `TouchableOpacity` (`~:560`) to `Pressable` with a `hovered` style callback (same pattern as Task 3), applying a subtle surface change on hover using the file's existing themed color token (no raw hex). Keep `testID="settings-persona-row"` and the `onPress={() => router.push('/persona-select')}`.

- [ ] **Step 4: Type-check + lint**

Run: `npx tsc --noEmit && bun run lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add "app/(tabs)/settings/index.tsx"
git commit -m "settings: centered max-width content + account-type row hover on desktop

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Verify — ship-check + visual

**Files:** none (verification only)

- [ ] **Step 1: Full gate**

Run: `bun run ship-check`
Expected: green (typecheck + lint + all validators). No validator changes are needed (presentation-only).

- [ ] **Step 2: Visual check at desktop width**

Start web (`bun run start-web`) or the running dev server; at a browser width ≥900px, open Settings → tap "Account Type" → persona-select. Confirm: Settings content is centered at a readable width (not edge-to-edge); persona-select shows a centered card with a 2×2 role grid; hovering a role card and the Account-Type row shows feedback; tapping "Property Owner" still switches and returns. Then narrow the window <900px and confirm the layout falls back to the single-column full-width mobile layout unchanged.

- [ ] **Step 3: Record the check**

No code change. Note in the task's completion that the desktop + mobile visual checks passed.

---

## Self-Review

- **Spec coverage:** centered max-width container (Tasks 1, 4) ✓; 2×2 grid (Task 2) ✓; hover states (Tasks 3, 4) ✓; headline/lede scaling (Task 2) ✓; both role variants covered because Settings shares one container (Task 4) ✓; mobile unchanged (verified Task 5) ✓; content-relevance explicitly out of scope ✓.
- **Placeholder scan:** none — each task gives exact files, the style objects to add, and the `hovered` pattern.
- **Type/naming consistency:** `useResponsiveLayout` / `isDesktop` used identically across tasks; style names (`centerWrap`, `cardGrid`, `cardHalf`, `contentDesktop`) are distinct and consistent.
- **Note for implementer:** the two screens pull colors differently (persona-select may use `useTheme()`, settings uses `styles`). Match each file's existing color source for hover styles — never introduce a raw hex; that will fail anti-slop lint.

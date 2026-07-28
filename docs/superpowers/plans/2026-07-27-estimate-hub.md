# Estimate Hub (Workstream A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the currently-hidden `estimate` tab into a visible, branded **Estimate hub** that is the single front door to all estimating flows, without deleting any existing screen.

**Architecture:** Repurpose the already-registered `estimate` tab. Move the heavy Full Estimator from `estimate/index.tsx` to `estimate/full.tsx`, and make a new lightweight hub the `estimate/index.tsx`. The hub renders from a pure, testable entry list (`utils/estimateHubEntries.ts`) using existing premium primitives (`BrandBackdrop`, `Card`, `IconWrapper`). Existing deep links that expected the estimator are repointed to `/full`.

**Tech Stack:** React Native + Expo Router 6 (typed routes), TypeScript (strict), bun test scripts, lucide-react-native icons.

---

## File Structure

- **Create** `utils/estimateHubEntries.ts` — pure data: the hub entry list + types. No RN/lucide imports (must run under Bun).
- **Create** `scripts/validate-estimate-hub.ts` — validates entry integrity + that every route resolves to a real screen file.
- **Rename** `app/(tabs)/estimate/index.tsx` → `app/(tabs)/estimate/full.tsx` — the unchanged Full Estimator (route becomes `/(tabs)/estimate/full`).
- **Create** `app/(tabs)/estimate/index.tsx` — the new hub landing screen.
- **Modify** `app/(tabs)/_layout.tsx` — flip the `estimate` tab from `href: null` to a visible, persona-gated tab.
- **Modify** `app/project-detail.tsx:1607` and `app/(tabs)/materials/index.tsx:265` — repoint estimator navigation to `/(tabs)/estimate/full`.
- **Modify** `package.json` — register `test:estimate-hub` and add it to `ship-check`.

`app/(tabs)/discover/estimate.tsx` re-exports `../../(tabs)/estimate/index`, which now resolves to the hub automatically — **no change needed**, and it correctly makes the Discover "Estimate" row and the DesktopSidebar "Estimate" link land on the hub (verified in Task 6).

---

### Task 1: Pure hub entry list + validator

**Files:**
- Create: `utils/estimateHubEntries.ts`
- Test: `scripts/validate-estimate-hub.ts`

- [ ] **Step 1: Write the pure entry module**

Create `utils/estimateHubEntries.ts`:

```ts
// utils/estimateHubEntries.ts — the Estimate hub's entry list.
//
// Pure data: NO react-native / lucide imports, so scripts/validate-estimate-hub.ts
// can import it under Bun. Icons are referenced by `iconKey` (a string) and
// mapped to lucide components inside the hub SCREEN, keeping this module RN-free.

export type HubGroup = 'create' | 'insights';
export type HubTone = 'accent' | 'success' | 'info' | 'neutral';

export interface HubEntry {
  /** Stable unique id (also the testID suffix). */
  id: string;
  label: string;
  subtitle: string;
  /** Expo-router path. Must resolve to a real screen file (validator enforces). */
  route: string;
  group: HubGroup;
  /** Lucide icon name; the screen maps this to a component. */
  iconKey: string;
  tone: HubTone;
}

export const HUB_ENTRIES: HubEntry[] = [
  // ── Create ──────────────────────────────────────────────────────────────
  { id: 'quick',   label: 'Quick Estimate', subtitle: 'Fast ballpark from a few questions — no plans needed', route: '/estimate-wizard',        group: 'create',   iconKey: 'Calculator', tone: 'accent' },
  { id: 'takeoff', label: 'AI Takeoff',     subtitle: 'Upload plans, get LF / SF / EA quantities',            route: '/takeoff',                group: 'create',   iconKey: 'Ruler',      tone: 'accent' },
  { id: 'visual',  label: 'Visual Takeoff', subtitle: 'Trace areas & lines on plans or photos to quantify',   route: '/area-takeoff',           group: 'create',   iconKey: 'Grid',       tone: 'accent' },
  { id: 'full',    label: 'Full Estimator', subtitle: 'Line items, materials, labor, markup & PDF',           route: '/(tabs)/estimate/full',   group: 'create',   iconKey: 'Layers',     tone: 'accent' },
  // ── Insights ────────────────────────────────────────────────────────────
  { id: 'confidence',  label: 'Estimate Risk',   subtitle: 'Score every line against your cost history',       route: '/estimate-confidence',  group: 'insights', iconKey: 'Gauge',      tone: 'info' },
  { id: 'accuracy',    label: 'Bid vs Actual',   subtitle: 'Per-line variance once the job is done',           route: '/estimate-accuracy',    group: 'insights', iconKey: 'TrendingUp', tone: 'success' },
  { id: 'calibration', label: 'Calibration',     subtitle: 'Cross-job bias correction by category',            route: '/estimate-calibration', group: 'insights', iconKey: 'GitCompare', tone: 'neutral' },
  { id: 'living',      label: 'Living Estimate', subtitle: 'Projected margin at completion, live',             route: '/living-estimate',      group: 'insights', iconKey: 'Activity',   tone: 'neutral' },
];

export const HUB_GROUPS: HubGroup[] = ['create', 'insights'];

export function entriesForGroup(group: HubGroup): HubEntry[] {
  return HUB_ENTRIES.filter(e => e.group === group);
}
```

- [ ] **Step 2: Write the failing validator**

Create `scripts/validate-estimate-hub.ts`:

```ts
// Estimate-hub validation — utils/estimateHubEntries.ts (pure, no RN imports).
//
// Guards: unique ids, non-empty labels/subtitles, valid group, every route
// starts with '/' and resolves to a REAL screen file under app/ (so a renamed
// or deleted estimating screen fails ship-check instead of shipping a dead card).
//
// fileURLToPath + join because the repo path contains a space.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { HUB_ENTRIES, HUB_GROUPS, entriesForGroup } from '@/utils/estimateHubEntries';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

let failed = 0;
let passed = 0;
const assert = (c: boolean, m: string) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.error('  FAIL  ' + m); } };

console.log('\nestimate-hub validation:');

const ids = HUB_ENTRIES.map(e => e.id);
assert(new Set(ids).size === ids.length, 'entry ids are unique');
assert(HUB_ENTRIES.length >= 6, `hub covers the estimating surfaces (found ${HUB_ENTRIES.length})`);
assert(entriesForGroup('create').length >= 3, 'at least 3 create entries');
assert(entriesForGroup('insights').length >= 3, 'at least 3 insights entries');

for (const e of HUB_ENTRIES) {
  assert(e.label.trim().length > 0, `${e.id}: non-empty label`);
  assert(e.subtitle.trim().length > 0, `${e.id}: non-empty subtitle`);
  assert(e.iconKey.trim().length > 0, `${e.id}: non-empty iconKey`);
  assert(HUB_GROUPS.includes(e.group), `${e.id}: group '${e.group}' is valid`);
  assert(e.route.startsWith('/'), `${e.id}: route starts with '/'`);

  // Route must resolve to a real screen file. Expo Router: '/foo' → app/foo.tsx;
  // '/(tabs)/estimate/full' → app/(tabs)/estimate/full.tsx.
  const rel = e.route.replace(/^\//, '');
  const candidates = [
    join(ROOT, 'app', rel + '.tsx'),
    join(ROOT, 'app', rel, 'index.tsx'),
  ];
  assert(candidates.some(existsSync), `${e.id}: route '${e.route}' resolves to a screen file`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 3: Run the validator to verify it FAILS**

Run: `bun run scripts/validate-estimate-hub.ts`
Expected: FAIL — `full: route '/(tabs)/estimate/full' resolves to a screen file` fails, because `app/(tabs)/estimate/full.tsx` does not exist yet (it's created in Task 2). Every other assertion passes.

- [ ] **Step 4: Commit**

```bash
git add utils/estimateHubEntries.ts scripts/validate-estimate-hub.ts
git commit -m "feat(estimate): add pure hub entry list + validator"
```

---

### Task 2: Move the Full Estimator to `/full` and repoint navigation

**Files:**
- Rename: `app/(tabs)/estimate/index.tsx` → `app/(tabs)/estimate/full.tsx`
- Modify: `app/project-detail.tsx:1607`
- Modify: `app/(tabs)/materials/index.tsx:265`

- [ ] **Step 1: Rename the estimator file (preserve history)**

Run:
```bash
git mv "app/(tabs)/estimate/index.tsx" "app/(tabs)/estimate/full.tsx"
```
No code inside changes — the component stays `export default function EstimateScreen()`; only its route path changes to `/(tabs)/estimate/full`.

- [ ] **Step 2: Verify the validator now PASSES**

Run: `bun run scripts/validate-estimate-hub.ts`
Expected: PASS — `N passed, 0 failed` (the `/full` route file now exists).

- [ ] **Step 3: Repoint project-detail's estimator navigation**

In `app/project-detail.tsx`, line ~1607, change the target from the estimate tab (now the hub) to the Full Estimator:

```tsx
// before
onPress={() => router.replace({ pathname: '/(tabs)/estimate', params: { projectId: id ?? '' } } as any)}
// after
onPress={() => router.replace({ pathname: '/(tabs)/estimate/full', params: { projectId: id ?? '' } } as any)}
```

- [ ] **Step 4: Repoint materials' estimator navigation**

In `app/(tabs)/materials/index.tsx`, line ~265, change:

```tsx
// before
router.push('/(tabs)/estimate');
// after
router.push('/(tabs)/estimate/full');
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0, no errors. (Typed routes now include `/(tabs)/estimate/full`.)

- [ ] **Step 6: Commit**

```bash
git add "app/(tabs)/estimate/full.tsx" app/project-detail.tsx "app/(tabs)/materials/index.tsx"
git commit -m "refactor(estimate): move full estimator to /full, repoint deep links"
```

---

### Task 3: Build the hub landing screen

**Files:**
- Create: `app/(tabs)/estimate/index.tsx`

- [ ] **Step 1: Write the hub screen**

Create `app/(tabs)/estimate/index.tsx`:

```tsx
import React, { useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Calculator, Ruler, Grid, Layers, Gauge, TrendingUp, GitCompare, Activity,
  type LucideIcon,
} from 'lucide-react-native';
import { BrandBackdrop } from '@/components/BrandBackdrop';
import { Card } from '@/components/ui/Card';
import { IconWrapper } from '@/components/ui/IconWrapper';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import { HUB_ENTRIES, entriesForGroup, type HubEntry } from '@/utils/estimateHubEntries';

// iconKey → lucide component. Lives in the SCREEN so the entry list stays RN-free.
const ICONS: Record<string, LucideIcon> = {
  Calculator, Ruler, Grid, Layers, Gauge, TrendingUp, GitCompare, Activity,
};

export default function EstimateHubScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const go = useCallback((entry: HubEntry) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    router.push(entry.route as never);
  }, [router]);

  const renderCard = (entry: HubEntry) => {
    const Icon = ICONS[entry.iconKey] ?? Calculator;
    return (
      <Card
        key={entry.id}
        pressable
        onPress={() => go(entry)}
        accessibilityLabel={entry.label}
        testID={`estimate-hub-${entry.id}`}
        style={styles.card}
      >
        <View style={styles.cardRow}>
          <IconWrapper icon={Icon} tone={entry.tone} size="md" />
          <View style={styles.cardText}>
            <Card.Title>{entry.label}</Card.Title>
            <Card.Meta>{entry.subtitle}</Card.Meta>
          </View>
        </View>
      </Card>
    );
  };

  return (
    <View style={styles.root}>
      {/* Branded hero band — BrandBackdrop is always ink+amber regardless of theme. */}
      <View style={[styles.hero, { paddingTop: insets.top + 20 }]}>
        <BrandBackdrop />
        <Text style={styles.heroEyebrow}>ESTIMATING</Text>
        <Text style={styles.heroTitle}>Estimate</Text>
        <Text style={styles.heroSubtitle}>Price the job, then learn from every bid.</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.sectionLabel}>CREATE</Text>
        {entriesForGroup('create').map(renderCard)}

        <Text style={[styles.sectionLabel, { marginTop: 20 }]}>INSIGHTS</Text>
        {entriesForGroup('insights').map(renderCard)}
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.background },
  hero: {
    paddingHorizontal: 20,
    paddingBottom: 22,
    overflow: 'hidden',
  },
  heroEyebrow: {
    color: '#FF8533',
    fontSize: Type.caption2.fontSize,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  heroTitle: {
    color: '#F4EFE6',
    fontSize: Type.title1.fontSize,
    fontWeight: '800',
  },
  heroSubtitle: {
    color: '#C9C3B8',
    fontSize: Type.subhead.fontSize,
    marginTop: 4,
  },
  scroll: { flex: 1 },
  sectionLabel: {
    color: t.textMuted,
    fontSize: Type.caption2.fontSize,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 10,
  },
  card: { marginBottom: 10 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  cardText: { flex: 1 },
});
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0. (Confirms `Card`, `IconWrapper`, `BrandBackdrop`, and every lucide icon name resolve.)

- [ ] **Step 3: Commit**

```bash
git add "app/(tabs)/estimate/index.tsx"
git commit -m "feat(estimate): add branded Estimate hub landing screen"
```

---

### Task 4: Make the Estimate tab visible

**Files:**
- Modify: `app/(tabs)/_layout.tsx`

- [ ] **Step 1: Import the tab icon**

In `app/(tabs)/_layout.tsx`, add `MageEstimate` to the existing icons import (line 6):

```tsx
// before
import { MageProject, MageDiscover, MageSummary } from '@/components/icons';
// after
import { MageProject, MageDiscover, MageSummary, MageEstimate } from '@/components/icons';
```

- [ ] **Step 2: Register the visible tab (mobile tab bar block)**

In the mobile `<Tabs>` render (around line 237), replace the hidden estimate registration:

```tsx
// before
<Tabs.Screen name="estimate" options={{ href: null }} />
// after
<Tabs.Screen
  name="estimate"
  options={isMinimalPersona ? { href: null } : {
    title: 'Estimate',
    tabBarIcon: ({ color, focused }) => (
      <TabIcon Icon={MageEstimate} color={color} focused={focused} />
    ),
  }}
/>
```

This places Estimate after Settings in registration order; expo-router orders tabs by declaration. To sit it between "Your Projects" and "Discover", move this `<Tabs.Screen name="estimate" ...>` block to immediately AFTER the `(home)` block (line ~215) and BEFORE the `discover` block (line ~219). Leave the other hidden `<Tabs.Screen>` lines untouched.

- [ ] **Step 3: Leave the desktop block as-is**

The desktop-sidebar branch (around line 144) hides the tab bar entirely (`tabBarStyle: { display: 'none' }`) and navigates via `DesktopSidebar`, so its `<Tabs.Screen name="estimate" options={{ href: null }} />` can stay. No change there.

- [ ] **Step 4: Typecheck + launch check**

Run: `npx tsc --noEmit`
Expected: exit 0.

Then reload the app (Metro is running). On a contractor persona the bottom tab bar shows: Summary · Your Projects · **Estimate** · Discover · Settings. Tapping Estimate lands on the hub.

- [ ] **Step 5: Commit**

```bash
git add "app/(tabs)/_layout.tsx"
git commit -m "feat(estimate): surface Estimate as a visible persona-gated tab"
```

---

### Task 5: Wire the validator into ship-check

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the test script + ship-check entry**

In `package.json` `scripts`, add:

```json
"test:estimate-hub": "bun run scripts/validate-estimate-hub.ts",
```

Then append ` && bun run test:estimate-hub` to the end of the `ship-check` script string.

- [ ] **Step 2: Run it**

Run: `bun run test:estimate-hub`
Expected: `N passed, 0 failed`, exit 0.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "test(estimate): add estimate-hub validator to ship-check"
```

---

### Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck, lint, validators**

Run:
```bash
npx tsc --noEmit
npx eslint "app/(tabs)/estimate/index.tsx" "app/(tabs)/_layout.tsx" utils/estimateHubEntries.ts
bun run test:estimate-hub && bun run test:feature-search
```
Expected: tsc exit 0; eslint 0 errors; both validators `0 failed`. (`test:feature-search` confirms the `/full` route move didn't break the feature registry / sidebar parity check.)

- [ ] **Step 2: Manual smoke on the running app**

Reload the app and confirm:
1. Contractor persona: Estimate tab visible, between Your Projects and Discover; opens the hub.
2. Every hub card navigates to its screen; **Full Estimator** opens the moved estimator with cart/UI intact.
3. From a project, the "open estimate" action (project-detail) still opens the Full Estimator with the project's context.
4. Discover → "Estimate" and (desktop) the sidebar "Estimate" link both land on the hub.
5. A minimal persona (client / property_manager) does **not** see the Estimate tab.

- [ ] **Step 3: Final commit (if any cleanup was needed)**

```bash
git add -A
git commit -m "chore(estimate): estimate hub verification pass"
```

---

## Self-Review

**Spec coverage (Workstream A section of the design doc):**
- Repurpose hidden `estimate` tab → Task 4. ✓
- Move Full Estimator to `estimate/full` → Task 2. ✓
- New hub landing with Create + Insights card groups on premium primitives → Tasks 1 + 3. ✓
- Persona gating (hidden for minimal personas) → Task 4 (`isMinimalPersona`). ✓
- Repoint entry points (project-detail, materials, discover redirect, sidebar) → Task 2 + verified Task 6. ✓
- Keep all screens; no deletions → only a rename (Task 2). ✓
- `validate-estimate-hub` in ship-check → Task 5. ✓

**Placeholder scan:** No TBD/TODO; every code step contains complete code; commands have expected output.

**Type consistency:** `HubEntry` / `HUB_ENTRIES` / `entriesForGroup` / `HUB_GROUPS` are defined in Task 1 and used identically in Tasks 1 (validator) and 3 (screen). `iconKey` strings in Task 1 all exist in the Task 3 `ICONS` map (`Calculator, Ruler, Grid, Layers, Gauge, TrendingUp, GitCompare, Activity`). `tone` values (`accent | info | success | neutral`) are all valid `IconWrapperTone`s. Route `/(tabs)/estimate/full` created in Task 2 matches the `full` entry's route in Task 1 and the validator's file-resolution.

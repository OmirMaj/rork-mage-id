# MAGE ID — Phase 1.5 Migration Checklist

Generated 2026-05-11 after Phase 1 foundation shipped on the `phase1-foundation` branch.

**190 files** still reference legacy `Colors.primary` / `Colors.background` / `Colors.surface`. The list below is the migration backlog. Each file gets ticked when its `Colors.*` references are swapped for the themed equivalents using the canonical Colors → t mapping documented in `docs/superpowers/plans/2026-05-11-phase-1-design-polish.md` (Task 16 step 3).

## Already migrated in Phase 1 PR 1-6

- [x] `constants/colors.ts` (extended with `Theme`)
- [x] `constants/typography.ts` (Fraunces + Mono tokens added)
- [x] `contexts/ThemeContext.tsx` (created)
- [x] `hooks/useThemedStyles.ts` (created)
- [x] `app/_layout.tsx` (font load + ThemeProvider mount)
- [x] `components/ui/Button.tsx` (created)
- [x] `components/ui/Card.tsx` (created)
- [x] `components/ui/Input.tsx` (created)
- [x] `components/ui/Badge.tsx` (created)
- [x] `components/ui/EyebrowLabel.tsx` (created)
- [x] `components/IconButton.tsx` (legacy primitive themed)
- [x] `components/StatusPill.tsx` (legacy primitive themed)
- [x] `components/NavRow.tsx` (legacy primitive themed)
- [x] `components/Skeleton.tsx` (themed + ListSkeleton added)
- [x] `components/ProjectCard.tsx` (fully themed, uses new primitives)
- [x] `app/(tabs)/(home)/index.tsx` (bg theme-aware; sub-components deferred)
- [x] `app/project-detail.tsx` (bg theme-aware; tile grid deferred)
- [x] `app/onboarding.tsx` (bg theme-aware; slides deferred)
- [x] `app/paywall.tsx` (bg theme-aware + close icon themed)
- [x] `app/(tabs)/settings/appearance.tsx` (created, fully themed)
- [x] `app/(tabs)/settings/index.tsx` (Appearance nav row added)

## Phase 1.5 high-priority — status

- [x] `components/PageHeader.tsx` — fully themed + Fraunces title
- [x] `components/DesktopSidebar.tsx` — brand mark + active pill use accent
- [x] `components/DesktopActionRail.tsx` — fully themed
- [x] `components/EmptyState.tsx` — fully themed + Fraunces title
- [x] `components/ProjectRow.tsx` — fully themed + uses Badge primitive
- [x] `components/AIHomeBriefing.tsx` — outer surface theme-aware (inner deferred)
- [x] `components/SmartInbox.tsx` — outer surface theme-aware (inner deferred)
- [x] `components/OnboardingChecklist.tsx` — outer surface theme-aware (inner deferred)
- [x] `components/FilterChipRow.tsx` — fully themed
- [x] `components/EntityActionSheet.tsx` — fully themed
- [x] `app/(tabs)/_layout.tsx` — tab bar uses accent + theme surface
- [x] `app/(tabs)/discover/index.tsx` — outer container theme-aware
- [x] `app/(tabs)/summary/index.tsx` — outer container theme-aware (all 3 render paths)

## Phase 1.6 — formerly-deferred deep migrations

- [x] `components/AICopilot.tsx` — fully themed (StyleSheet + MessageBubble + PRIORITY_COLORS helper)
- [x] `components/Tutorial.tsx` — chrome themed + Fraunces title; demoStyles deferred (used by factory mockups)
- [x] `app/(tabs)/schedule/index.tsx` — outer containers theme-aware (both render paths); inner Gantt deferred
- [x] `app/(tabs)/settings/index.tsx` body — outer KeyboardAvoidingView theme-aware; inner row groups deferred

## Still in backlog (Phase 1.7+)

- [ ] `components/Tutorial.tsx` demoStyles block — internal tutorial mockups
- [ ] `app/(tabs)/schedule/index.tsx` Gantt chart inner surfaces, project chips, task rows
- [ ] `app/(tabs)/settings/index.tsx` settings row groups, profile hero, signature pad, COMPANY BRANDING section

## Backlog — remaining 170 files

See `/tmp/unmigrated.txt` for the full grep output (regenerate with the command at the bottom of this doc).

Migrate each file using this pattern:

```ts
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';

function MyComponent() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  // ... use colors.accent, colors.text, colors.surface, etc.
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { backgroundColor: t.bg },
  // ...
});
```

Canonical Colors → t mapping is in the parent plan doc Task 16 step 3.

## Regenerate this list

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE" && \
  grep -rl "Colors\.primary\|Colors\.background\|Colors\.surface" app/ components/ \
  | grep -v node_modules \
  | sort > /tmp/unmigrated.txt && wc -l /tmp/unmigrated.txt
```

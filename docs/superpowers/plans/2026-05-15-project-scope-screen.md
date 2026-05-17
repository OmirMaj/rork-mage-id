# Project Scope Screen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a free, project-linked Scope screen whose answers persist on the project and auto-prefill the (project-aware) Estimate Wizard so a rough AI estimate needs zero re-entry — while keeping the standalone quick-estimate flow untouched.

**Architecture:** Extract the wizard's question data + step-stepper UI into shared units (`utils/scopeQuestions.ts` + `components/ScopeQuestionStepper.tsx`). A new thin screen `app/project-scope.tsx` reuses the stepper to capture + save `project.scope`. `estimate-wizard.tsx` is refactored to consume the same shared units and gains optional project-awareness (prefill from scope, link result back, AI returns rough estimate + `refineWith`). NextStepHero + project-detail are repointed.

**Tech Stack:** React Native / Expo Router (typed routes), TypeScript strict, zustand/React-Query/context (existing `useProjects`), Supabase (offline queue), `mageAISmart` + zod schema. **No unit-test framework is wired in this repo** — verification for every task = `npx tsc --noEmit` clean + the explicit manual walkthrough given in that task.

**Spec:** `docs/superpowers/specs/2026-05-15-project-scope-screen-design.md`

**Established facts (verified against repo + live DB 2026-05-15):**
- `public.projects` has `description text`, `estimate jsonb`, `linked_estimate jsonb`, but **NO `scope` column** → migration is required.
- `contexts/ProjectContext.tsx` `syncProjectToSupabase` (~lines 946-965) enumerates explicit columns in its upsert payload; new fields do NOT sync unless added there. The Supabase→Project read mapping is near `contexts/ProjectContext.tsx:139`.
- `estimate-wizard.tsx` today: `WizardAnswers` (interface, ~l.53), `PROJECT_TYPES` (~l.64), `QUALITY_LABELS` (~l.77), `estimateSchema` (~l.83), `INITIAL` (~l.102), `EstimateWizardScreenInner` (~l.129), `canAdvance` switch (~l.149), `generate` prompt (~l.191), step JSX `{step === N && <StepCard …>}` for steps 0-7 (~l.611-760), `StepCard` is a local presentational component.
- `expo-router` auto-discovers `app/*.tsx`; route screens are also declared as `<Stack.Screen>` in `app/_layout.tsx`.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `types/index.ts` | `ProjectScope` interface; `Project.scope?` | Modify |
| `supabase/migrations/20260515100000_add_scope_to_projects.sql` | `projects.scope jsonb` column | Create |
| `contexts/ProjectContext.tsx` | Persist + load `scope` (sync payload + read map) | Modify |
| `utils/scopeQuestions.ts` | Shared: `WizardAnswers`, `INITIAL_SCOPE`, `PROJECT_TYPES`, `QUALITY_LABELS`, `SCOPE_STEPS` meta, `stepCanAdvance`, `buildEstimatePrompt`, `estimateSchema` (+`refineWith`) | Create |
| `components/ScopeQuestionStepper.tsx` | Controlled stepper UI: renders one step's card+input for given answers; Back/Next/Skip; reused by both screens | Create (code moved from wizard) |
| `app/project-scope.tsx` | Free screen: stepper → `updateProject(id,{scope})`; no AI; no paywall | Create |
| `app/estimate-wizard.tsx` | Consume shared units; optional `projectId` prefill + link-back + rough/`refineWith` | Modify |
| `components/NextStepHero.tsx` | href #4→`/project-scope`, #5→`/estimate-wizard?projectId`; has-scope predicate | Modify |
| `app/project-detail.tsx` | Remove `scopeFocusMode`/`edit=scope` hack; "no estimate" btn → project-aware wizard | Modify |
| `app/_layout.tsx` | Register `project-scope` Stack.Screen | Modify |

---

## Task 1: Data model + persistence + migration

**Files:**
- Modify: `types/index.ts` (Project interface + new `ProjectScope`)
- Create: `supabase/migrations/20260515100000_add_scope_to_projects.sql`
- Modify: `contexts/ProjectContext.tsx` (sync payload ~l.946-965; read map ~l.139)

- [ ] **Step 1: Add `ProjectScope` + `Project.scope?` to `types/index.ts`**

Find `export interface Project {` and add `scope?: ProjectScope;` immediately after the `description: string;` line. Then add this interface directly above `export interface Project {`:

```ts
/**
 * Structured scope captured on the free Project Scope screen
 * (app/project-scope.tsx). Mirrors the Estimate Wizard's answer shape
 * exactly so it round-trips into the wizard with zero translation.
 * Independent of the legacy type/squareFootage/quality/targetBudget
 * fields (different shapes, set at creation) — do NOT sync the two.
 */
export interface ProjectScope {
  projectType: string;
  sizeSqft: string;
  location: string;
  quality: 'budget' | 'standard' | 'high_end';
  scope: string;
  timelineWeeks: string;
  specialRequirements: string;
  targetBudget: string;
  updatedAt: string;
}
```

- [ ] **Step 2: Create the migration**

Create `supabase/migrations/20260515100000_add_scope_to_projects.sql`:

```sql
-- 20260515100000_add_scope_to_projects.sql
-- Structured project scope captured on the free Project Scope screen.
-- jsonb (not separate columns) so it round-trips 1:1 with the
-- ProjectScope TS interface and the Estimate Wizard answers. Nullable;
-- existing rows keep NULL until the GC fills scope.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS scope jsonb;
```

- [ ] **Step 3: Apply the migration to the live DB**

Apply via the Supabase MCP `apply_migration` (name `add_scope_to_projects`, the SQL above). Then verify:

Run (MCP `execute_sql`): `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='projects' AND column_name='scope';`
Expected: one row, `scope`.

- [ ] **Step 4: Add `scope` to the Supabase upsert payload**

In `contexts/ProjectContext.tsx`, inside `syncProjectToSupabase`'s upsert object (the `supabaseWrite('projects', 'insert', { … })` payload, ~l.946-965), add this line next to `description: project.description,`:

```ts
          scope: (project.scope ?? null) as unknown,
```

- [ ] **Step 5: Map `scope` back on the Supabase→Project read**

In `contexts/ProjectContext.tsx` near l.139 (the object that maps a fetched DB row `r`/`data` into a `Project` — it has lines like `description: ...`, `client_portal: r.client_portal as Project['clientPortal']`), add:

```ts
              scope: (r.scope ?? undefined) as Project['scope'],
```

Use the exact same row-variable name already used by the surrounding mapped fields in that block (`r` or `data`). If projects are mapped in more than one place (e.g. an initial-load map AND a realtime/refetch map), add the line to every such map — grep `client_portal: ` in the file to find them all.

- [ ] **Step 6: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors mentioning `types/index.ts`, `ProjectContext.tsx`, or `ProjectScope`.

- [ ] **Step 7: Commit**

```bash
git add types/index.ts supabase/migrations/20260515100000_add_scope_to_projects.sql "contexts/ProjectContext.tsx"
git commit -m "feat(scope): ProjectScope data model + jsonb column + sync plumbing"
```

---

## Task 2: Shared question module `utils/scopeQuestions.ts`

**Files:**
- Create: `utils/scopeQuestions.ts`

This becomes the single source of truth for the wizard/scope question set. It re-homes `WizardAnswers`, `PROJECT_TYPES`, `QUALITY_LABELS`, `estimateSchema`, `INITIAL`, the per-step validation, and the prompt builder, and adds step metadata + `refineWith`.

- [ ] **Step 1: Create `utils/scopeQuestions.ts`**

```ts
// utils/scopeQuestions.ts
//
// Single source of truth for the project-scope / estimate-wizard
// question set. Both app/project-scope.tsx (free capture) and
// app/estimate-wizard.tsx (AI generation) import from here so the two
// screens cannot drift. ProjectScope (types/index.ts) mirrors
// WizardAnswers exactly + an updatedAt stamp.

import { z } from 'zod';

export interface WizardAnswers {
  projectType: string;
  sizeSqft: string;
  location: string;
  quality: 'budget' | 'standard' | 'high_end';
  scope: string;
  timelineWeeks: string;
  specialRequirements: string;
  targetBudget: string;
}

export const INITIAL_SCOPE: WizardAnswers = {
  projectType: '',
  sizeSqft: '',
  location: '',
  quality: 'standard',
  scope: '',
  timelineWeeks: '',
  specialRequirements: '',
  targetBudget: '',
};

export const PROJECT_TYPES = [
  'New Build',
  'Full Remodel',
  'Kitchen Remodel',
  'Bathroom Remodel',
  'Addition',
  'Basement Finish',
  'ADU / Backyard Build',
  'Commercial TI',
  'Roof Replacement',
  'Deck / Outdoor',
] as const;

export const QUALITY_LABELS: Record<WizardAnswers['quality'], string> = {
  budget: 'Budget',
  standard: 'Standard',
  high_end: 'High-End',
};

/** Step metadata. iconKey is resolved to a Lucide icon in the stepper
 *  component (keeps this module icon-library-free). kind drives which
 *  input the stepper renders. */
export type ScopeStepKind = 'chips' | 'qualityChips' | 'numeric' | 'text' | 'textarea';
export interface ScopeStep {
  key: keyof WizardAnswers;
  title: string;
  subtitle: string;
  iconKey: 'building' | 'home' | 'sparkles' | 'wrench';
  kind: ScopeStepKind;
  placeholder?: string;
  optional: boolean;
}

export const SCOPE_STEPS: ScopeStep[] = [
  { key: 'projectType', title: 'What kind of project?', subtitle: "Pick the closest match — we'll refine in the next steps.", iconKey: 'building', kind: 'chips', optional: false },
  { key: 'sizeSqft', title: 'How big is the project?', subtitle: 'Approximate square footage of the work area.', iconKey: 'home', kind: 'numeric', placeholder: 'e.g. 1500', optional: false },
  { key: 'location', title: "Where's the job?", subtitle: 'City and state — we use this for regional pricing.', iconKey: 'building', kind: 'text', placeholder: 'e.g. Austin, TX', optional: false },
  { key: 'quality', title: 'What quality tier?', subtitle: 'Drives material selection and labor assumptions.', iconKey: 'sparkles', kind: 'qualityChips', optional: false },
  { key: 'scope', title: "What's the scope?", subtitle: "A few sentences on what you're actually building.", iconKey: 'wrench', kind: 'textarea', placeholder: 'e.g. Gut kitchen, new cabinets and quartz counters, move the sink wall, add island with seating, replace floors.', optional: false },
  { key: 'timelineWeeks', title: "What's the timeline?", subtitle: 'Expected duration in weeks.', iconKey: 'building', kind: 'numeric', placeholder: 'e.g. 8', optional: false },
  { key: 'specialRequirements', title: 'Any special requirements?', subtitle: 'Permits, HOA, historic, accessibility, etc. Optional.', iconKey: 'wrench', kind: 'textarea', placeholder: 'e.g. Historic district review, ADA bathroom.', optional: true },
  { key: 'targetBudget', title: 'Target budget?', subtitle: 'Optional — helps the AI sanity-check the estimate.', iconKey: 'sparkles', kind: 'text', placeholder: 'e.g. $80,000', optional: true },
];

export const TOTAL_SCOPE_STEPS = SCOPE_STEPS.length;

/** Per-step "can advance" validation. Mirrors the wizard's original
 *  canAdvance switch exactly (steps 0-7). Optional steps always pass. */
export function stepCanAdvance(stepIndex: number, a: WizardAnswers): boolean {
  switch (stepIndex) {
    case 0: return a.projectType.length > 0;
    case 1: return a.sizeSqft.trim().length > 0 && !isNaN(Number(a.sizeSqft));
    case 2: return a.location.trim().length > 0;
    case 3: return true;
    case 4: return a.scope.trim().length > 10;
    case 5: return a.timelineWeeks.trim().length > 0 && !isNaN(Number(a.timelineWeeks));
    case 6: return true;
    case 7: return true;
    default: return false;
  }
}

export const estimateSchema = z.object({
  summary: z.string().catch('').default(''),
  lineItems: z.array(z.object({
    category: z.string().catch('Other').default('Other'),
    description: z.string().catch('').default(''),
    quantity: z.number().catch(1).default(1),
    unit: z.string().catch('ea').default('ea'),
    unitCost: z.number().catch(0).default(0),
    total: z.number().catch(0).default(0),
  })).default([]),
  subtotal: z.number().catch(0).default(0),
  contingency: z.number().catch(0).default(0),
  permits: z.number().catch(0).default(0),
  total: z.number().catch(0).default(0),
  notes: z.array(z.string()).default([]),
  // NEW: the specific missing inputs that would most sharpen this
  // estimate. Empty when scope was complete. Back-compatible default.
  refineWith: z.array(z.string()).default([]),
});
export type EstimateResult = z.infer<typeof estimateSchema>;

export function buildEstimatePrompt(a: WizardAnswers): string {
  return `You are a construction cost estimator producing a quick first-pass budget for a US contractor. Use the inputs and return a JSON object with an itemized line-by-line estimate.

Inputs:
- Project type: ${a.projectType || '(not provided)'}
- Size: ${a.sizeSqft || '(not provided)'} sqft
- Location: ${a.location || '(not provided)'}
- Quality tier: ${QUALITY_LABELS[a.quality]}
- Scope: ${a.scope || '(not provided)'}
- Timeline: ${a.timelineWeeks || '(not provided)'} weeks
- Special requirements: ${a.specialRequirements || 'None'}
- Target budget: ${a.targetBudget || 'Not specified'}

ALWAYS return a usable ROUGH estimate even if some inputs are missing —
make clearly-labeled assumptions for anything not provided; never refuse.

Return JSON with:
- summary: one paragraph plain-English overview
- lineItems: array of { category, description, quantity, unit, unitCost, total } (total = quantity * unitCost)
- subtotal: sum of all lineItems totals
- contingency: ~10% of subtotal
- permits: rough permit/fees estimate for the location
- total: subtotal + contingency + permits
- notes: array of caveats (e.g. "assumes standard finishes")
- refineWith: array of SHORT strings naming the specific missing inputs
  that would most improve accuracy (e.g. "exact square footage",
  "finish level for the primary bath"). Empty array if inputs were
  sufficient. Max 5 items.

Use current regional pricing where possible. Round reasonably. Keep it under 15 line items.`;
}

export function scopeCacheKey(a: WizardAnswers): string {
  return `wizard::${a.projectType}::${a.sizeSqft}::${a.location}::${a.quality}::${a.scope.slice(0, 80)}`;
}
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors in `utils/scopeQuestions.ts`. (`estimate-wizard.tsx` will still type-check because it keeps its own local copies until Task 4 — that's fine.)

- [ ] **Step 3: Commit**

```bash
git add utils/scopeQuestions.ts
git commit -m "feat(scope): shared question module (data, steps, prompt, schema+refineWith)"
```

---

## Task 3: Extract `components/ScopeQuestionStepper.tsx` from the wizard

**Files:**
- Create: `components/ScopeQuestionStepper.tsx`
- Read-only reference: `app/estimate-wizard.tsx` (the `StepCard` component + step 0-7 JSX + the `makeStyles` entries used by them: `chipWrap`, `chip`, `chipActive`, `chipText`, `chipTextActive`, `input`, `hint`, `textArea`, plus whatever `StepCard` uses).

Goal: a controlled, presentational stepper that renders exactly the wizard's existing per-step card+input UI for one step, driven by `SCOPE_STEPS`. Both screens render `<ScopeQuestionStepper stepIndex answers onChange />`. **This task MOVES working UI; do not re-author it from imagination — copy the existing JSX/styles/`StepCard` verbatim and parameterize.**

- [ ] **Step 1: Read the source UI**

Open `app/estimate-wizard.tsx`. Copy out, verbatim: (a) the `StepCard` component definition; (b) the JSX bodies inside each `{step === 0 …}` … `{step === 7 …}` block (the `<StepCard>…</StepCard>` contents); (c) every `makeStyles` style key referenced by those blocks and by `StepCard`.

- [ ] **Step 2: Create `components/ScopeQuestionStepper.tsx`**

Create the component with this exact contract, pasting the copied `StepCard` + per-step input JSX into the `renderInput` switch (keyed by `SCOPE_STEPS[stepIndex].kind`), and pasting the copied style keys into its own `makeStyles`:

```tsx
// components/ScopeQuestionStepper.tsx
//
// Presentational, controlled single-step renderer shared by
// app/project-scope.tsx (free capture) and app/estimate-wizard.tsx
// (AI generation). Renders ONE step (card + input) for the given
// answers. Parent owns step index, Back/Next/Skip, and persistence.
// UI is the wizard's original step UI, moved here verbatim so the two
// screens are pixel-identical by construction.

import React from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Building2, Home, Sparkles, Wrench } from 'lucide-react-native';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import {
  SCOPE_STEPS, PROJECT_TYPES, QUALITY_LABELS,
  type WizardAnswers,
} from '@/utils/scopeQuestions';

const ICONS = { building: Building2, home: Home, sparkles: Sparkles, wrench: Wrench };

export interface ScopeQuestionStepperProps {
  stepIndex: number;
  answers: WizardAnswers;
  onChange: <K extends keyof WizardAnswers>(key: K, value: WizardAnswers[K]) => void;
  testIDPrefix?: string;
}

export function ScopeQuestionStepper({ stepIndex, answers, onChange, testIDPrefix = 'scope' }: ScopeQuestionStepperProps) {
  const { colors: c } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const step = SCOPE_STEPS[stepIndex];
  if (!step) return null;
  const Icon = ICONS[step.iconKey];

  // ---- PASTE: the wizard's StepCard component body here, renamed to a
  // local `Card`, OR import it if you exported it. It wraps icon+title+
  // subtitle+children. Keep its markup identical. ----
  const Card = ({ children }: { children: React.ReactNode }) => (
    <View style={styles.stepCard}>
      <View style={styles.stepIconWrap}>
        <Icon size={28} color={c.accent} />
      </View>
      <Text style={styles.stepTitle}>{step.title}</Text>
      <Text style={styles.stepSubtitle}>{step.subtitle}</Text>
      <View style={{ marginTop: 16 }}>{children}</View>
    </View>
  );

  const renderInput = () => {
    switch (step.kind) {
      case 'chips':
        return (
          <View style={styles.chipWrap}>
            {PROJECT_TYPES.map((t) => {
              const active = answers.projectType === t;
              return (
                <TouchableOpacity
                  key={t}
                  onPress={() => onChange('projectType', t)}
                  style={[styles.chip, active && styles.chipActive]}
                  activeOpacity={0.8}
                  testID={`${testIDPrefix}-type-${t}`}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{t}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        );
      case 'qualityChips':
        return (
          <View style={styles.chipWrap}>
            {(['budget', 'standard', 'high_end'] as const).map((q) => {
              const active = answers.quality === q;
              return (
                <TouchableOpacity
                  key={q}
                  onPress={() => onChange('quality', q)}
                  style={[styles.chip, active && styles.chipActive]}
                  activeOpacity={0.8}
                  testID={`${testIDPrefix}-quality-${q}`}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{QUALITY_LABELS[q]}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        );
      case 'numeric':
        return (
          <TextInput
            value={String(answers[step.key] ?? '')}
            onChangeText={(v) => onChange(step.key, v.replace(/[^0-9.]/g, '') as WizardAnswers[typeof step.key])}
            placeholder={step.placeholder}
            placeholderTextColor={c.textMuted}
            keyboardType="numeric"
            style={styles.input}
            testID={`${testIDPrefix}-${step.key}`}
          />
        );
      case 'text':
        return (
          <TextInput
            value={String(answers[step.key] ?? '')}
            onChangeText={(v) => onChange(step.key, v as WizardAnswers[typeof step.key])}
            placeholder={step.placeholder}
            placeholderTextColor={c.textMuted}
            style={styles.input}
            testID={`${testIDPrefix}-${step.key}`}
          />
        );
      case 'textarea':
        return (
          <TextInput
            value={String(answers[step.key] ?? '')}
            onChangeText={(v) => onChange(step.key, v as WizardAnswers[typeof step.key])}
            placeholder={step.placeholder}
            placeholderTextColor={c.textMuted}
            multiline
            numberOfLines={5}
            textAlignVertical="top"
            style={styles.textArea}
            testID={`${testIDPrefix}-${step.key}`}
          />
        );
      default:
        return null;
    }
  };

  return <Card>{renderInput()}</Card>;
}

// PASTE the wizard's relevant makeStyles entries here verbatim
// (stepCard, stepIconWrap, stepTitle, stepSubtitle, chipWrap, chip,
//  chipActive, chipText, chipTextActive, input, hint, textArea).
// If the wizard's StepCard used different style names, keep those names
// and update the Card markup above to match exactly.
const makeStyles = (c: ThemeColors) => StyleSheet.create({
  stepCard: { /* paste from wizard */ } as any,
  stepIconWrap: { /* paste from wizard */ } as any,
  stepTitle: { /* paste from wizard */ } as any,
  stepSubtitle: { /* paste from wizard */ } as any,
  chipWrap: { /* paste from wizard */ } as any,
  chip: { /* paste from wizard */ } as any,
  chipActive: { /* paste from wizard */ } as any,
  chipText: { /* paste from wizard */ } as any,
  chipTextActive: { /* paste from wizard */ } as any,
  input: { /* paste from wizard */ } as any,
  textArea: { /* paste from wizard */ } as any,
});
```

> NOTE: the `{ /* paste from wizard */ } as any` placeholders MUST be replaced with the verbatim style objects copied in Step 1. `as any` is only a transient scaffold so the file type-checks before paste; the executing engineer replaces each with the real `StyleSheet`-typed object and removes `as any`. Do not leave `as any` in the committed file.

- [ ] **Step 3: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors in `components/ScopeQuestionStepper.tsx` (after styles pasted and `as any` removed).

- [ ] **Step 4: Commit**

```bash
git add "components/ScopeQuestionStepper.tsx"
git commit -m "feat(scope): shared ScopeQuestionStepper (wizard step UI extracted, verbatim)"
```

---

## Task 4: New free screen `app/project-scope.tsx` + route registration

**Files:**
- Create: `app/project-scope.tsx`
- Modify: `app/_layout.tsx` (add `<Stack.Screen name="project-scope" />`)

- [ ] **Step 1: Create `app/project-scope.tsx`**

```tsx
// app/project-scope.tsx
//
// Free, project-linked scope capture. Guided stepper (shared with the
// Estimate Wizard via ScopeQuestionStepper + scopeQuestions). Saves
// project.scope; runs NO AI and is NOT paywalled — capture is free, the
// Pro gate lives on AI generation in estimate-wizard.tsx. Reached from
// NextStepHero "Add scope now" (/project-scope?id=<projectId>).

import React, { useCallback, useMemo, useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { ChevronLeft, ChevronRight, Check } from 'lucide-react-native';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { Type } from '@/constants/typography';
import { ScopeQuestionStepper } from '@/components/ScopeQuestionStepper';
import {
  INITIAL_SCOPE, TOTAL_SCOPE_STEPS, SCOPE_STEPS, stepCanAdvance,
  type WizardAnswers,
} from '@/utils/scopeQuestions';

export default function ProjectScopeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getProject, updateProject } = useProjects();

  const project = useMemo(() => getProject(id ?? ''), [id, getProject]);

  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<WizardAnswers>(INITIAL_SCOPE);

  // Resume / edit: hydrate from saved scope on mount.
  useEffect(() => {
    if (project?.scope) {
      const { updatedAt, ...rest } = project.scope;
      void updatedAt;
      setAnswers({ ...INITIAL_SCOPE, ...rest });
    }
  }, [project?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const onChange = useCallback(<K extends keyof WizardAnswers>(key: K, value: WizardAnswers[K]) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  }, []);

  const persist = useCallback((a: WizardAnswers) => {
    if (!id) return;
    updateProject(id, { scope: { ...a, updatedAt: new Date().toISOString() } });
  }, [id, updateProject]);

  const isLast = step === TOTAL_SCOPE_STEPS - 1;
  const canAdvance = stepCanAdvance(step, answers);
  const stepMeta = SCOPE_STEPS[step];

  const goNext = useCallback(() => {
    if (!canAdvance) return;
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (isLast) {
      persist(answers);
      router.back();
      return;
    }
    setStep((s) => Math.min(TOTAL_SCOPE_STEPS - 1, s + 1));
  }, [canAdvance, isLast, answers, persist, router]);

  const goBack = useCallback(() => {
    if (step === 0) { router.back(); return; }
    setStep((s) => Math.max(0, s - 1));
  }, [step, router]);

  // Skip: save whatever's filled so far (partial), exit. NextStepHero
  // keeps prompting until the free-text scope field is non-empty.
  const skip = useCallback(() => {
    persist(answers);
    router.back();
  }, [answers, persist, router]);

  if (!project) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + 40 }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={styles.missingTitle}>Project not found</Text>
        <Text style={styles.missingBody}>It may have been deleted. Go back and pick a project.</Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={() => router.back()}>
          <Text style={styles.primaryBtnText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack} hitSlop={12} testID="scope-back" accessibilityRole="button" accessibilityLabel="Back">
            <ChevronLeft size={24} color={c.text} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>PROJECT SCOPE</Text>
            <Text style={styles.projName} numberOfLines={1}>{project.name}</Text>
          </View>
          <TouchableOpacity onPress={skip} hitSlop={12} testID="scope-skip" accessibilityRole="button" accessibilityLabel="Skip for now">
            <Text style={styles.skipText}>Skip for now</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.progressWrap}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${((step + 1) / TOTAL_SCOPE_STEPS) * 100}%` }]} />
          </View>
          <Text style={styles.progressLabel}>
            Step {step + 1} of {TOTAL_SCOPE_STEPS}{stepMeta?.optional ? ' · optional' : ''}
          </Text>
        </View>

        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: 140 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <ScopeQuestionStepper stepIndex={step} answers={answers} onChange={onChange} testIDPrefix="scope" />
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          <TouchableOpacity
            style={[styles.nextBtn, !canAdvance && styles.nextBtnDisabled]}
            onPress={goNext}
            disabled={!canAdvance}
            activeOpacity={0.85}
            testID="scope-next"
          >
            {isLast ? <Check size={18} color="#FFF" /> : <ChevronRight size={18} color="#FFF" />}
            <Text style={styles.nextBtnText}>{isLast ? 'Save scope' : 'Next'}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  header: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
  eyebrow: { ...Type.caption2, fontWeight: '800' as const, color: c.accent, letterSpacing: 0.8 },
  projName: { ...Type.subhead, fontWeight: '700' as const, color: c.text },
  skipText: { ...Type.footnote, color: c.textSecondary, fontWeight: '600' as const },
  progressWrap: { paddingHorizontal: 20, paddingVertical: 8, gap: 6 },
  progressTrack: { height: 4, borderRadius: 2, backgroundColor: c.line, overflow: 'hidden' as const },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: c.accent },
  progressLabel: { ...Type.caption1, color: c.textMuted },
  footer: { paddingHorizontal: 20, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line, backgroundColor: c.bg },
  nextBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8, backgroundColor: c.accent, borderRadius: 14, paddingVertical: 16 },
  nextBtnDisabled: { opacity: 0.4 },
  nextBtnText: { ...Type.bodyEmphasized, color: '#FFF' },
  missingTitle: { ...Type.title3, color: c.text, textAlign: 'center' as const, marginBottom: 6 },
  missingBody: { ...Type.body, color: c.textSecondary, textAlign: 'center' as const, paddingHorizontal: 32, marginBottom: 20 },
  primaryBtn: { alignSelf: 'center' as const, backgroundColor: c.accent, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 },
  primaryBtnText: { ...Type.bodyEmphasized, color: '#FFF' },
});
```

> If `Type` keys (`caption2`, `subhead`, `footnote`, `caption1`, `bodyEmphasized`, `title3`, `body`) differ in `constants/typography.ts`, substitute the nearest existing key (grep `constants/typography.ts`). Do not invent keys — this exact class of bug occurred earlier in the project; verify each `Type.x` exists.

- [ ] **Step 2: Register the route in `app/_layout.tsx`**

Find the block of `<Stack.Screen name="…" />` declarations. Add, following the surrounding style (most are `options={{ headerShown: false }}` or `presentation`):

```tsx
        <Stack.Screen name="project-scope" options={{ headerShown: false }} />
```

- [ ] **Step 3: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors in `app/project-scope.tsx` or `app/_layout.tsx`.

- [ ] **Step 4: Manual verification**

Start the app (`bun run start`). Deep-link or navigate to `/project-scope?id=<a real project id>`. Expected: header with project name + "Skip for now"; progress "Step 1 of 8"; the project-type chips render (identical to the wizard's step 1); Next disabled until a type is picked; stepping through all 8 works; "Save scope" on the last step returns to the project. Reopen the screen for the same project → fields are pre-hydrated from the saved scope. "Skip for now" mid-flow returns and still persists partial answers.

- [ ] **Step 5: Commit**

```bash
git add "app/project-scope.tsx" "app/_layout.tsx"
git commit -m "feat(scope): free Project Scope screen + route"
```

---

## Task 5: Make the wizard consume shared units + project-aware + rough/refineWith

**Files:**
- Modify: `app/estimate-wizard.tsx`

- [ ] **Step 1: Replace local copies with shared imports**

In `app/estimate-wizard.tsx`:
- Delete the local `WizardAnswers` interface, `PROJECT_TYPES`, `QUALITY_LABELS`, `estimateSchema`, `EstimateResult` type, and `INITIAL` const.
- Add: `import { INITIAL_SCOPE, TOTAL_SCOPE_STEPS, stepCanAdvance, buildEstimatePrompt, scopeCacheKey, estimateSchema, type WizardAnswers, type EstimateResult } from '@/utils/scopeQuestions';`
- Replace `useState<WizardAnswers>(INITIAL)` → `useState<WizardAnswers>(INITIAL_SCOPE)`.
- Replace the `TOTAL_STEPS = 8` const with `const TOTAL_STEPS = TOTAL_SCOPE_STEPS;`
- Replace the entire `canAdvance` `useMemo`'s switch body with: `return stepCanAdvance(step, answers);` (keep the `useMemo(() => …, [step, answers])` wrapper).
- In `generate`, replace the inline `const prompt = \`…\`;` with `const prompt = buildEstimatePrompt(answers);` and the inline `const cacheKey = \`wizard::…\`;` with `const cacheKey = scopeCacheKey(answers);`.

- [ ] **Step 2: Replace the inline step JSX with the shared stepper**

Replace the entire `{step === 0 && (…)}` … `{step === 7 && (…)}` block (inside the `<ScrollView>`), and delete the now-unused local `StepCard` component, with:

```tsx
          <ScopeQuestionStepper stepIndex={step} answers={answers} onChange={set} testIDPrefix="wizard" />
```

Add the import: `import { ScopeQuestionStepper } from '@/components/ScopeQuestionStepper';`. Remove any now-unused imports (`Building2`, `Home`, `Wrench`, etc. if only the deleted JSX used them — let `npx tsc`/eslint flag unused).

- [ ] **Step 3: Add projectId param + prefill from saved scope**

Near the other `useLocalSearchParams`/hooks in `EstimateWizardScreenInner`, add:

```tsx
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  const { getProject, updateProject } = useProjects(); // extend the existing useProjects() destructure; do not add a second call
  const scopedProject = useMemo(() => (projectId ? getProject(projectId) : undefined), [projectId, getProject]);

  useEffect(() => {
    if (scopedProject?.scope) {
      const { updatedAt, ...rest } = scopedProject.scope;
      void updatedAt;
      setAnswers({ ...INITIAL_SCOPE, ...rest });
    }
  }, [scopedProject?.id]); // eslint-disable-line react-hooks/exhaustive-deps
```

(The file already calls `useProjects()` for `settings`; add `getProject, updateProject` to that existing destructure rather than calling the hook twice.)

- [ ] **Step 4: Link the generated estimate back to the project**

This is the riskiest integration point (spec §7). After `setResult(res.data as EstimateResult);` succeeds in `generate`, add:

```tsx
        if (projectId) {
          const r = res.data as EstimateResult;
          // Map estimateSchema → the LinkedEstimate shape the rest of the
          // app reads from project.linkedEstimate. One AI line item →
          // one LinkedEstimateItem; roll contingency+permits into totals.
          const items = r.lineItems.map((li, i) => ({
            id: `wiz-${Date.now()}-${i}`,
            description: li.description || li.category,
            category: li.category,
            quantity: li.quantity || 1,
            unit: li.unit || 'ea',
            unitCost: li.unitCost || 0,
            lineTotal: li.total || (li.quantity || 1) * (li.unitCost || 0),
          }));
          const baseTotal = r.subtotal || items.reduce((s, it) => s + it.lineTotal, 0);
          const grandTotal = r.total || baseTotal + (r.contingency || 0) + (r.permits || 0);
          updateProject(projectId, {
            linkedEstimate: {
              items,
              baseTotal,
              markupTotal: (r.contingency || 0) + (r.permits || 0),
              grandTotal,
              globalMarkup: 0,
              notes: [...(r.notes ?? []), ...(r.refineWith?.length ? [`Refine with: ${r.refineWith.join(', ')}`] : [])].join(' · '),
              source: 'ai_wizard',
              updatedAt: new Date().toISOString(),
            } as unknown as NonNullable<ReturnType<typeof getProject>>['linkedEstimate'],
          });
        }
```

> Before writing this, open `types/index.ts`, find the `LinkedEstimate` / `LinkedEstimateItem` interfaces, and adjust the object above to match their EXACT property names and required fields (the names above are the documented shape but MUST be reconciled with the real interface — `LinkedEstimateItem` in this repo uses `materialId`, `name`, `unitPrice`, `bulkPrice`, `markup`, `usesBulk`, `supplier`, `lineTotal` per `utils/estimateAssemblies.ts`). Mirror `utils/estimateAssemblies.ts`'s `applyAssembly` mapping for the item shape; only the source data differs. Remove the `as unknown as …` cast once the real type lines up. This step is not done until the object is type-correct against the real `LinkedEstimate` interface with no `as unknown`.

- [ ] **Step 5: Surface `refineWith` in the result UI**

In the result render (where `result.notes` / summary are shown, ~l.388), add directly under the summary block:

```tsx
          {result.refineWith && result.refineWith.length > 0 && (
            <View style={styles.refineCard}>
              <Text style={styles.refineTitle}>Add these for a sharper number</Text>
              {result.refineWith.map((rfn, i) => (
                <Text key={i} style={styles.refineItem}>• {rfn}</Text>
              ))}
            </View>
          )}
```

Add to the wizard's `makeStyles`:

```tsx
  refineCard: { backgroundColor: themeColors.accent + '12', borderRadius: 12, padding: 14, marginTop: 12, gap: 4 },
  refineTitle: { fontSize: Type.footnote.fontSize, fontWeight: '800' as const, color: themeColors.accent },
  refineItem: { fontSize: Type.footnote.fontSize, color: themeColors.text, lineHeight: 19 },
```

(Use the wizard file's existing themed-styles variable name — it may be `themeColors` or `c`; match the file.)

- [ ] **Step 6: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors. Confirm no leftover `as unknown as` in the Task 5 Step 4 block.

- [ ] **Step 7: Manual verification**

`bun run start`.
(a) Open the wizard with NO projectId (Discover → Quick Estimate Wizard): all 8 steps render identically to before, generate works, PDF/email works — standalone path unchanged.
(b) Open `/estimate-wizard?projectId=<id of a project that has saved scope>`: all 8 questions are pre-answered from scope; tap Generate → estimate renders; "Add these for a sharper number" shows when scope had blanks; reopen the project → it now has a linked estimate (margin pill / estimate tile populated, not blank).
(c) Free user with projectId: prefilled wizard renders; Generate triggers the Pro Paywall (gate intact); scope already saved (free).

- [ ] **Step 8: Commit**

```bash
git add "app/estimate-wizard.tsx"
git commit -m "feat(scope): wizard shares scope module; project-aware prefill + link-back + refineWith"
```

---

## Task 6: Repoint NextStepHero + clean up project-detail

**Files:**
- Modify: `components/NextStepHero.tsx`
- Modify: `app/project-detail.tsx`

- [ ] **Step 1: NextStepHero — has-scope predicate**

In `components/NextStepHero.tsx`, find the `project_no_scope` detection (`!p.description || p.description.trim().length < 10`). Replace the condition with a saved-scope check:

```ts
  const projectNoScope = projScope.find(p => !p.scope || (p.scope.scope ?? '').trim().length === 0);
```

- [ ] **Step 2: NextStepHero — href #4 (Add scope now)**

In the `project_no_scope` return object, replace the `href` with:

```ts
      href: { pathname: '/project-scope', params: { id: projectNoScope.id } },
```

- [ ] **Step 3: NextStepHero — href #5 (Open estimator)**

In the `project_no_estimate` return object, replace the `href` with:

```ts
      href: { pathname: '/estimate-wizard', params: { projectId: projectNoEstimate.id } },
```

- [ ] **Step 4: project-detail — remove the superseded scope-mode hack**

In `app/project-detail.tsx`:
- Delete the `scopeFocusMode` state line and its comment.
- Delete the `useEffect` that resets scope-mode on modal close (the `if (!showEditModal && scopeFocusMode) setScopeFocusMode(false);` effect).
- In the deep-link consume effect, delete the entire `if (editParam === 'scope') { … }` branch (keep the `editParam === '1' || editParam === 'true'` and `tileParam` branches).
- In the edit modal, revert the title to the static `Edit Project`, the Description label back to `Description`, remove the scope-mode helper `<Text>` and the conditional placeholder, and remove `autoFocus={scopeFocusMode}` from the Description `TextInput`. (i.e. undo the 2026-05-15 `scopeFocusMode` edit entirely; the modal returns to its pre-scope-mode state.)

- [ ] **Step 5: project-detail — "no estimate" button → project-aware wizard**

Find the `!hasAnyEstimate` quick-action `TouchableOpacity` (`onPress={() => router.replace('/(tabs)/discover/estimate' as any)}`, ~l.1274). Replace its `onPress` with:

```tsx
              onPress={() => router.push({ pathname: '/estimate-wizard', params: { projectId: id ?? '' } } as never)}
```

- [ ] **Step 6: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors; no remaining references to `scopeFocusMode` or `editParam === 'scope'` (grep to confirm: `grep -n "scopeFocusMode\|editParam === 'scope'" app/project-detail.tsx` → no output).

- [ ] **Step 7: Manual verification — the full NextStepHero audit**

`bun run start`. On a free account, walk every NextStepHero card to its destination:
1. Project with no scope → card "Add scope now" → opens `/project-scope` (the new stepper, free, NOT the edit modal, NOT a paywall).
2. Project with scope but no estimate → "Open estimator" → opens the wizard prefilled from scope (NOT blank, NOT the tile modal).
3. Overdue invoice card → opens that invoice.
4. Stale RFI card → opens the project's RFIs section.
5. Create-invoice card → opens the new-invoice form.
6. Expiring-COI card (if present) → prequal manager (Pro paywall expected on free — documented, acceptable).
Confirm the edit-project pencil still opens the normal "Edit Project" modal (scope-mode fully removed).

- [ ] **Step 8: Commit**

```bash
git add "components/NextStepHero.tsx" "app/project-detail.tsx"
git commit -m "fix(scope): repoint NextStepHero to scope screen + project-aware wizard; remove scope-mode hack"
```

---

## Task 7: Final verification + ship

**Files:** none (verification + release)

- [ ] **Step 1: Full type-check**

Run: `npx tsc --noEmit`
Expected: zero errors across the whole project.

- [ ] **Step 2: Lint the touched files**

Run: `npx eslint utils/scopeQuestions.ts components/ScopeQuestionStepper.tsx app/project-scope.tsx app/estimate-wizard.tsx components/NextStepHero.tsx app/project-detail.tsx`
Expected: no errors (warnings acceptable, but fix any unused-import warnings introduced by Task 5 Step 2).

- [ ] **Step 3: End-to-end manual walkthrough**

`bun run start`. Execute the full happy path on a free account:
1. New/empty project → home/summary shows NextStepHero "Add scope now".
2. Tap it → `/project-scope` stepper (free). Fill 5 required, skip the 2 optional. Save → back to project.
3. Project now shows "Open estimator" next-step. Tap → wizard prefilled from scope (no re-entry).
4. Generate → Pro paywall fires (free tier). Upgrade-bypass not needed to verify prefill+gate.
5. Standalone: Discover → Quick Estimate Wizard (no project) → still works, emails a PDF.
6. (If a Pro/owner account is available) repeat step 4 → estimate generates, links to project, `refineWith` shows, project no longer "no estimate".

- [ ] **Step 4: OTA + ship (matches this session's established release flow)**

```bash
eas update --branch production --message "Project Scope screen: free guided scope capture that prefills the project-aware Estimate Wizard (rough AI estimate + 'add these to sharpen' refineWith); standalone quick-estimate untouched; NextStepHero destinations corrected."
```

Then squash-merge `materials-cart` → `main` and `git push origin main` (resolve any squash conflicts by taking the strictly-newer `materials-cart` side, then verify no conflict markers + newest content present — the pattern used throughout this session). The migration was already applied to prod in Task 1 Step 3; no separate DB deploy needed. `npx tsc --noEmit` is the release gate (no test runner in this repo).

- [ ] **Step 5: Final commit (if any verification fixes were made)**

```bash
git add -A
git commit -m "chore(scope): verification fixes for project scope workflow"
```

---

## Self-Review

**Spec coverage:** §1 problem → Tasks 4/6 (real screen + repoint). §3 two flows → Task 5 Step 7 (standalone untouched + project-aware verified). §4 data model → Task 1. §5 shared questions → Task 2. §6 scope screen free → Task 4. §7 wizard project-aware + rough/refineWith + explicit estimate→LinkedEstimate mapping → Task 5 (Step 4 flagged as riskiest, own phase). §8 NextStepHero audit → Task 6. §9 entry points → Tasks 4/6. §10 edge cases: project-deleted → Task 4 (`if (!project)`); partial scope → Task 4 skip + Task 5 prefill; free-user gate → Task 5 Step 7c; re-run scope → Task 4 hydrate; offline → inherited via `updateProject`. §11 verification (tsc + manual, no test runner) → stated in header + every task. §12 files → File Structure table. All covered.

**Placeholder scan:** The only intentional "paste from wizard" markers are in Task 3 (verbatim code-move, with explicit instruction + a hard "do not leave `as any`/placeholders in the committed file" gate and a verify step). All other steps contain complete code or exact mechanical diffs. No "TBD/handle errors/similar to Task N".

**Type consistency:** `WizardAnswers`/`EstimateResult`/`estimateSchema` defined once in Task 2, imported everywhere after (Tasks 4/5). `ProjectScope` (Task 1) = `WizardAnswers` + `updatedAt`; scope screen + wizard strip `updatedAt` symmetrically before `setAnswers`. `stepCanAdvance`/`TOTAL_SCOPE_STEPS`/`buildEstimatePrompt`/`scopeCacheKey` names consistent Task 2 ↔ 4 ↔ 5. NextStepHero predicate (Task 6 Step 1) matches the `project.scope?.scope` "has scope" rule from spec §4. Task 5 Step 4 explicitly defers the `LinkedEstimate`/`LinkedEstimateItem` field names to the real `types/index.ts` interface (reconciled against `utils/estimateAssemblies.ts`) rather than hard-coding possibly-wrong names — flagged, not assumed.

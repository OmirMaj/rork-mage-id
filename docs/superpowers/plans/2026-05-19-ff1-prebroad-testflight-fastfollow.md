# FF1 — Pre-Broad-TestFlight Fast-Follow Batch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Three small, independent app-side OTA fixes from the 2026-05-19 re-audit: make `?openCreate=1` actually open the create modal, give the signed-contract screen a "Create first invoice" CTA, and make the Stripe-not-connected nudge show once instead of every send.

**Architecture:** One plan, **three independent tasks**, one file each (`app/(tabs)/(home)/index.tsx`, `app/contract.tsx`, `app/invoice.tsx`) — zero shared symbols, any order. Each is additive/wiring-only; every no-trigger path stays byte-identical.

**Tech Stack:** React Native + Expo Router (`useLocalSearchParams`/`router.setParams`), `@react-native-async-storage/async-storage`, TS strict. No unit runner — per-task gate = `npx tsc --noEmit` clean from worktree root + spec §5 manual reasoning.

**Spec:** `docs/superpowers/specs/2026-05-19-ff1-prebroad-testflight-fastfollow-design.md` (@ `e607567`). Worktree `/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main`, branch `claude/p0-launch-on-main` (== `main` @ `ff0d5df`). Use `git -C "<that path>"`.

## CRITICAL
- Each task confined to its ONE named file. Do NOT modify `CreateMenu.tsx`/`OnboardingChecklist.tsx` (URLs already correct), `types/index.ts`, any migration/portal/edge-fn. No new dependency (AsyncStorage is already a project dep).
- The no-trigger paths must be byte-identical to today: FF1-A inert when no `openCreate` param; FF1-B unchanged for non-`signed` status; FF1-C identical first-time + connected sends.
- Do NOT touch the shipped P0 behaviors (invoice create-then-edit, paywall-needs-real-project, CreateMenu picker).
- Build authors code + commits only. **Ship is a controller OTA step AFTER the final opus whole-impl review** (not in this plan).
- Gate per task: `npx tsc --noEmit` clean + the stated manual reasoning.

---

### Task 1: FF1-A — Home consumes `?openCreate=1` (fire-once)

**Files:** Modify `app/(tabs)/(home)/index.tsx`

- [ ] **Step 1: Add `useRef` to the React import (line 1)**

Find:
```tsx
import React, { useCallback, useState, useMemo, useEffect } from 'react';
```
Replace with:
```tsx
import React, { useCallback, useState, useMemo, useEffect, useRef } from 'react';
```

- [ ] **Step 2: Add `useLocalSearchParams` to the expo-router import (line 9)**

Find:
```tsx
import { useRouter } from 'expo-router';
```
Replace with:
```tsx
import { useRouter, useLocalSearchParams } from 'expo-router';
```

- [ ] **Step 3: Read the param + add the consumed-ref (right after `const router = useRouter();`, line 68)**

Find:
```tsx
  const router = useRouter();
```
Replace with:
```tsx
  const router = useRouter();
  const { openCreate } = useLocalSearchParams<{ openCreate?: string }>();
  const openCreateConsumed = useRef(false);
```

- [ ] **Step 4: Add the fire-once effect (immediately after the existing effect that ends near line 266)**

Locate the existing `useEffect(() => { ... }, [...]);` block whose opening is at ~line 266 (the second `useEffect` in the component). Immediately AFTER that block's closing `);`, insert:
```tsx
  // FF1-A: /?openCreate=1 is pushed by the global "+" "Project" row,
  // the zero-project fallback, and the onboarding checklist's #1 row,
  // but nothing consumed it (the route resolved to home with no modal).
  // Open the create modal exactly once, then clear the param. The ref
  // guard guarantees fire-once even if a re-render re-delivers it before
  // setParams clears; no param ⇒ inert ⇒ zero change to normal entry.
  useEffect(() => {
    if (openCreate && !openCreateConsumed.current) {
      openCreateConsumed.current = true;
      setShowCreateModal(true);
      router.setParams({ openCreate: undefined });
    }
  }, [openCreate, router]);
```
(If the exact line differs, anchor on "immediately after the second existing `useEffect` block in the component body, before the first `useCallback`/render code." `setShowCreateModal` is the existing state setter from `const [showCreateModal, setShowCreateModal] = useState(false);` at ~:220 — do not redeclare it.)

- [ ] **Step 5: Gate**

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" && npx tsc --noEmit
```
Expected: clean (zero errors). `useLocalSearchParams<{ openCreate?: string }>()` typed; `router.setParams({ openCreate: undefined })` is valid Expo Router API.

Reason through (report): entering home via `/?openCreate=1` (from CreateMenu "Project" `:71`, CreateMenu zero-project fallback `:210`, OnboardingChecklist row `:124`) → effect fires once → create modal opens → param cleared so it cannot re-fire on re-render; the `useRef` guard blocks a second open even if a render delivers the param before `setParams` lands. Normal home entry (no `openCreate`) → effect body skipped → **zero behavior change** (modal still only opened by the existing `:349/:734/:773` callers). Back-nav into home after closing → param already cleared + ref true → no reopen. No change to `CreateMenu.tsx`/`OnboardingChecklist.tsx`.

- [ ] **Step 6: Commit**
```bash
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" add "app/(tabs)/(home)/index.tsx"
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" commit -m "feat(FF1-A): home consumes ?openCreate=1 (opens create modal fire-once)"
```

---

### Task 2: FF1-B — Signed-contract → "Create first invoice" CTA

**Files:** Modify `app/contract.tsx`

Context (verified, no edits needed): `:16` imports `View, Text, TouchableOpacity` from react-native; `:19` `useRouter` imported; `:23` group imports `Plus`; `:65` `const router = useRouter();`; `:69` `const { projectId, fromRevision } = useLocalSearchParams<{ projectId: string; fromRevision?: string }>();`; styles `primaryBtn` (`:1065`, has `flex: 1.4`) + `primaryBtnText` (`:1072`, `#FFF` bold) exist in `makeStyles`. `bill-from-estimate.tsx:78` reads `projectId`.

- [ ] **Step 1: Add the CTA inside the existing signed block**

Find this exact block (~`:655-664`):
```tsx
        {contract.status === 'signed' && (
          <View style={[styles.statusBanner, { backgroundColor: themeColors.success + '0D', borderColor: themeColors.success + '30' }]}>
            <CheckCircle2 size={16} color={themeColors.success} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.statusBannerTitle, { color: themeColors.success }]}>Signed by both parties</Text>
              <Text style={styles.statusBannerBody}>
                Binding agreement on file. Invoices on this project should reference it.
              </Text>
            </View>
          </View>
        )}
```
Replace it ENTIRELY with (wrap the unchanged banner + a new sibling CTA in a fragment; the banner View is byte-identical; the button overrides `primaryBtn`'s `flex:1.4` so it renders as a full-width standalone button under the banner, not a flex row child):
```tsx
        {contract.status === 'signed' && (
          <>
            <View style={[styles.statusBanner, { backgroundColor: themeColors.success + '0D', borderColor: themeColors.success + '30' }]}>
              <CheckCircle2 size={16} color={themeColors.success} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.statusBannerTitle, { color: themeColors.success }]}>Signed by both parties</Text>
                <Text style={styles.statusBannerBody}>
                  Binding agreement on file. Invoices on this project should reference it.
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={[styles.primaryBtn, { flex: 0, alignSelf: 'stretch', marginTop: 10 }]}
              onPress={() => router.push({ pathname: '/bill-from-estimate', params: { projectId } } as any)}
              accessibilityRole="button"
              accessibilityLabel="Create first invoice"
            >
              <Plus size={16} color="#FFF" />
              <Text style={styles.primaryBtnText}>Create first invoice</Text>
            </TouchableOpacity>
          </>
        )}
```

- [ ] **Step 2: Gate**

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" && npx tsc --noEmit
```
Expected: clean. `projectId` is `string` from `:69`; `router.push({ pathname: '/bill-from-estimate', params: { projectId } } as any)` matches the file's existing `as any` route-push idiom (`:371`); `TouchableOpacity`/`Plus`/`Text` already imported; `styles.primaryBtn`/`primaryBtnText` exist.

Reason through (report): a `signed` contract now shows a tappable full-width "Create first invoice" button below the "Signed by both parties" banner → `router.push` to `/bill-from-estimate?projectId=<the in-scope projectId>` (verified `bill-from-estimate.tsx:78` reads `projectId`). The banner markup is byte-identical (only wrapped in a fragment with an added sibling). `draft`/`sent`/`void` branches and all signing/lock/sign-and-send logic are untouched (the change is entirely inside the existing `status === 'signed'` conditional). `flex:0 + alignSelf:'stretch'` overrides `primaryBtn`'s `flex:1.4` so the lone button is full-width in the column, not a shrunk row child.

- [ ] **Step 3: Commit**
```bash
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" add app/contract.tsx
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" commit -m "feat(FF1-B): signed-contract → Create first invoice CTA"
```

---

### Task 3: FF1-C — Stripe-not-connected nudge show-once

**Files:** Modify `app/invoice.tsx`

Context (verified): AsyncStorage NOT yet imported; last import is `:66 import { safeJsonParse } from '@/utils/safeJson';`. The nudge is inside `const handleConfirmSend = useCallback(async () => { ... }` (`:354`, async — `await` is valid).

- [ ] **Step 1: Add the AsyncStorage import (after line 66)**

Find:
```tsx
import { safeJsonParse } from '@/utils/safeJson';
```
Replace with:
```tsx
import { safeJsonParse } from '@/utils/safeJson';
import AsyncStorage from '@react-native-async-storage/async-storage';
```

- [ ] **Step 2: Make the nudge show-once**

Find this exact block (~`:507-521`, inside the async `handleConfirmSend`):
```tsx
    // Stripe-not-connected nudge. Pre-audit this state was a silent
    // console.log; the user shipped an invoice with no Pay button and
    // never knew why. Surface a one-time alert so they can set up Connect
    // for next time. Non-blocking — we navigate back regardless.
    if (stripeNotConnected && totalDue > 0) {
      Alert.alert(
        'Invoice sent — no Pay button included',
        "You haven't connected Stripe yet, so this invoice was emailed without a one-tap Pay button. Set up Stripe in Payments to add Pay buttons to future invoices.",
        [
          { text: 'Later', style: 'cancel' },
          { text: 'Set up Stripe', onPress: () => router.push('/payments-setup' as never) },
        ],
      );
    } else {
      nailIt(`Invoice #${workingInvoice.number} sent${recipientInfo}`);
    }
```
Replace it ENTIRELY with (read a once-flag first; show the nudge only the first time ever; every other send — connected or repeat — now shows the normal success toast, which is a strict improvement over today's silent suppressed-nudge sends; alert title/body/buttons byte-identical):
```tsx
    // FF1-C: Stripe-not-connected nudge — show ONCE EVER, not on every
    // send. After the first time, the user knows; nagging on each invoice
    // is friction. A failed flag read counts as "not seen" (show it);
    // the flag write is fire-and-forget and never blocks the send.
    const stripeNudgeSeen = await AsyncStorage.getItem('buildwise_stripe_nudge_seen').catch(() => null);
    if (stripeNotConnected && totalDue > 0 && stripeNudgeSeen !== '1') {
      void AsyncStorage.setItem('buildwise_stripe_nudge_seen', '1');
      Alert.alert(
        'Invoice sent — no Pay button included',
        "You haven't connected Stripe yet, so this invoice was emailed without a one-tap Pay button. Set up Stripe in Payments to add Pay buttons to future invoices.",
        [
          { text: 'Later', style: 'cancel' },
          { text: 'Set up Stripe', onPress: () => router.push('/payments-setup' as never) },
        ],
      );
    } else {
      nailIt(`Invoice #${workingInvoice.number} sent${recipientInfo}`);
    }
```

- [ ] **Step 3: Gate**

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" && npx tsc --noEmit
```
Expected: clean. `AsyncStorage.getItem(...)` returns `Promise<string | null>`; `.catch(() => null)` keeps it non-throwing; `await` valid inside the async `handleConfirmSend`; `void AsyncStorage.setItem(...)` is fire-and-forget.

Reason through (report): **first** not-connected send with balance → flag absent → nudge shows once + flag set to `'1'`. **Every subsequent** send (not-connected repeat OR Stripe-connected) → either `stripeNudgeSeen === '1'` or `!stripeNotConnected` → `else` → normal `nailIt("Invoice #… sent")` toast (today these suppressed-nudge sends were silent — net improvement, no regression). The create-then-edit pay-link logic, the email send path, and the `nailIt` text are byte-unchanged. AsyncStorage read failure → `null !== '1'` → nudge still shows, send still completes (never throws, never blocks). Connected sends unaffected.

- [ ] **Step 4: Commit**
```bash
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" add app/invoice.tsx
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" commit -m "fix(FF1-C): Stripe-not-connected nudge shows once, not every send"
```

---

## Final combined gate (after all 3 tasks)
```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" && npx tsc --noEmit && git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" diff --stat ff0d5df HEAD
```
Expected: `npx tsc --noEmit` clean; `git diff --stat ff0d5df HEAD` lists EXACTLY three files — `app/(tabs)/(home)/index.tsx`, `app/contract.tsx`, `app/invoice.tsx` — plus the spec/plan docs. No other source file changed.

---

## Ship (controller, AFTER final opus whole-impl review — NOT build)
Code-only, OTA-able, no migration/portal/edge-fn → Netlify-independent. FF-merge `claude/p0-launch-on-main` → `main` (FF if possible; else a clean safe merge — never force), push, then:
```bash
eas update --branch production --message "FF1 pre-broad-TestFlight fast-follow (openCreate consumer + signed-contract invoice CTA + Stripe nudge show-once)"
```
Verify the OTA published (update group id + commit). No portal deploy, no Supabase MCP step.

## Self-Review
**Spec coverage:** spec §2 FF1-A (`openCreate` consumer, fire-once, useRef+setParams, inert when absent) → Task 1; §2 FF1-B (signed-contract CTA → bill-from-estimate with projectId, additive, no signing-logic change) → Task 2; §2 FF1-C (`buildwise_stripe_nudge_seen` once-ever flag, read-fail = not-seen, fire-and-forget write, email/pay-link byte-unchanged, suppressed sends now get the success toast) → Task 3; §3 non-goals (no CreateMenu/checklist/types/migration change; shipped P0s untouched) → CRITICAL + single-file-per-task; §4 error handling (ref-guard fire-once; projectId in scope; AsyncStorage non-throwing/non-blocking) → each task's Step "Reason through"; §5 verification → per-task gates + final combined gate. 3 spec items ↔ 3 tasks, no gaps.
**Placeholder scan:** No TBD/TODO. Every edit gives the exact before/after code in full (imports, the fire-once effect, the full signed-block fragment, the full nudge block). The only locate-by-description directive (Task 1 Step 4 "after the second existing useEffect block") is a precise structural anchor with a stated fallback rule, not a vague TODO. Exact file paths + line anchors throughout.
**Type/name consistency:** `openCreate` / `openCreateConsumed` / `useRef` / `useLocalSearchParams` / `setShowCreateModal` consistent within Task 1; `projectId` / `styles.primaryBtn` / `styles.primaryBtnText` / `Plus` / `TouchableOpacity` consistent within Task 2 and matched to verified file anchors; `buildwise_stripe_nudge_seen` / `AsyncStorage` / `stripeNudgeSeen` / `handleConfirmSend` consistent within Task 3. Three independent single-file tasks → no cross-task symbol drift. Each commit message matches its task (`feat(FF1-A)` / `feat(FF1-B)` / `fix(FF1-C)`).
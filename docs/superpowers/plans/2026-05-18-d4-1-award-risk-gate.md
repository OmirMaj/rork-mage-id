# D4-1 — Real Award-Time Sub-Risk Gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Replace `app/buyout-package.tsx`'s single soft "Award anyway" with a real, specific, two-step risk gate driven by the existing `reviewPrequalPacket` engine (COI-expiry + prequal fails become named, dated award blockers), recording an acknowledged override on the created commitment.

**Architecture:** Single-file change to `app/buyout-package.tsx`'s `handleAward` (~:186-237). Reuse `utils/prequalEngine.ts` `reviewPrequalPacket` (unchanged) + `useProjects().updateCommitment` (existing). App-only, OTA-able, **no migration / no engine change / no portal** → independent of H4's Netlify block. One cohesive task (risk-compute + gate + record are tightly coupled).

**Tech Stack:** RN (`Alert.alert`), TS strict. No unit runner — gate = `npx tsc --noEmit` + manual reasoning (spec §6).

**Spec:** `docs/superpowers/specs/2026-05-18-d4-1-award-risk-gate-design.md` (@ `ea838ca`). Worktree `/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main`, branch `claude/p0-launch-on-main`. Use `git -C "<that path>"`.

## CRITICAL
- Confine changes to `app/buyout-package.tsx` `handleAward`. Do NOT modify `utils/prequalEngine.ts`, `awardBidPackage`, or any other screen. The clean-pass award path must be byte-identical to today.
- Build authors code only; ships via OTA at the controller ship step.
- Gate: `npx tsc --noEmit` clean + spec §6 manual reasoning.

## Anchors (verified)
- `app/buyout-package.tsx` `handleAward = useCallback((bid) => {...}, [pkg, awardBidPackage, getSubcontractor, prequalPackets, allowanceItems])` (~:186). It already computes `sub`, `packet = prequalPackets.find(p => p.subcontractorId === sub.id)`, and an ad-hoc `prequalGap` string, then `Alert.alert(prequalGap?'Award without prequal docs?':'Award this bid?', lines, [Cancel, {text:prequalGap?'Award anyway':'Award', style:..., onPress:()=>{const commitmentId = awardBidPackage(pkg.id, bid.id); if(commitmentId){haptics}}}])`.
- `useProjects()` provides `awardBidPackage(packageId,bidId): string|null` (returns the new commitment id) and `updateCommitment(id, updates: Partial<Commitment>)`. The handler currently destructures `awardBidPackage, getProject, prequalPackets, getSubcontractor` (~:66) — add `updateCommitment` (+ `getCommitmentsForProject` if needed to read current notes).
- `utils/prequalEngine.ts`: `reviewPrequalPacket(packet: PrequalPacket): PrequalReviewResult { overall:'pass'|'fail'|'needs_info'; findings: PrequalFinding[] (each {criterion,label,passed,note?,severity:'blocker'|'advisory'}); summary; missingFields }`. The COI check has `criterion:'coi_expiry'`.

---

### Task 1: Real two-step award gate (single file)

**Files:** Modify `app/buyout-package.tsx`

- [ ] **Step 1: Imports + hook**

Add `import { reviewPrequalPacket } from '@/utils/prequalEngine';` (reuse the existing import grouping). In the component's `useProjects()` destructure (~:66), add `updateCommitment` (and `getCommitmentsForProject` only if you need to read the commitment's current notes to append). Do not import/modify anything else.

- [ ] **Step 2: Compute structured blockers (replace the ad-hoc `prequalGap` string)**

In `handleAward`, after `sub`/`packet` are resolved, replace the `const prequalGap = ...` expression with:
```tsx
const review = packet ? reviewPrequalPacket(packet) : null;
const blockers: string[] = [];
if (!packet) {
  blockers.push(sub
    ? 'No prequal packet on file for this sub.'
    : 'Bid is not linked to a tracked subcontractor — no prequal/COI verified.');
} else if (review && review.overall !== 'pass') {
  for (const f of review.findings) {
    if (!f.passed && f.severity === 'blocker') {
      blockers.push(f.note ? `${f.label} — ${f.note}` : f.label);
    }
  }
  if (blockers.length === 0) {
    // overall not 'pass' but no blocker-severity finding (e.g. needs_info)
    blockers.push(`Prequal not approved: ${review.summary}`);
  }
}
const isRisky = blockers.length > 0;
```
(The engine's `coi_expiry` blocker finding now appears in `blockers` with its label/note — COI expiry is a first-class, named award blocker. No separate COI math; the engine is the source of truth.)

- [ ] **Step 3: The gate — clean = unchanged one-tap; risky = two-step + record**

Keep the existing informational `lines` array (vendor/total/savings/allowance). Replace the single `Alert.alert(...)` award block with:
```tsx
const doAward = () => {
  const commitmentId = awardBidPackage(pkg.id, bid.id);
  if (commitmentId) {
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (isRisky) {
      // Audit trail: record the acknowledged override on the commitment.
      const overrideLine = `[risk-override ${new Date().toISOString().slice(0, 10)}] Awarded despite: ${blockers.join('; ')}. Acknowledged by GC.`;
      try {
        // Commitment.notes handling — read its real type in types/index.ts:
        //  - if `notes: string`  → append: `${existing}\n${overrideLine}` (read current via getCommitmentsForProject if needed)
        //  - if `notes: string[]`→ push:   updateCommitment(commitmentId, { notes: [...existing, overrideLine] })
        // Use updateCommitment(commitmentId, { notes: <appended/pushed> }) accordingly.
        updateCommitment(commitmentId, { /* notes per the real Commitment.notes type, incl. overrideLine */ } as Partial<Commitment>);
      } catch (e) {
        console.warn('[award-override] could not record override on commitment', e);
      }
    }
  }
};

if (!isRisky) {
  Alert.alert('Award this bid?', lines.join('\n'), [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Award', style: 'default', onPress: doAward },
  ]);
} else {
  Alert.alert(
    '⚠️ Compliance risk — review before award',
    [...lines, '', 'RISKS:', ...blockers.map(b => `• ${b}`), '',
     'Awarding accepts this compliance/insurance exposure. Your override will be recorded on the commitment.'].join('\n'),
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Review override',
        style: 'destructive',
        onPress: () => Alert.alert(
          'Confirm risk override',
          `Award ${bid.vendorName ?? sub?.companyName ?? 'this sub'} despite:\n\n${blockers.map(b => `• ${b}`).join('\n')}\n\nThis is the GC's compliance risk and will be recorded.`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Award & accept risk', style: 'destructive', onPress: doAward },
          ],
        ),
      },
    ],
  );
}
```
Add `updateCommitment` (and any needed reads) to the `useCallback` dependency array. Keep `Commitment` type import if needed for the `Partial<Commitment>` annotation (it's likely already imported in this file; if not, add it to the existing `@/types` import). **Read the real `Commitment.notes` type in `types/index.ts` and implement the append/push exactly** (string → newline-append the existing value; string[] → spread+push). If recording cleanly isn't reachable (e.g. notes type/շcommitment-read is awkward), ship the gate WITHOUT the record and keep the `console.warn` + leave a `// D4-1: override-record deferred (see spec §4.2 fallback)` comment — the two-step GATE is the required deliverable; the recorded line is the enhancement (spec §4.2 fallback).

- [ ] **Step 4: Gate**

`npx tsc --noEmit` from worktree root → clean. Reason through (report): expired-COI sub → `reviewPrequalPacket` yields a `coi_expiry` blocker → `isRisky` → two-step gate naming "COI ... expired ..."; only the explicit second "Award & accept risk" runs `awardBidPackage`; the commitment notes carry the override line. Failed-prequal (non-COI) → blockers list those findings → two-step. No packet → "No prequal packet" blocker → two-step. Fully compliant (`review.overall==='pass'`) → unchanged single "Award this bid?" one-tap, no override line. Cancel at any step → no award/commitment/notes write. `awardBidPackage` args/success-haptics unchanged; other buyout-package behavior + other screens byte-unaffected; `prequalEngine.ts` untouched.

- [ ] **Step 5: Commit**
```bash
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" add app/buyout-package.tsx
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" commit -m "feat(D4-1): real two-step award risk gate (COI/prequal blockers + recorded override)"
```

---

## Ship (controller, after final whole-impl review — NOT build)
Code-only, OTA, no migration/portal. FF-merge `claude/p0-launch-on-main` → `main`, push, `eas update --branch production --message "D4-1 award risk gate"`. (Independent of H4's Netlify block.)

## Self-Review
**Spec coverage:** §4.1 risk computation via `reviewPrequalPacket` + no-packet → Step 2; §4.2 two-step gate + clean-path-unchanged + recorded override + documented fallback → Step 3; §3 non-goals (no per-project hard policy [override always allowed via explicit ack], no payment/lien gating, no engine change, no migration) → CRITICAL + steps; §5 error handling (pure engine, packet undefined handled, no new write path beyond updateCommitment, fallback) → Steps 2-3; §6 verification → Step 4. D4-2/D4-3 not in scope (spec §1/§7). No gaps.
**Placeholder scan:** All gate/blocker code given in full. The single adapt-to-real-type directive (`Commitment.notes` string-vs-array append) is a precise, named, two-branch instruction against a verified type location + a documented spec-§4.2 fallback — not a vague TODO. Exact line anchors + engine API given.
**Type/name consistency:** `review`/`blockers`/`isRisky`/`doAward`/`overrideLine` consistent across Steps 2-3. `reviewPrequalPacket`/`PrequalReviewResult.findings[].{passed,severity:'blocker',label,note}` match the verified engine API. `awardBidPackage(pkg.id,bid.id):string|null` + `updateCommitment(id,Partial<Commitment>)` match the verified `useProjects` API. Single task → no cross-task drift. `Commitment` from `@/types`.

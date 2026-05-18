# D4-1 — Real Award-Time Sub-Risk Gate (COI + Prequal) — Design

Source: `docs/superpowers/audits/2026-05-17-feature-depth-audit.md` item **D4** ("Make sub-risk real — gate, don't decorate"). This spec is **D4-1** only.

Build target: p0-on-main worktree, branch `claude/p0-launch-on-main`, HEAD `abe5cbf`. **App-only, OTA-able. No migration, no portal, no edge-fn** → independent of H4's Netlify block. Reuses the existing risk engine — no new risk logic.

## 1. Decomposition (D4 split)

D4 = three separable enforcement surfaces + a policy model. Per the brainstorming decomposition guidance + proportionality:

- **D4-1 (THIS spec): real award-time gate.** The audit's named concrete defect — `app/buyout-package.tsx`'s award handler offers a single soft destructive "Award anyway" on a prequal gap, COI isn't even a distinct award blocker ("demos like a 9, protects like a 4"). Turn it into a real, specific, two-step risk-acknowledgement gate using the EXISTING `utils/prequalEngine.ts` (which already evaluates COI expiry). App-side, OTA, no migration. Highest-leverage, most-concrete slice.
- **D4-2 (decomposed follow-on, NOT here): payment-path gating.** Conditional/unconditional lien waiver required at draw/final; COI valid at sub payment. Touches the invoice/draw/payment flow (higher blast radius) — its own brainstorm→spec. §7.
- **D4-3 (decomposed follow-on, NOT here): per-project enforceable policy.** A per-project "require prequal + valid COI" hard policy (block with NO override) layered atop D4-1's gate — needs a policy data model + UI. §7.

## 2. Problem

`app/buyout-package.tsx` award handler (~:194-237): computes an ad-hoc `prequalGap` string from `packet.status` only (`approved` → null; `expired`/other → a message), then:
```
Alert.alert(prequalGap ? 'Award without prequal docs?' : 'Award this bid?', lines,
  [Cancel, { text: prequalGap ? 'Award anyway' : 'Award', style: prequalGap?'destructive':'default', onPress: () => awardBidPackage(...) }])
```
So a risky award is one destructive tap away, **COI expiry is not a distinct award blocker** (only indirectly via packet.status), and there is no specific naming of the actual exposure or any recorded acknowledgement. This is "decorative."

**The risk engine already exists:** `utils/prequalEngine.ts` `reviewPrequalPacket(packet: PrequalPacket): PrequalReviewResult { overall: 'pass'|'fail'|'needs_info'; findings: PrequalFinding[]; summary; missingFields }` — and its findings already include a `coi_expiry` criterion (fail if expired, warn if <30d) plus license/criteria checks. `renewalBucket(expiresAt)` → `'60d'|'30d'|'7d'|'expired'|'ok'`. The award path simply doesn't use it. buyout-package already has `prequalPackets`, `getSubcontractor`, the awarded `sub`, and `packet = prequalPackets.find(p => p.subcontractorId === sub.id)` in scope.

## 3. Goal / Non-goals

**Goal:** At award, compute the real risk via `reviewPrequalPacket` (and explicit "no prequal packet on file" detection) and surface COI-expiry + prequal-fail as named, dated blockers. A risky award is **gated**: a clean-pass award stays one-tap; a risky award requires an explicit, specific, **two-step** acknowledgement that names the exact exposure(s) and is a deliberate second confirm (not the existing single soft tap), and the acknowledged override is recorded as an audit line on the created commitment. No silent risky award.

**Non-goals (YAGNI / scope / independence):**
- No per-project hard "block, no override" policy (that's D4-3) — D4-1 always allows an *explicit acknowledged* override (the GC can still award; the gate makes it deliberate + recorded, per the audit's "blocks **or hard-confirms**").
- No payment-path / lien-waiver gating (D4-2).
- No new risk logic — reuse `reviewPrequalPacket`/`renewalBucket` as-is; do not modify `prequalEngine.ts`.
- No migration / no `Commitment` schema change — record the override in the commitment's existing `notes` field; if not cleanly available, documented fallback = acknowledgement-only + a logged line.
- No change to the clean-award flow (engine `overall === 'pass'` AND COI ok → unchanged one-tap "Award"), `awardBidPackage` internals, or any other screen.

## 4. Architecture

All changes confined to `app/buyout-package.tsx`'s award handler (the `Alert.alert` block ~:218-236) + small local risk computation, reusing `utils/prequalEngine.ts` (imported; not modified).

### 4.1 Risk computation (reuse the engine)

In the award handler, replace the ad-hoc `prequalGap` string with structured blockers:
- `const review = packet ? reviewPrequalPacket(packet) : null;`
- Build `blockers: string[]`:
  - If `!packet`: `'No prequal packet on file for this sub.'`
  - Else if `review.overall !== 'pass'`: a line per failing/needs-info finding from `review.findings` that is a hard issue, formatted with its label (e.g. `'COI expired (2026-04-30)'`, `'License expired'`, `'Prequal: <summary>'`) — surface the engine's `coi_expiry` finding explicitly so COI is a first-class, dated blocker, plus other failed criteria.
  - Independently, if COI expiry is available and `renewalBucket(coiExpiry) === 'expired'` (or the `coi_expiry` finding is a fail), include `'COI expired <date> — sub is uninsured for this work.'` (the audit's headline COI gate). (Use the engine's finding as the source of truth; do not re-implement expiry math.)
- `const isRisky = blockers.length > 0;`

### 4.2 The gate (two-step, specific, recorded)

- **Clean (`!isRisky`):** unchanged — the existing single `Alert.alert('Award this bid?', lines, [Cancel, {text:'Award', onPress: award}])`. No new friction for good subs.
- **Risky (`isRisky`):** replace the single soft "Award anyway" with a deliberate two-step:
  1. First `Alert.alert('⚠️ Compliance risk — review before award', <lines incl. an explicit "RISKS:" block listing every `blocker` with dates, and the line "Awarding accepts this compliance/insurance exposure. Your override will be recorded.">, [{Cancel}, {text:'Review override', style:'destructive', onPress: step2}])`.
  2. `step2` → a second `Alert.alert('Confirm risk override', 'You are awarding <vendor> despite: <blockers joined>. This is the GC\'s compliance risk and will be recorded on the commitment.', [{Cancel}, {text:'Award & accept risk', style:'destructive', onPress: doAward}])`.
  - `doAward` calls the existing `awardBidPackage(pkg.id, bid.id)` exactly as today; on success, append an audit line to the created commitment's `notes` (existing field): `` `[risk-override ${new Date().toISOString().slice(0,10)}] Awarded despite: ${blockers.join('; ')}. Acknowledged by GC.` `` via the existing commitment-update path (`updateCommitment`/the offline-queue path used elsewhere — reuse, no new write path). **Fallback (documented):** if appending to commitment notes is not cleanly reachable from this handler without a risky refactor, ship the two-step gate WITHOUT the recorded line and log `console.warn('[award-override] ...')` + note the deferral — the gate (the audit's core ask) still ships; the recorded-audit-line is the enhancement.
- Two-step + specific + recorded is meaningfully a *gate* (deliberate, informed, auditable) vs today's one soft tap — satisfying the audit's "blocks or hard-confirms award" while leaving the hard-no-override policy to D4-3.

## 5. Error handling / correctness

- `reviewPrequalPacket` is pure (existing, unchanged); `packet` may be undefined (handled → "no packet on file" blocker). No new failure modes.
- The clean-pass path is byte-identical to today (no regression for compliant subs).
- `awardBidPackage` is called exactly as before (same args, same success handling/haptics) — only gated behind the acknowledgement; D4-1 does not change award internals or the commitment creation.
- Recording: reuse the existing commitment-notes update path (offline-queue-safe like every write). If the commitment id isn't returned/available to append synchronously, use the documented fallback (gate ships; record deferred) — never block the award on the audit-line write.
- No migration, no portal, no engine change → no schema/Netlify/cross-cutting risk.

## 6. Verification (no unit runner)

`npx tsc --noEmit` clean + manual reasoning:
- Sub with expired COI → award shows the two-step gate; step 1 names "COI expired <date>"; only after the explicit second "Award & accept risk" does `awardBidPackage` run; the commitment notes carry the recorded override line.
- Sub with failed/needs-info prequal (non-COI criteria) → blockers list those findings; same two-step gate.
- Sub with no prequal packet → "No prequal packet on file" blocker → two-step gate.
- Fully compliant sub (engine `pass`, COI ok) → unchanged single "Award this bid?" one-tap; no extra friction; no override line written.
- Cancel at either step → no award, no commitment, no notes write.
- Every other buyout-package behavior + `awardBidPackage` internals + other screens byte-unaffected.
- Final whole-impl review (opus).

## 7. Out of scope / future (decomposed)

- **D4-2:** payment-path gating — conditional/unconditional lien waiver required at draw/final; COI valid at sub payment. Touches the invoice/draw/payment flow. Own spec.
- **D4-3:** per-project enforceable "require prequal + valid COI" hard policy (block with NO override) — policy data model + UI, layered on D4-1. Own spec.
- COI endorsement-specific checks (additional insured / waiver of subrogation), automated COI re-request on expiry — future.

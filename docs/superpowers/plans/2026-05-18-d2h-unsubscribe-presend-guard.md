# D2-H Pre-Send Unsubscribe Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `invoice-dunning` and `homeowner-weekly-digest` consult the `is_email_unsubscribed` RPC before sending — skipping suppressed recipients without advancing dedup markers — via one shared helper in `_shared/email.ts`.

**Architecture:** Add `isEmailUnsubscribed(supabaseUrl, serviceRoleKey, email, eventKey)` to `supabase/functions/_shared/email.ts` (beside the peer network helper `resendSend`), byte-mirroring `notify`'s RPC call. Wire a fail-open pre-send guard into each scheduler at the point its recipient is resolved; suppression returns the existing no-marker skip path.

**Tech Stack:** Deno edge functions (Supabase), TypeScript, `fetch` to Supabase REST RPC. No test runner in repo; edge fns are tsconfig-excluded → gate is `npx tsc --noEmit` (app-regression check) + structured hand-walk + per-task review.

**Spec:** `docs/superpowers/specs/2026-05-18-d2h-unsubscribe-presend-guard-design.md`

---

### Task 1: Shared `isEmailUnsubscribed` helper in `_shared/email.ts`

**Files:**
- Modify: `supabase/functions/_shared/email.ts` (header comment ~:1-13; add export beside `resendSend` which ends ~:600)

- [ ] **Step 1: Update the stale "Pure functions, no I/O" header line**

In `supabase/functions/_shared/email.ts`, the header block (lines ~10-12) currently reads:

```
// Deno-friendly (no Node-specific APIs, no relative-path imports past
// .. once). Pure functions, no I/O. Each helper returns an HTML string
// ready to drop into bodyHtml.
```

Replace that exact three-line passage with:

```
// Deno-friendly (no Node-specific APIs, no relative-path imports past
// .. once). The HTML/template helpers are pure and return strings; the
// two network helpers — resendSend (Resend) and isEmailUnsubscribed
// (the is_email_unsubscribed RPC) — are the file's only I/O.
```

- [ ] **Step 2: Append the `isEmailUnsubscribed` export immediately after `resendSend`**

`resendSend` ends at the line `}` closing the function near line 600 (just before the `// ─── Money formatter ───` banner). Insert this block between the end of `resendSend` and the `// ─── Money formatter` banner:

```ts
// ─── Pre-send unsubscribe check ──────────────────────────────────────
//
// Mirrors notify/index.ts's local isUnsubscribed EXACTLY at the RPC
// level: POST /rest/v1/rpc/is_email_unsubscribed with
// { p_email: <lowercased>, p_event_key }, returns true iff the address
// is suppressed for that event_key OR globally (the RPC folds global in).
// Fail-OPEN on any error (bad status, network throw): we'd rather send a
// duplicate than silently drop legitimate mail on a transient glitch —
// identical risk posture to notify, which already runs this in prod.
//
// Takes supabaseUrl + serviceRoleKey explicitly (dependency-injected,
// same style as resendSend(apiKey, opts)) because shared code can't
// close over a single function's module-scoped env constants.
export async function isEmailUnsubscribed(
  supabaseUrl: string,
  serviceRoleKey: string,
  email: string | null | undefined,
  eventKey: string,
): Promise<boolean> {
  if (!email) return false;
  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/rpc/is_email_unsubscribed`, {
      method: 'POST',
      headers: {
        'apikey': serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_email: email.toLowerCase(), p_event_key: eventKey }),
    });
    if (!r.ok) return false;
    const v = await r.json();
    return v === true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 3: Verify no app-side type regression**

Run: `npx tsc --noEmit`
Expected: exits 0 (clean). `_shared/email.ts` is tsconfig-excluded so this only proves no app regression — it does NOT type-check the edge fn.

- [ ] **Step 4: Hand-review the edit (Deno/TS correctness)**

Confirm by reading the modified region:
- The new function is `export`ed and placed at module top level (not nested inside `resendSend`).
- It uses only `fetch` / `JSON` / template literals — no Node APIs, no new imports.
- The RPC path string is exactly `` `${supabaseUrl}/rest/v1/rpc/is_email_unsubscribed` ``, body is exactly `JSON.stringify({ p_email: email.toLowerCase(), p_event_key: eventKey })`, return is `v === true`, both error branches return `false`.
- The header comment passage was replaced (no leftover "Pure functions, no I/O.").

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/email.ts
git commit -m "$(cat <<'EOF'
feat(D2-H): shared isEmailUnsubscribed pre-send helper in _shared/email.ts

Byte-mirrors notify's is_email_unsubscribed RPC call (fail-open),
dependency-injected supabaseUrl/serviceRoleKey like resendSend.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Wire the guard into `invoice-dunning` (category `payment_reminders`)

**Files:**
- Modify: `supabase/functions/invoice-dunning/index.ts` (import ~:33; guard inside `processInvoice` right after `const recipientEmail = invite.email!;` ~:263)

- [ ] **Step 1: Add `isEmailUnsubscribed` to the existing `_shared/email.ts` import**

Line 33 currently:

```ts
import { wrapEmailHtml, resendSend, emailButton, fmtMoney } from '../_shared/email.ts';
```

Replace with:

```ts
import { wrapEmailHtml, resendSend, emailButton, fmtMoney, isEmailUnsubscribed } from '../_shared/email.ts';
```

- [ ] **Step 2: Insert the pre-send guard after the recipient is resolved**

In `processInvoice`, locate (around line 262-263):

```ts
  const invite = invites[0];
  const recipientEmail = invite.email!;
```

Immediately after the `const recipientEmail = invite.email!;` line, insert:

```ts

  // Pre-send suppression: if this address unsubscribed from payment
  // reminders (or globally), skip WITHOUT advancing dunning_stage /
  // dunning_last_sent_at — those are only written after a confirmed
  // send below, so 'skipped' loses nothing if they later re-subscribe.
  if (await isEmailUnsubscribed(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, recipientEmail, 'payment_reminders')) {
    console.log('[invoice-dunning] recipient unsubscribed — skipping, dunning_stage not advanced', invoice.id);
    return 'skipped';
  }
```

- [ ] **Step 3: Verify no app-side type regression**

Run: `npx tsc --noEmit`
Expected: exits 0 (clean). Edge fn is tsconfig-excluded; this guards against accidental app-side breakage only.

- [ ] **Step 4: Hand-walk the control flow**

Read `processInvoice` start-to-end and confirm:
- The guard sits AFTER `recipientEmail` is known and BEFORE the company-name lookup / `buildDunningHtml` / `resendSend`.
- `'payment_reminders'` matches the `eventKey` already used in `buildDunningHtml`'s `unsubscribe` (:196 area) and the `resendSend` `unsubscribe` (:319 area).
- Returning `'skipped'` reaches NO `dunning_stage`/`dunning_last_sent_at` `.update(...)` (that update is later, only after `sendResult.ok`).
- Both the single-invoice and cron callers already treat `'skipped'` as a normal non-error outcome (no caller edit needed).
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are the existing module-level constants (:35-36) — in scope here.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/invoice-dunning/index.ts
git commit -m "$(cat <<'EOF'
feat(D2-H): invoice-dunning pre-send unsubscribe guard

Skip suppressed recipients (payment_reminders / global) before send;
return 'skipped' so dunning_stage is not advanced — nothing lost.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Wire the guard into `homeowner-weekly-digest` (category `weekly_digest`)

**Files:**
- Modify: `supabase/functions/homeowner-weekly-digest/index.ts` (import ~:37; guard as first statement inside `for (const invite of invites)` in `sendForProject` ~:391)

- [ ] **Step 1: Add `isEmailUnsubscribed` to the existing `_shared/email.ts` import**

Line 37 currently:

```ts
import { wrapEmailHtml, resendSend } from '../_shared/email.ts';
```

Replace with:

```ts
import { wrapEmailHtml, resendSend, isEmailUnsubscribed } from '../_shared/email.ts';
```

- [ ] **Step 2: Insert the pre-send guard as the first statement of the invite loop**

In `sendForProject`, locate the loop (around line 391):

```ts
  for (const invite of invites) {
    const html = buildEmailHtml({
```

Insert the guard so the loop becomes exactly:

```ts
  for (const invite of invites) {
    // Pre-send suppression: skip an invite that unsubscribed from the
    // weekly digest (or globally). 'continue' does not increment `sent`,
    // so weeklyDigest.lastSentAt (stamped only when sent > 0) is not
    // advanced if ALL invites are suppressed — nothing is lost.
    if (await isEmailUnsubscribed(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, invite.email, 'weekly_digest')) {
      console.log('[homeowner-weekly-digest] recipient unsubscribed — skipping', project.id, invite.email);
      continue;
    }
    const html = buildEmailHtml({
```

- [ ] **Step 3: Verify no app-side type regression**

Run: `npx tsc --noEmit`
Expected: exits 0 (clean). Edge fn is tsconfig-excluded; this guards against accidental app-side breakage only.

- [ ] **Step 4: Hand-walk the control flow**

Read `sendForProject` start-to-end and confirm:
- The guard is the FIRST statement inside `for (const invite of invites)`, before `buildEmailHtml`/`sendEmail`.
- `'weekly_digest'` matches the `eventKey` already used in `buildEmailHtml`'s `unsubscribe` (:290 area) and `sendEmail`'s default (:313 area).
- `continue` does NOT touch `sent` or `errors`; `weeklyDigest.lastSentAt` is stamped only under `if (sent > 0 && portal)` (:421 area) → all-suppressed ⇒ `sent === 0` ⇒ not stamped (re-evaluated next Friday); mixed ⇒ stamped correctly (≥1 actually sent).
- `invite.email` is typed `string | undefined`; `invites` is pre-filtered to entries containing `'@'` (:368 area), and the helper's `if (!email) return false` is a safe no-op anyway — type-compatible with `email: string | null | undefined`.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are the existing module-level constants (:39-40) — in scope here.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/homeowner-weekly-digest/index.ts
git commit -m "$(cat <<'EOF'
feat(D2-H): homeowner-weekly-digest pre-send unsubscribe guard

Skip suppressed invites (weekly_digest / global) before send; continue
without incrementing sent so lastSentAt is not stamped if all skipped.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Whole-implementation verification

**Files:** none modified (verification only)

- [ ] **Step 1: App-regression type gate**

Run: `npx tsc --noEmit`
Expected: exits 0 (clean) — no app code was touched, so this must be unchanged from baseline.

- [ ] **Step 2: Structured hand-walk against spec §5**

Confirm each scenario by reading the final code:
- dunning, unsubscribed (category OR global): RPC→true → log emitted, `processInvoice` returns `'skipped'`, no `resendSend`, no `dunning_stage`/`dunning_last_sent_at` write.
- dunning, subscribed: RPC→false → unchanged send + marker write.
- digest, all invites unsubscribed: every invite `continue`s → `sent === 0` → `weeklyDigest.lastSentAt` not stamped.
- digest, mixed: suppressed skipped, subscribed sent, `lastSentAt` stamped (≥1 sent).
- RPC 5xx / network throw (both fns): helper returns `false` → mail still sends (fail-open).
- `notify/index.ts` untouched and behaviorally identical (its local `isUnsubscribed` is independent; grep to confirm no notify diff).

- [ ] **Step 3: Confirm scope cleanliness**

Run: `git diff --stat main...HEAD`
Expected: exactly these changed — `docs/superpowers/specs/2026-05-18-d2h-unsubscribe-presend-guard-design.md`, `docs/superpowers/plans/2026-05-18-d2h-unsubscribe-presend-guard.md`, `supabase/functions/_shared/email.ts`, `supabase/functions/invoice-dunning/index.ts`, `supabase/functions/homeowner-weekly-digest/index.ts`. No app files, no migration, no `notify`.

- [ ] **Step 4: Ship (deploy the two scheduled functions)**

Run:
```bash
supabase functions deploy invoice-dunning homeowner-weekly-digest --no-verify-jwt --project-ref nteoqhcswappxxjlpvap
```
Expected: both functions deploy successfully. No migration. (Per the standing auto-ship delegation for edge-fn deploys; reversible via re-deploy, additive + fail-open so it cannot block legitimate mail.)

---

## Self-Review

**Spec coverage:**
- Spec §3.1 shared helper → Task 1. ✓
- Spec §3.2 invoice-dunning wiring (`payment_reminders`, after recipient, return `'skipped'`, no marker) → Task 2. ✓
- Spec §3.3 digest wiring (`weekly_digest`, first in invite loop, `continue`, lastSentAt safety) → Task 3. ✓
- Spec §4 fail-open / marker integrity / no-regression → encoded in helper (Task 1 Step 2) + hand-walks (Tasks 2-4). ✓
- Spec §5 verification (tsc + hand-walk, edge tsconfig-excluded) → Task 4. ✓
- Spec §2 non-goal "do not touch notify" → Task 4 Step 2/3 explicitly verify notify unchanged. ✓
- Spec §6 out-of-scope (notify convergence, batch) → not implemented, correctly absent. ✓
- Ship command (spec header) → Task 4 Step 4. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to". Every code step shows exact code and exact insertion anchors. ✓

**Type consistency:** `isEmailUnsubscribed(supabaseUrl: string, serviceRoleKey: string, email: string | null | undefined, eventKey: string): Promise<boolean>` defined in Task 1 and called with that exact arg order/types in Task 2 (`recipientEmail: string`) and Task 3 (`invite.email: string | undefined`, accepted by the `| undefined` param). Constant names `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` match both edge fns' existing module declarations. ✓

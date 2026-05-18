# D2-H — Pre-Send Unsubscribe Guard for Bulk-Email Schedulers — Design

Follow-on hardening to **D2** (`invoice-dunning`, just shipped) + the existing `homeowner-weekly-digest`. Build target: this worktree, branch `claude/hungry-black-6b3068`, HEAD `e56d20c`. **Edge-fn-only. No app code, no OTA, no migration, no portal.** Ship = `supabase functions deploy invoice-dunning homeowner-weekly-digest --no-verify-jwt --project-ref nteoqhcswappxxjlpvap`.

## 1. Problem

The two scheduled bulk-email edge functions — `supabase/functions/invoice-dunning/index.ts` and `supabase/functions/homeowner-weekly-digest/index.ts` — send through `_shared/email.ts` `resendSend` + `wrapEmailHtml`, passing `unsubscribe: { recipientEmail, eventKey, enabled }`. That only generates the **List-Unsubscribe header + footer link** (RFC 8058 compliance). It does **not** pre-suppress a recipient who already unsubscribed.

Only `supabase/functions/notify/index.ts` does a real pre-send check: `isUnsubscribed(email, eventKey)` (notify/index.ts:154-172) → POST `${SUPABASE_URL}/rest/v1/rpc/is_email_unsubscribed` with `{ p_email: email.toLowerCase(), p_event_key: eventKey }`, returning `v === true`. So a homeowner who unsubscribed from `payment_reminders` or `weekly_digest` will keep receiving those bulk emails because the schedulers never consult the `email_unsubscribes` table before sending.

Currently a **latent gap, not a live incident** (Supabase project `nteoqhcswappxxjlpvap`: `email_unsubscribes` has rows but 0 for `payment_reminders` / 0 global). Close it before it becomes one — bulk schedulers are exactly where unwanted mail compounds.

## 2. Goal / Non-goals

**Goal:** Both scheduled bulk-email functions consult the same `is_email_unsubscribed` RPC `notify` uses, **before** sending, for each recipient. If the recipient is unsubscribed for that function's category (or globally — the RPC already folds global into the same call), skip the send (log + continue) and **do not advance that function's dedup marker**, so a still-subscribed-later recipient loses nothing.

**Non-goals (YAGNI / scope / minimal):**
- Do **not** refactor `notify`. Its local `isUnsubscribed` works in production and `notify` is **not** in the deploy list — touching it adds an out-of-scope re-test + source/deployed-drift surface. The new shared helper is byte-equivalent to notify's logic; converging notify onto it is a separate, optional cleanup. Pre-existing duplication is acceptable here.
- No new RPC, no migration — `email_unsubscribes` + `is_email_unsubscribed` already exist and are used by `notify` in prod.
- No app/OTA change, no portal change, no change to email templates or the List-Unsubscribe header path.
- No retry/queue for the suppression check — fail-open exactly like `notify` (a transient RPC error must never block legitimate mail).
- No change to the clean (subscribed) send path other than the added guard.

## 3. Approach

Three options considered:

- **A (chosen): add `isEmailUnsubscribed(supabaseUrl, serviceRoleKey, email, eventKey)` to `_shared/email.ts`, wire into both functions.** One shared definition living next to `resendSend` — which already performs network I/O in this same file, so the file's stale "pure functions, no I/O" header is updated to reflect that this is the shared *send + suppression* layer. Mirrors `notify`'s exact RPC call (path, headers, `{p_email, p_event_key}` body, `v === true`, fail-open). Minimal, no new file, matches the task's primary suggestion.
- **B: new `_shared/suppression.ts`.** Rejected — over-separation for one ~15-line network helper when `email.ts` already houses the peer network helper `resendSend`; adds import churn; task explicitly nudges toward `email.ts`.
- **C: inline the check in each function.** Rejected — duplicates the RPC logic a 3rd/4th time; the task explicitly asks to factor it into a shared helper.

### 3.1 The shared helper (`_shared/email.ts`, beside `resendSend`)

```ts
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
    if (!r.ok) return false;       // fail-open (same as notify)
    const v = await r.json();
    return v === true;
  } catch {
    return false;                  // fail-open (same as notify)
  }
}
```

"Mirror notify's exact RPC call signature" = the **Postgres RPC call** is byte-identical to notify (same path `/rest/v1/rpc/is_email_unsubscribed`, same headers, same `{ p_email: email.toLowerCase(), p_event_key: eventKey }` body, same `v === true`, same dual fail-open). The TS function gains explicit `supabaseUrl` / `serviceRoleKey` params (notify closes over module globals it cannot share) — matching the established `resendSend(apiKey, opts)` dependency-injection style in this same file. Global unsubscribe needs no extra call: the single RPC already folds "globally unsubscribed" into its boolean (notify depends on this — its comment: "opted out of this event_key (or globally)").

### 3.2 `invoice-dunning/index.ts` — category `payment_reminders`

In `processInvoice`, immediately after the recipient is resolved (`const recipientEmail = invite.email!;`, ~:263) and **before** the company-name lookup / `buildDunningHtml` / `resendSend`:

```ts
if (await isEmailUnsubscribed(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, recipientEmail, 'payment_reminders')) {
  console.log('[invoice-dunning] recipient unsubscribed — skipping, dunning_stage not advanced', invoice.id);
  return 'skipped';
}
```

`'payment_reminders'` is exactly the `eventKey` this function already passes to its List-Unsubscribe footer (:196, :319), so the pre-send check aligns 1:1 with what the recipient clicked. Returning `'skipped'` guarantees the `dunning_stage` / `dunning_last_sent_at` markers are **not** written (they are only written after `sendResult.ok` later in the function), so nothing is lost: a recipient who later re-subscribes still gets the correct stage. The cron loop already counts `'skipped'` as a normal outcome — no caller change.

Add `isEmailUnsubscribed` to the existing `../_shared/email.ts` import.

### 3.3 `homeowner-weekly-digest/index.ts` — category `weekly_digest`

In `sendForProject`, as the **first statement** inside `for (const invite of invites)` (~:391), before `buildEmailHtml` / `sendEmail`:

```ts
if (await isEmailUnsubscribed(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, invite.email, 'weekly_digest')) {
  console.log('[homeowner-weekly-digest] recipient unsubscribed — skipping', project.id, invite.email);
  continue;
}
```

`'weekly_digest'` matches the `eventKey` this function already passes to its footer (:290, :313). `continue` skips that invite without incrementing `sent` and without pushing to `errors`. Marker safety: `weeklyDigest.lastSentAt` is stamped only when `sent > 0` (:421). If every invite is suppressed, `sent` stays 0 → marker not stamped → the project is re-evaluated next Friday (and re-skipped while still unsubscribed) → nothing lost. If some invites are suppressed and others sent, stamping is still correct: at least one recipient received this week's digest and the per-project weekly marker should advance (suppressed recipients are simply, correctly, not mailed).

Add `isEmailUnsubscribed` to the existing `../_shared/email.ts` import.

## 4. Error handling / correctness

- **Fail-open** is deliberate and matches `notify`: any RPC/network error → `false` → send proceeds. We would rather send one duplicate than silently drop legitimate mail on a transient `email_unsubscribes` glitch. This is the same risk posture already running in prod via `notify`.
- **Marker integrity:** suppression returns the existing `'skipped'` (dunning) / `continue` (digest) paths, both of which already avoid writing the dedup marker when nothing was sent. No new "lost forever" path is introduced.
- **No regression for subscribed recipients:** the clean path is unchanged — one extra RPC round-trip per recipient (the same cost `notify` already pays per send) gated on the recipient actually being unsubscribed.
- **Offline/edge-safe:** pure `fetch` to the project's own REST endpoint with the service-role key both functions already hold in module scope; no new secret, no Node API, no new import. Deno/esm.sh imports unchanged.
- **No migration / RPC change:** `is_email_unsubscribed` + `email_unsubscribes` already exist and are exercised by `notify` in prod.

## 5. Verification (edge fns are tsconfig-excluded → hand-review)

- `npx tsc --noEmit` clean — must stay clean (no app code touched; this only confirms no accidental app-side regression). Edge fns are excluded from tsconfig so tsc will not type-check them; therefore also **hand-review** the three edited files for Deno/TS correctness (types, imports, no Node APIs).
- Hand-walk:
  - **dunning, unsubscribed recipient (category or global):** RPC → true → log line emitted, `processInvoice` returns `'skipped'`, no `resendSend`, `dunning_stage`/`dunning_last_sent_at` **unchanged**; next cron tick re-evaluates.
  - **dunning, subscribed recipient:** RPC → false → unchanged send + marker write.
  - **digest, all invites unsubscribed:** every invite `continue`s, `sent === 0`, `weeklyDigest.lastSentAt` **not** stamped.
  - **digest, mixed:** unsubscribed invites skipped, subscribed invites sent, `lastSentAt` stamped (correct — ≥1 sent).
  - **RPC error / 5xx / network throw:** helper returns `false` → mail still sends (fail-open) for both functions.
  - **Shared helper unused-elsewhere check:** `notify` untouched and still compiles/behaves identically (its local `isUnsubscribed` is independent).
- Per-task spec-compliance + code-quality review gates (subagent-driven), then final whole-impl review.

## 6. Out of scope / future

- Converging `notify`'s local `isUnsubscribed` onto the new shared `isEmailUnsubscribed` (optional dedup cleanup; would require re-deploying `notify`, which is not in this ship).
- Batch suppression (one RPC for N recipients) — current per-recipient call matches `notify` and is fine at scheduler volumes; revisit only if `email_unsubscribes` grows hot.
- Any other edge function that sends bulk mail without a pre-send check (none identified beyond these two; `notify` already guarded).

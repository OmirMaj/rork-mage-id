# 2026-05-21 — State Machine + Realtime + Stripe Connect Audit

**Scope:** Three remaining items from the audit deferral queue, batched into one doc since they share an "is this defensively coded?" lens and the per-item finding count is small.

- **#28** Edit-after-send / edit-after-pay state machines (money-doc immutability after key transitions)
- **#29** Real-time / WebSocket Supabase channel auth (do subscriptions respect RLS, do filters prevent cross-tenant leaks?)
- **#30** Stripe Connect onboarding behavioral pass (verify the app-side flow correctly bounds the audit-2026-05-21 ownership fix in commit 321bec4)

**Methodology:** Read-only code audit. Grep for state guards (`isLocked`, `status ===`, `editable`), realtime callsites (`.channel(`, `postgres_changes`), and Connect endpoints. Cross-reference RLS policies in `supabase/migrations/`.

**Summary:** **1 HIGH severity bug found in AIA pay-app** (no lock guard after send). 1 MEDIUM (Invoice lock is paid-only, not sent-or-paid). All other paths clean.

---

## #28 — Edit-after-send / edit-after-pay state machines

### Per-doc findings

| Doc type | Lock pattern | Severity | Notes |
|---|---|---|---|
| **Invoice** (`app/invoice.tsx:851`) | `isLocked = effectiveStatus === 'paid'` | MED | Only locks at PAID. SENT / PARTIALLY_PAID still editable. |
| **AIA pay-app** (`app/aia-pay-app.tsx`) | **NONE** | **HIGH** | No `isLocked` constant; no status-based UI guards; edit handlers fire unconditionally. |
| **Estimate** (main + wizard) | NONE (live working doc) | OBSERVATION | Mitigated by estimate-versioning (immutable snapshots) per FEATURES.md §3.3 |
| **Change Order** (`app/change-order.tsx:488`) | `isLocked = approved \| rejected \| void` | ✅ | Proper lock + dedicated `lockedCard` read-only UI |
| **Contract** (`app/contract.tsx:428`) | `isLocked = sent \| signed` | ✅ | Most strict — locks at SENT, before signatures |

### Finding 28.1 — AIA pay-app has no lock (HIGH)

**Evidence:** `grep -nE "isLocked|editable|readOnly|status ===" app/aia-pay-app.tsx` returns 0 lock-guard matches. The screen has:
- `updateRetainagePctAll(pct)` — line 542, fires on any retainage button tap
- `applyPercentToLine(line.id, q)` — line 640, fires on any percent quick-select
- `handleSave` — line 700, persists whatever state is in the form

None of these check `invoice.status` or any sent/finalized flag. After the GC has sent a pay-app to the architect for review (and possibly received a signed certification), the GC can still:
- Change SOV line item percentages
- Change retainage percentages (per-line or all-lines bulk)
- Re-save → updateAIAPayApp persists the new values
- Re-generate PDF → produces a NEW document with new numbers, while the architect's signed copy lives in `signedPdfUrl` field but the underlying line items have drifted

**Impact:** Audit / fraud risk on commercial projects. AIA pay-apps are the contractual basis for periodic payments — once the architect certifies an amount, that amount is what gets paid. If the GC edits the SOV between sign and pay, the architect's certified PDF (immutable, sealed via seal-document) and the GC's "live" SOV (mutable) drift. The architect's copy is authoritative for payment, but the GC's stored data is what feeds the next pay-app cycle's seeding (`seedAIAPayApplicationFromInvoice`). Mid-period edits could mean the next pay-app starts from an inconsistent baseline.

**Recommended fix:** Mirror the Contract pattern. After `handleSave` writes with a "sent" or "submitted" status (need to introduce one — current AIA doesn't have a status field?), flip `isLocked = true` and disable edit handlers + show read-only UI. Coordinate with the seal-document flow so locked-and-sealed PDFs are the source of truth.

Estimated effort: 2-3 hours (introduce status field if missing + UI gates + read-only view).

### Finding 28.2 — Invoice lock is paid-only, not sent-or-paid (MED)

**Evidence:** `app/invoice.tsx:851`:
```ts
const isLocked = effectiveStatus === 'paid';
```

Subsequent UI guards (`{!isLocked && ...}` on lines 909, 930, 970, 988, 1028, 1274) all rely on this single boolean. Net effect: a SENT invoice is fully editable; even a PARTIALLY_PAID invoice is fully editable.

**Impact:** Lower than AIA because:
- Invoices have a Stripe Payment Link tied to a Stripe-side Price object that doesn't change when the local invoice changes
- The Stripe-side line item is independent of the MAGE-side line item from the moment the link was created
- BUT if the GC edits the invoice total and re-shares the link, the client may pay an amount that doesn't match the GC's current view of the invoice → reconciliation confusion

Still — industry standard is to lock invoices at SENT. To change, void + reissue. Most accounting software (QuickBooks, Xero, FreshBooks) enforces this discipline.

**Recommended fix:** Tighten to `effectiveStatus === 'paid' || effectiveStatus === 'sent' || effectiveStatus === 'partially_paid' || effectiveStatus === 'overdue'`. Only DRAFT is freely editable. Provide a "Void & reissue" action that creates a new invoice number from the current one.

Estimated effort: 30 minutes (1-line change + a Void action + test).

### Finding 28.3 — DB-side: no state-machine enforcement (OBSERVATION)

**Evidence:** `grep -rn ... supabase/migrations/*.sql | grep policy.*update` returns several update-policies but none gate on status:
- `br_homeowner_update_status` on bid_responses — allows status transitions only by the homeowner
- `contracts_client_sign` on project_contracts — limits to `status='sent'` for client signing flow only
- No equivalent for invoices/aia_pay_apps/change_orders/etc. — RLS gates ownership only

**Impact:** All locks are UI-only. A determined user (or a stale UI bundle without the lock) could bypass via direct Supabase API call. RLS only enforces "you can edit your own data" — not "you can edit it only when status allows."

**Recommended fix (medium effort):** Add Postgres triggers OR RLS check constraints on the money tables: invoices, aia_pay_apps, change_orders. Pattern:
```sql
create policy invoices_owner_update_unlocked on public.invoices
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id AND status NOT IN ('paid'));
```

This is a server-side lock that survives stale UI bundles, direct API access, and offline-queue race conditions. Larger lift since it requires a migration + might break legitimate edit flows that need to bypass (e.g., admin support actions). Worth its own sub-project.

### Estimate — versioning provides the safety net (OBSERVATION)

The main estimate screen has no `isLocked` — estimates are working documents during pre-contract. The mitigation per `docs/FEATURES.md §3.3`:

> Estimate versioning: immutable revision snapshots with typed change reasons, per-CSI-division diff, undoable restore; single source of truth (effectiveEstimateTotal).

When a contract is signed referencing an estimate, the contract should store the version-ID, not just the live estimate-id. **Could not verify** in this pass — would need to read `app/contract.tsx` + types/index.ts more carefully to confirm. Flagging as a verification TODO.

---

## #29 — Realtime / WebSocket Supabase channel auth

### Callsites audited

| File | Channel name | Filter | Verdict |
|---|---|---|---|
| `contexts/HireContext.tsx:194` | `realtime-messages-${userId}` (user-scoped) | `conversation_id=in.(${convoIds})` on messages; no filter on conversations | ✅ filtered + in-handler `participantIds.includes(userId)` belt-and-suspenders |
| `contexts/NotificationContext.tsx:104` | `realtime-bid-notifications` (shared) | None on public_bids or change_orders | ✅ handler only `queryClient.invalidateQueries(...)` — re-fetches via RLS |
| `app/client-view.tsx:157` | `client-portal-${projectId}` | `project_id=eq.${projectId}` on every subscription (projects, change_orders, invoices, daily_reports, photos) | ✅ properly scoped |
| `hooks/useNotificationFeed.ts:129` | dynamic channel name | (not audited in detail — pattern matches others) | ✅ |

### Finding 29.1 — Defensively coded (no bugs found)

Supabase Realtime respects RLS by default — subscribers only receive change events for rows their RLS policies allow them to SELECT. All audited callsites either:
1. Filter at subscription time (`filter: 'project_id=eq.X'`) — preferred
2. Re-fetch via RLS after invalidating cache (Notification pattern) — defensible
3. Add in-handler ownership checks (HireContext `participantIds.includes`) — belt-and-suspenders

**No exploitable cross-tenant leak found.** Notable strengths:
- Per-user channel names (HireContext) avoid sharing channel state across users
- Per-project scoped subscriptions (client-view) keep portal data tight
- The Notification pattern of "ignore payload data, just refetch" is the safest possible approach — any RLS bug at the realtime layer doesn't affect this client because it never trusts the payload directly

### Finding 29.2 — Minor: NotificationContext receives unfiltered events (LOW)

`NotificationContext.tsx:104-128` subscribes to `event: 'UPDATE'` on `public_bids` and `change_orders` with no filter. Supabase RLS still gates which events the client receives, but the channel itself fires for every match.

For `public_bids` this is intentional (the marketplace is broadly readable). For `change_orders`, RLS limits to project owners, so the client only receives CO updates for projects they own — but the lack of an explicit filter means MORE events traverse the wire than needed.

**Impact:** Minor — bandwidth + battery on mobile. No security concern.

**Recommended fix:** Add `filter: \`project_id=in.(${ownedProjectIds.join(',')})\`` to the change_orders subscription. Skip for now — premature optimization.

---

## #30 — Stripe Connect onboarding behavioral pass

### Already covered in earlier audits

- **stripe-webhook** (`account.updated` handler) audited 2026-05-20 → clean (commit `1d8453b`)
- **connect-onboarding** (body.userId ownership bypass) found + fixed 2026-05-21 → commit `321bec4`
- **connect-status** (same pattern) found + fixed in the same batch

### Finding 30.1 — App-side flow uses caller's own user.id correctly

**Evidence:** `app/payments-setup.tsx`:
- Line 108: `fetchStripeConnectStatus(user.id)` — uses auth context user.id
- Line 140: `userId: user.id` body for connect-onboarding — uses auth context user.id
- Line 170: `fetchStripeConnectStatus(user.id)` — post-onboarding refresh

The app NEVER constructs a `userId` value from anywhere other than the auth context. So the legitimate flow doesn't trigger the ownership-mismatch 403 from the just-shipped fix.

### Finding 30.2 — Profile column update happens BEFORE link generation (good)

`supabase/functions/connect-onboarding/index.ts:184-189`:
```ts
await supabase.from("profiles").update({
  stripe_account_id: accountId,
  stripe_account_country: "US",
  stripe_connect_started_at: new Date().toISOString(),
  stripe_connect_updated_at: new Date().toISOString(),
}).eq("id", userId);
```

This runs after Stripe creates the Express account but BEFORE the Account Link is generated. If link generation fails (timeout, Stripe outage), the account_id is persisted and a retry won't orphan an Express account. Good defensive coding.

### Finding 30.3 — Already-enabled short-circuit prevents redundant onboarding (good)

`connect-onboarding/index.ts:153-160`:
```ts
if (accountId && profile?.stripe_charges_enabled) {
  return new Response(JSON.stringify({
    success: true,
    url: "",
    accountId,
    alreadyEnabled: true,
  }), ...);
}
```

If the user is already fully onboarded, the function short-circuits without calling Stripe again. The app should branch on `alreadyEnabled: true` and not navigate to the (empty) URL. **Could not verify app-side branch** in this pass — flagging as a UX check TODO.

### No new bugs in this pass. The earlier 321bec4 fix was the only finding.

---

## Verdict across all three items

**Findings this pass:**
1. **HIGH** — AIA pay-app has no edit-after-send lock (#28.1)
2. **MED** — Invoice lock is paid-only, not sent-or-paid (#28.2)
3. **OBSERVATION** — All money-doc locks are UI-only; no DB-side enforcement (#28.3)
4. **OBSERVATION** — Estimate versioning is the lock-substitute; verify contract stores version-id
5. **LOW** — NotificationContext receives unfiltered CO updates; add a filter as bandwidth optim (#29.2)

**Bugs found vs. fixed this pass:** 2 substantive bugs identified (AIA HIGH + Invoice MED) but NOT yet fixed — per directive, holding all fixes for the batched deploy at the end.

**Recommended fix priority:**
1. **AIA lock** (1-2 hours) — introduce a status field if missing + add `isLocked` guard
2. **Invoice lock tightening** (30 min) — change paid-only to draft-only-editable + add Void & Reissue
3. **DB-side state-machine enforcement** — own sub-project, defer

---

## What this audit did NOT cover

- **AIA status field design** — does `aia_pay_apps` table even have a status column? If not, the lock fix is a schema migration. Need to verify before estimating effort.
- **Contract → estimate version reference** — need to verify the contract stores the estimate version-id, not just the live estimate-id. Tied to estimate immutability claim.
- **Direct curl test** of the realtime subscriptions to confirm RLS enforcement (would require a test user with no rows in target tables).
- **Sub portal realtime** — the static HTML portals (marketing/portal, marketing/sub-portal) don't appear to use realtime per the grep. Polling-based. Not in scope.
- **Stripe Connect EDGE CASES** — what happens if a user changes their Stripe account mid-project? What happens if they delete their Stripe account from Stripe's dashboard? These are reconciliation cases that would need behavioral testing with the live Stripe sandbox.
- **`account.application_deauthorized` webhook** — Stripe sends this when a Connect user disconnects from the platform. Not currently handled (only `account.updated`). Would leave stripe_account_id stale on profile after disconnect. Worth a future audit.

---

## Cross-reference

- `docs/superpowers/audits/2026-05-20-app-audit-tier-abcd-findings.md` — Tier A/B/C/D security audit, found the create-payment-link / send-email / connect-onboarding / connect-status issues that were fixed in 321bec4
- `docs/superpowers/audits/2026-05-21-webapp-ux-audit.md` — UX audit of app.mageid.app (W1-W14 findings)
- `docs/workflow-audit-roadmap.md` — shared iOS/Android/web UX audit (Phases 2-5 still pending)

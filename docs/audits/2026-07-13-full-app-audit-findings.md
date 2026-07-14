# Full-app audit — findings & triage (2026-07-13)

13-domain adversarial audit + a quick-wins scout. The adversarial *verify* layer
was cut short by session limits, so items below marked "unverified" are
plausible-not-confirmed — each needs a read-through before fixing. Items I
confirmed myself (by reading code or the live DB) are marked "CONFIRMED".

---

## ✅ Fixed on branch `claude/full-app-hardening`

| Fix | Commit | Confidence |
|---|---|---|
| Scheduler `startDate` stamped on first edit → silent finish-day jump (+ rebase + start-date setting UI) | `6c8126a` | CONFIRMED (reproduced live) |
| Project **edits never synced** — plain insert on existing PK terminally dropped; edits reverted on next launch | `eb5640e` | CONFIRMED (code trace) |
| Offline queue: FK violations no longer terminal (parent/child out-of-order drain); dropped-write toast+Sentry; profile/settings writes through queue | `eb5640e` | CONFIRMED |
| Conversation start/message-preview writes bypassed queue → offline chats orphaned their messages | `9f007e7` | CONFIRMED |
| Marketing: 7 `support.html#` guide anchors demo.html links to didn't exist; builders canonical/sitemap mismatch + missing description | `9c9edc5` | CONFIRMED (source) |
| CO / BO- / OAC numbering used `length+1` → duplicate numbers after a mid-list delete | `6077a0c` | CONFIRMED |

---

## 🔒 CONFIRMED — owner-gated (live infrastructure)

**Client-portal cross-tenant RLS exposure (P0).** See
`docs/security/2026-07-13-portal-rls-exposure.md`. Confirmed live: anon can dump
every tenant's portal snapshots, contracts, signatures, selections. Ready-to-apply
Part A (drop unused contract/selection public reads) + designed Part B (token-gate
snapshot/message reads — needs a coordinated portal deploy). **Not auto-applied.**

---

## 💰 Financials — ✅ ALL 6 VERIFIED + FIXED on branch (2026-07-13)

Each was verified against the real invoice/estimate/Stripe code by a dedicated
reviewer, then adversarially re-checked (a skeptic tried to prove it a false
positive or that the fix would mis-bill). **All 6 came back CONFIRMED and every
one survived the skeptic** (`refuted: false`). Money math extracted to the
validator-covered `utils/invoiceBilling.ts`.

| # | Finding | Commit | Fix |
|---|---|---|---|
| 1 | Bill-from-Estimate progress invoices **double-scaled** on reopen (30% of stored-30% = 9%); corrupted subtotal saved back | `5807818` | `progressSubtotal()` skips invoice-level scaling when any line is pre-scaled; Billing % field hidden for those invoices; self-heals on next save |
| 4 | Emailed pay link charged **gross `totalDue`, ignoring retention** (in-app button already netted it) | `5807818` | both send paths now charge the retention-net balance (`balanceDue` / `netBalanceDue()`) |
| 5 | Estimate **markup in `lineTotal` but not `unitPrice`** → `qty × price ≠ total` on the PDF | `5807818` | `markupInclusiveUnitPrice()` folds markup into the shown unit price; `total` stays authoritative so the charge is unchanged |
| 2 | `updateInvoice` **clobbered Stripe-webhook payments** — every edit rewrote stale `amount_paid`/`payments`/`status` | `8d1912f` | conditional payload: reconciliation columns written only when a payment field actually changed |
| 6 | "Already billed" summed **raw line totals** → editor progress lines counted at 100%, blocking the remainder | `3b939a4` | both reducers weight each line via `billedAmountForLine(li, inv)` |
| 3 | Refetch **dropped retention / pay-link fields** (no DB column) → permanent loss on window-focus refetch | `fdf7bd6` | migration `20260713120000` adds the columns; write + map hydrate them (`?? null` so pay-link clears propagate) |

### ⚠️ Owner-gated follow-ups these fixes depend on
- **Apply migration `20260713120000` to prod BEFORE the OTA ships** (#3). The
  offline queue 400s on unknown columns and drops the invoice write — the same
  hazard as the punch_location gate. Migration-first, then OTA.
- **One-time historical reconcile** (#1, #3, #4): invoices already corrupted by
  the double-scale, and existing on-device retention/pay-link values with no
  cloud copy, and pre-existing gross pay links, need a one-pass recompute/upload.
  The fixes stop all *future* loss; they do not retroactively repair rows.
- **Manual-payment race** (#2 residual): the manual payment entry still
  read-modify-writes from stale local `amountPaid`, so a manual entry racing a
  webhook can still drop the Stripe credit. Durable fix = re-read / realtime
  before that write.

### Adversarial review of the fixes (post-implementation)
A second workflow put one skeptic on each fix trying to prove it introduced a
NEW regression. 3/5 clean; it caught **2 real regressions**, both fixed:
- **already-billed** (`progressSubtotal` gates per-invoice, but `billedAmountForLine`
  scaled per-line) → a MIXED invoice (voice-added line on a bill-from-estimate
  invoice) under-counted already-billed → double-charge exposure. Fixed by
  threading the invoice-level pre-scaled gate so `sum(billedAmountForLine) ===
  progressSubtotal` for every invoice (validator invariant added).
- **paylink-retention** — the pay-link charge went net but the email still showed
  gross, so the client saw a "$100k" button that charged $90k. Fixed: email
  headline + subject now show the net collectible (matches the charge).

## 🛡️ Tier-gating / server security — UNVERIFIED (needs DB + edge-fn read)
1. Monthly AI-cap RPC not pinned to `auth.uid()` — one user could exhaust another's quota.
2. Daily-usage RPCs likewise unpinned.
3. Pro-only AI text features (Bid Leveling, Weekly Analysis) gated client-side only, no server `requireTier`.

## 🧭 Routing / sharing — UNVERIFIED, client-side (safer to fix next)
1. **Public share routes `/shared-schedule`, `/shared-photos` auth-walled** → every external share link bounces to `/login` (high impact — breaks the whole share feature). *Verify against `app/_layout.tsx` auth gate + the shared-* screens.*
2. Crew claim magic link `rork-app://claim-crew?token=…` rewritten to `/` by `redirectSystemPath`.
3. Collaborator invite emails link to `https://mageid.app/invite/<id>` — no such route (marketing 404).
4. Photo-timeline share links on native use marketing host (`mageid.app`) not `app.mageid.app`.
5. Schedule share on native shows a relative URL in an Alert — unusable on iOS.
6. `property_manager` persona gets the full contractor sidebar on desktop while the tab bar hides those destinations (CLAUDE.md "keep sidebar+tabs in sync").

## 📅 Scheduler UI — UNVERIFIED (desktop Pro grid/Gantt)
1. BarView drag/link PanResponders frozen at mount → second drag reads stale geometry, teleports the bar, commits wrong dates.
2. Task-name gutter rendered outside the vertical ScrollView → names desync from bars on scroll.
3. "Due by" column computes deadline variance in calendar days vs a working-day EF → wrong late/early on 5-day weeks.
4. Board-tab card tap is a dead button (`setSelectedTaskId` has no consumer).
5. `rowNum` body cells omit the web sticky style their header + offset math assume.
6. Enter/ArrowDown navigation can target hidden (collapsed-summary) rows.

## 🧹 Other quick-wins from the scout (unverified)
- AI credit consumed **before** the model call → burned on upstream failure (edge-fn; increment-after-success like siblings already do).
- `deleteProject` doesn't cascade — orphaned invoices keep counting in "Outstanding"/SmartInbox forever.
- **Empty-successful-fetch treated as failure** across ~24 ProjectContext queries → deleted records resurrect across devices. ⚠️ NOT a blind flip: trusting an empty server can *wipe* local data not yet uploaded (esp. right after the sync-drop fix above). Needs a real reconcile (union by id + delete tombstones), not `data.length > 0` → `data`.
- Face ID login breaks silently after a password change (stored SecureStore creds not refreshed).
- Discover tab shows hardcoded vanity counts (1,317 / 2,957 / 869) over empty lists.
- RFP bid-review flashes "Not your project" while the owner's query is still loading.
- Stripe pay-link receipt polish + double-payment guard.

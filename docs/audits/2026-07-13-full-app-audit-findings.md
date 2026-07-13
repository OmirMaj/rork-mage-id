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

## 💰 Financials — UNVERIFIED, do NOT fix blind (live money)

Each needs verification against the actual invoice/estimate/Stripe code before any
change; a wrong "fix" here mis-bills real clients.
1. Progress invoices from Bill-from-Estimate **double-scaled** when reopened in the editor.
2. Local `updateInvoice` **clobbers Stripe-webhook-recorded payments** in Supabase.
3. Invoice refetch mapping **drops retention / pay-link / portal fields** — restart wipes them.
4. Emailed pay link charges **full `totalDue`, ignoring retention** (disagrees with the other two pay-link paths).
5. Estimate **markup excluded from invoice `unitPrice`** → `qty × price ≠ total` on invoices/PDFs.
6. "Already billed" counts **full unscaled line totals** from editor-created progress invoices → blocks billing the remainder.

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

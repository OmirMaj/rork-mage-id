# Send to Client Portal — Design

**Date:** 2026-05-26
**Status:** Approved — ready for implementation plan
**Scope:** Add an explicit "Send to Client" workflow per portal-bound item type, plus a project-level Client Outbox that surfaces what's still in draft. Two tiers — formal/financial items default to Draft and require explicit Send, operational/high-volume items default to Sent with a per-project auto-share toggle. Existing items (pre-this-feature) grandfather as Sent so nothing disappears from active client portals.

## Goal

Give general contractors deliberate control over what reaches the client portal, when, with notifications. Today, items auto-flow into the portal payload the moment their section toggle is on — a half-typed Change Order can leak. The user wants industry-standard CO/Invoice send semantics ("Sent on May 27, Viewed on May 28") plus a single place to see what's still in draft.

## Background

- `utils/portalSnapshot.ts` builds the client-portal payload at share time from project state, gated only by section-level toggles (`portal.showInvoices`, `portal.showChangeOrders`, etc.).
- `portal_messages` (Supabase table + realtime channel) + `portal_message` push notification type are already wired (`app/notifications-settings.tsx:50`, `app/notifications-inbox.tsx`, `app/client-messages.tsx`). We re-use both — no new notification infra.
- Punch list was recently filtered to open/in-progress only (prior portal-polish work). That stays.

## Tiering

Three tiers of behavior, one shared data shape (`PortalState`).

### Tier 1 — Draft-by-default, explicit Send required

Formal / high-stakes items. New items default to `portalState.status = 'draft'` and never reach the portal until the contractor taps Send.

- Change Order
- Invoice
- AIA Pay Application
- RFI
- Submittal

### Tier 2 — Sent-by-default, per-item Recall + project-level auto-share toggle

High-volume operational items. New items default to `portalState.status = 'sent'`. Contractor can Recall any single item. A new project-level **Auto-share with client** toggle group flips the default per type (off → draft-by-default for that type, on → sent-by-default).

- Daily Reports
- Photos
- Selections
- Warranties

### Tier 3 — No `portalState` (no change)

Already curated/filtered. No design change.

- Punch list (open/in-progress filter stays the source of truth)

## Data model

### `PortalState` (one shared interface)

```ts
// types/index.ts — new shared type
export interface PortalState {
  status: 'draft' | 'sent' | 'recalled';
  /** ISO timestamp of the most recent Send action. */
  sentAt?: string;
  /** Server-side first-view timestamp (set by portal-mark-viewed). */
  viewedAt?: string;
  /** Increments on every Send (initial Send → 1, re-send → 2, …).
   *  Used to detect "Unsent edits since last send" and to clear viewedAt
   *  on re-send so the client should re-view the new revision. */
  sentVersion?: number;
  /** Snapshot of the item at last Send. The portal renders THIS, not live
   *  state — so edits-after-send never leak to the client. JSON string,
   *  capped at 32 KB per row; truncated with a header if larger. */
  lastSentSnapshot?: string;
}
```

Add `portalState?: PortalState` (optional, additive — preserves backward compat) to all 9 affected interfaces:

- `ChangeOrder`
- `Invoice`
- `AIAPayApplication`
- `RFI`
- `Submittal`
- `DailyFieldReport`
- `ProjectPhoto`
- `SelectionCategory`
- `Warranty`

### Project-level auto-share toggle

Add to the existing `Project.portal` settings (or `Project.settings.portal` — check which is canonical in `types/index.ts`):

```ts
portal: {
  // … existing fields (showInvoices, showChangeOrders, etc.) stay
  autoShare?: {
    dailyReports?: boolean; // default: true
    photos?: boolean;       // default: true
    selections?: boolean;   // default: true
    warranties?: boolean;   // default: true
  };
};
```

`undefined` (existing projects) → all defaults true → existing client portals see no change.

### Backward-compat rule (existing items)

An item with `portalState === undefined` is treated as **Sent** by the snapshot filter. This preserves what every active client portal currently displays — no silent disappearances. Net effect:

- Existing project, existing CO → still shows in portal after upgrade.
- Existing project, new CO → defaults to `{ status: 'draft' }` → does NOT show until explicit Send.
- Existing project, new photo → defaults to `{ status: 'sent' }` (per Tier 2) → shows.

No migration script needed — purely a runtime semantic.

### Migration

Two additive Supabase migrations (no breaking changes):

1. `20260527XXX000_portal_state_columns.sql` — adds nullable jsonb `portal_state` column to: `change_orders`, `invoices`, `aia_pay_applications`, `rfis`, `submittals`, `daily_field_reports`, `photos`, `selections`, `warranties`.
2. (Same file or a second) — adds nullable jsonb `auto_share` field inside `projects.client_portal` (already jsonb, just nested key — no schema change required if the column is jsonb).

`portal-mark-viewed` edge fn migration: none required — writes back to the same `portal_state` jsonb.

## `portalSnapshot.ts` filter

Add one helper + apply at each section serializer:

```ts
const isShared = (s?: PortalState): boolean =>
  s == null || s.status === 'sent';   // undefined → grandfathered as sent

// Existing section gate (portal.showInvoices) AND per-item filter:
if (portal.showInvoices && invoices.length) {
  const visible = invoices.filter(i => isShared(i.portalState));
  if (visible.length) sections.invoices = visible.map(serializeInvoice);
}
```

Repeat for the 9 sections that gain `portalState`. The portal payload reads `lastSentSnapshot` per item when populated (so the client always sees the snapshotted version, never edits-since-send); falls back to live serialization when `lastSentSnapshot` is missing (grandfathered items).

## Per-item UI

A reusable component pair from Phase 1, dropped onto each affected detail screen:

### `<PortalStatusPill />`

Renders one of:

- 🟠 **Draft** — Not shared with client (Tier 1 default for new items)
- 🟢 **Sent · May 27** — Compact date for `sentAt`
- 🔵 **Viewed · May 27 3:14 pm** — Replaces Sent pill once `viewedAt` set
- ⚫ **Recalled** — Hidden from client; show as info pill with subtle styling
- 🟡 **Unsent edits** — Item's `updatedAt > sentAt` (computed; not a stored status)

### `<SendToClientButton />`

Sticky bottom action, primary color:

- `status = 'draft'` → "**Send to Client**" (orange primary). Disabled when item validation fails (e.g., CO with no line items).
- `status = 'sent'` with no unsent edits → "**Recall from Client**" (outlined, subtle). Tap → confirm → flips to `recalled`.
- `status = 'sent'` with unsent edits → "**Re-send updated**" (primary) + a "**Recall**" overflow option.
- `status = 'recalled'` → "**Re-send to Client**" (primary). Re-send clears `recalled` → `sent`.

A small `?` info icon next to the pill opens a tooltip explaining the state ("This item is not yet visible to the client. Tap Send to share.").

### Screens that get the pair

- `app/change-order.tsx` (Tier 1)
- `app/invoice.tsx` (Tier 1)
- `app/aia-pay-app.tsx` (or wherever AIA detail lives — confirm at impl time) (Tier 1)
- `app/rfi-detail.tsx` (Tier 1)
- `app/submittal-detail.tsx` (Tier 1)
- `app/daily-report-detail.tsx` (Tier 2 — UI is identical, just different default)
- `app/photo-detail.tsx` or the photo modal in `project-detail.tsx` (Tier 2)
- `app/selection-category.tsx` (Tier 2)
- `app/warranty-detail.tsx` (Tier 2)

## Client Outbox tray

### Entry point

New row at the top of `app/project-detail.tsx`, just above the existing "Portal Messages" row:

```
┌─────────────────────────────────────────┐
│ 📤 Client Outbox                     3 ›│
│ Drafts ready to send                    │
└─────────────────────────────────────────┘
```

Badge = drafts + unsent-edits. Zero → row hides itself.

### Outbox screen — `app/client-outbox.tsx` (new)

```
CLIENT OUTBOX — {Project name}

DRAFTS (3)
🟠 Change Order #4 · Foundation upgrade · +$12,400
🟠 Daily Report · May 27
🟠 RFI #2 · Tile grout color
[ Send all 3 to client ]   (primary; tap to confirm)

UNSENT EDITS (1)
🟡 Invoice #3 · Sent May 20, edited yesterday
[ Re-send updated ]

RECENTLY AUTO-SHARED (today · 12)     [chevron — collapsed by default]
  📷 8 photos from today's pour
  📋 Daily Report — May 27
  🎨 3 new flooring selections

RECENTLY SENT MANUALLY (last 7 days)  [chevron — collapsed by default]
  ...
```

**Batch send** is one tap → one consolidated `portal_messages` row → one push notification (*"3 new updates from {GC}: 1 Change Order, 1 RFI, 1 Daily Report"*).

Tapping an outbox row opens the item's detail screen.

### Auto-share digest line

The "RECENTLY AUTO-SHARED" section answers "what slipped through under the auto-share toggle?" — protects contractors from "oh wait I shared that photo accidentally" moments. Each row has a per-item Recall affordance.

## Notification path

**On Send (single or batch):**

1. Optimistic local mutation. `portalState.status = 'sent'`, `sentAt = now`, `sentVersion += 1`, `lastSentSnapshot = JSON.stringify(serializedItem).slice(0, 32_000)`.
2. `supabaseWrite` queues the update (offline-safe via existing offline queue).
3. One `portal_messages` insert with system-generated body. Single send → item-specific (`"📋 New Change Order #4 from {GC} — Foundation upgrade ($12,400). Tap to review."`). Batch send → consolidated (`"3 new updates from {GC}: 1 Change Order, 1 RFI, 1 Daily Report"`).
4. Push notification fires via the existing `portal_message` notification type. No new notification plumbing.
5. Email fallback (only if the client opted in AND the portal hasn't been opened in 24h) re-uses the existing Resend integration in `backend/hono.ts` `/email/send`. Email contains a deep link to `mageid.app/portal/<id>?focus=<itemType>-<itemId>`.

**On Recall:** flips `status = 'recalled'`. Item disappears from the next portal refresh. A small `portal_messages` row inserts (*"{GC} removed CO #4 — please disregard."*). Visible recall is the user-trust-preserving option — silently making content disappear feels broken.

**On Re-send (revision):** bumps `sentVersion`, refreshes `lastSentSnapshot`, clears `viewedAt`. Fresh `portal_messages` row. Client gets a new notification.

**On Edit-after-send:** **no auto-revert to draft**. The portal renders `lastSentSnapshot`, so live edits never leak. Detail screen shows the 🟡 Unsent edits pill until the user re-sends.

## `viewedAt` capture (server-side)

New tiny edge function `portal-mark-viewed` (or extend an existing portal RPC if naming aligns):

- Public endpoint (no JWT; the portal page is unauthenticated by design — same trust model as the existing public-portal access-token RPCs in `20260523070726_portal_access_token.sql`).
- Body: `{ portalId, accessToken, items: [{ kind: 'co'|'invoice'|..., id: string }] }`.
- Validates `accessToken` against the project's `client_portal.access_token` (existing field).
- For each `(kind, id)` pair, looks up the row by owner/project + `id`, and writes `portal_state.viewed_at = now()` **only if currently null** (first-view-only timestamp).
- Rate-limited by IP via the same pattern as `portal_choose_selection`.

`marketing/portal/index.html` calls this endpoint once per page mount with the visible items' IDs. Contractor sees the "🔵 Viewed · …" pill on next refresh of their detail screen / Outbox.

## Edge cases

| Case | Behavior |
|---|---|
| Existing item (pre-feature) | `portalState === undefined` → treated as Sent → no client portal disappearance. |
| Edit after send | `lastSentSnapshot` stays — portal shows last sent version. Detail screen shows 🟡 Unsent edits pill. No auto-revert to draft. |
| Recall + the client already viewed | Recall still fires + system message ("CO #4 removed"). Auditable, transparent. |
| Batch send across multiple types | One `portal_messages` row + one push. Sent items each get their own `sentAt`, `sentVersion`. |
| Send while offline | Queued via `supabaseWrite`. Optimistic local state immediately updates. Client notification fires once online — accepted UX tradeoff (no industry app pushes faster than the device's online state). |
| Tier 2 item created while auto-share is OFF for that type | Item defaults to `'draft'` — joins Tier 1's workflow. |
| Tier 2 item recalled while auto-share is ON | Stays recalled. Auto-share doesn't override per-item Recall. |
| Item deleted | If `status === 'sent'`, write a portal_messages row ("CO #4 removed by {GC}.") before deletion. Same trust principle as Recall. |
| Free-tier user | Outbox + Send buttons visible; tap → existing client-portal paywall opens. Pro+/Business+ users get full access (matches existing Pro client-portal gating). |

## What's deliberately NOT in scope (Phase 1 v1)

- **Revision history UI** (showing "CO #4 v1, v2, v3" to the contractor). `sentVersion` is captured for future use but not surfaced in this phase.
- **Client-side acknowledgment buttons** ("Acknowledge", "Approve"). Selections + signing already have their own approval RPCs; we don't duplicate that here.
- **Per-photo Send toggle within a photo batch.** Photos are Tier 2; if the user wants to review each photo individually, they turn the auto-share toggle off for photos → all new photos go to Outbox.
- **Public portal email digest (daily/weekly).** A later phase if data shows clients miss notifications.

## Testing & ship gates

- `npx tsc --noEmit` clean repo-wide.
- Manual walkthroughs:
  1. **Tier 1 happy path** — Create CO → 🟠 Draft pill visible → Send → 🟢 Sent pill → open `mageid.app/portal/<id>` → CO appears → tap-through → contractor's detail screen refreshes → 🔵 Viewed pill appears.
  2. **Tier 1 recall** — Send CO → Recall → portal refresh → CO disappears + system message appears in portal_messages thread.
  3. **Tier 1 edit-after-send** — Send CO → edit → 🟡 Unsent edits pill appears → portal still shows old version → Re-send → portal updates.
  4. **Tier 2 auto-share happy path** — Upload photo → no pill on item (it's Sent immediately) → portal shows it → toggle off Photos auto-share → upload another photo → goes to Outbox.
  5. **Outbox batch send** — 3 drafts → one tap "Send all" → one push notification to client device.
  6. **Migration** — existing test project's portal renders identically before vs after the upgrade (sanity check that grandfathered items still show).
- No unit runner exists in this repo; gating is `tsc --noEmit` + the final-implementation review + the manual walkthroughs above.
- **Ship path** — OTA for the app (JS-only). Two Supabase migrations applied via MCP. `portal-mark-viewed` edge fn deployed (`--no-verify-jwt` — same as the public-portal RPCs). `marketing/portal/index.html` deploys via the build-free `netlify deploy --dir` path with the user-supplied Netlify PAT.

## File touch list

**Create:**
- `components/PortalStatusPill.tsx` — shared status pill
- `components/SendToClientButton.tsx` — shared send/recall/re-send action
- `app/client-outbox.tsx` — Outbox screen
- `supabase/functions/portal-mark-viewed/index.ts` — viewed-at tracker
- `supabase/migrations/20260527000000_portal_state_columns.sql` — additive jsonb columns

**Modify:**
- `types/index.ts` — `PortalState` + `portalState?` on 9 interfaces; `Project.portal.autoShare` group
- `utils/portalSnapshot.ts` — `isShared()` helper + filter at 9 sections; read `lastSentSnapshot` when present
- `contexts/ProjectContext.tsx` — set default `portalState` per tier in `add<Type>` callbacks; implement `sendToClientPortal({ itemType, itemId })` + `recallFromClientPortal({...})` + `batchSendToClientPortal([])` + handle re-send / unsent-edits computation
- `app/change-order.tsx`, `app/invoice.tsx`, `app/aia-pay-app.tsx`, `app/rfi-detail.tsx`, `app/submittal-detail.tsx`, `app/daily-report-detail.tsx`, `app/selection-category.tsx`, `app/warranty-detail.tsx`, photo modal — drop in the two new components
- `app/project-detail.tsx` — add Client Outbox entry row
- `app/client-portal-setup.tsx` — add the Auto-share toggle group for Tier 2
- `app/_layout.tsx` — register `client-outbox` Stack screen
- `marketing/portal/index.html` — call `portal-mark-viewed` on mount

## Acceptance criteria

- Tier 1 (CO, Invoice, AIA, RFI, Submittal): new items default to Draft, do NOT reach client portal until Send.
- Tier 2 (Daily Reports, Photos, Selections, Warranties): new items default to Sent (or Draft if the per-type auto-share toggle is off).
- A 🟠 Draft / 🟢 Sent / 🔵 Viewed / 🟡 Unsent edits / ⚫ Recalled pill appears on every Tier 1 + Tier 2 detail screen.
- A Client Outbox row appears on project-detail when there's ≥1 draft or unsent-edit item.
- Send (single or batch) fires exactly ONE consolidated push notification to the client.
- Recall removes the item from the portal AND posts a "{GC} removed {item}" message in the portal_messages thread.
- viewedAt is captured first-time-only by `portal-mark-viewed` from the public portal page.
- Existing client portals continue rendering all currently-visible items after upgrade (no shock).
- `npx tsc --noEmit` clean.

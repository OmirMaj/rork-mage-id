# Client Portal — Trust + Engagement (v1) — Design Spec

**Date:** 2026-07-02
**Status:** APPROVED design ("LOOKS GOOD"), spec captured — parked while the scheduler research runs. Resume at: write plan → subagent-driven build.
**Thread:** Portal thread (thread C) of the webapp/portal audit (siblings: A webapp desktop-native polish, B scheduler surfacing — both queued). Part of the broader 4-thread activation audit (thread 1 activation shipped; thread 4 marketing deployed to mageid.app).

---

## Problem

The client portal is MAGE's headline differentiator AND the flywheel's referral engine, but the homeowner experience leaks trust and never closes the growth loop. Confirmed in code:
- Messages **poll every 15s** (`marketing/portal/index.html` ~5091) — feels laggy; the in-app `client-view.tsx`/`client-messages.tsx` already use Supabase realtime, so the static portal is behind.
- **No notifications** — the homeowner can't tell if the GC replied, sent an invoice, or needs input; they must manually revisit the link.
- **Documents section is stubbed** (`utils/portalSnapshot.ts` `sections.documents` placeholder) even though a real `ProjectDocument` model exists (`types/index.ts:3044`).
- **No in-portal payment** for AIA pay-apps (invoices have `payLinkUrl`; pay-apps don't); the signed contract PDF isn't downloadable from the portal.
- **Passcode friction** — passcode is emailed separately from the link; forwarding breaks it.
- **No referral loop** — the viral mechanic the flywheel is built around is absent.

## Goal

Make the homeowner portal a **trust glass-box**: instant messaging, proactive notifications, a real documents center, frictionless auth, in-portal payment, and one tasteful referral moment — so homeowner delight becomes GC retention + new-GC demand.

## Decisions (locked)

1. **Approach A — extend the existing static portal** (`marketing/portal/index.html` + `utils/portalSnapshot.ts` + `app/client-portal-setup.tsx` + Supabase RPC/edge/realtime). Not a rebuild (that's a future direction). Reuses proven infra.
2. **Notification channel = email** for v1 (invitee email + portal language, via existing `send-email`/`notify` edge fns, honoring `unsubscribe`). **Web-push deferred** (homeowner isn't in a native app; needs service worker + permission).
3. **Payment = hosted Stripe pay-link** (existing `create-payment-link` Connect edge fn), not embedded Elements.
4. **Referral leads with "refer your GC"** (classiest, GC-aligned) + a soft "ask your contractor for a MAGE portal" seed.
5. **Scope: all four clusters** (realtime+notify, magic-link, documents, payment) + the referral loop, in one v1.

---

## Architecture (what each unit does)

The portal is a **static page that renders a snapshot + calls anon Supabase RPCs**. Changes touch four seams:
- `marketing/portal/index.html` — the homeowner UI/JS (realtime sub, documents tab, pay CTAs, referral CTA, magic-link auth).
- `utils/portalSnapshot.ts` — the snapshot builder (add `documents`; keep section toggles + caps).
- `app/client-portal-setup.tsx` — GC config (magic-link tokens, doc visibility, referral toggle).
- Supabase — realtime on `portal_messages`, notification triggers off GC action paths, `create-payment-link` extended to AIA, magic-token verification; all following the `portal_write_rpc_hardening` RLS pattern.

## §1 — Near-realtime messaging + notifications
- **Realtime:** replace the 15s poll with a Supabase **realtime subscription** on `portal_messages` filtered by `portalId` (anon client already in snapshot). Polling stays as fallback if the channel drops.
- **Email notifications:** on GC reply / new invoice / action-needed (selection·CO·contract-sign), fire `send-email`/`notify` to the invitee's email in their portal language, with a magic-link deep-link, honoring `unsubscribe` + List-Unsubscribe. Debounce so a burst of edits = one digest, not spam.

## §2 — Magic-link (kill passcode friction)
Fold the passcode into a **per-invitee signed token in the URL** so the emailed link = complete auth (one tap, no code to copy). Revocable per invitee. Passcode stays as an **optional** extra-security toggle. Every notification email deep-links straight in.

## §3 — Documents center
Wire `sections.documents` to the real `ProjectDocument` data (contracts, lien waivers, COIs, permits, proposals, AIA billing) behind the existing `showDocuments` toggle + per-doc visibility. Render a Documents tab with view/download — including the **downloadable signed contract PDF** (`ProjectContract.signedPdfUrl`), closing a known gap. Respect the snapshot size cap (truncate/lazy-load large sets).

## §4 — In-portal payment
Extend `create-payment-link` (Stripe Connect, hosted checkout, app-fee) to **AIA pay-apps** as well as invoices; surface prominent **"Pay now"** CTAs on both. Tap → hosted checkout → `stripe-webhook` records payment → next snapshot shows paid. Gate on `payLinkUrl` presence / GC Connect status.

## §5 — Referral loop (the flywheel)
One **dismissible** CTA after a positive moment (new photos, milestone, closeout) — never on first load, never nagging. Primary: **"Refer [GC]"** (homeowner recommends their contractor → GC leads → GC retention). Secondary seed: **"Running your own project? Ask your contractor for a live MAGE portal."** Light attribution via a tracked link/referral code.

## Data & state
- Snapshot gains a `documents` array (typed subset of `ProjectDocument`, respecting visibility + caps).
- `portal_messages` realtime channel (anon, RLS-scoped to `portalId`).
- Magic token: signed, per-invitee, revocable; verified server-side (edge/RPC) — never trust client-decoded passcode.
- Payment status reflected via `stripe-webhook` → snapshot rebuild.

## Error handling
- Realtime channel failure → silent fallback to polling (no blank message pane).
- Notification send failure → logged, never blocks the GC action; homeowner still sees it on next open.
- Payment: if Connect not onboarded / no `payLinkUrl`, hide the Pay CTA (don't show a dead button).
- Oversized snapshot → truncate oldest docs/photos/messages with a "view more in-app" affordance.

## Security
- All portal reads/writes stay anon + RLS-protected per `portal_write_rpc_hardening`; new doc reads scoped to the portal's project.
- Magic token is a bearer credential — signed, expirable, revocable per invitee; passcode never serialized into the snapshot.
- Payments via Connect with `application_fee`; webhook signature-verified.
- Notifications honor `unsubscribe`.

## Testing (repo has no jest — pure-fn validate scripts + manual)
- **Pure:** snapshot builder emits `documents` respecting toggles/caps; notification-debounce/dedupe logic; magic-token encode/decode/expiry (extract pure fns, `scripts/validate-portal-*.ts`).
- **Manual:** realtime message appears <2s; notification email arrives + deep-links straight in (no passcode); documents view/download incl. signed PDF; pay-now on an invoice + an AIA pay-app; referral CTA appears only after a positive moment and is dismissible.

## Non-goals (v1)
Native mobile portal app; web-push; inline Stripe Elements; E2E message encryption; offline mode. (Candidates for a fast-follow / Approach B.)

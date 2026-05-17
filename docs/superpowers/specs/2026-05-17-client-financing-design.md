# Client Financing (Hosted-Link MVP) — Design Spec

Date: 2026-05-17
Status: design approved (sections 1–4 confirmed; illustrative-figure decision made by Claude per user delegation)
Approach: A — offer surfaces on the money documents + client portal; partner-agnostic hosted-link scaffold

## 1. Problem & intent

Contractors close more jobs when the homeowner sees "≈$420/mo" instead of
"$28,000". MAGE ID has no financing surface today (confirmed by grep:
only an unrelated cash-flow "loan" projection category exists). Goal: a
**client-financing referral surface** — the homeowner finances the job
through a licensed third-party partner, the GC is paid in full upfront,
and MAGE ID can earn referral/rev-share. This is also a retention and
sales-acceleration feature, not only a revenue line.

## 2. Hard constraints (regulatory boundary)

- MAGE ID is **never a lender**. It originates nothing, and the app
  **never collects or stores** SSN, income, or bank data.
- All applicant interaction (KYC, underwriting, terms, approval) happens
  on the **partner's hosted page**, off-app. The app only deep-links out
  and receives a coarse status back — the exact boundary the existing
  Stripe Connect onboarding already uses (`connect-onboarding` →
  `connect-status`/`stripe-webhook`).
- A disclosure renders **everywhere the offer appears**: "Financing
  provided by [Partner], a third party, subject to credit approval.
  MAGE ID is not a lender and may receive compensation."
- Any monthly figure is labeled "Estimated — not an offer. Actual terms
  from [Partner] on approval," and is shown **only** when the GC has
  configured a representative APR + term (their advertising choice as the
  merchant). Default: no number.
- Default state is **off**; explicit GC opt-in only.

## 3. Non-goals (YAGNI)

- No in-app prequal/offer rendering, no real-time APR, no application
  status timeline (that needs a signed partner API — Phase 2 / Approach B).
- No invoice factoring, material financing, or working-capital products
  (separate future products on the same scaffold).
- No multi-partner marketplace; one configured partner per GC.
- No new context provider; config rides on existing `settings`.

## 4. Architecture (3 isolated units)

1. **Config** — `settings.financing` (GC-level), persisted via the
   existing settings path (mirrors `settings.branding`). No new sync infra.
2. **Offer surface** — a shared `utils/financing.ts` is the single source
   of truth (`isAvailable`, `buildOfferUrl`, `illustrative`, `disclosure`).
   Consumed by: the invoice email builder, the estimate email/PDF, and the
   client portal. The outbound link targets a `financing-redirect` edge
   function (records the click, then 302s to the partner prequal URL with
   amount + opaque ref token prefilled).
3. **Attribution** — a `financing_referrals` Supabase row tracks the
   funnel; `financing-callback` (partner return URL/postback) and/or a
   manual GC status toggle move it forward. Edge functions mirror the
   `stripe-webhook`/`connect-status` pattern.

## 5. Data model

`types/index.ts`:

```ts
export interface FinancingConfig {
  enabled: boolean;
  partnerName: string;        // e.g. "Wisetack"
  prequalBaseUrl: string;     // partner hosted prequal page
  gcRefCode?: string;         // GC's partner/affiliate code, if any
  exampleApr?: number;        // optional — illustrative estimate only
  exampleTermMonths?: number; // optional — illustrative estimate only
  updatedAt: string;          // ISO
}
// Settings gains:  financing?: FinancingConfig

export type FinancingReferralStatus =
  | 'created' | 'clicked' | 'prequalified' | 'funded' | 'declined';

export interface FinancingReferral {
  id: string;
  projectId: string;
  gcUserId: string;
  partnerName: string;
  amountCents: number;        // amount the offer was for (0 if unknown)
  refToken: string;           // opaque; the ONLY identifier in the URL
  status: FinancingReferralStatus;
  source: 'estimate' | 'invoice' | 'portal';
  createdAt: string;
  updatedAt: string;
}
```

- `FinancingConfig` persists like `settings.branding` (ProjectContext
  settings serialize/read → Supabase). Default absent ⇒ off.
- `public.financing_referrals` table added via a committed migration
  using the repo `<timestamp>_*.sql` convention (never the dashboard).
- Referral row is **born lazily** when an offer link is built; **upsert
  on (project_id, source)** so re-sending an invoice does not duplicate.
  Status only ever moves forward (never funded→clicked).
- Writes go through the existing offline queue `supabaseWrite`
  (optimistic + queued), consistent with all writes.
- **RLS:** GC may select/insert/update rows where
  `gc_user_id = auth.uid()`. Edge functions use the service role and
  resolve a row by `ref_token` only (homeowner is anonymous — same model
  as the public portal / CO-approval inserts). The token is the
  capability; no project data in the URL.

## 6. Surfaces

- **GC setup** — a "Financing" card in `app/payments-setup.tsx` beside
  Stripe Connect: enable toggle; partner name; prequal URL (validated on
  save); optional ref code; optional example APR + term; the disclosure;
  and a "what your client sees" preview.
- **Estimate + invoice the homeowner receives** — a financing block in
  the email HTML (and the PDF where feasible): "Financing available —
  prequalify in ~2 min[, est. $X/mo]" → `financing-redirect?ref=<token>`.
- **Client portal** (`app/client-view.tsx`) — a "Finance this project"
  button + disclosure → same redirect.
- All three render from `utils/financing.ts` so copy/disclosure/URL
  cannot drift between surfaces.

**Amount source priority:** invoice total → estimate
`linkedEstimate.grandTotal` → project target budget. If none, the link
still works (generic "see options") and the illustrative figure is hidden.

**Illustrative monthly figure (decided):** shown only when both
`exampleApr` and `exampleTermMonths` are configured; standard amortized
payment from the project amount; always wrapped in "Estimated — not an
offer; actual terms from [Partner] on approval." No example configured ⇒
no number.

## 7. Edge functions (Deno, `supabase/functions/`)

- `financing-redirect` — `GET ?ref=<token>`: look up the referral by
  `ref_token` (service role); if found and status is `created`, set
  `clicked`; 302 to `prequalBaseUrl` with amount + `gcRefCode` +
  `ref_token` as the partner return key. Unknown/missing token ⇒ 302 to
  a safe MAGE marketing URL (never error to the homeowner). Always logs.
- `financing-callback` — `GET/POST ?ref=<token>&status=<...>`: validate
  token, move status forward only (`clicked→prequalified→funded`, or
  `declined`); ignore unknown tokens with 200. This is the partner
  return-URL / postback target; tolerant of partners that only support a
  return URL (no signed webhook needed for the MVP).

## 8. Error handling & edge cases

- Financing disabled or unconfigured ⇒ nothing renders anywhere.
- Empty/invalid `prequalBaseUrl` at send time ⇒ omit the block entirely
  (never render a broken link) — same graceful-degrade philosophy as the
  existing Stripe-not-connected nudge.
- Offline ⇒ referral upsert via `supabaseWrite` queue (optimistic).
- Unknown/missing `refToken` in either edge function ⇒ safe no-op /
  safe redirect + log; never a crash or a user-visible error.
- Re-send of the same document ⇒ upsert on (project_id, source);
  forward-only status transition.
- App never collects financial PII (platform safety rule and the entire
  point of the partner-hosted boundary).
- Web vs native: the app opens the redirect via `Linking.openURL` /
  WebBrowser (external); in emails it is a normal URL — no app dependency.

## 9. Verification

This RN/Expo repo has no unit-test runner. Gate = `npx tsc --noEmit`
clean across changed files, plus a manual walkthrough:

1. Enable financing in payments-setup; config persists and survives a
   reload (offline-enable also queues).
2. Send an estimate and an invoice to self → email contains the
   financing block + disclosure; the est. monthly appears only when an
   example APR/term is configured.
3. Tap the link → `financing-redirect` records `clicked` and lands on
   the partner URL with amount + `ref_token` prefilled.
4. Client portal shows the "Finance this project" button + disclosure;
   tapping behaves identically.
5. Hit the callback URL → referral status flips (and only moves forward).
6. Disabled/unconfigured → nothing renders on any surface.
7. Edge functions exercised via `curl` against the deployed functions
   (record-and-redirect; status-forward; unknown-token no-op).

## 10. Files touched

- `types/index.ts` — `FinancingConfig`, `FinancingReferral*`,
  `Settings.financing?`.
- `contexts/ProjectContext.tsx` — include `financing` in the settings
  serialize/read maps (mirror `branding`); thin `financing_referrals`
  accessor or expose for the hook.
- `utils/financing.ts` — NEW, single source of truth.
- `app/payments-setup.tsx` — NEW "Financing" card.
- invoice email builder + estimate email/PDF path — financing block.
- `app/client-view.tsx` — "Finance this project" button + disclosure.
- `supabase/functions/financing-redirect/` — NEW.
- `supabase/functions/financing-callback/` — NEW.
- `supabase/migrations/<timestamp>_financing_referrals.sql` — NEW
  (table + RLS).
- `hooks/useFinancingReferrals.ts` — NEW (react-query + realtime,
  modeled on `usePortalThread`) for the GC referral summary.

## 11. Phase 2 (out of scope, noted)

Signed-partner API: in-app real-time prequal offers, application-status
timeline, NextStepHero "offer financing" step, project-detail tile,
per-project tracker (Approach B). Same scaffold; no rework of Phase 1.

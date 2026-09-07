// constants/featureFlags.ts
//
// Ship-time kill-switches. These live in constants/ rather than inside a route
// module because more than one screen reads them: a flag defined in
// `app/(tabs)/mage-id-bids/index.tsx` made two other route modules import a
// third route module, coupling their module graphs for no reason and putting
// an import cycle one careless edit away.

// APP STORE GUIDELINE 1.2 — user-generated content.
//
// Browsing shows OTHER users' free-text scope_description, uploaded photos and
// GPS coordinates — the browse query in app/(tabs)/mage-id-bids/index.tsx
// selects all of them, and the RLS policy public_bids_select is
// `FOR SELECT TO authenticated USING (true)`. That makes
// this a UGC feed, and 1.2 requires four things before it can ship: a content
// filtering method, a mechanism to report objectionable content, a mechanism to
// block abusive users, and published developer contact info.
//
// A repo-wide search for report/block/flag functionality returns nothing, and
// there is no content_reports or blocked_users table. Shipping the feed as-is
// is one of the most reliably cited rejection reasons for marketplace apps.
//
// This flag disables BROWSING STRANGERS' POSTS ONLY. Posting an RFP and the
// "My RFPs" list are untouched, so the homeowner and contractor journeys both
// still work end to end — what goes away for 1.0 is reading other people's.
//
// To turn it on, ship the 1.2 kit (plan is in
// docs/audits/2026-09-02-launch-readiness.md #3): content_reports and
// blocked_users tables with insert-own RLS, a Report action on the browse card
// and app/rfp-detail.tsx, a Block action, `.not('user_id','in',...)` filtering
// on the browse query and on app/nearby-rfps.tsx, and a support contact in
// Settings. Mirrors the RFP_PAID_POST_ENABLED precedent in
// components/ClientPaywall.tsx.
export const RFP_BROWSE_ENABLED = false;

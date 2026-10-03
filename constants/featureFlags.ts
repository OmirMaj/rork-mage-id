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

// CONTRACTOR SERVICE AREAS — audit wave 5, finding #96.
//
// A homeowner RFP alerts only contractors whose companies row has a service
// area that covers it (supabase/functions/notify-nearby-contractors/reach.ts
// companyServesRfp). No screen in the app writes service_states or the service
// origin yet (app/notifications-settings.tsx says "that setup isn't available
// yet"), so today no post can reach anyone. While this is false the homeowner
// is told exactly that - before she posts, in the posted alert, in My RFPs -
// instead of "nobody will see this until a contractor who covers your area
// joins", which joining could never change.
//
// Flip it to true in the same change that ships a service-area editor; the
// reach copy goes back to reporting coverage by itself. The post-RFP entry
// points stay visible meanwhile (productDecision #96 - hiding them is the
// founder's call).
export const SERVICE_AREA_SETUP_ENABLED = false;

// APP STORE GUIDELINE 5.2.2 — third-party content rights (2026-10-02).
//
// The rights check for MAGE ID's first submission
// (contentfix-specs/RIGHTS-VERDICT.md, "Construction news") found that no
// publisher in the news feed has given MAGE permission: ENR's and Fine
// Homebuilding's terms forbid copying or commercial use, Construction Dive's
// and ConstructConnect's allow personal or internal use only, and
// Construction Business Owner already blocks the fetcher. Only OSHA (US
// government, public domain) is clearly free to use. The founder chose to
// HIDE Construction News for launch.
//
// While this is false: no Tools tile, sidebar row or search hit leads to
// /construction-news (utils/featureRegistry.ts HIDDEN_FEATURE_IDS), and the
// route itself redirects to Discover. Nothing is deleted — flip it to true, in
// the same change that adds back only the publishers whose written permission
// is on file (supabase/functions/construction-news/core.ts FEED_SOURCES), and
// today's screen, tile, row and search entry all return exactly as they were.
export const CONSTRUCTION_NEWS_ENABLED = false;

// APP STORE GUIDELINE 5.2.2 — Google business listings (2026-10-02).
//
// Discover > Companies shows business names, addresses and star ratings from
// Google Places, which the server copied into cached_companies for up to 90
// days. Google's terms forbid storing that content at all and require Google's
// logo where it is shown (contentfix-specs/RIGHTS-VERDICT.md, "Google business
// listings"). The founder chose to HIDE Companies for launch; the server lane
// stops the fetch and deletes the stored rows.
//
// While this is false: no Discover pill, Discover card, sidebar row or search
// hit leads to /(tabs)/discover/companies, and the route itself redirects to
// Discover. The screen is kept intact — flip this to true (with a licensed data
// source behind cached_companies) and every door returns exactly as before.
export const COMPANIES_DIRECTORY_ENABLED = false;

// APP STORE GUIDELINE 5.2.2 — Selections product photos (2026-10-02).
//
// The og-image edge function used to copy a retailer's product photo (og:image
// from the option's product link) or a Pexels stock photo onto each Selections
// option. MAGE has no retailer permission to reuse those images, and Pexels
// requires a credit the app never showed (contentfix-specs/RIGHTS-VERDICT.md,
// "Selections product photos"). The server now answers imageUrl: null to every
// call (supabase/functions/og-image/index.ts AUTO_PRODUCT_PHOTOS_ENABLED).
//
// While this is false the client matches it: Find options / Regenerate save
// every option photo-less without calling og-image, and an option card wires
// no long-press "Set photo from link" (app/selections.tsx), so the GC is never
// asked for a link that can only end in "No image found". Photos already
// stored still show. Flip it to true only together with the server flag, once
// the lawyer's answer and each retailer's permission are in hand.
export const PRODUCT_PHOTOS_ENABLED = false;

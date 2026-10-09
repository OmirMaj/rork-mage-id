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

// WHO IS ON THIS PROJECT (2026-10-04) — the avatar stack, the people block in
// the Team section, and the "Has it open" dot.
//
// While this is false, nothing of the feature exists for anyone: no avatar
// stack on the project page or the desktop header, no people block or roster
// row extras in the Team section, no "Show when you have a project open?"
// question card, no Settings row, and the Team roster keeps today's
// "Role · Active" wording. The root beacon (components/whoson/
// ProjectPresenceBeacon.tsx) adds no listener and never ticks, and no hook
// calls project_people(), set_share_presence() or reads
// profiles.share_presence: utils/whoson/peopleClient.ts refuses to send, and
// hooks/useProjectPeople.ts and hooks/useSharePresence.ts stay disabled. So
// nothing about anyone's activity is stored or shown.
//
// Why it is off: the founder has not yet answered the privacy decisions in
// the build spec (whether team members stay hidden from each other, "Has it
// open" versus another wording, ask-first versus tell-once, the Invite prompt
// on projects with a client portal), the "Team activity" paragraph is not
// published in the privacy policy, the App Store privacy answer has not been
// changed, and the lawyer has not answered whether a contractor seeing when
// his own employees have a project open needs a written notice.
//
// Flip it to true only when ALL of these hold: the founder has decided those
// questions, the privacy paragraph is live on mageid.app/privacy, the App
// Privacy answer names App functionality for usage data, the lawyer's answer
// is in, the migration 20261004120000_project_people.sql is applied to
// production (and delete-account redeployed with project_presence), and the
// founder's own two-account test has passed (invite, accept, answer the
// question on both, watch the dot appear and clear, switch it off).
export const WHOS_ON_ENABLED = false;

// ASK MAGE READS FILES: dark until the Gemini key is confirmed paid (2026-10-04).
//
// Ask MAGE can take a photo, a PDF or a plan page and have the AI read it
// (edge function ask-files, Google Gemini). The privacy page says AI prompts
// are not used to train models (marketing/privacy.html, "AI features and who
// processes them"). That holds only on Google's PAID tier, and whether
// GEMINI_API_KEY is on it has been open since
// docs/audits/2026-09-03-final-push/09-ai-features.md. The founder confirms it
// before this flips.
//
// While this is false: the Ask composer has no paperclip, no tray and no
// "What I read" block, utils/askFiles.ts answers 'feature_off' before the
// consent question and before any request, and every Ask golden is
// byte-identical. Flip it to true only AFTER supabase/functions/ask-files has
// ASK_FILES_SERVER_ENABLED = true deployed (ask-files/core.ts).
export const ASK_FILES_ENABLED = false;

// CLIENT FILES READ BY AI: dark until the founder and a lawyer answer (2026-10-04).
//
// On a client's portal message the project owner can tap "Read with MAGE"
// (phone app only): the AI reads the files the client attached, summarizes
// them and drafts a description he can start a change order, an RFI or a punch
// item from. The portal page tells the client nothing about AI today
// (marketing/portal/index.html), and App Store guideline 5.1.2(i) asks for
// disclosure and permission before personal data goes to a third-party AI.
// What the client must be told, and whether the contractor's own answer covers
// a client's file, is the founder's and a lawyer's call.
//
// While this is false: a client message shows no "Read with MAGE" button, the
// sheet is never mounted, nothing about a message is sent to ask-files, and
// /rfi and /punch-list do not read the draft hand-over param. Flip it to true
// only AFTER (1) the portal page tells the client, (2) the privacy page and
// the App Store privacy answers cover files clients send, (3) ask-files has
// MESSAGE_SOURCE_ENABLED = true and MESSAGE_SOURCE_NOT_BEFORE set, deployed,
// and (4) utils/messageAiCore.ts MESSAGE_AI_NOT_BEFORE carries the same time.
export const PORTAL_MESSAGE_AI_ENABLED = false;

// YOUR FIRST JOB: the interactive starter path on Home (2026-10-05).
//
// True: a contractor's Home shows "Your First Job" (components/FirstJobPath.tsx)
// where the old "Get up and running" card sat: one opening question, seven
// steps in the order of a real job, one step open at a time, each one ticked
// only from the account's real data.
//
// False: Home renders the old card (components/OnboardingChecklist.tsx)
// exactly as before, for everyone. The old component stays in the repo until a
// later lane deletes it, so this switch is a full way back.
export const FIRST_JOB_PATH_ENABLED = true;

// SCAN THE ROOM: walk a room with a LiDAR iPhone, get a plan, quantities and a
// priced draft (2026-10-06). Dark, with an OWNER PREVIEW since 2026-10-08.
//
// While this is false, nothing of the feature exists for anyone but the owner
// (utils/owner.ts OWNER_EMAILS): /scan-room redirects to Home, no tile, row or
// button leads to it, and utils/roomScan/native.ts never looks the native
// module up (its one optional lookup is refused before it runs). The owner's
// account alone gets one row on the project page, the route and the lookup.
// This flag is read in ONE file, utils/roomScan/allowed.ts; everything else
// asks scanRoomAllowed(email).
//
// Why it is still off: the native module (modules/mage-room-scan) compiles
// against the real ExpoModulesCore and links with RoomPlan as a weak framework,
// but it has never run on a phone; the parser was written from Apple's
// documented structure and has not read a real export; no build that carries
// the module has been launched on an iOS 15 phone; and nobody has measured how
// far a scan is from a tape.
//
// Flip it to true only when ALL of these hold
// (docs/scan-the-room-native-checklist.md): a build that carries the module
// has been seen to launch on a PHYSICAL iOS 15 phone, the app has been seen to
// launch on a build WITHOUT the module with this JavaScript over the air, a
// real export from a LiDAR iPhone parses and is a fixture, the App Store
// privacy answers cover a saved room shape, and the founder's ten-room
// tape-measure test is done.
export const SCAN_ROOM_ENABLED = false;

// Clearance Check (the room scanner's table of commonly used figures) has its
// OWN switch. Turning SCAN_ROOM_ENABLED on does NOT show it to anyone. It is
// shown to the owner account always (preview), and to anyone else only when
// this is true AND utils/roomScan/clearanceRefs says a named architect or
// expediter has read the table. The one reader is
// utils/roomScan/clearanceAllowed; scripts/validate-scan-clearance.ts pins it.
export const CLEARANCE_CHECK_ENABLED = false;

// CODE FLAGS (Big Bets, Bet 4, Phase 1, 2026-10-06): a quiet chip on a change
// order line or an estimate line that touches code-sensitive work ("May Need a
// Permit Amendment or an Inspection"), with a sheet that says in the app's own
// words why that kind of work is commonly looked at, which words triggered it,
// and where the official page is. It is a rule table (utils/codeFlags), never
// a model call. It flags and never blocks, and it is the contractor's private
// note: nothing of it is stored on the line or reaches a client.
//
// While this is false: no chip, no sheet, and the two screens that would show
// it (app/change-order.tsx, app/(tabs)/estimate/full.tsx) never load the
// feature's modules (scripts/validate-code-flags.ts proves both).
//
// Why it is off: the rule table is a STARTER LIST. The founder has not yet
// read it (design-previews/big-bets/CODE-FLAGS-RULES.md is the sheet he owes;
// utils/codeScopeTriggers CODE_SCOPE_RULES_REVIEW still says
// pending_founder_review), the lane has not had its independent review, and
// only two section numbers exist in the app's checked data (Phase 2 is a
// licensed architect or expediter checking a real table).
//
// Flip it to true only after the founder's review of the rule sheet and the
// independent review are both done.
export const CODE_FLAGS_ENABLED = false;

// DISCOVER WAITLIST CARDS (PROTECT-TEXT, 2026-10-09). The Discover tab ended in
// a section called "Earn More with MAGE" with four cards: "Refer a lead, earn
// 5% if it closes", "One-tap Friday payouts to all your subs", "Lien waivers
// at point-of-payment" and "Finance a truck or new equipment". None of the
// four exists: there is no referral payout, no mass payout or 1099 filing, no
// escrow and no equipment lender. The cards stated a commission, a tax-law
// reading, "No application fee" and a launch condition as if they were
// offers, and one footer printed an internal planning note. A card for a
// product that does not exist is not shown. Flip this only when a card's
// product is real, and rewrite the card to say what the product does.
export const DISCOVER_WAITLIST_CARDS_ENABLED: boolean = false;

# MAGE ID — Post-P0 Re-Audit (current shipped main)

Date: 2026-05-17
Method: 4 parallel agents against the EXACT shipped code (`main` @ d7213f5, read via the p0-on-main worktree): (1) regression-verify the 4 shipped P0 fixes + re-audit first-run, (2) re-trace project lifecycle, (3) re-audit money/CreateMenu↔wizard/RFI/messaging, (4) broad launch-blocker sweep (routes, field, subs/closeout, crash-risk, gating, data-loss). Every finding has a file:line.
Status: findings + ranked fix list. Not yet implemented.
Why this audit: the prior (2026-05-16) audit ran against a stale Phase-26 base; this one runs against the actual shipped code (scope feature + NextStepHero + the 4 P0 fixes all now live), so it both verifies the fixes and re-checks everything against code that has since changed.

---

## Verdict (read first)

**The 4 shipped P0 fixes are correct and not regressed — but the wider TestFlight round should still wait on a small fast-follow batch.** The biggest remaining issue is a one-line dead route in the single most-visible "where do I start" component, plus a silent message-loss bug on the client side. None require new features; the whole fast-follow is ~half a day.

## P0 fix verification — all PASS

| Shipped fix | Result | Proof |
|---|---|---|
| Invoice create-then-edit (first-send pay link) | **PASS** | `invoice.tsx:373` `createdNew`; `addInvoice` before pay-link block `:377`; gate now `!payLinkUrl && totalDue>0` (not `existingInvoice`) `:388`; email-fail → draft `:454`; old duplicate `handleSave('sent')` tail removed; `userTier:tier` kept `:409`, `tier` in deps `:500` |
| Tutorial no auto-open | **PASS** | `index.tsx:101` no driving effect; reachable via HelpFab `:930` + Settings; `hasSeenTutorial` import removed, no broken importers |
| Post-create → wizard w/ projectId | **PASS** | `index.tsx:365-369` push `/estimate-wizard`\|`/schedule-wizard` w/ `projectId`; `_createdProjectId` in deps |
| Paywall re-show needs real project | **PASS** | `_layout.tsx:266` `hasRealProject` (excludes `Sample — `); in gate `:271`; `projects` in deps `:297` |
| CreateMenu in-sheet picker | **PASS (with edge — see N4)** | content-swap not nested Modal `CreateMenu.tsx:130,231`; 0→alert, 1→direct, 2+→picker `:177-201`; composes with project-aware wizard |

---

## P0 — Launch-blockers for the wider round

| # | Finding | Where | Fix | Effort |
|---|---|---|---|---|
| N1 | **`/rfi-log` is a dead route in NextStepHero** — the portfolio-wide stale-RFI CTA pushes a route with no file → not-found screen. NextStepHero is *the* "where do I start" card; this is the highest-visibility dead-end in the app. Found independently by 3 of 4 agents. (Was in the prior audit too; never reached main because that branch was stale.) | `components/NextStepHero.tsx:164` | Change fallback `'/rfi-log'` → `'/rfi'` (one line). | S |
| N2 | **Client-portal messages silently lost** — the GC↔client thread was migrated to Supabase, but the in-app client portal (`client-view.tsx`) still writes via `addPortalMessage` (local AsyncStorage `tertiary_portal_messages`). The GC reads Supabase, so a client reply from this surface never reaches the GC. Silent data loss in a customer-facing flow. | `app/client-view.tsx:274` vs `app/client-messages.tsx` + `hooks/usePortalThread.ts` | Route `client-view` send/read through `usePortalThread()` (Supabase), same as `client-messages`. | M |
| N3 | **First-run guidance points at fake data** — home opens on 3 auto-seeded `Sample — ` projects; NextStepHero picks one and says e.g. "Add scope to Sample — Sarah's Place", and nothing tells the user these are samples. The literal answer to "where do I start" aims the most-guided action at throwaway data. | `components/NextStepHero.tsx:170-176`; `utils/demoSeed.ts:54-70`; `app/(tabs)/(home)/index.tsx` | Exclude `Sample — ` projects from NextStepHero's project-scope target; add a one-line "These are samples — create your own to begin" banner. | M |

---

## P1 — Fix in the same fast-follow if possible

| # | Finding | Where | Fix |
|---|---|---|---|
| N4 | **CreateMenu picker → wrong param for 2 destinations** (edge exposed by the shipped P0-5 picker). It always passes `{ projectId }`, but `client-portal-setup` reads `id` and `photo-annotator` reads `photoId` → both show a "not found / pick a project" dead-end right after the user picked a project. | `components/CreateMenu.tsx:160`; `app/client-portal-setup.tsx:169`; `app/photo-annotator.tsx:45` | Per-option param mapping (e.g. `id` for client-portal-setup); point "Photo / markup" at a capture entry, not the annotator. |
| N5 | `/projects` is a dead route from notifications-settings ("Open projects" CTA, `as any` cast bypassed typed routes). | `app/notifications-settings.tsx:537` | Route to `/(tabs)/(home)`. |
| N6 | Estimate-wizard result screen has **no forward handoff** when project-linked — after the AI estimate folds into the project, the only actions are Share-PDF / Start-new; the create→estimate→invoice chain dead-ends and relies on the user knowing to swipe back. | `app/estimate-wizard.tsx:538-567` | Add a "View in project / Bill from this estimate" CTA when `projectId` is set. |
| N7 | Duplicate human-facing **invoice numbers** — `nextInvoiceNumber = existingInvoices.length + 1`; the new synchronous create-then-edit + offline/concurrent sends can mint two invoices with the same number (IDs are UUIDs so no crash, but the number the client sees collides). | `app/invoice.tsx:147-150`; `bill-from-estimate.tsx:83` | `Math.max(...numbers)+1`, or allocate the number inside the provider on `addInvoice`. |
| N8 | RFI "Response Required By" is still a raw `YYYY-MM-DD` TextInput; a typo yields `Invalid Date` and the RFI never flags overdue — defeats the feature's whole "creates a clock" value. | `app/rfi.tsx:490-497` | Swap to the native date picker, write ISO. |

---

## Decisions needed (not code bugs)

- **Free-tier walls (G1):** Punch List & RFIs require **business**, Change Orders require **pro**, but CreateMenu and project tiles surface all three to free users, so a free tester hits a full-screen paywall every time. Intentional per the tier model — but for TestFlight it reads as "half the app is locked." Decide: add lock badges / a free preview, or brief testers explicitly. (No revenue leak found — Pro AI tools are correctly gated.)
- **"Funding":** still does not exist in code (unchanged from prior audit). Leave out of TestFlight or add one honest "coming soon" so testers stop hunting.

## P2 — opportunistic

Stripe-not-connected nudge re-fires every send (no seen-flag) `invoice.tsx:487`; estimate fold doesn't bump `project.status` to `estimated` (cosmetic — both map to "precon") `estimate-wizard.tsx:188`; `bill-from-estimate` empty state has no "build estimate" button `:298`; daily-report Supabase payload omits `work_progress`/`incident` (local-persisted, no loss) `ProjectContext.tsx:~1440`; invoice created `'sent'` before email (narrow app-killed-mid-send window) `invoice.tsx:373`; NextStepHero hidden at 0 projects (orientation vanishes if samples deleted) `index.tsx:726`; checklist + hero render together (two competing CTAs) `index.tsx:712-731`; Stripe banner shows day-1 before any invoice `index.tsx:678`.

## Verified working — don't touch

All 4 shipped P0 fixes (table above). Scope→estimator prefill + fold into `linkedEstimate` (`estimate-wizard.tsx:91-189`); bill-from-estimate create-then-edit (`:252-265`); RFI ball-in-court + answered RFIs remain tappable (no dead-end); webhook/mark-paid reconcile reads persisted `payLinkUrl`/`payLinkId`, unaffected by create-then-edit; CreateMenu modal-gap avoids the iOS present-while-dismiss race; project-scope null-guarded + free (no paywall); no crashers found in the recent-churn surface.

## Recommended sequencing

1. **Fast-follow batch N1–N5** before widening TestFlight (~half a day, all OTA, mostly one-liners): N1 `/rfi-log`→`/rfi`, N5 `/projects`→home, N4 CreateMenu param map, N2 client-view→Supabase messaging, N3 sample-aware NextStepHero + banner. N1 alone is the single highest-leverage line in the app right now.
2. N6–N8 in the same batch if time (all S/small-M).
3. Make the G1 + funding calls explicitly before testers ask.
4. P2 opportunistically.

Go/no-go: don't widen TestFlight until **N1** (guaranteed dead-end in the first card most testers see) and **N2** (silent client message loss) are fixed.

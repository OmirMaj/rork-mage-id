# MAGE ID — Workflow Audit Roadmap

Comprehensive UX audit of every screen in the app and every page on the
marketing site, with prioritized fixes and the universal patterns that
turn MAGE ID into a workflow OS instead of a collection of forms.

**Goal:** every workflow in the app should have proper UX that no other
construction app has, or has worse — visible lifecycle, no re-entry, no
guessing about progress, all parties (GC, sub, homeowner, super) get
exactly what they need.

---

## Universal patterns

These four patterns apply to most workflow screens. Wherever a screen has
a finite state lifecycle, repeating data, or multi-step entry, the
matching pattern is the fix.

### 1. `<StatusPipeline>` — visible lifecycle

> File: `components/StatusPipeline.tsx`
>
> Use on any screen with a finite-state-machine status. Shows current
> stage as a breadcrumb (●━━○━━○), days-in-status, days-overdue/until-due
> coloring, and a one-tap advance button. Side-branches (rejected, void,
> revise & resubmit) live outside the visual but still reachable via
> existing pickers.

**Already wired:** RFI · Submittal · Change Order · Invoice · Contract · Lead.

**Should be wired next:**
- Punch list items — Open → In Progress → Verified → Closed
- AIA pay app cycles — Drafted → Submitted → Reviewed → Approved → Paid
- Permits — Applied → In Review → Issued (or Rejected)
- COI vault — Pending → Active → Expiring → Expired
- Prequal forms — Sent → Returned → Approved (or Returned with edits)
- Warranties — Active → Walk Scheduled → Walked → Closed
- Closeout binder — In progress → Compiled → Delivered
- Bid response (post-bid / submit-bid-response) — Drafted → Submitted → Awarded/Lost
- OAC meetings — Scheduled → Held → Action items closed
- Selections — Pending → Picked → Confirmed
- Lien waivers — Requested → Signed → Stored

### 2. Carry-forward — no re-entry

> Pattern from: `app/daily-report.tsx` (the "Copy from yesterday" button)
>
> Most workflow forms repeat 80% of the previous instance. Always have a
> one-tap "Copy from <last>" affordance that pre-fills repeating fields.
> Skip the fields that should be fresh per instance (timestamp,
> conditional like incident block, photos).

**Already wired:** Daily Field Report.

**Should be wired next:**
- AIA pay app — copy line items, % billed, retainage from prior pay app
- Time tracking — copy crew from yesterday with one tap
- Weekly snapshot — copy template/sections from prior week
- Invoice (recurring) — copy line items from last invoice
- Bid response — copy schedule of values / scope outline from prior bid
- Punch walk — start a new walk pre-loaded with open items from prior
- OAC meeting — pre-fill agenda from prior meeting + carry open action items
- Prequal form — pre-fill from prior submission to same agency

### 3. Progress indicator — no guessing

> Pattern from: `app/daily-report.tsx` (the "X of 5 filled · ready to send" pill)
>
> Multi-step forms should always tell the user how complete they are
> and when they're ready to submit. Required vs. optional should be
> visible at a glance.

**Already wired:** Daily Field Report.

**Should be wired next:**
- Estimate wizard (8 questions) — already a wizard, but show step counter and "X of 8 done"
- Onboarding flow — currently a stack of screens, needs a global progress bar
- Closeout binder — checklist already exists, expose completion percentage at top
- Handover checklist — same pattern, surface completion at top
- AIA pay app — show line-item completion (some line items are bilked at 0%, others at 100%)
- Contract setup — show "5 of 7 sections filled" before sending
- Client portal setup — show "3 of 5 sections customized" before launching
- Public profile setup — same

### 4. Voice + AI everywhere

Voice dictation that maps to structured fields (already on DFR / RFI /
Submittal / CO / Invoice / Lead) is one of MAGE ID's biggest moats.
Anywhere a user types a paragraph into a multi-line input, voice should
be the default input mode.

**Already wired:** DFR · RFI · Submittal · Change Order · Invoice · Lead.

**Should be wired next:**
- Punch item creation
- Permit notes
- OAC meeting minutes
- Daily homeowner update (already pulls from DFR — could add direct dictation)
- Buyout package scope
- Selections allowance notes
- Warranty walk findings
- Bid response narrative

---

## Per-screen audit

### Tier 1 — Project lifecycle workflows (highest impact)

| Screen | Current state | Recommended fixes | Status |
|---|---|---|---|
| `daily-report.tsx` | Voice + AI parse + photos + email send | ✅ Carry-forward, ✅ progress indicator | shipped |
| `rfi.tsx` | Form + voice + status picker | ✅ StatusPipeline | shipped |
| `submittal.tsx` | Form + voice + review cycles | ✅ StatusPipeline | shipped |
| `change-order.tsx` | Form + voice + AI impact | ✅ StatusPipeline | shipped |
| `invoice.tsx` | Form + voice + Stripe payment links | ✅ StatusPipeline | shipped |
| `contract.tsx` | Form + signature blocks | ✅ StatusPipeline | shipped |
| `lead-detail.tsx` | Form + chip stages + voice + activity log | ✅ StatusPipeline (additive) | shipped |
| `aia-pay-app.tsx` | Schedule of Values + retention math | StatusPipeline + carry-forward from prior pay app | TODO |
| `punch-list.tsx` + `ai-punch.tsx` + `punch-walk.tsx` | List + walk mode | StatusPipeline per item + bulk-action toolbar (mark all verified) | TODO |
| `permits.tsx` | List + per-permit detail | StatusPipeline per permit (Applied → Under Review → Issued) | TODO |
| `coi-vault.tsx` | Insurance certificate vault | StatusPipeline (Pending → Active → Expiring → Expired) + auto-expiry alerts | TODO |
| `prequal-form.tsx` + `prequal-manager.tsx` | Sub prequal flow | StatusPipeline + carry-forward from prior submission | TODO |
| `warranties.tsx` | Warranty list + walks | StatusPipeline (Active → Walk Scheduled → Walked → Closed) | TODO |
| `closeout-binder.tsx` | Compilation flow | Progress indicator + StatusPipeline (Compiling → Compiled → Delivered) | TODO |
| `lien-waivers.tsx` | Waiver tracking | StatusPipeline (Requested → Signed → Stored) | TODO |
| `oac-meeting.tsx` | Owner-Architect-Contractor meetings | StatusPipeline + agenda carry-forward + voice-to-minutes | TODO |
| `handover.tsx` | Handover checklist | Progress indicator at top | TODO |
| `selections.tsx` | Material/finish selections | StatusPipeline per selection (Pending → Picked → Confirmed) | TODO |
| `bid-detail.tsx` + `submit-bid-response.tsx` + `post-bid.tsx` | Bidding flows | StatusPipeline + carry-forward from prior bid | TODO |
| `buyout.tsx` + `buyout-package.tsx` | Sub buyout flow | StatusPipeline (Drafted → Sent → Bids in → Awarded) | TODO |

### Tier 2 — Multi-step forms (need progress indicator)

| Screen | Current | Recommended |
|---|---|---|
| `estimate-wizard.tsx` | 8-question wizard | Progress indicator across steps + jump-back capability |
| `onboarding.tsx` + `onboarding-paywall.tsx` | First-run flow | Global progress bar, skip-and-resume, milestone confetti |
| `client-portal-setup.tsx` | Portal config | "X of 5 sections customized" + preview-as-homeowner button |
| `payments-setup.tsx` | Stripe Connect onboarding | Step-by-step status + "what comes next" |
| `public-profile-setup.tsx` | Public profile | Section completion + preview |
| `sub-portal-setup.tsx` | Sub portal config | Same pattern |

### Tier 3 — Multi-party access verification

This is the one area where MAGE ID can build something **no other app
has**: every party (GC, sub, homeowner, super, owner-rep, architect)
should be able to do exactly what they need on the same project, with
permissions that make sense.

**Audit each role:**

| Role | What they need | Where it lives | Gap? |
|---|---|---|---|
| GC | Everything | Native app (this audit) | — |
| Homeowner | Schedule, selections, daily updates, contract, payments, photos | `client-view.tsx` + `marketing/portal/` | ✅ already shipped |
| Subcontractor | Their assigned tasks, daily reports, COI, prequal | `sub-portals.tsx` + `marketing/sub-portal/` | ✅ already shipped |
| Architect | RFIs, submittals, drawings | `marketing/architect/` | ✅ partial — needs response tracking on the architect side |
| Super | Daily reports, photos, punch, schedule, RFIs | Native app + offline-first | ✅ — verify all surfaces work offline |
| Owner-rep | Pay apps, change orders, schedule, RFIs | Native app | TODO — define an "Owner-rep" role distinct from "Homeowner" |
| Inspector | Punch list (read-only) | Native app | TODO — guest-link mode for inspectors |

**Recommendations for multi-party gaps:**

1. **Owner-rep role** — currently homeowner = owner = full access. For
   commercial projects there's an Owner-rep who needs less than the
   GC but more than a residential homeowner. Add a distinct role.
2. **Inspector guest links** — like the architect/sub portals but
   read-only on punch + permits + drawings. Inspector clicks emailed
   link, sees only what they need.
3. **Super dashboard** — super = field staff, not GC. Their home tab
   should be photos + DFR + punch, not financials. A `role: 'super'`
   filter on the home tab tile grid would do it.

### Tier 4 — Marketing site audit

The marketing site (`mageid.app`) has been audited for screenshot
placement (16 of 31 slots filled with matching screens; rest are
placeholders waiting for captures). Workflow gaps remaining:

| Page | Gap | Fix |
|---|---|---|
| `index.html` (homepage) | Pillar mockups still use CSS-rendered fake content | Replace with real screenshots |
| `client-experience.html` | No phone slots — uses different visual-card pattern | Either add `<.screenshot.phone>` slots or refactor to feature-pair pattern |
| `playbook.html` | Long-scroll page-by-page walkthrough | Add a sticky table-of-contents on desktop |
| `features/index.html` | Feature hub list — no per-feature depth | Add a phone-mock per tab |
| All feature pages | Inconsistent navs (some have "vs Competitors", others "vs Software / Takeoff / Other Apps") | Standardize nav across all pages |
| All feature pages | Missing pricing on a public page | Add `/pricing` page with tier comparison |
| All feature pages | No multi-party framing | Add "For homeowners / For subs / For architects" tabs on relevant pages |
| `vs-competitors.html` | Anonymized table is good, but missing direct call-out of competitor names where it'd help SEO | Add a follow-up section "Compared to [named competitors]" lower on page |

### Tier 5 — Cross-cutting affordances

These are "every screen should have this" features:

1. **Universal mic button** — already on most screens, verify on every form
2. **Help / explainer term overlay** — `FeatureHeader` does this on RFI / Submittal; should be on every workflow screen
3. **Required field indicators** — currently inconsistent; standardize across forms
4. **Empty-state screenshots** — some screens have skeletons, others have plain "No items yet" text. Standardize on a delightful empty-state component (icon + headline + 2-line copy + primary CTA)
5. **Sticky save bar at bottom** — long forms should have a sticky "Save / Send" footer instead of scrolling to find the button
6. **Confirmation patterns** — destructive actions (delete CO, void invoice, mark lost) should consistently use the same confirmation dialog component

---

## Implementation phases

### Phase 1 (this commit) — shipped
- Daily Report: carry-forward + progress indicator
- StatusPipeline component
- Wired into RFI · Submittal · Change Order · Invoice · Contract · Lead

### Phase 2 — next focused pass (~4–6 hours)
- AIA pay app: StatusPipeline + carry-forward from prior period
- Punch list: bulk-action toolbar + per-item StatusPipeline
- Estimate wizard: progress indicator
- Permits: StatusPipeline per permit
- COI vault: StatusPipeline + auto-expiry banner

### Phase 3 — multi-party audit (~6–8 hours)
- Owner-rep role definition
- Inspector guest links
- Super dashboard variant

### Phase 4 — marketing polish (~3–4 hours)
- Replace homepage CSS mockups with real screenshots
- Add phone slots to client-experience.html
- Standardize nav across all marketing pages
- `/pricing` page

### Phase 5 — Cross-cutting (~6–8 hours)
- Universal empty-state component
- Sticky save bar pattern
- Standardized confirmation dialog
- Required-field indicator pattern

---

## What MAGE ID gets that no other app has after this audit

1. **Lifecycle visualization on every workflow** — most apps bury status
   in a dropdown halfway down a form. We surface it as a visual breadcrumb
   with days-in-status counters at the top of every form.

2. **Carry-forward everywhere** — Raken / Procore / Buildertrend reviews
   consistently complain about re-entering yesterday's data. Our DFR
   answers this; rolling the same pattern out to AIA pay apps, time
   tracking, weekly snapshots, recurring invoices, and bid responses
   means MAGE ID is the only construction app where the user never
   re-types what they already typed.

3. **Multi-party portals at parity** — homeowner, sub, architect, and
   owner-rep all get tailored portals with the same data model, no extra
   apps to install. Most competitors have one portal type (homeowner-only)
   or none (workflow happens in email).

4. **Voice + AI as the default input** — every form, every screen. Other
   apps treat voice as a "premium feature" or skip it entirely.

5. **Real-time progress signals** — every multi-step form tells the user
   how complete they are and when they're ready to submit. No more
   "did I fill enough?" guessing.

6. **Offline-first sync queue** — already shipped; verify on every write
   path during Phase 5 audit.

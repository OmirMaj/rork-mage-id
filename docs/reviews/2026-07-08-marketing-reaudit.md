# Marketing Re-Audit (2026-07-08)

Second-pass audit after the earlier amber-brand + factual fixes. 20 findings. Most auto-fixed in commit `a38774f`; owner-gated items + the screenshot situation below.

## Fixed (commit a38774f)
- **Currency debt** — added Safety Management, WIP Reporting, Crew/Worker profiles to the Business tier on `pricing.html` + `index.html`; surfaced them on `features/index.html`, `field.html`, `compare/procore.html`, `jobtread-alternative.html`. Resolved the "Business vs Enterprise: same features" FAQ.
- **Regression** — `features/vs-competitors.html` savings headline `$5,820–$6,288` → **`$5,640–$6,240`** (now matches the table's own Savings column).
- **Over-claim corrected** — weather-aware reflow re-marked "Soon / on the roadmap" on `vs-other-tools.html` + `features/index.html` (was claimed as shipped/MAGE-only) to match `scheduling.html`.
- **Staleness** — QuickBooks "Q3 2026 roadmap" phrasing, Pro annual price consistency across sibling pages, playbook App Store link reconciled with index.html's deliberate badge removal.
- a11y + brand nits.

## ⚠️ Deploy guardrail (critical)
The live marketing site now advertises **Safety, WIP, and Crew/Worker profiles** — features that ship in this same branch but are **not yet deployed**. **Deploy marketing AT THE SAME TIME AS (or after) the app OTA that ships these modules — never before**, or the site will claim features users can't access.

## Owner-gated (NOT changed)
1. **Legal AI sub-processor inconsistency** — `privacy.html` names "Google (Gemini)"; `terms.html` + `do-not-sell.html` name "Anthropic." Per the product (Claude/Anthropic), privacy.html is likely the stale one. **Decide the canonical vendor(s) and make all three legal pages consistent.** (Left untouched deliberately — compliance statement.)

## 📸 Screenshots — STILL STALE (owner re-capture required)
All 30 app screenshots in `marketing/screenshots/screens/*.png` are **old green-brand captures** (dated May 4 2026; `46-time-tracking.png` is Jul 4), NOT the current amber build. They cannot be regenerated in this environment (no simulator). **Re-capture from the amber build** using the repo's iOS Simulator helper (commits `920677b` / `5549315`, defaults to iPhone 15 Pro Max) and drop replacements **in place with the same filenames** (pages reference them by name). The screenshot *generators* are already rebranded to amber, but these 30 are real app captures.

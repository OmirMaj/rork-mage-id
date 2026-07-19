# MAGE Copilot — Engine Complete (8/8 capabilities) + Verification Runbook

**Branch:** `claude/mage-copilot` (PR #86) · **Status:** all built, ship-check green, OTA-safe (no edge functions) · owner-gated for merge.

Every substantive feature now has a grounded **voice → clarifying interview → build** flow on one shared engine (`components/copilot/CopilotShell.tsx` + `hooks/useCopilotConversation.ts` + `utils/copilot/*`). The interview asks only what your own data can't resolve, cites your numbers, and every gap kind renders a real input (date wheel / number ladder / choice chips).

## The 8 capabilities

| # | Capability | id | Entry ("… by voice") | Apply | Live-verified |
|---|-----------|-----|----------------------|-------|:---:|
| 1 | Schedule | `schedule` | Mobile schedule header mic + empty state; Estimator? no — schedule screen | generate → `schedule-review` | ✅ E2E on sim |
| 2 | Estimate | `estimate` | Estimator hero "Build by voice" (project-scoped) | generate → commit → `project-detail` | ✅ E2E on sim |
| 3 | Daily Report | `daily_report` | project-detail → Daily Reports → "Log by voice" | `addDailyReport` (auto-propagates progress → schedule + portal) | pattern-verified |
| 4 | Change Order | `change_order` | project-detail → Change Orders → "Draft by voice" | route → `change-order` pre-filled | pattern-verified |
| 5 | RFI | `rfi` | project-detail → RFIs → "Raise by voice" | `addRFI` (auto-#) | pattern-verified |
| 6 | Punch | `punch` | project-detail → Punch → "Add by voice" | `addPunchItem` | pattern-verified |
| 7 | Billing | `invoice` | project-detail → Invoices → "Bill by voice" | route → `bill-from-estimate?type` | pattern-verified |
| 8 | Safety | `safety_incident` | `safety-incidents` → "Report by voice" | route → `safety-incidents` pre-filled (OSHA treatment) | pattern-verified |

"pattern-verified" = ship-check green + a pure-fn gap validator + identical machinery to the two E2E-verified ones (only grounding/gaps/apply differ). Not yet exercised on the sim.

## Engine design (for reviewers)

- **`CopilotCapability`** (`utils/copilot/types.ts`) declares: `buildGrounding` (your history), `gaps` (what's unresolved, ranked by impact), `buildTurnPrompt` + `mergeDraft` (one stateless `mageAI` turn per utterance), `apply` (persist/route), a `copy` block (all domain nouns — the shell is capability-agnostic), and an `aiFeature` (metering).
- **Ask-only-when-unresolved**: a gap fires only when neither the draft nor grounding resolves it. `mergeDraft` refuses a model-*presumed* value the user never stated (e.g. `utils/copilot/schedule/dateSignal.ts` — this is why the schedule interview actually asks "when do you break ground?").
- **Apply patterns**: *generate+commit* (Schedule, Estimate, DFR, RFI, Punch) vs *route pre-filled, persist nothing* (Change Order, Billing, Safety) — the latter reuse the existing screens' save/approval flows and don't mutate on "Build it".
- **Validators** in ship-check: `test:copilot-{ask,reducer,gaps-schedule,date-signal,gap-options,gaps-estimate,gaps-dfr,gaps-co,gaps-rfi-punch,gaps-billing,gaps-safety}`.

## Verification runbook (do this after a Metro restart)

The flagship demo project needs a **Metro restart with cache clear** to appear (a new file, `app/dev-flagship-seeder.tsx`, came in via git merge and Metro's watcher missed it — a plain reload isn't enough):

```bash
bun run start -c        # -c clears the Metro cache so the new route/link load
```

1. **Load real data:** Settings → **DEVELOPER (OWNER ONLY)** → *Flagship demo (Overlook Estate)* → **Load flagship project**. (Owner-only; `omirmajeed2000@gmail.com` qualifies.) This mints "The Overlook Estate" — a $9.18M, ~52%-complete estate fully populated across every feature. Great for App Store / marketing screenshots on iOS and web.
2. **Walk each capability** from the entry-point column above. Each: speak or type a scope → the interview asks only what's unresolved → **Build it**. On the Overlook Estate, the Daily Report interview will surface the *critical-path progress* question (it has in-progress tasks), which a bare project won't.
3. **Non-destructive check:** Change Order / Billing / Safety route to their screens *pre-filled without saving* — safe to open and back out. Schedule previews at `schedule-review` before commit. Estimate/DFR/RFI/Punch **do persist** on "Build it" (all additive / undo-safe).

## Owner-gated / remaining

- **Merge PR #86** when satisfied.
- **Metro restart** to load the demo project (above).
- **Deploy `transcribe-audio`** edge function if you want on-device *voice* input; until then the interview runs via the typing fallback (spec §3.6) — fully functional, just typed.
- Optional next: a full sim pass of capabilities 3–8 on the Overlook Estate (I can do this once Metro's restarted).

# MAGE ID — final-push audit brief (read fully before starting)

You are one of thirteen parallel auditors. Each has one domain. Your job is to find what is
actually wrong, missing, or disconnected in that domain — with proof — and what would make the
product materially better. The founder will act on this list before launch. Wrong findings cost
more than missing ones: every claim you make will be checked.

## The product, in five lines
MAGE ID is a React Native / Expo 54 construction-management app for small and mid general
contractors. iOS is primary, web (RN-web at app.mageid.app) is secondary, and there is a
token-based client portal and sub portal. Backend is Supabase: Postgres with RLS, 60+ Deno edge
functions (`supabase/functions/*`), RevenueCat tiers (free / Pro $29 / Business $79 / Enterprise
$150), offline-first writes through `utils/offlineQueue.ts`. The moat is a cost book that learns
from closed jobs; a rate the contractor STATED must never be shown as one we MEASURED.

Repo root: /Users/omirmajeed/Desktop/MAGE ID - CLAUDE  (branch main, ~113 commits ahead of origin)
Read `CLAUDE.md` first (accurate build/architecture reference). Then the banner at the top of
`docs/START-HERE.md` (current deploy state). `docs/PRODUCT-BIBLE.md` is the product reference.

## Rules this codebase has taught the hard way
1. **Documents lie; code doesn't.** Every prior audit's biggest finds came from a doc or a code
   comment confidently asserting something the code contradicted (a variance sign inverted, a
   "TODO" that was wired and wrong, a superseded PR only half superseded). Treat docs and comments
   as leads, never as evidence. Read the code path end to end.
2. **`supabase/schema.sql` IS production** — regenerated today (2026-09-03) and every section
   MD5-verified against the live database. Trust it over `supabase/migrations/*` (the tracker does
   not match the files). If you need live truth beyond it, you MAY run READ-ONLY SQL against
   production through the Supabase MCP tool `execute_sql` (project id `nteoqhcswappxxjlpvap`):
   SELECT-only. NEVER run DDL/DML, NEVER call `apply_migration`, `deploy_edge_function`,
   `create_branch`, or anything that writes. Production has real (few) users.
3. **Do not modify the repository.** No edits, no new files under the repo, no git commands that
   change state. Write ONLY under your assigned output path in the scratchpad. If a command would
   write into the repo (e.g. `supabase functions download`), run it from a scratchpad directory.
4. **Automated tests found zero bugs; the simulator found nineteen.** Mounting is not working.
   Trace real user paths: what does the user tap, what data flows, what is written, what is read
   back. Silent success (a write that is discarded, an error that is swallowed, a value that never
   round-trips) is the recurring failure class here — hunt for it specifically.
5. **A guard that names files goes blind.** When you assess coverage, enumerate; do not trust lists.

## Already found and closed — do NOT re-report unless you prove the fix is incomplete
- `docs/audits/2026-08-31-medium-sweep.md` — 32 findings, all closed or refuted.
- `docs/audits/2026-09-02-launch-readiness.md` — 16 findings; 14 closed, #12 (verified-pros
  de-scoped to notifications only) and #3 (RFP browse gated OFF pending a report/block kit) are
  known partials.
If you find one of these is NOT actually fixed, report it as **REGRESSION/UNCLOSED** with the proof.

## Known founder decisions — not bugs, do not report as defects
`RFP_BROWSE_ENABLED=false`; `CLIENT_SUBS_ENABLED=false` (homeowner path ships free);
"verified pros only" restricted to notifications; `notification_outbox_recipient_kind_check` vs the
app writing `'user'`; `utils/jobCostEngine.ts` counting client payments as job-cost actual;
`utils/aiaBilling.ts` `thisPeriod = scheduledValue`; `cost_seeds.deleted_at` NOT applied (cost_seeds
is under a do-not-touch instruction — soft-delete of a cost seed does not persist, known);
`20260827120000_project_financials_drop_legacy` deliberately not applied (phase 2, waits on OTA);
`20260826180000_portal_link_expiry_cron` deliberately not applied (its edge fn is undeployed);
no OpenWeather key (simulated weather is labeled and refused by the delay log);
no Anthropic key (Construction Answers inert by design); RevenueCat webhook secret unset (known
BLOCKER in LAUNCH-CHECKLIST.md); sandbox web billing key in eas.json (known, web only).
You MAY comment on the *consequences* of these if you find a consequence nobody has recorded.

## Severity rubric (be honest; P0 is rare)
- **P0** — security breach across tenants, money computed wrong for the user, data loss, App Store
  rejection on submission, or a crash on a main path.
- **P1** — user-visible defect, silent failure, compliance/privacy risk, a feature that cannot work.
- **P2** — quality, debt, performance, inconsistency that will bite soon.
- **P3** — polish and opportunity.
Confidence: **CONFIRMED** (traced end to end, quoted) or **LIKELY** (one link not verified — say
which). Do not file anything below LIKELY.

## Output contract
Write your report to the path given in your task. Format:

```
# <domain> — final-push audit — 2026-09-03
## Scope covered (files/paths actually read; commands run)
## Findings (ranked; most severe first)
### F1 — [P0|P1|P2|P3] [CONFIRMED|LIKELY] <one-sentence defect>
- Where: `path/file.ts:line` (+ others)
- Evidence: quoted lines (short)
- Failure scenario: concrete inputs/state → wrong outcome the user sees
- Fix: concrete, smallest correct change
- Effort: S / M / L
### F2 ...
## ADD / CONNECT / DO BETTER (ranked by leverage)
### O1 — <opportunity> — leverage: <why it matters for a GC> — evidence of the gap: `file:line` — sketch
...
## Appendix — lower-severity notes (one line each with file:line)
## What I could not verify (and how it could be)
```
Aim for 8–20 well-proven findings and 3–8 opportunities. Fewer, verified findings beat many
speculative ones. Quote code; give line numbers; name the user-facing consequence.

When done, return a summary of at most 400 words: counts by severity, your top five findings in
one line each with file:line, and your single highest-leverage opportunity.

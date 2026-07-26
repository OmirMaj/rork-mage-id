All grounding anchors verified against `main @ a8dbff6` (Brain v3 + marketing v3 merged). Four scout sweeps + spot checks corrected five facts the frontier map left soft; they're folded in below. Here is the plan.

═══════════════════════════════════════════════════════════════════
THE FRIDAY CLOSE BUILD PLAN
Architect's build order for: Week-Close ritual → Leak→Draft-CO autonomy → QBO cost pull → Pace pre-apply
Base ref: `main @ a8dbff6` (merge PR #99)
Theme: Brain v3 taught it to know things. Profit Leak taught it to spot money. The Friday Close teaches it to COLLECT — every week ends billed, chased, drafted, and closed, with receipts for what the brain did itself.
═══════════════════════════════════════════════════════════════════

──────────────────────────────────────────────
0. GROUND RULES (verified environment facts — every implementer obeys these)
──────────────────────────────────────────────
G1. BRANCH: build on `claude/friday-close` cut from `origin/main` (a8dbff6), in a worktree — the default checkout (`claude/beautiful-hypatia-X5u4P`) is STALE (pre-Brain-v3). Every file:line ref below was re-verified against main.
G2. TESTS: no jest. Every pure engine ships with a `scripts/validate-<name>.ts` runnable under bun with synthetic fixtures, exiting non-zero on failure, registered as a `test:*` script in package.json AND appended to the `ship-check` chain (both — the chain is the gate; an unregistered validator is a dead test).
G3. WRITES: all Supabase writes via `supabaseWrite` (utils/offlineQueue.ts:312). Migration-before-OTA remains the ship ORDER (PGRST schema misses re-queue as transient — writes stall, not drop, until schema lands — but order stands).
G4. CAPTURE IS NEVER LOAD-BEARING: every `recordPrediction` / `recordDidForYou` / gate read is fire-and-forget inside its own try/catch. A ledger failure must never break a CO draft, a schedule accept, or a QBO confirm.
G5. IDs: `generateUUID()` from utils/generateId.ts (NOTE: the export is `generateUUID`, not `generateId` — Brain-v3 plan naming drift).
G6. TIER: all four surfaces gate Business+ via `hooks/useTierAccess.ts` (QBO already server-gates business/enterprise via `requireTier` in qbo-connect-start/sync/status; the reconciler itself is cron-secret-gated, no tier check — correct, leave it).
G7. OWNER-GATED (never done by implementers): apply_migration via Supabase MCP (never `db push`), edge-fn deploy, merge, OTA. Implementers write files/commits only.
G8. DRAFT-FOREVER: no code path in this campaign sends anything external. Leak COs are created `status:'draft'` and NEVER auto-transitioned; portal visibility stays at its unsent default. The only auto-sender in the app remains the already-shipped `invoice-dunning` cron — this campaign reads its effects, never triggers sends. Never market auto-chase as new.
G9. AUTONOMY NEVER STARVES ITS OWN GATE: every autonomous act (pre-applied pace, auto-drafted CO) still records its prediction to `brain_predictions` so the grading loop keeps scoring the exact substitution being automated. Every autonomous act writes a `recordDidForYou` receipt (utils/brain/didForYou.ts:38).
G10. NO NAG ON INACTIVE PROJECTS: every ritual surface reuses composeBrief's cadence discipline (active-project filters, the ≥2-reports-in-7d style predicates, composeBrief.ts:252-278) and ships an honest empty state (QUIET_MORNING_LINE precedent, composeBrief.ts:387). The Friday nudge is not armed when nothing qualifies.
G11. NOTHING SILENT INTO THE COST BOOK: QBO-pulled lines land in a staging table and reach job costs / CostSamples ONLY through explicit per-line confirmation. No confirm, no cost. Rejected lines never resurface as staged.
G12. NEW `mageid_*` KEYS: every new per-user AsyncStorage key is added to `LOCAL_USER_CACHE_KEYS` (contexts/AuthContext.tsx:29-54) in the SAME bundle that introduces it, or it leaks across tenants.
G13. EARNED-TRUST FRAMING: gates (≥60% n≥5 pace, ≥50% n≥5 leak) are framed as an earned-trust ladder with visible auto-demotion, never as statistical guarantees. Demotion is silent in behavior (falls back to suggest) but LOUD in receipts (didForYou line + locked scoreboard).
G14. NO NEW PREDICTION KINDS: `brain_predictions.kind` has a CHECK constraint (migration 20260725120000, applied to prod). This campaign extends PAYLOADS only (jsonb, unconstrained) — e.g. `preApplied: true` on pace_suggestion_applied. Adding a kind = a migration we deliberately avoid.

──────────────────────────────────────────────
1. DEPENDENCY-ORDERED BUILD SEQUENCE
──────────────────────────────────────────────
Order forced by two facts: (a) the autonomy gate module + prefs column are consumed by Waves 3 and 4; (b) the QBO staging schema must exist as a file before the reconciler extension and the confirm UI are written against it.

  WAVE 0  Foundation: 2 migration files + autonomyGate pure engine + useAutonomy hook + cache keys
  WAVE 1  composeWeekClose pure engine (zero existing-file edits) — the container everything else surfaces in
  WAVE 2  /week-close screen + WeekCloseCard + Friday nudge + notification kind + settings toggle
  WAVE 3  Leak→Draft-CO: pure draft builder + catch-up sweep hook + receipts
  WAVE 4  Pace pre-apply: pure pre-apply planner + schedule-review integration + badge/revert + autonomy settings section
  WAVE 5  QBO server half: reconciler Purchase/Bill pull (code only; deploy owner-gated) + pure mapping engine + type extensions
  WAVE 6  QBO confirm-queue UI + materialization + week-close wiring
  WAVE 7  Ship gates (owner): migrations → edge deploy → merge → OTA

Cross-wave data edges: W3 and W4 consume W0's gates/prefs. W2 renders W3's drafts (leg 1) and W6's pending count (input added in W1, wired in W6). W6 consumes W5's staging schema + mapping engine. W1 depends on nothing new (pure composition over shipped engines) — it is independently OTA-worthy with W2 alone if the campaign must be cut short.

──────────────────────────────────────────────
2. FEATURE SPECS
──────────────────────────────────────────────

╔══ FEATURE 1 — THE WEEK-CLOSE RITUAL ═════════════════════════════╗

CORRECTED FACT: the map's "unbilled is displayed nowhere as a sweep" is overstated — `computeWIPReport` unbilled (utils/financialReports.ts:96, `unbilled = max(0, earned − billedToDate)`) IS displayed in app/wip-report.tsx and its CSV export (:316). What does NOT exist (grep-verified zero hits): `composeWeekClose`, any `/week-close` route, any weekly ACTION surface. The new thing is the ritual container with deep links, not new math. (app/weekly-snapshot.tsx exists but is a per-project read-only pulse view off project-detail — different animal; leg 3 may deep-link it.)

NEW `utils/weekClose/composeWeekClose.ts` — pure sibling of composeBrief (composeBrief.ts:77-95 input-shape precedent):
```ts
interface ComposeWeekCloseInput {
  projects: Project[]; invoices: Invoice[]; changeOrders: ChangeOrder[];
  dailyReports: DailyFieldReport[];
  wipRows: WIPRow[];                        // caller runs computeWIPReport (financialReports.ts:55-145)
  paymentPredictions?: PaymentPredictionResult | null;   // utils/paymentPrediction.ts
  wwp?: { commitments: WeeklyCommitment[]; ppc: number | null } | null;  // utils/lastPlanner.ts:236-286
  lookaheadReadyCount?: number;             // buildLookahead constraint-clear tasks (lastPlanner.ts:168-223)
  unsentClientItemCount?: number;           // client-outbox sweep population
  qboPendingCount?: number;                 // W6 wires; 0/absent until then
  autoDraftedCOs?: ChangeOrder[];           // W3's drafts (auditTrail marker), still status 'draft'
  now?: Date;
}
```
Output: `{ dateISO, legs: WeekCloseLeg[], allQuiet: boolean }`, `WeekCloseLeg { id: 'bill'|'chase'|'close'|'commit'|'clients', title, items: WeekCloseItem[] }`, item = BriefItem contract ({id, text, severity?, route?} — composeBrief.ts:54-60) so rows deep-link.
- LEG 1 bill what you earned: top unbilled WIP rows (unbilled > $500 floor, desc) → route bill-from-estimate (Stack route verified _layout.tsx:691) / project AIA; PLUS W3's auto-drafted leak COs ("CO #12 drafted from Tue's report — $1,840 — review & send" → /change-order?coId=…); PLUS qboPendingCount line ("6 QBO costs need review") when > 0.
- LEG 2 chase what you're owed: overdue invoices (dueDate past, balance > 0) with predicted landing dates from `predictInvoicePayments` → /payment-predictions. HONESTY: dunning already auto-chases server-side (supabase/functions/invoice-dunning, stages 1-6/7-13/14+ days, dedup via dunning_stage/dunning_last_sent_at:80-81); this leg SHOWS the chase state, never re-sends. Per-send receipts ("2nd notice sent Tuesday") are NOT feasible v1 — the dunning columns aren't in the client Invoice type and the fn writes no outbox receipt; deferred (honesty ledger).
- LEG 3 close this week's plan: WWP DID marking + `computePpc` for the ending week ("You committed 9, finished 7 — 78% PPC") → /last-planner.
- LEG 4 commit next week: lookahead-ready count ("5 tasks constraint-clear for next week") → /last-planner.
- LEG 5 tell the clients: unsent client-outbox items → /client-outbox; weekly update drafting link → /client-update. Receipt line, not duplicate send: homeowner-weekly-digest already fires Fridays 16:00 UTC for portal projects (index.ts:18) — say "portal digest goes out automatically", don't re-send.
CADENCE (G10): a project contributes items only if status active AND any activity in the trailing 14 days (report, invoice, task status change — pure fn over inputs). Zero qualifying items → `allQuiet` + line "Clean close — nothing left on the table this week." Validator: `scripts/validate-compose-week-close.ts` (per-leg fixtures, cadence exclusion, empty state, dedupe of a CO appearing as both draft and unbilled).

NEW `app/week-close.tsx` — modal route (append Stack.Screen in the _layout.tsx :603-619 modal cluster beside "brief"): dated header ("Friday, Jul 31 — 3 legs open"), five-leg checklist, rows tap → route, explicit Done writes `mageid_week_close_last_seen` (localDateISO — brief.tsx:78 precedent). Business+ (G6). No auto-open.
NEW `components/home/WeekCloseCard.tsx` — home card mirroring MorningBriefCard's mount pattern ((home)/index.tsx:720-722): visible Friday through Sunday when not yet done this week (last-seen key), compact leg counts.
NEW Friday nudge — `nextFridayFireDate(hour, minute, now)` pure sibling of `nextMorningFireDate` in utils/brief/nudgeTime.ts (:19-26, verified generic hour math) + `armWeekCloseNudge()` in utils/weekClose/nudge.ts cloning armDailyBriefNudge (nudge.ts:50-92; fixed OS identifier `mageid-week-close-nudge`, no stored id needed). Fire Fri 15:00 local. ARM-TIME PREDICATE (G10): armed only when ≥1 active project had activity in 14d — computed at each re-arm (WeekCloseCard foreground effect, MorningBriefCard.tsx:78-83 precedent). Body: "Friday close is ready — bill what you earned." Respects a new `weekClose` toggle riding `profiles.notification_preferences` (flat jsonb, additive key, NO migration — notifications-settings.tsx:263-288 write pattern).
MODIFY contexts/NotificationContext.tsx — `kind==='week_close'` → router.push('/week-close') in the verified switch (:87-91).

╔══ FEATURE 2 — LEAK COs, DRAFTED FOR YOU ═════════════════════════╗

CORRECTED SEMANTICS: "overnight" is honestly a CATCH-UP SWEEP ON APP OPEN. There is no client background runtime (nudge.ts:4), and CO creation is client-context-bound (`addChangeOrder`, ProjectContext.tsx:1564-1582 → supabaseWrite('change_orders','insert')). A server cron would have to duplicate cost-book pricing + CO numbering into Deno and write rows the local-first state doesn't own. The drafts still APPEAR overnight from the user's POV (they materialize on the next open, before he looks). See Risk D1.

PRECISION GATE (exists, verified): `gradeLeak` (gradePredictions.ts:236-317) resolves leak_flag rows to `{itemsBilled, itemsEaten, dollarsBilled, dollarsEaten, closedNoMatch}`; `buildLeakAccuracy` (accuracyReport.ts:113-140) already computes exactly the precision the map asked for: `billedRate = itemsBilled/(itemsBilled+itemsEaten)` (:125). Gate: rate ≥ 0.50 AND resolved-scan n ≥ 5 (stricter than the display's n≥3) — computed in W0's autonomyGate from `fetchResolvedPredictions(['leak_flag'])` (predictionLedger.ts:73-92). Below gate → no drafting, suggest-only (today's manual button), locked scoreboard visible.

NEW `utils/brain/leakCoDraft.ts` — pure:
- `collectDraftableLeaks({dailyReports, projects, changeOrders, processedReportIds, now})` → candidates: reports ≤14 days old on active projects whose `leakScan.items` contain ≥1 PRICED item (`estimatedPrice != null` — PricedLeakItem, types/index.ts:1395-1402), skipping reports already processed (AsyncStorage set) OR already carrying a CO with the audit marker. Unpriced-only scans stay manual — a $0 auto-draft is noise.
- `buildDraftCO(candidate, project, existingCOs, nowISO)` → full `ChangeOrder`: `status:'draft'` (valid — ChangeOrderStatus, types/index.ts:1098), number = same max+1 rule as change-order.tsx:113, reason 'out_of_scope', description = the exact handleDraftLeakCO format (daily-report.tsx:667-708 — priced lines + "NEEDS PRICE:" lines), changeAmount = Σ priced, originalContractValue/newContractTotal computed as the CO screen does, and DEDUPE MARKER: auditTrail entry `{id, action:'auto_drafted_from_leak', actor:'MAGE', timestamp, detail:<reportId>}` (COAuditEntry is free-form action:string, types/index.ts:1115-1121; audit_trail is already a synced column — survives cache wipes, NO schema change).
Validator: `scripts/validate-leakco-draft.ts` (priced/unpriced split, dedupe against processed set AND marker, number sequencing, description format, gate-closed → empty plan).

NEW `hooks/useLeakCoDrafts.ts` — the only impure piece: once-per-session module-flag sweep (useBrainGrading.ts pattern): gate check (autonomyGate + `leak_draft_co` pref) → collect → for each plan `addChangeOrder(draft)` → `recordDidForYou("Drafted CO #12 for $1,840 from Tuesday's report — review & send", projectId)` (G9) → append reportId to `mageid_leakco_drafted` (G12). Mounted with one line in WeekCloseCard (ledger'd second touch) so it runs on every home render, not just Fridays. G4: the whole sweep is try/catch — a failure degrades to today's manual flow.
DRAFT-FOREVER (G8): nothing in this feature transitions status or touches portal send. app/daily-report.tsx is NOT modified — the manual button remains, and the sweep's dedupe respects manually-created drafts only via the processed-set (a manual draft lacks the marker; acceptable double-draft window is closed by processedReportIds being written for manual paths too? NO — keep it simple and honest: the sweep only skips its OWN work; if the user manually drafted first, the report's leakScan will usually be beyond the 14-day window or the CO comparison in review catches it. Implementer adds one guard: skip candidates where ANY existing CO on the project references the report date in its description — the exact string handleDraftLeakCO writes).
SURFACES: drafts appear in week-close leg 1 (autoDraftedCOs input = COs with the marker still in 'draft'), in the morning brief's didForYou section (free — ledger-fed), and in the CO list like any draft. Auto-demotion: gate re-checked every sweep; a demotion writes the didForYou line via useAutonomy (below) and the sweep simply stops.

╔══ FEATURE 3 — TRUE COSTS VIA QBO PULL ═══════════════════════════╗

VERIFIED BASELINE: qbo-reconciler (30-min cron, cron-secret-gated) pulls ONLY `Invoice where MetaData.LastUpdatedTime > last_sync_at` and acts only on Balance==0 (index.ts:82-97) — zero Purchase/Bill/Expense pull anywhere (grep-verified). Mapping is a direct column: `projects.qbo_customer_id` written by upsertCustomer (_shared/qbo-mapping/customer.ts:10,39-42) — NOT a mapping table. CORRECTED FACT vs map: on Purchase/Bill the CustomerRef lives at LINE level (AccountBasedExpenseLineDetail / ItemBasedExpenseLineDetail), not the header — unmapped lines are the NORM, which is another reason the confirm queue is mandatory, not optional polish. CORRECTED FACT: `CostSample` has NO `source` field today (costDatabase.ts:27-38 — basis 'actual'|'committed' only); flagging `source:'qbo'` requires the type extension in W5.

MIGRATION (file `supabase/migrations/20260726120100_qbo_cost_lines.sql`; applied ONLY via Supabase MCP):
```sql
create table public.qbo_cost_lines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  qbo_type text not null check (qbo_type in ('purchase','bill')),
  qbo_id text not null,          -- QBO entity Id
  qbo_line_id text not null default '',
  doc_number text, vendor text, txn_date date,
  amount numeric not null, description text, account_name text,
  qbo_customer_ref text,         -- line-level CustomerRef.value when present
  project_id text,               -- resolved via projects.qbo_customer_id; null = needs assignment
  status text not null default 'staged' check (status in ('staged','confirmed','rejected')),
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, qbo_type, qbo_id, qbo_line_id)
);
alter table public.qbo_cost_lines enable row level security;
create policy qbo_cost_lines_owner on public.qbo_cost_lines
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create index qbo_cost_lines_user_status on public.qbo_cost_lines (user_id, status);
alter table public.qbo_connections add column if not exists cost_pull_last_at timestamptz;
```
Separate cursor `cost_pull_last_at` — do NOT reuse last_sync_at (the invoice pull already advances it; sharing would skip cost history on first run).

MODIFY supabase/functions/qbo-reconciler/index.ts (code lands in repo; DEPLOY OWNER-GATED): after the invoice pull, per connected user: query `Purchase` then `Bill` `where MetaData.LastUpdatedTime > '${costSince}' MAXRESULTS 200` via the existing `qboFetch` (token refresh + 401-retry free — _shared/qbo.ts:123-151); explode into lines; resolve project_id where the line CustomerRef matches a `projects.qbo_customer_id` for that user; skip Purchase rows with Credit=true; UPSERT on the unique key with `on conflict … do update … where qbo_cost_lines.status = 'staged'` — a QBO edit refreshes a staged row but NEVER resurrects a confirmed/rejected one (G11). Stamp cost_pull_last_at. IMPORTANT symmetry guard: rows synthesized from MAGE's own pushed invoices are receivables, not costs — Purchase/Bill are inherently cost-side so no loop risk, but skip any Bill whose vendor matches the user's own company_name (self-referential noise).
MODIFY types/index.ts (sole touch, ledger'd): `MaterialReceipt.origin?: 'scan' | 'qbo'`. MODIFY utils/costDatabase.ts: `CostSample.source?: 'receipt' | 'qbo'`; `receiptToCostSamples` (:180-198) stamps source from receipt.origin.
NEW `utils/qbo/qboCostMap.ts` — pure: `stagedLineToReceipt(row)` → MaterialReceipt with DETERMINISTIC id `qbo-<type>-<qboId>-<lineId>` (idempotent re-materialization — receipts are AsyncStorage-local by design, useMaterialReceipts.ts:3-8, and are wiped on re-auth; the staging table is the durable truth, so confirmed rows re-materialize on any device), origin:'qbo', vendor/receiptDate/documentNumber/lines mapped, status 'reviewed'; `findLikelyDuplicate(receipts, row)` → same-vendor, total within ±5%, txn_date within 7 days (the scanned-receipt double-count guard — see Risk D2). Validator: `scripts/validate-qbo-costmap.ts` (deterministic ids, dup heuristic hits/misses, unmapped line → null project preserved).

╔══ FEATURE 3b — QBO CONFIRM QUEUE (the UI half) ══════════════════╗

NEW `hooks/useQboCostLines.ts` — react-query fetch of own staged+confirmed rows (reads don't queue; useBidResponsesPortfolio precedent), 5-min stale.
NEW `app/qbo-review.tsx` — Stack route (_layout second touch): list staged lines grouped by vendor/date; project picker for unmapped lines (null project_id); duplicate warning chip when findLikelyDuplicate hits ("Looks like the receipt you scanned Jul 22 — confirm anyway?"); CONFIRM → materialize via useMaterialReceipts.addReceipt(stagedLineToReceipt(row)) + `supabaseWrite('qbo_cost_lines','update',{id, status:'confirmed', project_id})` + `recordDidForYou("Filed 6 QBO costs to Henderson — $3,420")`; REJECT → status 'rejected'. NEVER any bulk silent path (G11) — "Confirm all" is allowed only for MAPPED, non-duplicate lines and says the count. On mount: idempotent re-materialization sweep (confirmed rows whose deterministic receipt id is missing locally get re-added — post-wipe recovery).
WIRING: entry row + pending badge in app/qbo-setup.tsx; `qboPendingCount` fed into composeWeekClose (leg 1 line); Business+ client gate via useTierAccess (matches server requireTier).
DOWNSTREAM (free, zero edits): materialized receipts already flow to job-cost actuals (JobCostInput.receipts, jobCostEngine.ts:125-143 additive input, consumed by app/job-costing.tsx) and to the cost book (buildCostDatabase → receiptToCostSamples) — the entire "compounding feed" is one conversion function. No edits to jobCostEngine or its callers.

╔══ FEATURE 4 — PACE PRE-APPLY: THE FIRST EARNED AUTONOMOUS ACT ═══╗

VERIFIED SUBSTRATE: draft arrival = `const [draft] = useState(() => takeDraft())` (schedule-review.tsx:59); `paceFor` suggestion rules :99-116 (skip milestones + 'general', confidence medium/high, ≥1-day delta); `applyPace` capture :118-155 with payload already carrying `trade` + `aiOriginalDays` (types.ts PaceSuggestionAppliedPayload); `gradePace` outcome carries trade, `paceBeatAi = paceErrVsAi < -0.5`, `tie = |paceErrVsAi| ≤ 0.5` (gradePredictions.ts:69-117); `buildPaceAccuracy` pools all trades (accuracyReport.ts:46-73). The per-trade split is PURE-DERIVABLE from resolved rows — no schema change (G14). Note the generator already half-applies pace via prompt grounding (paceGrounding.ts:101 instructs the AI to derive durations from PACE HISTORY) — paceFor's ≥1-day-delta rule is what prevents double-application, so the pre-apply planner MUST reuse paceFor's exact rules, not reimplement them.

NEW `utils/pace/preApplyPlan.ts` — pure: `computePreApplyPlan({tasks, paceBook, tradeGates, prefEnabled})` → `PreApplyDecision[] {taskId, trade, paceDays, aiOriginalDays, jobCount, confidence}`. Eligibility = paceFor's rules verbatim AND tradeGates[trade].passed AND prefEnabled. Validator: `scripts/validate-pace-preapply.ts` (gate pass/fail per trade, delta threshold, milestone/general skips, pref off → empty).
GATE (in W0's autonomyGate): per-trade over `fetchResolvedPredictions(['pace_suggestion_applied'])`: `beatOrTie = paceBeatAi || tie`; passed = rate ≥ 0.60 AND n ≥ 5 for THAT trade.
MODIFY app/schedule-review.tsx: one mount effect — compute plan, apply `durationDays = paceDays` per decision, add to pacedIds (:97 — kills the chip re-offer), stash decisions in state. BADGE per pre-applied task (extend components/schedule/PaceChip.tsx with a preApplied variant): "Set from your 12 jobs · tap for AI's 4d" — tap REVERTS to `aiOriginalDays`, removes from pacedIds (chip returns to suggest mode). Provenance strip (:268-278) gains "N set from your pace".
CAPTURE TIMING (G9, deliberate): pre-applied predictions are recorded at `accept()` (:162-172), not at pre-apply — only tasks STILL holding the pace value when the user accepts become ledger rows (`{...payload, preApplied: true}`). Reverted pre-applies never pollute the gate; manual chip taps keep their existing immediate capture. Grading is unchanged — gradePace scores both provenances identically, which is exactly right: the gate measures the substitution, not who initiated it.
RECEIPT: on accept with ≥1 surviving pre-apply → `recordDidForYou("Pre-set 4 durations from your measured pace (framing, drywall)", projectId)`.

AUTONOMY PREFERENCE (the smallest honest one — map-verified: zero autonomy prefs exist anywhere today):
MIGRATION (file `supabase/migrations/20260726120000_autonomy_preferences.sql`): `alter table public.profiles add column if not exists autonomy_preferences jsonb not null default '{}'::jsonb;` — sibling of notification_preferences, same read/write pattern (notifications-settings.tsx:193-199 read, :263-288 supabaseWrite('profiles','update') toggle).
Shape v1: `{ pace_preapply?: boolean; leak_draft_co?: boolean }` — ABSENT = ON (both are draft-level, zero-blast-radius acts; the earned gate is the real lock, the pref is the opt-out). No 'off/suggest/draft/act' ladder v1 — two booleans, honest and shippable; the domain-keyed jsonb means future domains (rfi_chase, weather) ride the same column without migration.
NEW `hooks/useAutonomy.ts` (W0, mirrors useTierAccess:157-202): reads prefs + fetchResolvedPredictions → `{ paceTradeGates, leakGate, prefs, setPref }`; TRANSITION DETECTOR: compares gate pass-state against `mageid_autonomy_gate_state` (G12) and on pass→fail writes the demotion receipt: "My pace calls for framing slipped to 45% — I've gone back to asking first" / "Leak precision dropped below half — CO drafting is back to one-tap" (G13). Promotion transitions also get a line ("Framing pace unlocked — 5 jobs, 60%+").
SETTINGS UI: "Brain autonomy" section appended to app/notifications-settings.tsx (entry already linked from (tabs)/settings/index.tsx:1020 and notifications-inbox): two toggles + live scoreboard per domain — "Pace pre-apply · framing 4/5 at 80% ✓ · drywall 3/7 (43%) — unlocks at 60% over 5 jobs". The settings screen becomes the scoreboard; locked domains show progress, not a dead toggle.

──────────────────────────────────────────────
3. BUILD BUNDLES (sequential single-writer implementers) + CONFLICT LEDGER
──────────────────────────────────────────────
Discipline per Brain v3: one agent per bundle, strictly in order, each ends with `npx tsc --noEmit` + `bun run lint` + its new validators + all pre-existing validators green, one commit per bundle. All on `claude/friday-close`.

F0 FOUNDATION — NEW: supabase/migrations/20260726120000_autonomy_preferences.sql, supabase/migrations/20260726120100_qbo_cost_lines.sql, utils/brain/autonomyGate.ts, hooks/useAutonomy.ts, scripts/validate-autonomy-gate.ts. MODIFY: contexts/AuthContext.tsx (add `mageid_week_close_last_seen`, `mageid_leakco_drafted`, `mageid_autonomy_gate_state` in ONE edit — sole touch of this file), package.json (test:autonomy-gate + ship-check append).
F1 WEEK-CLOSE ENGINE — NEW only: utils/weekClose/composeWeekClose.ts, utils/weekClose/types.ts, scripts/validate-compose-week-close.ts. MODIFY: package.json.
F2 WEEK-CLOSE SURFACE — NEW: app/week-close.tsx, components/home/WeekCloseCard.tsx, utils/weekClose/nudge.ts. MODIFY: utils/brief/nudgeTime.ts (add nextFridayFireDate — pure, append-only), app/_layout.tsx (route, :603-619 cluster), app/(tabs)/(home)/index.tsx (card mount beside :720-722), contexts/NotificationContext.tsx (week_close branch at :87-91), app/notifications-settings.tsx (weekClose nudge toggle — 1st touch), package.json.
F3 LEAK→DRAFT CO — NEW: utils/brain/leakCoDraft.ts, hooks/useLeakCoDrafts.ts, scripts/validate-leakco-draft.ts. MODIFY: components/home/WeekCloseCard.tsx (sweep mount — 2nd touch, rebases on F2), package.json. (app/daily-report.tsx: ZERO touches this campaign.)
F4 PACE PRE-APPLY — NEW: utils/pace/preApplyPlan.ts, scripts/validate-pace-preapply.ts. MODIFY: app/schedule-review.tsx, components/schedule/PaceChip.tsx, utils/brain/types.ts (optional preApplied on PaceSuggestionAppliedPayload), app/notifications-settings.tsx (autonomy section — 2nd touch, rebases on F2), package.json.
F5 QBO SERVER + MAPPING — NEW: utils/qbo/qboCostMap.ts, scripts/validate-qbo-costmap.ts. MODIFY: supabase/functions/qbo-reconciler/index.ts (deploy deferred), types/index.ts (MaterialReceipt.origin — sole touch of types/index.ts in the campaign), utils/costDatabase.ts (CostSample.source + stamp), package.json.
F6 QBO CONFIRM UI — NEW: hooks/useQboCostLines.ts, app/qbo-review.tsx. MODIFY: app/_layout.tsx (route — 2nd touch, rebases on F2), app/qbo-setup.tsx (entry + badge), app/week-close.tsx (qboPendingCount wiring — 2nd touch, rebases on F2), package.json.

CONFLICT LEDGER (shared-file ownership — deviation = re-plan, not improvisation):
| file | owner bundle(s) | rule |
|---|---|---|
| contexts/AuthContext.tsx | F0 only | all three cache keys in one edit |
| package.json | every bundle | append-only test:* + ship-check chain; sequential order makes it safe |
| app/_layout.tsx | F2 then F6 | append-only Stack.Screen additions; F6 rebases |
| components/home/WeekCloseCard.tsx | F2 then F3 | F2 creates; F3 adds ONLY the sweep mount line |
| app/notifications-settings.tsx | F2 then F4 | F2 nudge toggle; F4 autonomy section — disjoint sections |
| app/week-close.tsx | F2 then F6 | F6 adds only the qboPendingCount input wiring |
| app/(tabs)/(home)/index.tsx | F2 only | card mount only |
| app/schedule-review.tsx, components/schedule/PaceChip.tsx | F4 only | |
| types/index.ts | F5 only | MaterialReceipt.origin only — keep the hottest file cold |
| utils/brain/types.ts | F4 only | payload optional field only (G14) |
| app/daily-report.tsx, contexts/ProjectContext.tsx, utils/brain/gradePredictions.ts, utils/brain/accuracyReport.ts, utils/brief/composeBrief.ts | NOBODY | consumed read-only; gates live in autonomyGate.ts; demotion lines ride didForYou, not composeBrief edits |

OTA-SAFE vs OWNER-GATED (explicit):
- OTA-safe JS: F1, F2, F3, F4 (everything), F5's client half (qboCostMap, type extensions), F6 — with the ship-order caveat that F0's TWO migrations must be applied BEFORE the OTA (useAutonomy selects autonomy_preferences; qbo-review selects qbo_cost_lines; G3 ordering).
- OWNER-GATED: apply both migrations via Supabase MCP (project nteoqhcswappxxjlpvap); deploy qbo-reconciler; merge; OTA. The reconciler deploy may TRAIL the OTA safely (client tolerates an empty staging table — qbo-review just shows its empty state), but migrations may not.
SHIP GATES (owner, end of campaign): (1) apply_migration ×2 → verify execute_sql; (2) deploy qbo-reconciler → watch one 30-min cron cycle's logs; (3) merge PR; (4) `eas update --branch production` (JS-only, runtime 1.0.0 untouched, zero native modules). Order: 1 → 3 → 4, with 2 anywhere after 1.

──────────────────────────────────────────────
4. THE RISKIEST DESIGN DECISIONS
──────────────────────────────────────────────
D1 — "Overnight" leak-CO drafting: client catch-up sweep vs server cron.
RECOMMEND: client sweep on app open (once-per-session, useBrainGrading precedent). Grounding is decisive: no background runtime exists client-side (nudge.ts:4), and a Deno cron would have to reimplement cost-book pricing, CO numbering, and contract-total math server-side while writing change_orders rows the AsyncStorage-first ProjectContext doesn't know it owns — the exact double-source-of-truth bug class the offline queue exists to prevent. Accepted consequence: a user who doesn't open the app gets no draft until he does — irrelevant, because the draft's only purpose is to be reviewed by that same user in that same session. Copy discipline: receipts say "drafted from Tuesday's report", never "while you slept".

D2 — QBO confirmed lines: materialize as MaterialReceipt vs a parallel cost input into jobCostEngine.
RECOMMEND: materialize as MaterialReceipt with origin:'qbo' and deterministic ids. One conversion function buys the ENTIRE downstream for free — job-cost actuals (JobCostInput.receipts) and cost-book samples (receiptToCostSamples) with zero edits to jobCostEngine or its callers — and the staging table remains the durable truth (receipts are deliberately device-local; confirmed rows re-materialize idempotently after any cache wipe). The real risk is double-counting a cost that was both scanned and keyed into QBO; that is why findLikelyDuplicate runs in the confirm UI and why silent bulk-confirm of flagged duplicates is forbidden (G11). REJECTED: parallel `qboCosts` input (touches every computeJobCost consumer and forks cost semantics); riding Smart Inbox (read-only notification surface, no confirm/reject state).

D3 — Autonomy preference storage + shape: profiles column vs notification_preferences piggyback vs AsyncStorage; ladder vs booleans.
RECOMMEND: new `profiles.autonomy_preferences` jsonb column (one-line additive migration), two booleans, absent=ON. AsyncStorage fails the tenant test (wiped on sign-in — a consent record must not silently reset to ON after re-auth... note it resets to the DEFAULT, which is ON — unacceptable for a pref someone turned OFF); piggybacking notification_preferences conflates "how do you want to be told" with "what may the brain do" and poisons both schemas. Absent=ON is defensible ONLY because both v1 domains are draft-level with trivial undo (delete draft / tap-revert) and both are additionally locked behind earned gates — an L4 act (sending anything) would require explicit opt-in, and none ships here (G8). The jsonb shape is the rails: future domains add keys, not columns.

D4 — Pre-apply capture timing: record at pre-apply vs at accept.
RECOMMEND: at accept, only for surviving pre-applies (F4 spec). Recording at pre-apply would let the brain grade itself on suggestions the user rejected before the schedule ever existed — inflating n with phantom trials and biasing the gate the autonomy depends on. Cost: pre-applies on drafts the user abandons entirely are never captured — correct, since no schedule was created. Manual chip taps keep today's capture-at-apply (unchanged behavior, and the payload flag distinguishes provenances for any future per-provenance split).

HONESTY LEDGER (what v1 knowingly does not do — documented cuts, not oversights):
- No dunning consent toggle or per-send receipts (map campaign feature 3): dunning columns aren't client-typed and the fn writes no outbox rows; the chase leg shows overdue+predictions only. Follow-up rides the same autonomy_preferences rails.
- No evening site-wrap doorbell (map campaign feature 4): out of this brief's four features; the Friday nudge shares nudgeTime plumbing a future eveningNudge reuses.
- No auto-SEND of anything, ever (G8) — leak CO L4 stays locked ~forever per the map.
- No QBO deletion/void propagation v1 (a voided Bill leaves a staged row; confirm UI shows txn_date, user rejects); no vendor→trade auto-categorization (account_name shown raw; category editable at confirm).
- No pace pre-apply on the copilot's mobile apply path — schedule-review (the desktop/review surface where aiOriginalDays and the chip already live) only, v1.
- Week-close composes on open; the Friday 15:00 nudge is static text (no background compose — same constraint and answer as the morning brief).
- n≥5 gates are thin (G13) — framed as earned-trust ladder with visible demotion, never as certainty.

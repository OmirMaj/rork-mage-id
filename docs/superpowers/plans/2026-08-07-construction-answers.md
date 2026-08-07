# Construction Answers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An agentic, cited construction Q&A: a new `construction-answer` edge function runs a Claude (Opus 4.8) tool-use loop over live web search + the contractor's own data + a deterministic calculator, surfaced as an "Ask" mode in the Construction AI tab, Business+-gated.

**Architecture:** New Supabase edge function (Deno, `npm:@anthropic-ai/sdk`) runs a manual agentic loop; it internally streams from Claude and returns one cited JSON payload to the RN app (no RN SSE). Tools: server-side `web_search_20260209` (cited authoritative retrieval), custom data tools executed against Supabase (project/plans/RFIs/rates), and a deterministic `calculate`. Honesty contract: never state an unretrieved code section, cite everything, defer to the AHJ. Gemini and all existing Q&A surfaces are untouched.

**Tech Stack:** React Native + Expo (TS strict, `bun`), Supabase edge functions (Deno), Anthropic TypeScript SDK. Verified by `npx tsc --noEmit`, `bun run ship-check`, permanent pure-logic validators, and (edge loop) owner integration test post-deploy.

**Reference spec:** `docs/superpowers/specs/2026-08-07-construction-answers-design.md`

---

## File structure
- **Create** `utils/constructionCalc.ts` — safe deterministic arithmetic evaluator (no `eval`); pure.
- **Create** `scripts/validate-construction-calc.ts` — permanent validator for the evaluator; wired into ship-check.
- **Create** `types/constructionAnswer.ts` — shared request/response types (imported by the client caller + UI; the edge fn re-declares its own Deno-side copy).
- **Create** `utils/constructionAnswer.ts` — client caller (auth'd fetch to the edge fn), `mageAI`-style; parses the typed response.
- **Create** `supabase/functions/construction-answer/index.ts` — the agentic edge function.
- **Modify** `supabase/functions/_shared/auth.ts` — add `construction_answer` to `MONTHLY_CAPS`.
- **Modify** `app/paywall.tsx` — add the `construction_answer` row to `AI_LIMITS`.
- **Modify** `app/(tabs)/construction-ai/index.tsx` — add the Business+-gated "Ask" mode.
- **Reference** `supabase/functions/mcp/index.ts` (data-access shape), `supabase/functions/ai/index.ts` (edge conventions: CORS, `Deno.serve`, auth), `hooks/useTierAccess.ts`, `utils/aiRateLimiter.ts`.

---

## Task 1: Deterministic calculator (pure) + validator

**Files:** Create `utils/constructionCalc.ts`, `scripts/validate-construction-calc.ts`.

- [ ] **Step 1: Implement a safe arithmetic evaluator.** In `utils/constructionCalc.ts`, export `evaluateExpression(expr: string): { ok: true; value: number } | { ok: false; error: string }`. Support `+ - * / ( )`, unary minus, decimals, and `^` (power). Implement a small shunting-yard / recursive-descent parser — **do NOT use `eval`/`Function`**. Reject anything with letters or unknown chars. Round to a sane precision (e.g. 6 sig-figs) and reject non-finite results. Keep it pure (no imports).

- [ ] **Step 2: Write the validator.** In `scripts/validate-construction-calc.ts`, import `evaluateExpression` and assert a table of cases: `"2+3*4"→14`, `"(1240/16)"→77.5`, `"8*50*12"→4800`, `"2^3"→8`, `"-3+5"→2`; and rejections: `"1+"`, `"drop table"`, `"1/0"` (→ error, not Infinity), `""`. Follow the existing `scripts/validate-*.ts` pattern (a `main()` that counts pass/fail, `console.log` summary, `process.exit(1)` on any fail). Run: `bunx tsx scripts/validate-construction-calc.ts` (or the runner the repo's other validators use) → all pass.

- [ ] **Step 3: Wire into ship-check + typecheck + commit.** Add the validator to the ship-check validator list (match how `validate-schedule-onramp.ts` etc. are registered — grep `validate-` in `package.json`/the ship-check script). Run `npx tsc --noEmit` (zero errors) and the validator (green).
```bash
git add utils/constructionCalc.ts scripts/validate-construction-calc.ts package.json
git commit -m "feat(construction-answer): deterministic arithmetic evaluator + validator"
```

---

## Task 2: Shared types + client caller

**Files:** Create `types/constructionAnswer.ts`, `utils/constructionAnswer.ts`.

- [ ] **Step 1: Types.** In `types/constructionAnswer.ts` define and export:
```ts
export interface ConstructionAnswerRequest { question: string; projectId?: string | null; }
export interface AnswerCitation { label: string; kind: 'web' | 'plan' | 'rfi' | 'rate'; url?: string; ref?: string; }
export interface ConstructionCalc { expression: string; value: number; note?: string; }
export interface ConstructionAnswerResult {
  answer: string;
  citations: AnswerCitation[];
  calc?: ConstructionCalc | null;
  verified: boolean;          // false when the answer rests on unretrieved knowledge
  disclaimer?: string | null; // e.g. "Confirm local amendments with your AHJ."
  usedAI: boolean;            // true only when the model actually ran (for metering)
}
```

- [ ] **Step 2: Client caller.** In `utils/constructionAnswer.ts`, export `askConstruction(req: ConstructionAnswerRequest): Promise<ConstructionAnswerResult>`. Follow `utils/mageAI.ts`: get the Supabase session/JWT, `fetch` `${FUNCTIONS_URL}/construction-answer` with `Authorization: Bearer <jwt>` + JSON body, parse the typed result. On non-200: map 402→a friendly "Business plan required" error, 404/network→a graceful "Construction Answers isn't available yet" error (so the UI degrades, not crashes). Do NOT throw raw. Match the file's existing `FUNCTIONS_URL`/supabase-client import used by `mageAI`/`projectMemory`.

- [ ] **Step 3: Typecheck + commit.** `npx tsc --noEmit` (zero errors).
```bash
git add types/constructionAnswer.ts utils/constructionAnswer.ts
git commit -m "feat(construction-answer): shared types + auth'd client caller"
```

---

## Task 3: Tier gate + caps

**Files:** Modify `supabase/functions/_shared/auth.ts`, `app/paywall.tsx`. Reference `hooks/useTierAccess.ts`.

- [ ] **Step 1: Server cap.** In `supabase/functions/_shared/auth.ts`, add a `construction_answer` key to `MONTHLY_CAPS` for each tier: `free: 0, pro: 0, business: <N e.g. 100>, enterprise: Infinity` (match the shape of the existing `plan_code_review`/`project_memory` entries). Do not change `requireTier`’s signature — the edge fn will call `requireTier(req, ['business'], 'construction_answer')` (min-rank already lets enterprise through).

- [ ] **Step 2: Paywall table.** In `app/paywall.tsx` `AI_LIMITS`, add a `construction_answer` row consistent with the others (free/pro "—", business the monthly N, enterprise "Unlimited"), with a short label like "Construction Answers (agentic, cited)". Keep the numbers aligned with Step 1.

- [ ] **Step 3: Confirm the client gate key exists.** Grep `useTierAccess` — its feature keys live in `hooks/useTierAccess.ts`. Add a `construction_answer` feature mapped to Business+ there if the hook uses an explicit key map (follow `ai_code_check`). If the hook derives access generically, no change needed — note which.

- [ ] **Step 4: Typecheck + commit.** `npx tsc --noEmit` (zero errors; note: `_shared/auth.ts` is Deno — verify it's excluded from the app tsconfig as the other `supabase/functions` files are, so this won't error the app typecheck; the change is a literal object entry).
```bash
git add supabase/functions/_shared/auth.ts app/paywall.tsx hooks/useTierAccess.ts
git commit -m "feat(construction-answer): Business+ gate + monthly cap + paywall row"
```

---

## Task 4: The agentic edge function

**Files:** Create `supabase/functions/construction-answer/index.ts`. Reference `supabase/functions/ai/index.ts` (CORS, `Deno.serve`, JSON, auth) and `supabase/functions/mcp/index.ts` (Supabase data queries).

- [ ] **Step 1: Read the conventions.** Read `ai/index.ts` for the edge boilerplate (CORS headers, `Deno.serve`, OPTIONS handling, how it reads the user JWT + builds a Supabase client, secret access via `Deno.env.get`). Read `mcp/index.ts` for how it queries `projects`, `rfis`, invoices, and how it scopes to the authenticated user (RLS via the user's JWT). Reuse these patterns verbatim.

- [ ] **Step 2: Auth + tier gate + input.** On POST: CORS/OPTIONS as in `ai`. Parse `{ question, projectId }`. Enforce the tier: `await requireTier(req, ['business'], 'construction_answer')` from `_shared/auth.ts` (returns 402 on failure — return that response). Read `ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')`; if missing, return a 503 JSON `{ error: 'not_configured' }` (the client degrades gracefully). Build a Supabase client bound to the caller's JWT for the data tools.

- [ ] **Step 3: Anthropic client + system prompt.** `import Anthropic from "npm:@anthropic-ai/sdk"`. `const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });`. Write the **system prompt** (put it in a `const SYSTEM` string, cache-controlled) encoding the honesty contract verbatim:
  - "You are MAGE's construction expert. Answer construction questions by researching, not recalling."
  - "NEVER state a code section, span value, or spec figure you did not retrieve via web_search this turn. If you didn't retrieve it, say so and set the answer's confidence accordingly."
  - "Cite every authoritative claim. Prefer the contractor's own job data (via the tools) when the question is about their project."
  - "When a local amendment can't be verified, give the model-code answer as general guidance and explicitly tell them to confirm with their AHJ / building department."
  - "Use the calculate tool for any arithmetic (spans, loads, quantities) — never compute in your head."
  - "Be concise and lead with the answer. This is for a contractor on a jobsite."

- [ ] **Step 4: Tools.** Define the tool list:
  - Server tool: `{ type: "web_search_20260209", name: "web_search", max_uses: 5 }`. (Do NOT also add `code_execution` — the `_20260209` web tool runs code-exec internally.)
  - Custom `get_project_context` — input `{}` (uses the request's `projectId`); handler queries `projects` (type, scope, location, linked estimate top lines, schedule summary) scoped to the user; returns compact JSON.
  - Custom `search_plans` — input `{ query: string }`; handler POSTs the existing `project-memory-search` (or calls its RPC) filtered to `source='Plan Sheet'` for this project; returns cited snippets `{ sheet, text }[]`.
  - Custom `list_rfis` — input `{}`; handler returns open RFIs for the project (`#`, subject, question, answer).
  - Custom `get_cost_rates` — input `{ trade?: string }`; handler returns the contractor's learned/seeded rates (mirror how the app builds the cost DB, or read the seeds table) with provenance.
  - Custom `calculate` — input `{ expression: string }`; handler = the Deno port of `evaluateExpression` (copy the pure logic into the function file, or inline a minimal safe parser — do NOT `eval`). Returns `{ value }` or `{ error }`.
  Each custom tool = `{ name, description (prescriptive "call this when…"), input_schema }`.

- [ ] **Step 5: Manual agentic loop (internal streaming).** Seed `messages` with a compact grounding block (project context + top rates, fetched once up front like `groundingFacts`) + the user question. Loop:
  - `const stream = client.messages.stream({ model: "claude-opus-4-8", max_tokens: 8000, thinking: { type: "adaptive" }, output_config: { effort: "high", task_budget: { type: "tokens", total: 40000 } }, system: [{ type:'text', text: SYSTEM, cache_control:{type:'ephemeral'} }], tools, messages });` then `const msg = await stream.finalMessage();`. (Use the beta path + `betas: ["task-budgets-2026-03-13"]` per the reference; if the SDK version in Deno rejects the beta, drop `task_budget` and keep `max_tokens` as the ceiling — note which.)
  - If `msg.stop_reason === 'pause_turn'`: append `{role:'assistant', content: msg.content}` and continue (server-tool continuation — do NOT add a user message).
  - Collect `tool_use` blocks; execute each custom tool handler; append the assistant turn then a single user turn of `tool_result` blocks (all results in one message). Loop until `stop_reason === 'end_turn'` or a max of ~8 iterations (bound).
  - Accumulate citations from `web_search_tool_result` blocks (url/title) and from the custom tools the model cited; capture any `calculate` result as `calc`.
- Parse the final assistant text into `answer`. Determine `verified` = whether the answer's authoritative claims came from a retrieval this turn (heuristic: at least one web/plan citation when the question is code/spec; the model is also instructed to self-declare — have it end with a machine-readable line you strip, or infer from citations). Set `disclaimer` when the model deferred to the AHJ.

- [ ] **Step 6: Response + metering.** Return `{ answer, citations, calc, verified, disclaimer, usedAI: true }` (matches `types/constructionAnswer.ts`). Increment the monthly counter the same way `ai/index.ts` records usage against `MONTHLY_CAPS` (only on a real model run). Wrap the whole handler in try/catch → on error return a JSON `{ error }` 500 (never a hang); if the loop hits the iteration bound, return the best cited partial with a short "narrow the question" note rather than failing.

- [ ] **Step 7: Verify (Deno) + commit.** Run `deno check supabase/functions/construction-answer/index.ts` if `deno` is available (else careful read-through — this file is outside the app tsconfig, so `npx tsc` won't cover it). Confirm no secret is logged; the tier gate is enforced before any Anthropic call; every custom tool is scoped to the caller's JWT.
```bash
git add supabase/functions/construction-answer/index.ts
git commit -m "feat(construction-answer): agentic Claude edge function (web search + data tools + calc, cited, AHJ-honest)"
```

---

## Task 5: Construction AI "Ask" mode (client UI)

**Files:** Modify `app/(tabs)/construction-ai/index.tsx`. Reference `hooks/useTierAccess.ts`, `utils/constructionAnswer.ts`, the file's existing citation-chip / card styling.

- [ ] **Step 1: Read the tab.** Read `app/(tabs)/construction-ai/index.tsx` — its mode toggle (Code Check / Roadmap / Plan Review), how a mode renders input + result, its styles/tokens, and how it gates (`useTierAccess`). Add a fourth mode **"Ask"** (or, if the toggle is full, replace "Code Check"'s call path — but prefer adding a mode to avoid removing a feature).

- [ ] **Step 2: The Ask mode.** Render: a multiline question input + optional project picker (reuse whatever project-select the tab already has, else default to the selected project), a "Get answer" button (haptics), and a result area. On submit: `useTierAccess('construction_answer')` — if not Business+, show the upgrade CTA (route to `/paywall`) instead of calling. Otherwise call `askConstruction({ question, projectId })`; show a loading state (agentic calls take longer — say "Researching your codes + job…").

- [ ] **Step 3: Render the result honestly.** Show `answer`; a row of **tappable citation chips** (web → open url; plan → jump to `/plan-viewer?sheetId=`; rfi/rate → label) reusing the tab/app chip style; the `calc` (expression → value) when present; and a **verified/AHJ banner**: when `verified===false` or `disclaimer` set, show an amber "General guidance — confirm with your AHJ" note (honesty chip, matching the brain-center directive: grounded + honest). Use design tokens (no raw hex/bare fontSize). Handle the caller's graceful errors (not-available / needs-Business) as inline messages, never a crash.

- [ ] **Step 4: Typecheck + commit.** `npx tsc --noEmit` (zero errors).
```bash
git add "app/(tabs)/construction-ai/index.tsx"
git commit -m "feat(construction-answer): Business+ Ask mode in Construction AI (cited answer + calc + AHJ banner)"
```

---

## Task 6: Ship-check + final review

- [ ] **Step 1: Full ship-check.** `bun run ship-check` → green (typecheck + lint + all validators incl. `validate-construction-calc.ts`). Fix anything flagged.

- [ ] **Step 2: Inert-behind-gate audit.** Confirm by reading: a non-Business user sees the upgrade CTA (no call); if the edge fn is undeployed/misses the key, the client shows "not available yet" (no crash); Gemini and the existing Q&A surfaces are byte-for-byte unchanged; no existing funnel event touched. The Anthropic key never reaches the client (only the edge fn reads it).

- [ ] **Step 3: Commit any fixes.**
```bash
git add -A && git commit -m "chore(construction-answer): ship-check green; inert-behind-gate verified"
```

---

## Self-review — spec coverage
- Agentic edge fn (Opus 4.8), tool loop {web_search, data tools, calculate}, internal streaming, one JSON payload → Task 4. ✓
- Deterministic calculator (auditable math) + validator → Task 1 (+ ported into Task 4). ✓
- Honesty/citation contract (no fabricated code, cite all, AHJ deferral, `verified`) → Task 4 system prompt + Task 5 rendering. ✓
- Business+ gate + monthly cap + paywall row → Task 3; enforced server-side in Task 4, client in Task 5. ✓
- Surfaced in Construction AI tab, reusing shell + chips → Task 5. ✓
- Graceful/inert until owner sets `ANTHROPIC_API_KEY` + deploys → Tasks 2/4/5 (503/404 handling + tier CTA). ✓
- Gemini + existing surfaces untouched; no funnel changes → Task 6 audit. ✓

Consistency: `ConstructionAnswerResult` fields (`answer`/`citations`/`calc`/`verified`/`disclaimer`/`usedAI`), the route `construction-answer`, the feature key `construction_answer`, and `requireTier(..., ['business'], 'construction_answer')` are used identically across Tasks 2–5. Edge-function file is Deno (outside app tsconfig) — verified via `deno check`/read, not `npx tsc`. No placeholders; the agentic loop's exact API shape is given from the Claude API reference (model id, `web_search_20260209`, task-budget beta, `pause_turn` handling, prompt caching).

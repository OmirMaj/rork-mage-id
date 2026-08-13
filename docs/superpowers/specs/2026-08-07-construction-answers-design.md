# Construction Answers — deep, agentic, cited construction Q&A (Design Spec)

_Date: 2026-08-07. A construction-question engine that answers by **doing the work** — grounded in the contractor's own data + authoritative construction sources, multi-step, and cited — instead of a single-shot LLM answering from memory. The moat: agentic Claude wired to the contractor's data AND live authoritative retrieval, which neither a bare Gemini/Claude call nor a stock chatbot can match._

## Goal & exit condition

**A contractor asks a construction question and gets an answer that researched the code/spec, checked their job, ran the real calc, and cited every source — and honestly defers to the AHJ when it can't verify, never fabricating a code section.** Success = answers that are current, jurisdiction-aware, project-specific, and trustworthy enough to act on — a class of answer the app cannot produce today.

## Current state (the gap — verified)

Every construction-answer surface today (Ask MAGE, Construction AI's Code Check, Project Memory, Ask Your Plans) is a **single-shot Gemini 2.5 Flash call grounded on the contractor's own data**, with:
- **Zero authoritative construction knowledge** — no IRC/IBC, span tables, or jurisdiction data. Code/permit answers are Gemini's training memory only (stale, and the "Plan Review" mode *fabricates* code citations like "IRC 2021 R310.1").
- **No agentic loop** — one prompt → one answer; it cannot "look up the code → check the plan → run the calc → cite each step."
- The one agentic path — **Connect Claude (MCP)** — is real but lives *outside* the app (read-only, Pro+, 6 tools), and still has no authoritative sources.

## Decisions (locked)

1. **Approach A — agentic Claude with live authoritative retrieval.** Claude researches the code/spec/span data live via web search; no curated KB to build/maintain.
2. **Tier gate: Business+** (agentic loops cost real money). Enterprise inherits.
3. **Powered by Claude (Anthropic API)** as a new, second AI backend alongside Gemini — surfaced in-app (the user does not have to leave for Claude desktop).

## Architecture

A new Supabase edge function **`supabase/functions/construction-answer`** (Deno) runs an **agentic tool-use loop** with Claude, then returns a single cited answer to the app. Engines and the Gemini relay are untouched; this is additive.

### Model & request shape (per the Claude API reference)
- **Model `claude-opus-4-8`** (the reasoning is hard; Opus is correct). `thinking: {type: "adaptive"}`, `output_config: {effort: "high"}`.
- SDK: `@anthropic-ai/sdk` via Deno `npm:` specifier. Auth: `ANTHROPIC_API_KEY` edge-function secret (**new owner prerequisite** — see below).
- The edge function **streams from Claude internally** (avoids Anthropic HTTP timeouts on long agentic turns) and returns one JSON `{ answer, citations[], usedSources, calc?, verified: bool, disclaimer }` to the RN client — so **no React-Native SSE is needed for v1** (reuses the existing request/response `mageAI`-style call site).

### The tool loop
Claude is given three kinds of tools and loops until done:
1. **Authoritative retrieval — server-side web search.** `{ type: "web_search_20260209", name: "web_search" }` (Anthropic-hosted, built-in dynamic filtering, returns results *with citations*). Bounded by `max_uses` (~5) to cap latency/cost. **Do NOT also declare `code_execution`** — the `_20260209` web tool runs code-exec under the hood; a second execution env confuses the model.
2. **The contractor's own data — custom tools executed by the edge function** against Supabase (scoped to the authenticated user via RLS / the same auth the MCP uses). Reuse/mirror what `supabase/functions/mcp` already exposes plus plan/RFI/cost lookups:
   - `get_project_context(projectId)` → type, scope, location/jurisdiction, key estimate lines, schedule summary.
   - `search_plans(projectId, query)` → cited plan-sheet snippets (reuse the existing `project-memory-search` pgvector over `memory_embeddings`, `source='Plan Sheet'`).
   - `list_rfis(projectId)` / `get_cost_rates(trade?)` → open RFIs + the contractor's learned/seeded rates (`buildCostDatabase`/seeds).
3. **Deterministic math — a custom `calculate(expression)` tool** the edge function evaluates safely (no `eval`; a small arithmetic parser) so span/load/quantity results are auditable and correct, not model-guessed.

Loop via the SDK **tool runner** (custom-tool handlers execute against Supabase; the server `web_search` tool runs automatically), or a manual agentic loop for finer logging/gating — implementer picks; the manual loop is preferred for the audit log. Bound the whole loop with a **task budget** (`output_config.task_budget`, beta `task-budgets-2026-03-13`) so it paces itself and finishes within the edge-function window.

### Grounding injection + caching
- Seed the first turn with a compact **grounding block** (the contractor's project context + top learned rates) the way `groundingFacts`/`buildEstimatePrompt` already do — so cheap questions don't need a tool round-trip — while the data tools remain available for deeper lookups.
- **Prompt caching** on the stable system prompt + tool definitions (`cache_control: {type: "ephemeral"}` on the last system block) — the system prompt is large and reused across questions.

### The honesty & citation contract (the whole point)
System prompt hard-rules, mirroring MAGE's provenance ethos and *fixing today's fabricated-citation problem*:
- **Never state a code section, span value, or spec figure you did not retrieve this turn.** If web search didn't return it, say so.
- **Cite every authoritative claim** — each code/spec/product fact carries its source (web_search citations) or its project source (RFI #, Sheet, rate provenance), rendered as tappable chips like Ask MAGE (`[REF]`) and Ask Your Plans (sheet chips) already do.
- **Defer to the AHJ.** When a local amendment can't be verified, answer with the model code as *general guidance* and explicitly say *"confirm with your AHJ / building department."* A pre-written honest disclaimer, not an AI-improvised one.
- `verified: false` whenever the answer rests on unretrieved knowledge — the UI surfaces that state (no false confidence).

## Surfacing (reuse the existing shell)
Upgrade the **Construction AI** tab (`app/(tabs)/construction-ai/index.tsx`) with an **"Ask" mode** (or replace the single-shot "Code Check" call) that hits `construction-answer` and renders: the answer, source chips, the calc (when present), and the verified/AHJ banner. Reuse the tab's existing UI + the citation-chip pattern; do not build a new screen. Gate the mode on Business+.

## Tiering, caps, cost
- **Server gate:** `requireTier(req, ['business'], 'construction_answer')` in the edge function (`_shared/auth.ts` min-rank → Enterprise satisfies). **Client gate:** `useTierAccess('construction_answer')` on the mode.
- **Monthly cap:** add `construction_answer` to `MONTHLY_CAPS` (`_shared/auth.ts`), enforced server-side; align the number with a new row in `app/paywall.tsx` `AI_LIMITS` and, if a daily client pre-check is wanted, `utils/aiRateLimiter.ts`. (Agentic calls are pricier than the Gemini text calls — set a conservative Business cap, generous/unlimited Enterprise.)
- **Cost controls baked in:** `effort: "high"` (not `max`), `task_budget`, `web_search` `max_uses`, prompt caching, a bounded tool set.

## Owner prerequisites (gating — like the App-Store/RevenueCat items)
- **`ANTHROPIC_API_KEY`** set as a `construction-answer` edge-function secret (new backend dependency; the app has never used the Anthropic API before). Owner-provisioned.
- **Deploy** `supabase functions deploy construction-answer`. The feature is inert until both are done; the build ships behind the tier gate so nothing breaks pre-deploy (the mode shows an upgrade/coming-soon state if the function 404s or the tier is insufficient).

## Non-goals / deferred
- No change to Gemini or the existing Q&A surfaces' engines (Ask MAGE, Project Memory, Ask Your Plans stay as they are; this is a new, deeper mode).
- No curated code/spec KB (rejected Approach B); no Claude-training-only mode (rejected C).
- No React-Native SSE streaming in v1 (edge streams from Claude internally, returns one payload); live token streaming to the app is a later enhancement.
- Not turning the MCP into the engine — this is an *in-app* engine that happens to reuse the MCP's data-access shape.

## Edge cases
- **No project context / general question:** the data tools return empty; the answer relies on web search + honest AHJ deferral. Still valuable.
- **Web search returns nothing authoritative:** answer as general guidance, `verified:false`, defer to AHJ — never fabricate a citation.
- **Edge-function time limit:** the task budget + `max_uses` + bounded tools keep the loop within the window; if a turn still risks timeout, it returns the best cited partial with a "still researching — narrow the question" note (never a hang). (If this proves too tight, a background-job + poll variant is the documented enhancement.)
- **Tier/secret missing:** the mode degrades gracefully (upgrade CTA or "coming soon"), never a dead-end or crash.
- **Prompt-injection via retrieved content:** treat web/plan content as data, not instructions (system-prompt boundary); the answer cites but does not obey retrieved text.

## Testing & ship discipline
- `bun run ship-check` green (typecheck + lint + validators). Add a permanent pure-logic validator for the parts that are testable without the network: the `calculate` arithmetic parser (`scripts/validate-construction-calc.ts`), and the grounding-block/citation-parsing helpers (pure functions). The agentic loop itself is integration-tested by the owner post-deploy (needs the key).
- Keep all new AI behavior **strictly gated** — non-Business users and a missing key/function must not affect any existing flow.
- Do not alter existing funnel events or the Gemini relay.

## Risks
- **Edge-function execution window vs. agentic latency** — the highest risk; mitigated by task budget + `max_uses` + bounded tools + internal streaming, with the background-job variant as the escape hatch.
- **Cost** — agentic Opus loops are materially pricier than Gemini text calls; mitigated by the Business+ gate, caps, effort/budget bounds, and caching. Monitor spend before widening the tier.
- **New backend dependency** (Anthropic API) — owner must provision the key; the build must stay inert/graceful until then.
- **Honesty regressions** — the anti-fabrication rule is the product's credibility; the system prompt + `verified` flag + citation rendering must be enforced and reviewed hard (a fabricated code number is worse than "I don't know").

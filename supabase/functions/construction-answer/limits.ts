// construction-answer/limits.ts — the three ceilings on one Construction Answer.
//
// Pure (no imports, no Deno globals): scripts/validate-ai-call-log.ts runs it
// under Bun and pins index.ts to it.
//
// WHY. A Construction Answer is an agentic Claude Opus run with server-side
// web search, the costliest call in the app (one unmeasured estimate: 40 to 80
// cents). The monthly cap (MONTHLY_CAPS.construction_answer: 100 on Business,
// 300 on Enterprise) bounds the month; nothing bounded the hour or one answer's
// wall clock. Founder, 2026-10-04: "put an hourly limit on Construction Answers".
//
//   HOURLY_LIMIT       answers one account may START per clock hour. ask-files
//                      (one Gemini Flash call) allows 30; this is a multi-round
//                      Opus run with paid searches, so 10. Counted with the
//                      shared rate_limit_increment bucket (rateLimitCount),
//                      fail CLOSED like its siblings: no limiter, no run.
//   ANSWER_STOP_MS     hard wall-clock stop for the whole agentic run, measured
//                      from the handler's first line. The app gives up at 120 s
//                      (utils/constructionAnswer.ts ANSWER_TIMEOUT_MS), so the
//                      server answers first, with a reason.
//   MAX_ROUNDS         model calls in one run's tool loop.
//   MAX_WEB_SEARCHES_PER_ROUND   Anthropic web_search max_uses, which is per
//                      model call. One run's real ceiling is therefore
//                      MAX_ROUNDS x MAX_WEB_SEARCHES_PER_ROUND searches.

export const HOURLY_LIMIT = 10;
export const ANSWER_STOP_MS = 100_000;
export const MAX_ROUNDS = 8;
export const MAX_WEB_SEARCHES_PER_ROUND = 5;
/** The most web searches one answer can make (and be billed for). */
export const MAX_WEB_SEARCHES_PER_ANSWER = MAX_ROUNDS * MAX_WEB_SEARCHES_PER_ROUND;

export type HourlyDecision = "ok" | "limited" | "unavailable";

/**
 * `countAfter` is rateLimitCount's reply: the count INCLUDING this request, or
 * a negative number when the limiter itself failed. `countAfter - 1 >= limit`
 * refuses exactly the request after the limit. Anything that is not a finite
 * number is treated as a failed limiter (fail closed).
 */
export function hourlyDecision(countAfter: number, limit: number = HOURLY_LIMIT): HourlyDecision {
  if (typeof countAfter !== "number" || !Number.isFinite(countAfter) || countAfter < 0) return "unavailable";
  return countAfter - 1 >= limit ? "limited" : "ok";
}

/** 429 body. The app shows `message` as written for any 429 from this function. */
export function hourlyLimitBody(limit: number = HOURLY_LIMIT): { error: string; code: string; message: string } {
  return {
    error: "hourly_limit",
    code: "hourly_limit",
    message: `Construction Answers limit reached (${limit} per hour). Try again in an hour.`,
  };
}

/** 503 body when the limiter cannot be read. */
export function limiterUnavailableBody(): { error: string; code: string; message: string } {
  return {
    error: "rate_limiter_unavailable",
    code: "rate_limiter_unavailable",
    message: "Construction Answers is busy right now. Try again in a moment.",
  };
}

/** Milliseconds left before the stop; 0 or less = stop now. A garbled clock stops. */
export function stopMsLeft(startedAt: number, now: number, stopMs: number = ANSWER_STOP_MS): number {
  if (!Number.isFinite(startedAt) || !Number.isFinite(now) || now < startedAt) return 0;
  return stopMs - (now - startedAt);
}

/** 504 body for a run the wall clock stopped. Nothing is charged for it. */
export function answerStoppedBody(): { error: string; code: string; message: string } {
  return {
    error: "answer_timeout",
    code: "answer_timeout",
    message: "That took too long, so MAGE stopped it. It did not count toward this month's limit. Try a narrower question: one code figure, one calculation or one plan detail.",
  };
}

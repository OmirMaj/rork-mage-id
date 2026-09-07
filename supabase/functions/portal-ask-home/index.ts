// portal-ask-home
//
// Ask Your Home: the homeowner's question box in the client portal. Anonymous
// (no JWT) — authenticated by the same 192-bit client_portal accessToken that
// gates portal_get_snapshot / portal_sign_contract. Flow:
//   1. Authorise through portal_project_for_token — the SECURITY DEFINER
//      choke point every portal RPC uses (token + enabled, and expiry once
//      20260904100800 is applied). Not an in-file token compare: see below.
//   2. Rate limit via rate_limit_counters: 20 questions/day per portal
//      (sum of today's hourly buckets) + a per-IP hourly cap.
//   3. Embed the question (geminiEmbed) → match_project_memory with the
//      project OWNER's user_id + projectId (service role, server-side only),
//      filtered to homeowner-safe sources.
//   4. Grounded Gemini answer — cites refs, prefers the not-found line.
//   5. Return { success, answer, refs: [{ ref, kind }] }.
//
// No new tables. No anon table reads. The access token is NEVER logged.
//
// Deploy (OWNER-GATED — do not deploy from a work session):
//   supabase functions deploy portal-ask-home
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY (all already set).

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { rateLimitCount } from "../_shared/auth.ts";
import { geminiEmbed, toVectorLiteral } from "../_shared/embeddings.ts";
import { GEMINI_TEXT_MODEL } from "../_shared/models.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://nteoqhcswappxxjlpvap.supabase.co";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") || "";
const GEMINI_MODEL = GEMINI_TEXT_MODEL; // env-overridable (audit AI-F12)

const PORTAL_DAILY_LIMIT = 20;   // questions per portal per UTC day (spec)
const IP_HOURLY_LIMIT = 15;      // questions per source IP per hour
const MAX_QUESTION_CHARS = 500;
const TEXT_TIMEOUT_MS = 60_000;  // B3 (review): bounded upstream fetch → CORS 504, not a wall-clock death
const MATCH_COUNT = 12;          // fetch wide, filter to safe sources, keep 8
const KEEP_MATCHES = 8;

// Sources a homeowner may read. Change orders / submittals / punch items stay
// contractor-internal (pricing + dispute context).
const ALLOWED_SOURCES = new Set(["Home Passport", "Daily Report", "RFI"]);

// KEEP IN SYNC with utils/passport/askHomePrompt.ts —
// scripts/validate-home-passport.ts asserts this file embeds the same
// not-found line and grounding rule.
const ASK_HOME_NOT_FOUND = "That's not in your home's records — ask your contractor.";

function buildPrompt(question: string, docs: { ref: string; content: string }[]): string {
  const context = docs.length > 0
    ? docs.map((d) => `[${d.ref}] ${d.content}`).join("\n\n")
    : "(no records found for this question)";
  return (
    "You are the memory of a home, answering the HOMEOWNER who lives there. " +
    "Answer the question using ONLY the home records below. Never invent brands, " +
    "dates, contacts, prices, or coverage terms. Write in plain, friendly language " +
    "a homeowner understands — no contractor jargon. Lead with the direct answer, " +
    "and cite the record reference in parentheses for each fact, e.g. " +
    "(Warranty — Trane HVAC). If the records do not contain the answer, reply " +
    `exactly: "${ASK_HOME_NOT_FOUND}" When unsure, prefer that reply over guessing.` +
    "\n\n" +
    `HOME RECORDS:\n${context}\n\n` +
    `HOMEOWNER QUESTION: ${question.trim()}`
  );
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Sum today's hourly buckets for this portal's ask scope. -1 = unavailable
 *  (caller fails OPEN — the access token is the primary gate and 20 flash
 *  calls/day is a bounded cost). */
async function portalDailyCount(portalId: string): Promise<number> {
  try {
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const scope = `askhome:portal:${portalId}`;
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/rate_limit_counters?select=count&scope=eq.${encodeURIComponent(scope)}&bucket_start=gte.${dayStart.toISOString()}`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    if (!r.ok) return -1;
    const rows = (await r.json()) as { count: number }[];
    return rows.reduce((s, x) => s + (x.count ?? 0), 0);
  } catch {
    return -1;
  }
}

function kindFromDocId(docId: string): string {
  const m = /^passport:([a-z]+):/.exec(docId || "");
  return m ? m[1] : "record";
}

interface AskRequest { portalId?: string; accessToken?: string; question?: string }
interface MemoryMatch { doc_id: string; source: string; ref: string; content: string; similarity: number }

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ success: false, error: "Use POST" }, 405);
  if (!SERVICE_ROLE_KEY || !GEMINI_KEY) return json({ success: false, error: "Server not configured" }, 500);

  let body: AskRequest;
  try { body = (await req.json()) as AskRequest; } catch { return json({ success: false, error: "Invalid JSON" }, 400); }

  const portalId = (body.portalId ?? "").trim();
  const accessToken = (body.accessToken ?? "").trim();
  const question = (body.question ?? "").trim();
  if (!portalId || !accessToken || !question) {
    return json({ success: false, error: "Missing portalId, accessToken, or question" }, 400);
  }
  if (question.length > MAX_QUESTION_CHARS) {
    return json({ success: false, error: "Question too long — keep it under 500 characters." }, 400);
  }

  // Per-IP hourly throttle. Fail OPEN on limiter unavailability (count < 0):
  // the access token is the primary gate.
  // A2 (review 2026-09-04) / EDGE-F15: the FIRST x-forwarded-for hop is
  // client-suppliable. Key on cf-connecting-ip when present, else the LAST
  // hop — the one the edge proxy itself appended.
  const xff = (req.headers.get("x-forwarded-for") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ip = (req.headers.get("cf-connecting-ip") || xff[xff.length - 1] || "").trim();
  if (ip) {
    const ipHits = await rateLimitCount(`askhome:ip:${ip}`);
    if (ipHits > IP_HOURLY_LIMIT) {
      return json({ success: false, error: "Too many questions from this connection — please wait a bit.", code: "rate_limited" }, 429);
    }
  }

  // Authorise through the choke point, not by comparing the token here.
  // portal_project_for_token (SECURITY DEFINER, EXECUTE for service_role
  // only — the two-argument signature is the only one in production) is the
  // ONE place that knows what a valid portal link is: token + enabled today,
  // and NOT EXPIRED once 20260904100800 is applied (AUTH-F7). Until the
  // 2026-09-05 review this file read projects.client_portal and compared the
  // token itself, so an expired link kept getting AI answers after every RPC
  // had started refusing it. Nothing here leaks: the response never includes
  // ids or tokens, and the submitted token is never logged.
  const gate = await fetch(`${SUPABASE_URL}/rest/v1/rpc/portal_project_for_token`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_portal_id: portalId, p_access_token: accessToken }),
  });
  if (!gate.ok) {
    console.error("[portal-ask-home] portal_project_for_token failed:", gate.status);
    return json({ success: false, error: "Lookup failed" }, 500);
  }
  const gateBody: unknown = await gate.json();
  const projectId = typeof gateBody === "string" && UUID_RE.test(gateBody) ? gateBody : null;
  if (!projectId) {
    // Same shape + delay for "no such portal", "bad token", "disabled" and
    // "expired" — don't reveal which.
    await new Promise((r) => setTimeout(r, 250));
    return json({ success: false, error: "Invalid portal link" }, 401);
  }

  // The OWNER's user_id is what match_project_memory is keyed on. Service
  // role, by the uuid the choke point just vouched for.
  const lookup = await fetch(
    `${SUPABASE_URL}/rest/v1/projects?select=id,user_id&id=eq.${encodeURIComponent(projectId)}&limit=1`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
  );
  if (!lookup.ok) {
    console.error("[portal-ask-home] lookup failed:", lookup.status);
    return json({ success: false, error: "Lookup failed" }, 500);
  }
  const rows = (await lookup.json()) as { id: string; user_id: string }[];
  const proj = rows[0];
  if (!proj?.user_id) {
    console.error("[portal-ask-home] project vanished between gate and lookup");
    return json({ success: false, error: "Lookup failed" }, 500);
  }

  // Per-portal daily cap: increment this hour's bucket, then sum today.
  await rateLimitCount(`askhome:portal:${portalId}`);
  const daily = await portalDailyCount(portalId);
  if (daily > PORTAL_DAILY_LIMIT) {
    return json({
      success: false,
      error: "Daily question limit reached — the answered questions above are always available. Try again tomorrow.",
      code: "daily_limit",
    }, 429);
  }

  // Retrieve from the project's memory index using the OWNER's user_id.
  let qvec: number[][];
  try {
    qvec = await geminiEmbed([question]);
  } catch (e) {
    console.error("[portal-ask-home] query embed failed:", String(e));
    return json({ success: false, error: "Embedding failed" }, 502);
  }
  if (!qvec[0]) return json({ success: false, error: "Empty embedding" }, 502);

  const rpc = await fetch(`${SUPABASE_URL}/rest/v1/rpc/match_project_memory`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_user_id: proj.user_id,
      p_project_id: proj.id,
      p_query: toVectorLiteral(qvec[0]),
      p_match_count: MATCH_COUNT,
    }),
  });
  if (!rpc.ok) {
    const t = await rpc.text().catch(() => "");
    console.error("[portal-ask-home] rpc failed:", rpc.status, t.slice(0, 300));
    return json({ success: false, error: "Search failed" }, 500);
  }
  const allMatches = (await rpc.json()) as MemoryMatch[];
  const matches = (Array.isArray(allMatches) ? allMatches : [])
    .filter((m) => ALLOWED_SOURCES.has(m.source))
    .slice(0, KEEP_MATCHES);

  if (matches.length === 0) {
    // Nothing homeowner-safe matched — the honest answer, free of charge.
    return json({ success: true, answer: ASK_HOME_NOT_FOUND, refs: [] });
  }

  // Grounded answer.
  const prompt = buildPrompt(question, matches.map((m) => ({ ref: m.ref, content: m.content })));
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TEXT_TIMEOUT_MS);
  let gen: Response;
  try {
    gen = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 500, temperature: 0.2 },
        }),
        signal: ac.signal,
      },
    );
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      return json({ success: false, error: "No answer right now — try again in a moment.", code: "upstream_timeout" }, 504);
    }
    console.error("[portal-ask-home] gemini network error:", (e as Error).message);
    return json({ success: false, error: "No answer right now — try again in a moment." }, 502);
  } finally {
    clearTimeout(timer);
  }
  if (!gen.ok) {
    const t = await gen.text().catch(() => "");
    console.error("[portal-ask-home] gemini failed:", gen.status, t.slice(0, 200));
    return json({ success: false, error: "No answer right now — try again in a moment." }, 502);
  }
  const genData = await gen.json();
  const answer = (genData.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
  if (!answer) {
    return json({ success: false, error: "No answer right now — try again in a moment." }, 502);
  }

  const refs = matches.map((m) => ({ ref: m.ref, kind: kindFromDocId(m.doc_id) }));
  return json({ success: true, answer, refs });
});

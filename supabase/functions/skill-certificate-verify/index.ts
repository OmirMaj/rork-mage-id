// skill-certificate-verify/index.ts — the public check behind
// https://mageid.app/skills/<code> (track LEARN, lane LEARNCERT).
//
// verify_jwt is OFF: a public, rate-limited read of one certificate by its check code.
// Anyone holding the link may confirm the certificate without an account. The
// 12-character code (32-character alphabet, 2^60 values, crypto random) is
// the capability; the per-address hourly limit below bounds a guessing script.
//
//   GET ?code=XXXXXXXXXXXX
//     200 {valid, revoked, holderName, certificateTitle, scope, issuedAt, correct, total}
//     400 {error:'bad_code'}       — format checked BEFORE any database read
//     404 {valid:false}            — no such code (never issued, or deleted by its owner)
//     405 | 429 {error:'rate_limited'} | 502 {error:'unavailable'}
//
// WHAT IT RETURNS. Only what the row and the generated key hold: the typed
// name, the skill's title and scope line (from _shared/skillQuizKey.generated.ts,
// never invented here), the issue date and the score. Never user_id, the row
// id or an email. The name is the one the account holder typed; MAGE ID does
// not check identity, and nothing in this response says otherwise.
//
// CACHING. Errors are `no-store`; a 200 is cached for 60 s only, so a deletion
// or a revocation reaches the page within a minute.
//
// RATE LIMIT. Keyed on cf-connecting-ip, else the LAST x-forwarded-for hop
// (the first hop is client-suppliable; _shared/notifyGuards.ts clientIpFrom,
// the portal-ask-home pattern). Fails OPEN when the limiter is down (-1).

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { rateLimitCount } from "../_shared/auth.ts";
import { clientIpFrom } from "../_shared/notifyGuards.ts";
import { SKILL_QUIZ_KEY } from "../_shared/skillQuizKey.generated.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const IP_HOURLY_LIMIT = 120;

/** Same alphabet and length as the table check and the award function. */
export const CODE_RE = /^[A-HJ-NP-Z2-9]{12}$/;

/** The ONLY columns read. Never user_id, id or anything that names an account. */
export const PUBLIC_COLUMNS = "topic, quiz_version, correct, total, holder_name, issued_at, revoked_at";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS,
      "Content-Type": "application/json",
      "Cache-Control": status === 200 ? "public, max-age=60" : "no-store",
    },
  });
}

/** 'Construction AI' → 'construction AI' (utils/learn/topics.ts lowerFirst). */
export function lowerFirst(label: string): string {
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/** The scope line, the same template as utils/learn/topics.ts topic(). */
export function scopeFor(label: string): string {
  return `Using ${lowerFirst(label)} in the MAGE ID app.`;
}

export interface PublicRow {
  topic: string;
  correct: number;
  total: number;
  holder_name: string;
  issued_at: string;
  revoked_at: string | null;
}

/** The 200 body, built field by field from the row and the key. null when the
 *  row's topic is not in the key (the page then shows the error state). */
export function verifyPayload(row: PublicRow): Record<string, unknown> | null {
  const t = Object.prototype.hasOwnProperty.call(SKILL_QUIZ_KEY.TOPICS, row.topic)
    ? SKILL_QUIZ_KEY.TOPICS[row.topic]
    : null;
  if (!t) return null;
  const revoked = row.revoked_at != null;
  return {
    valid: !revoked,
    revoked,
    holderName: row.holder_name,
    certificateTitle: t.certificateTitle,
    scope: scopeFor(t.label),
    issuedAt: row.issued_at,
    correct: row.correct,
    total: row.total,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);

  const code = new URL(req.url).searchParams.get("code") ?? "";
  if (!CODE_RE.test(code)) return json({ error: "bad_code" }, 400);

  const hits = await rateLimitCount(`skill-cert-verify:${clientIpFrom(req.headers)}`);
  if (hits > IP_HOURLY_LIMIT) return json({ error: "rate_limited" }, 429);

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ error: "unavailable" }, 502);
  try {
    const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data, error } = await svc
      .from("app_skill_certificates")
      .select(PUBLIC_COLUMNS)
      .eq("verify_code", code)
      .maybeSingle();
    if (error) {
      console.error("[skill-certificate-verify] read failed", error.code ?? "", error.message ?? "");
      return json({ error: "unavailable" }, 502);
    }
    if (!data) return json({ valid: false }, 404);
    const body = verifyPayload(data as PublicRow);
    if (!body) {
      console.error("[skill-certificate-verify] row topic is not in the generated key");
      return json({ error: "unavailable" }, 502);
    }
    return json(body);
  } catch (err) {
    console.error("[skill-certificate-verify] threw", err instanceof Error ? err.message : String(err));
    return json({ error: "unavailable" }, 502);
  }
});

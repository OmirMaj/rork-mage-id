// skill-certificate-award/index.ts — grade an app-skills check on the server and,
// on a pass, issue the certificate (track LEARN, lane LEARNCERT).
//
// A certificate exists only because THIS function graded a passing answer sheet
// against the generated key (_shared/skillQuizKey.generated.ts, rendered from
// utils/learn/quizBank.ts). The client's own grading is a preview; nothing it
// says about the score is trusted. public.app_skill_certificates has no client
// insert grant, so this is the only way a row is written.
//
// WHAT IT IS NOT. An app-skills certificate says the person passed a short check
// on using one part of the MAGE ID app. It is not a trade, safety or license
// credential. The holder name is whatever the account holder typed: MAGE ID does
// not check identity, and nothing returned here implies it did.
//
// verify_jwt = true (supabase/config.toml); the user is re-verified with GoTrue.
//
//   POST {topic, quizVersion, answers: {questionId: choiceId}, holderName}
//     200 {passed:false, correct, total}            (no row is written)
//     200 {passed:true, certificate:{id, topic, quiz_version, correct, total,
//          holder_name, verify_code, issued_at, revoked_at}}
//     400 {error:'bad_request'} | 400 {error:'bad_name'}
//     401 {error:'unauthorized'} | 405 | 409 {error:'quiz_changed'}
//     410 {error:'revoked'} | 429 {error:'rate_limited'} | 503 {error:'unavailable'}
//
// A second pass on the same topic and quiz version returns the certificate
// already issued (unique (user_id, topic, quiz_version); the name is not
// changed by a re-issue). When that row was revoked (support, at the holder's
// request) it answers 410 revoked instead of passing the dead row back.
//
// PRIVACY: the holder name and the answers are never logged.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { verifyUser } from "../_shared/verifyUser.ts";
import { rateLimitCount } from "../_shared/auth.ts";
import { SKILL_PASS_PCT, SKILL_QUIZ_KEY } from "../_shared/skillQuizKey.generated.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

/** Awards per user per hour. Fails OPEN when the limiter is down (-1): the
 *  value of a certificate is low and the grading happens here anyway. */
const AWARD_HOURLY_LIMIT = 30;

/** 32 characters: A-Z without I and O, 2-9 (no 0 / 1). Matches the table check. */
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 12;
const MAX_ANSWERS = 20;
const MAX_ANSWER_CHARS = 40;

const CERT_COLUMNS = "id, topic, quiz_version, correct, total, holder_name, verify_code, issued_at, revoked_at";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** Pass rule, integer math only (no division): correct * 100 >= PASS_PCT * total. */
export function isPass(correct: number, total: number): boolean {
  return Number.isInteger(correct) && Number.isInteger(total) && total > 0 &&
    correct >= 0 && correct <= total && correct * 100 >= SKILL_PASS_PCT * total;
}

/** The printed name: control and format characters removed (no bidi tricks),
 *  inner whitespace collapsed, trimmed. null when it holds '@' or is not 2 to
 *  80 characters long (counted in code points, like Postgres char_length). */
export function cleanHolderName(raw: string): string | null {
  const name = raw.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim();
  const len = [...name].length;
  if (name.includes("@") || len < 2 || len > 80) return null;
  return name;
}

/** 12 characters from CODE_ALPHABET (32^12 = 2^60 codes), crypto.getRandomValues.
 *  Rejection sampling keeps every character equally likely for any alphabet
 *  length (with 32, 256 is an exact multiple and nothing is rejected). */
export function newVerifyCode(): string {
  const n = CODE_ALPHABET.length;
  const limit = 256 - (256 % n);
  let out = "";
  while (out.length < CODE_LENGTH) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (b < limit && out.length < CODE_LENGTH) out += CODE_ALPHABET[b % n];
    }
  }
  return out;
}

interface AwardBody {
  topic: string;
  quizVersion: number;
  answers: Record<string, string>;
  holderName: string;
}

/** Shape check only; the grading is below. null on anything malformed. */
export function parseBody(raw: unknown): AwardBody | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const b = raw as Record<string, unknown>;
  if (typeof b.topic !== "string" || !hasOwn(SKILL_QUIZ_KEY.TOPICS, b.topic)) return null;
  if (typeof b.quizVersion !== "number" || !Number.isInteger(b.quizVersion)) return null;
  if (typeof b.holderName !== "string" || b.holderName.length > 400) return null;
  const a = b.answers;
  if (!a || typeof a !== "object" || Array.isArray(a)) return null;
  const entries = Object.entries(a as Record<string, unknown>);
  if (entries.length > MAX_ANSWERS) return null;
  const answers: Record<string, string> = {};
  for (const [k, v] of entries) {
    if (typeof v !== "string" || v.length > MAX_ANSWER_CHARS) return null;
    answers[k] = v;
  }
  return { topic: b.topic, quizVersion: b.quizVersion, answers, holderName: b.holderName };
}

/** Grade against the key. null when any question in the key has no answer. */
export function grade(
  answers: Record<string, string>,
  key: Readonly<Record<string, string>>,
): { correct: number; total: number } | null {
  const ids = Object.keys(key);
  let correct = 0;
  for (const qid of ids) {
    if (!hasOwn(answers, qid)) return null;
    if (answers[qid] === key[qid]) correct++;
  }
  return { correct, total: ids.length };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ error: "unavailable" }, 503);

  const user = await verifyUser(req);
  if (!user) return json({ error: "unauthorized" }, 401);

  const hits = await rateLimitCount(`skill-cert-award:${user.id}`);
  if (hits > AWARD_HOURLY_LIMIT) return json({ error: "rate_limited" }, 429);

  let raw: unknown;
  try { raw = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const body = parseBody(raw);
  if (!body) return json({ error: "bad_request" }, 400);

  const key = SKILL_QUIZ_KEY.TOPICS[body.topic];
  if (body.quizVersion !== key.version) return json({ error: "quiz_changed" }, 409);

  const graded = grade(body.answers, key.answers);
  if (!graded || graded.total !== key.total) return json({ error: "bad_request" }, 400);
  const { correct, total } = graded;
  if (!isPass(correct, total)) return json({ passed: false, correct, total });

  const holderName = cleanHolderName(body.holderName);
  if (!holderName) return json({ error: "bad_name" }, 400);

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // Insert; on (user_id, topic, quiz_version) do nothing. A verify_code clash
  // (unique) is retried once with a fresh code.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { error } = await svc
      .from("app_skill_certificates")
      .upsert({
        user_id: user.id,
        topic: body.topic,
        quiz_version: key.version,
        correct,
        total,
        holder_name: holderName,
        verify_code: newVerifyCode(),
      }, { onConflict: "user_id,topic,quiz_version", ignoreDuplicates: true });
    if (!error) break;
    const codeClash = error.code === "23505" && /verify_code/.test(error.message ?? "");
    if (codeClash && attempt === 0) continue;
    console.error("[skill-certificate-award] insert failed", error.code ?? "", error.message ?? "");
    return json({ error: "unavailable" }, 503);
  }

  const { data: cert, error: readErr } = await svc
    .from("app_skill_certificates")
    .select(CERT_COLUMNS)
    .eq("user_id", user.id)
    .eq("topic", body.topic)
    .eq("quiz_version", key.version)
    .maybeSingle();
  if (readErr || !cert) {
    console.error("[skill-certificate-award] read-back failed", readErr?.message ?? "no row");
    return json({ error: "unavailable" }, 503);
  }
  // A certificate support revoked at the holder's request stays revoked: a
  // re-pass on the same quiz version must not hand back a row whose public
  // link says "removed by its owner" as if it were fresh.
  if (cert.revoked_at !== null) return json({ error: "revoked" }, 410);
  return json({ passed: true, certificate: cert });
});

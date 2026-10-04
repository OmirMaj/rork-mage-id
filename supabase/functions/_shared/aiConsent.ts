// supabase/functions/_shared/aiConsent.ts — "may AI run for this owner?"
//
// App Store guideline 5.1.2(i). A server path that sends a contractor's job
// records to an AI provider with NO tap in the app (the Friday client recap,
// Ask Your Home) asks here first, immediately before the AI call. The answer is
// the account's stored one, public.profiles.ai_consent (migration
// 20261004090000_ai_consent.sql), read with the service role in ITS OWN query.
//
// FAIL CLOSED. The only yes is the exact string 'granted'. NULL (never told),
// 'declined', a missing profile row, a missing column, a non-2xx answer and a
// thrown fetch are all "no AI". 'unavailable' is kept apart from 'not_granted'
// only so a caller can say the truth ("could not check" versus "not turned
// on"); neither one ever lets an AI call through. A failed read is tried once
// more before it is reported.
//
// Do NOT call this from requireTier (_shared/auth.ts). The functions behind it
// are called by the app after the phone's own question, and the web app stores
// no answer of its own, so a check there would switch off every AI feature on
// web. scripts/validate-ai-consent-server.ts pins that, and fails any function
// that reaches an AI provider without a user tap and does not call this file.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type OwnerAiConsent = "granted" | "not_granted" | "unavailable";

/** True only for the exact string 'granted' (a stored value or an OwnerAiConsent). */
export function aiConsentAllows(answer: unknown): boolean {
  return answer === "granted";
}

type ConsentFetch = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

async function readOnce(
  supabaseUrl: string,
  serviceRoleKey: string,
  ownerId: string,
  fetchImpl: ConsentFetch,
): Promise<OwnerAiConsent> {
  try {
    const r = await fetchImpl(
      `${supabaseUrl}/rest/v1/profiles?select=id,ai_consent&id=eq.${ownerId}&limit=1`,
      { headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` } },
    );
    if (!r.ok) return "unavailable";
    const rows = await r.json();
    if (!Array.isArray(rows)) return "unavailable";
    const row = (rows as Array<{ id?: unknown; ai_consent?: unknown } | null>).find(
      (x) => !!x && typeof x.id === "string" && x.id.toLowerCase() === ownerId.toLowerCase(),
    );
    return aiConsentAllows(row?.ai_consent) ? "granted" : "not_granted";
  } catch {
    return "unavailable";
  }
}

/** One owner. Never throws. An id that is not a uuid is 'not_granted' and makes
 *  no request. A read that fails is tried once more. */
export async function readOwnerAiConsent(
  supabaseUrl: string,
  serviceRoleKey: string,
  ownerId: string | null | undefined,
  fetchImpl: ConsentFetch = fetch,
): Promise<OwnerAiConsent> {
  if (typeof ownerId !== "string" || !UUID_RE.test(ownerId)) return "not_granted";
  if (!supabaseUrl || !serviceRoleKey) return "unavailable";
  const first = await readOnce(supabaseUrl, serviceRoleKey, ownerId, fetchImpl);
  if (first !== "unavailable") return first;
  return readOnce(supabaseUrl, serviceRoleKey, ownerId, fetchImpl);
}

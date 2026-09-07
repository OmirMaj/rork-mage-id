// public-lead-intake
//
// The demand side of the public profile funnel. A visitor on a contractor's
// public portfolio page (mageid.app/builders/<companySlug>/...) fills the
// "Request a quote" form; that POSTs here, and we drop a Lead straight into the
// right GC's Pipeline — no login, same unauthenticated-write pattern the portal
// message / sub-invoice / RFP-bid functions already use (slug → user_id resolve
// + service-role insert).
//
// Deploy:  supabase functions deploy public-lead-intake --no-verify-jwt
//   (--no-verify-jwt because the caller is an anonymous web visitor; abuse is
//    bounded by required fields, a honeypot, and the slug→owner resolve.)
//
// Secrets required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// DB dependency: rpc public.gc_user_for_company_slug(p_slug text) → uuid
//   (see migration 20260608000000_public_lead_intake.sql).

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { rateLimitCount } from "../_shared/auth.ts";
import { clientIpFrom } from "../_shared/notifyGuards.ts";

const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://nteoqhcswappxxjlpvap.supabase.co";

// Abuse ceilings for this anonymous (--no-verify-jwt) endpoint. The honeypot
// only stops naive bots; without these a script could flood any GC's pipeline by
// slug. Hourly buckets, keyed per-IP and per-target-slug. Fails OPEN (a limiter
// outage must not drop real quote requests) — see the count < 0 handling below.
const LEAD_IP_HOURLY_LIMIT = 10;
const LEAD_SLUG_HOURLY_LIMIT = 30;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

interface LeadIntakeRequest {
  company_slug?: string;
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  project_type?: string;
  scope?: string;
  budget_min?: number;
  budget_max?: number;
  timeline?: string;
  source_project?: string; // which portfolio project they came from (free text → scope context)
  /** Honeypot — real users never fill this; bots do. */
  company_website?: string;
}

// ─── Supabase REST helpers (service role) ─────────────────────────────────
async function sbGet(path: string): Promise<unknown> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`sbGet ${path} → ${r.status}: ${t}`);
  }
  return r.json();
}

async function sbInsert(table: string, body: unknown): Promise<void> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`sbInsert ${table} → ${r.status}: ${t}`);
  }
}

/** Resolve a company slug to the owning GC's user_id via the SECURITY DEFINER RPC. */
async function userForSlug(slug: string): Promise<string | null> {
  const rows = await sbGet(`rpc/gc_user_for_company_slug?p_slug=${encodeURIComponent(slug)}`);
  if (typeof rows === "string") return rows || null;
  if (Array.isArray(rows) && rows.length > 0) {
    const v = rows[0];
    return typeof v === "string" ? v : (v?.gc_user_for_company_slug ?? v?.user_id ?? null);
  }
  return null;
}

const clip = (s: unknown, max: number): string | null => {
  if (typeof s !== "string") return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "Use POST" }, 405);

  let body: LeadIntakeRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  // Honeypot: silently accept (200) so bots don't learn, but write nothing.
  if (body.company_website && body.company_website.trim()) {
    return jsonResponse({ ok: true, message: "Thanks — we'll be in touch." });
  }

  const slug = clip(body.company_slug, 80);
  const name = clip(body.name, 120);
  if (!slug || !name) {
    return jsonResponse({ error: "Missing required fields: company_slug, name" }, 400);
  }
  if (!clip(body.email, 200) && !clip(body.phone, 40)) {
    return jsonResponse({ error: "Provide an email or phone so the contractor can reply." }, 400);
  }

  // Rate limit: bound flooding per-IP and per-target-slug. Fail OPEN — if the
  // limiter is unavailable (count < 0) we still accept the lead rather than
  // risk dropping a real customer's quote request.
  // EDGE-F15 (review 2026-09-05): clientIpFrom — the FIRST x-forwarded-for hop
  // is client-supplied, so keying on it made the per-IP bucket attacker-chosen.
  const ip = clientIpFrom(req.headers);
  const ipCount = await rateLimitCount(`lead:ip:${ip}`);
  const slugCount = await rateLimitCount(`lead:slug:${slug}`);
  if (ipCount > LEAD_IP_HOURLY_LIMIT || slugCount > LEAD_SLUG_HOURLY_LIMIT) {
    return jsonResponse({ error: "Too many requests right now — please try again later." }, 429);
  }

  let userId: string | null;
  try {
    userId = await userForSlug(slug);
  } catch (e) {
    console.error("[public-lead-intake] slug resolve failed:", String(e));
    return jsonResponse({ error: "Lookup failed, try again shortly." }, 502);
  }
  if (!userId) return jsonResponse({ error: "Contractor not found." }, 404);

  // Compose a scope note that preserves which portfolio project drew them in.
  const sourceProject = clip(body.source_project, 120);
  const scopeParts = [clip(body.scope, 2000), sourceProject ? `(from portfolio: ${sourceProject})` : null].filter(Boolean);
  const now = new Date().toISOString();

  try {
    await sbInsert("leads", {
      id: crypto.randomUUID(),
      user_id: userId,
      name,
      email: clip(body.email, 200),
      phone: clip(body.phone, 40),
      address: clip(body.address, 300),
      project_type: clip(body.project_type, 80),
      scope: scopeParts.length ? scopeParts.join(" ") : null,
      budget_min: typeof body.budget_min === "number" && isFinite(body.budget_min) ? body.budget_min : null,
      budget_max: typeof body.budget_max === "number" && isFinite(body.budget_max) ? body.budget_max : null,
      timeline: clip(body.timeline, 120),
      source: "website",
      stage: "new",
      received_at: now,
      touches: [],
      created_at: now,
      updated_at: now,
    });
  } catch (e) {
    console.error("[public-lead-intake] insert failed:", String(e));
    return jsonResponse({ error: "Could not save your request." }, 500);
  }

  return jsonResponse({ ok: true, message: "Thank you — your request was sent. The contractor will reach out shortly." });
});

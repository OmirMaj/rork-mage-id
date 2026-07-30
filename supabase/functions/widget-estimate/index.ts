// widget-estimate
//
// The public API behind the embeddable "Instant Estimate" widget
// (marketing/widget/embed.js). A contractor drops one <script> tag on their own
// website; a homeowner picks a scope, a size and a zip; this returns a ballpark
// band AND drops the lead into that contractor's MAGE pipeline.
//
// Why it matters: every competitor's site answers "what will this cost?" with
// a contact form. This answers it in ten seconds — on the CONTRACTOR's domain,
// with their brand — and the homeowner has already self-qualified by the time
// the GC picks up the phone.
//
// PUBLIC by design: verify_jwt is OFF. The caller is an anonymous visitor on a
// third-party domain, so there is no JWT to check and CORS must be wide open.
// Abuse is bounded exactly like public-lead-intake: required fields, a
// honeypot, and hourly rate limits keyed per-IP and per-contractor.
//
// Deploy:  supabase functions deploy widget-estimate --no-verify-jwt
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// DB:      table public.leads, rpc public.gc_user_for_company_slug(p_slug text)
//          (both already exist — see public-lead-intake).
//
// GET  /widget-estimate            → { projectTypes, qualities, version }
// POST /widget-estimate            → { ok, estimate, leadCaptured }
//   body { contractorId, projectType, sizeSqft, quality, email, name, zip }
//
// ── DRIFT WARNING ────────────────────────────────────────────────────────────
// The pricing model below is a hand-port of utils/widgetEstimate.ts. Deno can't
// resolve this repo's `@/` alias, and vendoring the app's util tree into the
// function bundle is worse. scripts/validate-widget-estimate.ts reads THIS FILE
// and fails ship-check if the rate table or the multipliers drift from the TS
// engine. If you change one, change both.
// ─────────────────────────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { rateLimitCount } from "../_shared/auth.ts";

const SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";
const SUPABASE_URL =
  Deno.env.get("SUPABASE_URL") || "https://nteoqhcswappxxjlpvap.supabase.co";

const WIDGET_IP_HOURLY_LIMIT = 25;
const WIDGET_CONTRACTOR_HOURLY_LIMIT = 80;

// Wide-open CORS is the whole point — this runs from arbitrary contractor
// domains. Nothing here is authenticated and nothing here reads user data.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json", ...extra },
  });
}

// ── pricing model — KEEP IN SYNC with utils/widgetEstimate.ts ────────────────

type WidgetQuality = "budget" | "standard" | "premium" | "luxury";

interface WidgetProjectType {
  id: string;
  label: string;
  measure: string;
  rateLow: number;
  rateLikely: number;
  rateHigh: number;
  typicalSizeSqft: number;
  minSizeSqft: number;
  maxSizeSqft: number;
  floorTotal: number;
  sizeExponent: number;
}

const WIDGET_PROJECT_TYPES: WidgetProjectType[] = [
  { id: "kitchen_remodel", label: "Kitchen remodel", measure: "kitchen floor area", rateLow: 180, rateLikely: 300, rateHigh: 475, typicalSizeSqft: 180, minSizeSqft: 60, maxSizeSqft: 800, floorTotal: 14000, sizeExponent: 0.88 },
  { id: "bathroom_remodel", label: "Bathroom remodel", measure: "bathroom floor area", rateLow: 220, rateLikely: 380, rateHigh: 600, typicalSizeSqft: 60, minSizeSqft: 25, maxSizeSqft: 300, floorTotal: 9000, sizeExponent: 0.85 },
  { id: "whole_home_remodel", label: "Whole-home remodel", measure: "finished area being remodeled", rateLow: 95, rateLikely: 165, rateHigh: 260, typicalSizeSqft: 2000, minSizeSqft: 600, maxSizeSqft: 12000, floorTotal: 60000, sizeExponent: 0.93 },
  { id: "home_addition", label: "Home addition", measure: "new conditioned area", rateLow: 180, rateLikely: 275, rateHigh: 420, typicalSizeSqft: 600, minSizeSqft: 100, maxSizeSqft: 5000, floorTotal: 40000, sizeExponent: 0.92 },
  { id: "new_construction", label: "New home construction", measure: "conditioned area", rateLow: 165, rateLikely: 260, rateHigh: 400, typicalSizeSqft: 2400, minSizeSqft: 500, maxSizeSqft: 15000, floorTotal: 150000, sizeExponent: 0.95 },
  { id: "adu", label: "ADU / garage conversion", measure: "ADU floor area", rateLow: 200, rateLikely: 320, rateHigh: 480, typicalSizeSqft: 700, minSizeSqft: 200, maxSizeSqft: 1500, floorTotal: 60000, sizeExponent: 0.9 },
  { id: "basement_finish", label: "Basement finish", measure: "basement floor area", rateLow: 45, rateLikely: 85, rateHigh: 145, typicalSizeSqft: 900, minSizeSqft: 200, maxSizeSqft: 4000, floorTotal: 15000, sizeExponent: 0.9 },
  { id: "deck_patio", label: "Deck or patio", measure: "deck / patio area", rateLow: 30, rateLikely: 60, rateHigh: 110, typicalSizeSqft: 350, minSizeSqft: 60, maxSizeSqft: 2500, floorTotal: 4500, sizeExponent: 0.9 },
  { id: "roof_replacement", label: "Roof replacement", measure: "roof area (≈ footprint × 1.2)", rateLow: 5.5, rateLikely: 9.5, rateHigh: 17, typicalSizeSqft: 2200, minSizeSqft: 400, maxSizeSqft: 20000, floorTotal: 6500, sizeExponent: 0.94 },
  { id: "siding_replacement", label: "Siding replacement", measure: "wall area being resided", rateLow: 7, rateLikely: 13, rateHigh: 24, typicalSizeSqft: 1800, minSizeSqft: 300, maxSizeSqft: 15000, floorTotal: 6000, sizeExponent: 0.94 },
  { id: "flooring", label: "Flooring replacement", measure: "floor area", rateLow: 5, rateLikely: 11, rateHigh: 20, typicalSizeSqft: 900, minSizeSqft: 100, maxSizeSqft: 8000, floorTotal: 2500, sizeExponent: 0.92 },
  { id: "commercial_ti", label: "Commercial tenant improvement", measure: "leased area", rateLow: 55, rateLikely: 110, rateHigh: 200, typicalSizeSqft: 3000, minSizeSqft: 400, maxSizeSqft: 60000, floorTotal: 35000, sizeExponent: 0.93 },
];

const WIDGET_QUALITY_MULTIPLIERS: Record<WidgetQuality, number> = {
  budget: 0.78,
  standard: 1.0,
  premium: 1.32,
  luxury: 1.85,
};

const WIDGET_QUALITY_LABELS: Record<WidgetQuality, string> = {
  budget: "Budget — keep it simple, stock finishes",
  standard: "Standard — mid-range finishes",
  premium: "Premium — high-end finishes",
  luxury: "Luxury — custom, no compromises",
};

const REGION_FACTOR_MIN = 0.7;
const REGION_FACTOR_MAX = 1.6;
const ABSURD_SIZE_MULTIPLE = 3;
const WIDEN_NO_SIZE = 0.18;
const WIDEN_SIZE_CLAMPED = 0.12;
const WIDEN_NO_QUALITY = 0.1;
const WIDEN_NO_REGION = 0.08;

const WIDGET_RATE_BASIS =
  "Typical published U.S. cost ranges for this scope, adjusted for size, finish level and region. Not a quote.";

interface WidgetRange { low: number; likely: number; high: number }

interface WidgetEstimate {
  priceable: boolean;
  range: WidgetRange | null;
  perSqft: WidgetRange | null;
  projectTypeId: string | null;
  projectLabel: string | null;
  quality: WidgetQuality;
  sizeSqft: number | null;
  regionFactor: number;
  confidence: "low" | "medium" | "high";
  assumptions: string[];
  cannotPriceReason: string | null;
  basis: string;
  asOf: string | null;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

function roundStep(likely: number): number {
  if (likely >= 250000) return 10000;
  if (likely >= 100000) return 5000;
  if (likely >= 20000) return 1000;
  if (likely >= 5000) return 500;
  return 100;
}
const floorTo = (n: number, s: number) => Math.floor(n / s) * s;
const ceilTo = (n: number, s: number) => Math.ceil(n / s) * s;
const roundTo = (n: number, s: number) => Math.round(n / s) * s;

const SYNONYMS: Record<string, string> = {
  kitchen: "kitchen_remodel", bath: "bathroom_remodel", bathroom: "bathroom_remodel",
  remodel: "whole_home_remodel", whole_home: "whole_home_remodel", gut_renovation: "whole_home_remodel",
  addition: "home_addition", new_home: "new_construction", new_build: "new_construction",
  custom_home: "new_construction", accessory_dwelling_unit: "adu", garage_conversion: "adu",
  basement: "basement_finish", deck: "deck_patio", patio: "deck_patio",
  roof: "roof_replacement", roofing: "roof_replacement", siding: "siding_replacement",
  floors: "flooring", tenant_improvement: "commercial_ti", ti: "commercial_ti",
};

function normalizeProjectType(raw: unknown): WidgetProjectType | null {
  const s = String(raw ?? "").trim().toLowerCase().replace(/[\s\-/]+/g, "_");
  if (!s) return null;
  const exact = WIDGET_PROJECT_TYPES.find((p) => p.id === s);
  if (exact) return exact;
  const byLabel = WIDGET_PROJECT_TYPES.find(
    (p) => p.label.toLowerCase().replace(/[\s\-/]+/g, "_") === s,
  );
  if (byLabel) return byLabel;
  const mapped = SYNONYMS[s];
  return mapped ? (WIDGET_PROJECT_TYPES.find((p) => p.id === mapped) ?? null) : null;
}

function normalizeQuality(raw: unknown): WidgetQuality | null {
  const s = String(raw ?? "").trim().toLowerCase().replace(/[\s\-_]+/g, "");
  if (!s) return null;
  if (["budget", "economy", "basic", "value", "low"].includes(s)) return "budget";
  if (["standard", "mid", "midrange", "midgrade", "average", "normal"].includes(s)) return "standard";
  if (["premium", "highend", "upscale", "high"].includes(s)) return "premium";
  if (["luxury", "custom", "ultra", "bespoke"].includes(s)) return "luxury";
  return null;
}

// Coarse zip → regional factor. Values mirror constants/regions.ts REGIONS +
// CITY_ADJUSTMENTS; see utils/widgetEstimate.ts regionFactorForZip().
const ZIP3_TO_STATE: [number, number, string][] = [
  [5, 5, "NY"], [10, 27, "MA"], [28, 29, "RI"], [30, 38, "NH"], [39, 49, "ME"],
  [50, 59, "VT"], [60, 69, "CT"], [70, 89, "NJ"],
  [100, 149, "NY"], [150, 196, "PA"], [197, 199, "DE"],
  [200, 205, "DC"], [206, 219, "MD"], [220, 246, "VA"], [247, 268, "WV"],
  [270, 289, "NC"], [290, 299, "SC"],
  [300, 319, "GA"], [320, 349, "FL"], [350, 369, "AL"], [370, 385, "TN"],
  [386, 397, "MS"], [398, 399, "GA"],
  [400, 427, "KY"], [430, 459, "OH"], [460, 479, "IN"], [480, 499, "MI"],
  [500, 528, "IA"], [530, 549, "WI"], [550, 567, "MN"], [570, 577, "SD"],
  [580, 588, "ND"], [590, 599, "MT"],
  [600, 629, "IL"], [630, 658, "MO"], [660, 679, "KS"], [680, 693, "NE"],
  [700, 714, "LA"], [716, 729, "AR"], [730, 749, "OK"], [750, 799, "TX"],
  [800, 816, "CO"], [820, 831, "WY"], [832, 838, "ID"], [840, 847, "UT"],
  [850, 865, "AZ"], [870, 884, "NM"], [885, 885, "TX"], [889, 898, "NV"],
  [900, 961, "CA"], [967, 968, "HI"], [970, 979, "OR"], [980, 994, "WA"],
  [995, 999, "AK"],
];
const ZIP3_TO_CITY: [number, number, string][] = [
  [100, 104, "New York City"], [110, 119, "New York City"],
  [21, 22, "Boston"],
  [200, 200, "Washington DC"], [202, 205, "Washington DC"],
  [190, 191, "Philadelphia"],
  [606, 608, "Chicago"],
  [900, 908, "Los Angeles"],
  [940, 941, "San Francisco"], [944, 944, "San Francisco"],
  [980, 981, "Seattle"],
  [331, 331, "Miami"], [770, 772, "Houston"], [752, 753, "Dallas"],
  [303, 303, "Atlanta"], [802, 802, "Denver"], [850, 853, "Phoenix"],
  [372, 372, "Nashville"], [282, 282, "Charlotte"],
];
const CITY_ADJUSTMENTS: Record<string, number> = {
  "New York City": 1.35, "San Francisco": 1.32, "Los Angeles": 1.22, Chicago: 1.12,
  Boston: 1.20, Seattle: 1.15, Miami: 1.05, Houston: 0.95, Dallas: 0.93, Atlanta: 0.92,
  Denver: 1.08, Phoenix: 0.94, Philadelphia: 1.10, "Washington DC": 1.18, Detroit: 1.00,
  Minneapolis: 1.06, Portland: 1.10, "Las Vegas": 1.02, Nashville: 0.96, Charlotte: 0.91,
};
const REGION_INDEX: [string[], string, number][] = [
  [["CT", "ME", "MA", "NH", "RI", "VT"], "New England", 1.18],
  [["NJ", "NY", "PA"], "Mid-Atlantic", 1.22],
  [["AL", "AR", "FL", "GA", "KY", "LA", "MS", "NC", "SC", "TN", "VA", "WV"], "Southeast", 0.88],
  [["IL", "IN", "IA", "MI", "MN", "MO", "OH", "WI"], "Midwest", 1.02],
  [["KS", "NE", "ND", "OK", "SD"], "Great Plains", 0.90],
  [["AZ", "NM", "TX"], "Southwest", 0.92],
  [["CO", "ID", "MT", "UT", "WY", "NV"], "Mountain", 1.05],
  [["CA"], "West Coast", 1.28],
  [["OR", "WA", "AK"], "Pacific Northwest", 1.12],
  [["DC", "DE", "MD", "HI"], "Northeast Metro", 1.15],
];

const lookupRange = (table: [number, number, string][], z3: number): string | null => {
  for (const [lo, hi, v] of table) if (z3 >= lo && z3 <= hi) return v;
  return null;
};

function regionFactorForZip(zip: unknown): { factor: number; label: string | null; basis: string } {
  const digits = String(zip ?? "").replace(/\D/g, "");
  if (digits.length < 5) return { factor: 1, label: null, basis: "national" };
  const z3 = Number(digits.slice(0, 3));
  if (!Number.isFinite(z3)) return { factor: 1, label: null, basis: "national" };
  const city = lookupRange(ZIP3_TO_CITY, z3);
  if (city && CITY_ADJUSTMENTS[city] != null) {
    return { factor: CITY_ADJUSTMENTS[city], label: city, basis: "metro" };
  }
  const state = lookupRange(ZIP3_TO_STATE, z3);
  if (state) {
    const region = REGION_INDEX.find(([states]) => states.includes(state));
    if (region) return { factor: region[2], label: region[1], basis: "region" };
  }
  return { factor: 1, label: null, basis: "national" };
}

function emptyEstimate(reason: string, asOf: string | null): WidgetEstimate {
  return {
    priceable: false, range: null, perSqft: null, projectTypeId: null, projectLabel: null,
    quality: "standard", sizeSqft: null, regionFactor: 1, confidence: "low",
    assumptions: [], cannotPriceReason: reason, basis: WIDGET_RATE_BASIS, asOf,
  };
}

function estimateWidgetRange(input: {
  projectType?: unknown;
  sizeSqft?: unknown;
  quality?: unknown;
  regionFactor?: unknown;
  nowMs?: number | null;
}): WidgetEstimate {
  const asOf =
    typeof input.nowMs === "number" && Number.isFinite(input.nowMs)
      ? new Date(input.nowMs).toISOString()
      : null;

  const type = normalizeProjectType(input.projectType);
  if (!type) {
    return emptyEstimate(
      input.projectType
        ? `We don't publish a defensible rate for "${String(input.projectType).slice(0, 60)}". Pick the closest scope, or send the details straight to the contractor.`
        : "Tell us what kind of project it is and we can put a range on it.",
      asOf,
    );
  }

  const assumptions: string[] = [];
  let widen = 0;

  const parsedQuality = normalizeQuality(input.quality);
  const quality: WidgetQuality = parsedQuality ?? "standard";
  if (!parsedQuality) {
    widen += WIDEN_NO_QUALITY;
    assumptions.push("Assumed mid-range finishes — premium or custom work runs meaningfully higher.");
  }

  const rawRegion = input.regionFactor;
  const regionKnown = typeof rawRegion === "number" && Number.isFinite(rawRegion) && rawRegion > 0;
  const regionFactor = regionKnown ? clamp(rawRegion as number, REGION_FACTOR_MIN, REGION_FACTOR_MAX) : 1;
  if (!regionKnown) {
    widen += WIDEN_NO_REGION;
    assumptions.push("Priced at national average labor and material costs — no location given.");
  } else if (regionFactor !== rawRegion) {
    assumptions.push(
      `Regional factor clamped to ${regionFactor.toFixed(2)} — anything outside ${REGION_FACTOR_MIN}–${REGION_FACTOR_MAX} is outside what this model can defend.`,
    );
    widen += WIDEN_NO_REGION;
  } else if (regionFactor !== 1) {
    const dir = regionFactor > 1 ? "above" : "below";
    assumptions.push(
      `Adjusted ${Math.round(Math.abs(regionFactor - 1) * 100)}% ${dir} national average for your area.`,
    );
  }

  const rawSize = input.sizeSqft;
  const sizeGiven = typeof rawSize === "number" && Number.isFinite(rawSize) && rawSize > 0;
  if (sizeGiven) {
    const s = rawSize as number;
    if (s < type.minSizeSqft / ABSURD_SIZE_MULTIPLE || s > type.maxSizeSqft * ABSURD_SIZE_MULTIPLE) {
      return emptyEstimate(
        `${s.toLocaleString("en-US")} sq ft is outside anything we can honestly ballpark for a ${type.label.toLowerCase()} (we price ${type.minSizeSqft.toLocaleString("en-US")}–${type.maxSizeSqft.toLocaleString("en-US")} sq ft). Send the details to the contractor instead.`,
        asOf,
      );
    }
  }

  let sizeSqft: number;
  if (!sizeGiven) {
    sizeSqft = type.typicalSizeSqft;
    widen += WIDEN_NO_SIZE;
    assumptions.push(
      `No size given — priced a typical ${type.label.toLowerCase()} at ${type.typicalSizeSqft.toLocaleString("en-US")} sq ft. Give us the real ${type.measure} and this range tightens.`,
    );
  } else {
    const s = rawSize as number;
    sizeSqft = clamp(s, type.minSizeSqft, type.maxSizeSqft);
    if (sizeSqft !== s) {
      widen += WIDEN_SIZE_CLAMPED;
      assumptions.push(
        `${s.toLocaleString("en-US")} sq ft is outside our priced band, so we used ${sizeSqft.toLocaleString("en-US")} sq ft and widened the range.`,
      );
    }
  }

  const scale = clamp(Math.pow(sizeSqft / type.typicalSizeSqft, type.sizeExponent - 1), 0.7, 1.6);
  const qualityMult = WIDGET_QUALITY_MULTIPLIERS[quality];
  const common = qualityMult * regionFactor * scale;
  const floor = type.floorTotal * qualityMult * regionFactor;

  let likely = Math.max(type.rateLikely * common * sizeSqft, floor);
  const spreadLow = type.rateLow / type.rateLikely;
  const spreadHigh = type.rateHigh / type.rateLikely;
  let low = likely * spreadLow * (1 - widen);
  let high = likely * spreadHigh * (1 + widen);

  if (likely <= floor) {
    assumptions.push(
      `At this size the number is driven by the minimum it takes to mobilize a ${type.label.toLowerCase()}, not by square footage.`,
    );
    low = Math.max(low, floor * 0.85);
    high = Math.max(high, floor * 1.35);
    likely = Math.max(likely, floor);
  }

  const step = roundStep(likely);
  const range: WidgetRange = {
    low: Math.max(floorTo(low, step), step),
    likely: roundTo(likely, step),
    high: ceilTo(high, step),
  };
  range.low = Math.min(range.low, range.likely);
  range.high = Math.max(range.high, range.likely);

  const perSqft: WidgetRange = {
    low: Math.round((range.low / sizeSqft) * 100) / 100,
    likely: Math.round((range.likely / sizeSqft) * 100) / 100,
    high: Math.round((range.high / sizeSqft) * 100) / 100,
  };

  assumptions.push(
    "This is a ballpark from a few inputs, not a quote. The real number depends on scope, finishes, site conditions and access.",
  );

  return {
    priceable: true, range, perSqft,
    projectTypeId: type.id, projectLabel: type.label,
    quality, sizeSqft, regionFactor,
    confidence: widen === 0 ? "high" : widen <= 0.12 ? "medium" : "low",
    assumptions, cannotPriceReason: null, basis: WIDGET_RATE_BASIS, asOf,
  };
}

// ── Supabase REST helpers (service role) ────────────────────────────────────

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `contractorId` is whatever the contractor pasted into their script tag. Both
 * forms are already public: the company slug is in their /builders/<slug> URL,
 * and the user id is only useful for routing a lead TO them. Accept either.
 */
async function resolveContractor(contractorId: string): Promise<string | null> {
  if (UUID_RE.test(contractorId)) return contractorId;
  const rows = await sbGet(
    `rpc/gc_user_for_company_slug?p_slug=${encodeURIComponent(contractorId)}`,
  );
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

interface WidgetRequest {
  contractorId?: string;
  projectType?: string;
  sizeSqft?: number | string;
  quality?: string;
  email?: string;
  name?: string;
  phone?: string;
  zip?: string;
  /** Free-text "anything else we should know" from the widget. */
  notes?: string;
  /** Honeypot — real users never fill this; bots do. Matches public-lead-intake. */
  company_website?: string;
}

// ── handler ─────────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  // The catalog the widget renders its dropdowns from. Cached hard — it changes
  // about as often as the rate table does.
  if (req.method === "GET") {
    return jsonResponse(
      {
        version: 1,
        basis: WIDGET_RATE_BASIS,
        projectTypes: WIDGET_PROJECT_TYPES.map((p) => ({
          id: p.id,
          label: p.label,
          measure: p.measure,
          typicalSizeSqft: p.typicalSizeSqft,
          minSizeSqft: p.minSizeSqft,
          maxSizeSqft: p.maxSizeSqft,
        })),
        qualities: (Object.keys(WIDGET_QUALITY_MULTIPLIERS) as WidgetQuality[]).map((q) => ({
          id: q,
          label: WIDGET_QUALITY_LABELS[q],
        })),
      },
      200,
      { "Cache-Control": "public, max-age=3600, s-maxage=86400" },
    );
  }

  if (req.method !== "POST") return jsonResponse({ error: "Use POST" }, 405);

  let body: WidgetRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  // Honeypot: 200 with a plausible shape so bots learn nothing, but write nothing.
  if (body.company_website && body.company_website.trim()) {
    return jsonResponse({ ok: true, estimate: emptyEstimate("Thanks — we'll be in touch.", null), leadCaptured: false });
  }

  const contractorId = clip(body.contractorId, 120);
  if (!contractorId) {
    return jsonResponse({ error: "Missing contractorId — check the data-contractor on your embed snippet." }, 400);
  }

  // Rate limit per-IP and per-contractor. Fails OPEN (rateLimitCount returns -1
  // when the limiter is unavailable) — a limiter outage must not stop a real
  // homeowner from getting a number.
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  const ipCount = ip ? await rateLimitCount(`widget:ip:${ip}`) : 0;
  const contractorCount = await rateLimitCount(`widget:gc:${contractorId}`);
  if (ipCount > WIDGET_IP_HOURLY_LIMIT || contractorCount > WIDGET_CONTRACTOR_HOURLY_LIMIT) {
    return jsonResponse({ error: "Too many requests right now — please try again in a bit." }, 429);
  }

  // ── price it ──
  const zip = clip(body.zip, 12);
  const region = regionFactorForZip(zip);
  const rawSize = typeof body.sizeSqft === "string" ? Number(body.sizeSqft.replace(/[^\d.]/g, "")) : body.sizeSqft;
  const estimate = estimateWidgetRange({
    projectType: body.projectType,
    sizeSqft: typeof rawSize === "number" && Number.isFinite(rawSize) ? rawSize : null,
    quality: body.quality,
    regionFactor: region.basis === "national" ? null : region.factor,
    nowMs: Date.now(),
  });
  if (region.label) {
    estimate.assumptions.unshift(`Location: ${region.label} (from zip ${zip}).`);
  }

  // ── capture the lead ──
  // Deliberately independent of the estimate: a DB hiccup must never stop the
  // homeowner from seeing their number, and a scope we can't price is still a
  // lead worth having.
  const name = clip(body.name, 120);
  const email = clip(body.email, 200);
  const phone = clip(body.phone, 40);
  let leadCaptured = false;
  let leadError: string | null = null;

  if (name && ((email && EMAIL_RE.test(email)) || phone)) {
    try {
      const userId = await resolveContractor(contractorId);
      if (!userId) {
        leadError = "unknown_contractor";
      } else {
        const origin = clip(req.headers.get("origin") ?? req.headers.get("referer"), 200);
        const scope = [
          estimate.projectLabel ?? clip(body.projectType, 80) ?? "Project",
          estimate.sizeSqft ? `~${estimate.sizeSqft.toLocaleString("en-US")} sq ft` : null,
          `${estimate.quality} finishes`,
          zip ? `zip ${zip}` : null,
          estimate.range
            ? `Instant Estimate shown: $${Math.round(estimate.range.low).toLocaleString("en-US")}–$${Math.round(estimate.range.high).toLocaleString("en-US")}`
            : "Instant Estimate could not price this scope",
          clip(body.notes, 1000),
          origin ? `(from widget on ${origin})` : null,
        ].filter(Boolean).join(" · ");

        const now = new Date().toISOString();
        await sbInsert("leads", {
          id: crypto.randomUUID(),
          user_id: userId,
          name,
          email,
          phone,
          address: zip,
          project_type: estimate.projectLabel ?? clip(body.projectType, 80),
          scope,
          budget_min: estimate.range ? Math.round(estimate.range.low) : null,
          budget_max: estimate.range ? Math.round(estimate.range.high) : null,
          timeline: null,
          source: "website",
          stage: "new",
          received_at: now,
          touches: [],
          created_at: now,
          updated_at: now,
        });
        leadCaptured = true;
      }
    } catch (e) {
      console.error("[widget-estimate] lead capture failed:", String(e));
      leadError = "save_failed";
    }
  }

  return jsonResponse({
    ok: true,
    estimate,
    leadCaptured,
    leadError,
    poweredBy: { name: "MAGE ID", url: "https://mageid.app" },
  });
});

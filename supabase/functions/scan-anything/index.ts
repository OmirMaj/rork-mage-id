// scan-anything
//
// "Scan Anything to auto-file." One or more captures → Gemini classifies the
// document into a ScanDocType, then (unless it's a government ID) extracts a
// flat `fields` object per the type's schema, and suggests where it should be
// filed. The client confirms, uploads the image to project-documents, creates
// the right domain record (cost / contact / sub_compliance / file_only), and
// logs a ScanRecord. The server persists NOTHING — it returns the extraction.
//
// PII BOUNDARY: if the document classifies as `government_id`, this function
// does NOT extract anything. It returns a `redirect: 'crew-id-scan'` so the
// client sends the user to the consented crew ID-scan flow. Government-ID
// fields never flow through this endpoint.
//
// Modelled on analyze-photos (multi-image validation, size guards, metering,
// CORS, error shape) and scan-credential (never echo raw model text / PII in
// error bodies).
//
// Secrets: GEMINI_API_KEY

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { requireTier, aiUsageIncrement, MONTHLY_CAPS } from "../_shared/auth.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "";
const MODEL = 'gemini-2.5-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

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

// Mirror of the client's ScanDocType union (types/index.ts). Kept inline
// because the Deno edge runtime can't import from the app's `@/` alias.
type ScanDocType =
  | 'invoice' | 'delivery_ticket' | 'permit' | 'insurance_coi' | 'contract'
  | 'business_card' | 'spec_sheet' | 'equipment_nameplate' | 'material_tag'
  | 'warranty' | 'inspection_notice' | 'plan_sheet' | 'government_id' | 'other';

type ScanRecordKind = 'cost' | 'contact' | 'sub_compliance' | 'file_only';

const DOC_TYPES: ScanDocType[] = [
  'invoice', 'delivery_ticket', 'permit', 'insurance_coi', 'contract',
  'business_card', 'spec_sheet', 'equipment_nameplate', 'material_tag',
  'warranty', 'inspection_notice', 'plan_sheet', 'government_id', 'other',
];

interface ScanRequest {
  images?: { base64: string; mimeType?: string }[];
  projectId?: string;
}

// --- Routing table (server-side mirror of utils/scanRouting.ts) -------------
// The client is the source of truth for routing (validator-tested), but the
// server returns a suggestedDestination so the confirm screen renders without
// a round-trip. Both must agree.
function resolveDestination(docType: ScanDocType): { folder: string; recordKind: ScanRecordKind } {
  switch (docType) {
    case 'invoice': return { folder: 'financials', recordKind: 'cost' };
    case 'delivery_ticket': return { folder: 'daily-reports', recordKind: 'file_only' };
    case 'permit': return { folder: 'permits', recordKind: 'file_only' };
    case 'insurance_coi': return { folder: 'contracts', recordKind: 'sub_compliance' };
    case 'contract': return { folder: 'contracts', recordKind: 'file_only' };
    case 'business_card': return { folder: 'photos', recordKind: 'contact' };
    case 'spec_sheet': return { folder: 'plans', recordKind: 'file_only' };
    case 'plan_sheet': return { folder: 'plans', recordKind: 'file_only' };
    case 'equipment_nameplate': return { folder: 'photos', recordKind: 'file_only' };
    case 'material_tag': return { folder: 'photos', recordKind: 'file_only' };
    case 'warranty': return { folder: 'closeout', recordKind: 'file_only' };
    case 'inspection_notice': return { folder: 'photos', recordKind: 'file_only' };
    case 'government_id': return { folder: 'photos', recordKind: 'file_only' };
    case 'other': return { folder: 'photos', recordKind: 'file_only' };
  }
}

// --- Prompts ----------------------------------------------------------------

const CLASSIFY_PROMPT = `You are a construction document classifier for a general contractor's field app. Look at the attached image(s) and decide which ONE document type best describes it.

Return a single JSON object:
  - docType: exactly one of:
      "invoice"            — a supplier / material invoice or receipt (lumber yard, supply house, big-box pro desk)
      "delivery_ticket"    — a delivery / packing slip / bill of lading for materials dropped on site
      "permit"             — a building / trade permit or permit card issued by a jurisdiction
      "insurance_coi"      — a Certificate of Insurance (ACORD 25) for a subcontractor / vendor
      "contract"           — a subcontract, agreement, purchase order, or signed contract
      "business_card"      — a person's business card
      "spec_sheet"         — a product specification / cut sheet / data sheet
      "equipment_nameplate"— a nameplate / rating plate on equipment (HVAC unit, panel, motor)
      "material_tag"       — a product / material tag or label (e.g. on a pallet, box, or roll)
      "warranty"           — a product or workmanship warranty document
      "inspection_notice"  — an inspection result / correction notice / tag from an inspector
      "plan_sheet"         — an architectural / structural / MEP drawing sheet
      "government_id"       — a government-issued photo ID (driver's license, state ID, passport)
      "other"              — anything that doesn't clearly fit the above
  - confidence: 0-100, how sure you are.

Rules:
  - If confidence is below 50, return docType "other".
  - If the image is clearly a person's government photo ID, return "government_id" — do NOT try to read the ID.

Return JSON only — no preamble.`;

// Extract prompts per docType. government_id is intentionally absent — that
// path short-circuits before extraction. plan_sheet / other are file-only.
const EXTRACT_PROMPTS: Partial<Record<ScanDocType, string>> = {
  invoice: `You are reading a SUPPLIER / MATERIAL invoice or receipt. Extract it into strict JSON:
  - vendor: supplier business name.
  - date: invoice/receipt date as YYYY-MM-DD if determinable, else the printed string.
  - docNumber: invoice / order / receipt number if printed.
  - lines: array, one per purchased line item, each with { description, qty (number), unit, unitPrice (number), lineTotal (number) }.
  - subtotal, tax, total: numbers (strip $ and separators), 0 if not printed.
Skip non-item rows (subtotal/tax/total, store address, payment method). Return JSON only — no preamble.`,

  delivery_ticket: `You are reading a material DELIVERY TICKET / packing slip. Extract into strict JSON:
  - supplier: supplier business name.
  - date: delivery date as YYYY-MM-DD if determinable, else printed string.
  - ticketNumber: ticket / slip number if printed.
  - items: array of strings — the materials delivered as printed.
  - deliveredTo: job site / recipient as printed.
  - poNumber: purchase order number if printed.
Leave a field empty ("" or []) if not legible. Return JSON only — no preamble.`,

  permit: `You are reading a building / trade PERMIT or permit card. Extract into strict JSON:
  - jurisdiction: issuing city / county / authority.
  - permitNumber: the permit number as printed.
  - type: permit type ("Building", "Electrical", "Plumbing", "Mechanical", etc.).
  - issuedDate: YYYY-MM-DD if determinable, else "".
  - expiresDate: YYYY-MM-DD if determinable, else "".
  - address: the job address on the permit.
Leave a field empty if not legible. Return JSON only — no preamble.`,

  insurance_coi: `You are reading a Certificate of Insurance (ACORD 25) for a subcontractor / vendor. Extract into strict JSON:
  - insured: the named insured (the sub / vendor company).
  - carrier: the insurance carrier / producer.
  - policyNumber: the primary policy number.
  - coverageType: main coverage(s) shown ("General Liability", "Workers Comp", "Auto").
  - effectiveDate: YYYY-MM-DD if determinable, else "".
  - expiresDate: policy expiration YYYY-MM-DD if determinable, else "".
  - limits: the printed limits as a short string (e.g. "$1,000,000 each occurrence").
Leave a field empty if not legible. Return JSON only — no preamble.`,

  contract: `You are reading a subcontract / agreement / purchase order. Extract into strict JSON:
  - parties: array of the party names in the agreement.
  - title: the document title / subject.
  - effectiveDate: YYYY-MM-DD if determinable, else "".
  - amount: the contract amount as a number, 0 if none printed.
Leave a field empty if not legible. Return JSON only — no preamble.`,

  business_card: `You are reading a person's BUSINESS CARD. Extract into strict JSON:
  - name: the person's full name.
  - company: the company name.
  - title: their job title.
  - phone: the primary phone number.
  - email: the email address.
  - address: the mailing address if printed.
  - website: the website if printed.
Leave a field empty ("") if not printed. Return JSON only — no preamble.`,

  spec_sheet: `You are reading a product SPECIFICATION / cut sheet. Extract into strict JSON:
  - manufacturer: the manufacturer name.
  - product: the product name.
  - model: the model / part number.
  - specSection: the CSI spec section if referenced (e.g. "09 30 00"), else "".
Leave a field empty if not legible. Return JSON only — no preamble.`,

  equipment_nameplate: `You are reading an equipment NAMEPLATE / rating plate. Extract into strict JSON:
  - make: the manufacturer / make.
  - model: the model number.
  - serial: the serial number.
  - rating: the voltage / rating string as printed (e.g. "208-230V / 1Ph / 60Hz").
  - manufactureDate: YYYY-MM-DD or the printed date/code, else "".
Leave a field empty if not legible. Return JSON only — no preamble.`,

  material_tag: `You are reading a material / product TAG or label. Extract into strict JSON:
  - vendor: the vendor / manufacturer.
  - product: the product name.
  - partNumber: the SKU / part number.
  - grade: the grade / size as printed.
Leave a field empty if not legible. Return JSON only — no preamble.`,

  warranty: `You are reading a product or workmanship WARRANTY. Extract into strict JSON:
  - product: the product / system covered.
  - provider: the warranty provider / issuer.
  - term: the warranty term as printed (e.g. "10 years").
  - startDate: YYYY-MM-DD if determinable, else "".
  - endDate: YYYY-MM-DD if determinable, else "".
Leave a field empty if not legible. Return JSON only — no preamble.`,

  inspection_notice: `You are reading an INSPECTION notice / correction notice / tag. Extract into strict JSON:
  - authority: the inspecting authority / department.
  - result: the outcome ("Pass", "Fail", "Partial", "Correction Required").
  - date: inspection date as YYYY-MM-DD if determinable, else "".
  - itemsNoted: array of strings — any noted items / corrections listed.
Leave a field empty ("" or []) if not legible. Return JSON only — no preamble.`,
};

async function classify(
  parts: Record<string, unknown>[],
): Promise<{ docType: ScanDocType; confidence: number } | { error: string; status: number }> {
  const geminiParts = [{ text: CLASSIFY_PROMPT }, ...parts];
  const r = await callGemini(geminiParts, 400);
  if ('error' in r) return r;
  const o = r.parsed as Record<string, unknown>;
  const t = String(o.docType ?? 'other');
  const docType: ScanDocType = (DOC_TYPES as string[]).includes(t) ? (t as ScanDocType) : 'other';
  let confidence = Number.isFinite(Number(o.confidence)) ? Math.max(0, Math.min(100, Number(o.confidence))) : 0;
  // Low-confidence floor → 'other' (never mis-file on a guess).
  if (confidence < 50) return { docType: 'other', confidence };
  return { docType, confidence };
}

async function extract(
  docType: ScanDocType,
  parts: Record<string, unknown>[],
): Promise<{ fields: Record<string, unknown>; title: string }> {
  const prompt = EXTRACT_PROMPTS[docType];
  // No extract schema (plan_sheet / other) → file-only, empty fields.
  if (!prompt) return { fields: {}, title: '' };
  const geminiParts = [{ text: prompt }, ...parts];
  const r = await callGemini(geminiParts, 1500);
  // On ANY extraction failure keep the classification but return empty fields —
  // the client presents an editable blank form and still files the image.
  // Never surface raw model text (may contain PII fragments).
  if ('error' in r) return { fields: {}, title: '' };
  const fields = (r.parsed && typeof r.parsed === 'object' && !Array.isArray(r.parsed))
    ? (r.parsed as Record<string, unknown>)
    : {};
  const title = typeof fields.suggestedTitle === 'string' ? fields.suggestedTitle : '';
  return { fields, title };
}

// Shared Gemini call + JSON parse. NEVER returns raw model text to the caller —
// on non-JSON it logs a length-only marker server-side and returns a generic
// error (mirrors scan-credential's PII discipline).
async function callGemini(
  parts: Record<string, unknown>[],
  maxOutputTokens: number,
): Promise<{ parsed: unknown } | { error: string; status: number }> {
  let resp: Response;
  try {
    resp = await fetch(`${ENDPOINT}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.1, maxOutputTokens },
      }),
    });
  } catch (e) {
    return { error: `Gemini network error: ${(e as Error).message}`, status: 502 };
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    return { error: `Gemini ${resp.status}: ${text.slice(0, 160)}`, status: 502 };
  }
  let j: Record<string, unknown>;
  try { j = await resp.json(); }
  catch { return { error: 'Gemini returned an unreadable response', status: 502 }; }
  const candidates = j?.candidates as { content?: { parts?: { text?: string }[] } }[] | undefined;
  const raw = candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  try { return { parsed: JSON.parse(raw) }; }
  catch {
    // Never echo `raw` — an extracted invoice / card / permit may hold PII.
    console.log(`[scan-anything] non-JSON Gemini output (len=${raw.length})`);
    return { error: 'Gemini returned non-JSON', status: 502 };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'POST only' }, 405);
  if (!GEMINI_API_KEY) return jsonResponse({ success: false, error: 'GEMINI_API_KEY not configured' }, 500);

  // Server-side paywall FIRST — Scan Anything is a Business-tier feature.
  const auth = await requireTier(req, ['business'], 'scan_anything');
  if (!auth.ok) return jsonResponse(auth.body, auth.status);

  let body: ScanRequest;
  try { body = await req.json(); } catch { return jsonResponse({ success: false, error: 'Invalid JSON body' }, 400); }

  if (!body.projectId || typeof body.projectId !== 'string') {
    return jsonResponse({ success: false, error: 'projectId required' }, 400);
  }

  // Validate images: inline base64 only (v1 — no URL fetch, no SSRF surface).
  const images = Array.isArray(body.images) ? body.images : [];
  if (images.length === 0) {
    return jsonResponse({ success: false, error: 'At least one image is required' }, 400);
  }
  if (images.length > 6) {
    return jsonResponse({ success: false, error: 'Max 6 images per scan.' }, 400);
  }
  const MAX_BYTES_PER_IMAGE = 6 * 1024 * 1024;   // ~4.5MB raw
  const MAX_BYTES_TOTAL = 8 * 1024 * 1024;
  let total = 0;
  for (let i = 0; i < images.length; i++) {
    const p = images[i];
    if (!p || typeof p.base64 !== 'string' || p.base64.length === 0) {
      return jsonResponse({ success: false, error: `Image ${i} is missing base64 data` }, 400);
    }
    if (p.base64.length > MAX_BYTES_PER_IMAGE) {
      const mb = (p.base64.length / 1024 / 1024).toFixed(1);
      return jsonResponse({
        success: false,
        error: `Image ${i} is too large (${mb} MB encoded). Capture at ~1200×1600.`,
      }, 413);
    }
    total += p.base64.length;
  }
  if (total > MAX_BYTES_TOTAL) {
    const mb = (total / 1024 / 1024).toFixed(1);
    return jsonResponse({
      success: false,
      error: `Total image payload too large (${mb} MB). Use fewer / lower-quality captures.`,
    }, 413);
  }

  // Meter AFTER validation, BEFORE any Gemini call — a missing / oversized
  // input where no scan runs must never consume a monthly unit.
  const used = await aiUsageIncrement(auth.userId, 'scan_anything');
  const cap = MONTHLY_CAPS[auth.tier].scan_anything;
  if (used > cap) {
    return jsonResponse({
      success: false,
      error: `Monthly scan limit reached (${cap} on ${auth.tier}). Resets on the 1st.`,
      code: 'monthly_cap_reached', used, cap,
    }, 429);
  }

  const imageParts: Record<string, unknown>[] = images.map((p) => ({
    inline_data: { mime_type: p.mimeType || 'image/jpeg', data: p.base64 },
  }));

  console.log(`[scan-anything] tier=${auth.tier} images=${images.length}`);

  // Step 1 — classify.
  const classified = await classify(imageParts);
  if ('error' in classified) return jsonResponse({ success: false, error: classified.error }, classified.status);
  const { docType, confidence } = classified;

  // Step 2 — GOV-ID SHORT-CIRCUIT. No extraction. The client redirects to the
  // consented crew ID-scan flow. Government-ID fields never pass through here.
  if (docType === 'government_id') {
    return jsonResponse({
      success: true,
      docType: 'government_id',
      confidence,
      fields: {},
      suggestedTitle: 'Government ID',
      suggestedDestination: { folder: 'photos', recordKind: 'file_only' },
      redirect: 'crew-id-scan',
    });
  }

  // Step 3 — extract (schema switched by docType; empty fields on failure).
  const { fields, title } = await extract(docType, imageParts);
  const destination = resolveDestination(docType);

  return jsonResponse({
    success: true,
    docType,
    confidence,
    fields,
    // Server title is optional — the client's defaultTitleFor covers the empty
    // case deterministically. Return the AI title only if it produced one.
    suggestedTitle: title,
    suggestedDestination: destination,
  });
});

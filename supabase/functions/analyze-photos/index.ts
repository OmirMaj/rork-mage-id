// analyze-photos
//
// Generic Gemini Vision pipeline for project photos. Tasks:
//   - 'punch'   → AI walks the photos and returns a structured punch
//                 list (description, location, trade, priority).
//   - 'dfr'     → AI summarizes the photos as the workPerformed +
//                 trades-on-site fields of a daily field report.
//   - 'rfi'     → AI flags photos that warrant an RFI (unclear scope,
//                 conflict between drawings and field, missing info).
//   - 'triage'  → AI classifies each photo as punch | rfi | dfr |
//                 progress | noise so a worker can dump a batch and the
//                 UI routes each photo to the right destination. The
//                 game-changer: one snap-and-go flow instead of three
//                 separate analyzers.
//   - 'rooms'   → AI reads a floor-plan sheet and returns every room
//                 (name, type, sqft, bbox) for the Plan Intelligence
//                 room-by-room estimating flow.
//
// Modelled on the existing analyze-drawings function — same auth /
// CORS / error shape, different prompt + schema per task.
//
// Secrets required:
//   GEMINI_API_KEY — Google AI Studio key (https://aistudio.google.com/)
//
// Request body:
// {
//   task: 'punch' | 'dfr' | 'rfi' | 'triage' | 'receipt' | 'rooms';
//   photoUrls: string[];        // 1..N publicly fetchable image URLs
//   projectName?: string;
//   projectType?: string;
//   notes?: string;             // user-provided context
// }

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { requireTier, aiUsageIncrement, MONTHLY_CAPS } from "../_shared/auth.ts";
import { validateFetchableUrl } from "../_shared/urlGuard.ts";

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

interface AnalyzePhotosRequest {
  task: 'punch' | 'dfr' | 'rfi' | 'triage' | 'receipt' | 'rooms';
  /** EITHER photoUrls (server fetches) OR photos[].base64 inline.
   *  Client-side camera / library picks are file:// URIs that the
   *  server can't fetch — those callers send inline base64 instead. */
  photoUrls?: string[];
  photos?: { base64: string; mimeType?: string }[];
  projectName?: string;
  projectType?: string;
  notes?: string;
}

const PUNCH_PROMPT = `You are a residential general contractor walking a job site to build the punch list before final walkthrough. Look at the attached project photos and identify any items that need to be fixed, finished, or addressed before the project can close.

Return a JSON array of punch items, each with:
  - description: short title of the issue (≤80 chars). Sentence case.
  - location: where in the project ("Master Bath", "Hallway 2", "Kitchen", "Front door"). Title case. Empty if you can't tell.
  - trade: closest match from "Electrical", "Plumbing", "HVAC", "Drywall", "Painting", "Tile", "Flooring", "Trim/Carpentry", "Doors/Hardware", "Cabinets", "Roofing", "Concrete", "Framing", "Insulation", "Cleanup", "General"
  - priority: "high" for safety / blocking final / urgent; "low" for cosmetic small touch-ups; otherwise "medium"
  - photoIndex: which photo (0-indexed) shows this item. If multiple photos show it, pick the clearest.
  - confidence: 0-100. Only include items at confidence ≥ 60. Below that they're noise.

Look for: paint touch-ups, exposed nails, gaps in trim, loose fixtures, missing caulking, misaligned tile, damaged surfaces, exposed wiring, missing covers, dirty surfaces awaiting cleanup.

Be specific and actionable. "Paint touch-up needed near the door frame in Hallway 2" not "needs paint."

Return JSON only — no preamble.`;

const DFR_PROMPT = `You are summarizing a residential GC's job site photos as a daily field report entry. Write the workPerformed + tradesOnSite fields based on what's visible in the photos.

Return JSON with:
  - workPerformed: 1-3 sentences describing what got done today, in plain GC language. Reference specific trades / phases when visible.
  - tradesOnSite: array of trade names visible (Electrical, Plumbing, Drywall, etc.). Empty if no clear trade signals.
  - materialsObserved: array of materials / products you can identify in the photos. Empty if none.
  - notesForGC: optional string with anything the GC should follow up on (issues, surprises, "don't see X done that the schedule called for").

Be specific — "Electrical rough-in completed in master bath; visible BX cable runs and gang boxes set" not "electrical work done."

Return JSON only — no preamble.`;

const RFI_PROMPT = `You are a residential GC reviewing photos from the field. Identify any photos that warrant an RFI (Request For Information) to the architect, designer, or owner — situations where the field condition does not match the drawings, where information is missing, where there's a conflict between trades, or where a decision needs to be made before work can continue.

Return a JSON array of RFI candidates, each with:
  - subject: short headline (≤80 chars). Sentence case. e.g. "Plumbing rough-in conflicts with HVAC in ceiling plenum"
  - question: the specific question for the design team. 1-2 sentences. Concrete and answerable.
  - location: where the issue is ("Master Bath", "Ceiling at Hallway 2"). Title case. Empty if unclear.
  - trade: closest match from "Electrical", "Plumbing", "HVAC", "Structural", "Architectural", "Drywall", "Painting", "Tile", "Flooring", "Trim/Carpentry", "Cabinets", "Roofing", "Concrete", "Framing", "Insulation", "General"
  - priority: "high" if work is currently blocked; "medium" if it will block within a week; "low" otherwise
  - photoIndex: which photo (0-indexed) shows this. If multiple, pick the clearest.
  - confidence: 0-100. Only include items at confidence ≥ 70 (RFIs that go out wrongly waste design fees).

Common RFI triggers: drawings show one thing, field shows another; spec is silent on a detail that's been built; trade conflict (e.g. duct + beam, plumbing stack + framing); existing condition discovery during demo (rotted framing, unexpected wiring); finish selection contradicts plan.

Return JSON only — no preamble. Empty array if nothing in the photos warrants an RFI.`;

const TRIAGE_PROMPT = `You are a residential GC's AI assistant. The user just dumped a batch of job site photos and wants you to route each one to the right destination — punch list, RFI, daily report observation, progress photo, or noise (skip).

For EACH photo (in input order), return a JSON object with:
  - photoIndex: 0-based index of the photo
  - classification: one of "punch", "rfi", "dfr", "progress", "noise"
      • punch    — a defect / unfinished item visible (paint touch-up, exposed nail, missing caulk, damaged surface)
      • rfi      — a conflict, missing info, or design question that needs an answer (drawings vs. field discrepancy, trade conflict, surprise existing condition)
      • dfr      — a record of work performed today (a trade actively working, a phase clearly progressing — feeds the daily report's workPerformed field)
      • progress — a "look how nice this turned out" milestone shot worth keeping but no action needed
      • noise    — blurry, irrelevant, accidental snap; the user will likely want to discard
  - confidence: 0-100. Below 60, lean "noise" or the safest classification.
  - title: short headline (≤80 chars) — what to use as the description / subject when this becomes a record
  - location: ("Master Bath", "Front porch") if visible, empty otherwise
  - trade: closest match from the standard trade list ("Electrical", "Plumbing", "HVAC", "Drywall", "Painting", "Tile", "Flooring", "Trim/Carpentry", "Doors/Hardware", "Cabinets", "Roofing", "Concrete", "Framing", "Insulation", "Cleanup", "General"). Empty for "noise" / "progress".
  - priority: for punch / rfi only — "low" / "medium" / "high". Otherwise empty.
  - rationale: 1 short sentence explaining the classification — helps the GC accept or override.

Return a JSON array (one entry per photo, same length as the input batch). Order matters — the UI lines up your output with the photos by index.

Return JSON only — no preamble.`;

const RECEIPT_PROMPT = `You are reading a SUPPLIER / MATERIAL invoice or receipt for a residential general contractor (lumber yard, supply house, big-box pro desk, plumbing/electrical supplier). Extract the purchase into structured JSON so it can be costed and fed into the GC's price book.

Return a single JSON object (NOT an array) with:
  - vendor: the supplier's business name (top of the receipt).
  - receiptDate: the invoice/receipt date in YYYY-MM-DD if you can determine it, else the raw printed string.
  - documentNumber: the invoice / order / receipt number, if printed.
  - lines: an array, one per line item actually purchased, each with:
      • description — the item as printed ("2x4x8 SPF #2 stud", "1/2in CDX plywood 4x8").
      • category — your one-or-two-word trade/material bucket for cost grouping ("Framing", "Concrete", "Electrical", "Plumbing", "Drywall", "Roofing", "Finishes", "Hardware"). Best guess.
      • quantity — numeric quantity purchased.
      • unit — unit of measure as printed ("ea", "bf", "sheet", "cy", "lf", "box", "bag").
      • unitPrice — price per single unit (NOT the extended total).
      • lineTotal — the extended line total (quantity × unitPrice) if printed.
  - subtotal: pre-tax subtotal if printed.
  - tax: tax amount if printed.
  - total: the grand total printed on the document.
  - confidence: 0-100, how confident you are in this extraction overall (legibility, completeness).

Rules:
  - Numbers must be plain numbers — strip $ and thousands separators.
  - Skip non-item rows (subtotal/tax/total lines, store address, payment method, loyalty messages) — those belong in the summary fields, not in lines.
  - If a line shows only an extended total (no per-unit price), put it in lineTotal and leave unitPrice 0 — the app will back it out.
  - If the image is not a material/supplier invoice, return { "vendor": "", "lines": [], "confidence": 0 }.

Return JSON only — no preamble.`;

const ROOMS_PROMPT = `You are an expert construction estimator reading a residential FLOOR PLAN sheet (architectural drawing). Identify every room and named space on the plan so the contractor can price the job room by room.

Return a JSON object: { "rooms": [ ... ] } where each room has:
  - name: the label on the plan ("Master Bedroom", "Kitchen", "Bath 2"). If unlabeled but clearly a room, infer a sensible name ("Bedroom 3"). ≤60 chars.
  - type: best match from "kitchen", "bathroom", "bedroom", "living", "dining", "office", "garage", "laundry", "closet", "hallway", "basement", "deck", "other".
  - approxSqft: your best estimate of the room's floor area in square feet. PREFER printed dimensions on the plan (e.g. "12'-0\\" x 14'-6\\"" → 174). If no dimensions are printed, estimate from the room's share of the overall plan and any scale notation. Must be > 0.
  - bbox: { x, y, w, h } — the room's bounding box on THIS image, normalized 0..1 (x,y = top-left corner). Be as tight as you can.
  - confidence: 0-100. Use ≥80 when dimensions are printed, 50-79 when estimating from proportions, <50 when guessing. Only include rooms at confidence ≥ 40.
  - note: short observation that helps pricing (≤160 chars): printed dimensions, visible fixtures ("double vanity, tub + shower"), ceiling notes, anything unusual. Empty string if nothing.

Rules:
  - One entry per distinct room/space. Include garages, decks/patios, and large closets; skip wall thicknesses, dimension strings, and title-block text.
  - If multiple plan pages are attached, set bbox relative to the page the room appears on and work page by page.
  - If the image is NOT a floor plan (photo, elevation, detail sheet), return { "rooms": [] }.

Return JSON only — no preamble.`;

interface RoomOut {
  name: string;
  type: string;
  approxSqft: number;
  bbox: { x: number; y: number; w: number; h: number };
  confidence: number;
  note: string;
}

interface ReceiptLineOut {
  description: string;
  category: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  lineTotal: number;
}

interface ReceiptOut {
  vendor: string;
  receiptDate: string;
  documentNumber: string;
  lines: ReceiptLineOut[];
  subtotal: number;
  tax: number;
  total: number;
  confidence: number;
}

interface PunchItem {
  description: string;
  location: string;
  trade: string;
  priority: 'low' | 'medium' | 'high';
  photoIndex: number;
  confidence: number;
}

interface DfrSummary {
  workPerformed: string;
  tradesOnSite: string[];
  materialsObserved: string[];
  notesForGC: string;
}

interface RfiCandidate {
  subject: string;
  question: string;
  location: string;
  trade: string;
  priority: 'low' | 'medium' | 'high';
  photoIndex: number;
  confidence: number;
}

type TriageClass = 'punch' | 'rfi' | 'dfr' | 'progress' | 'noise';

interface TriageEntry {
  photoIndex: number;
  classification: TriageClass;
  confidence: number;
  title: string;
  location: string;
  trade: string;
  priority: 'low' | 'medium' | 'high' | '';
  rationale: string;
}

async function fetchAsBase64(url: string): Promise<{ data: string; mimeType: string }> {
  // SSRF guard: only fetch https URLs on the app's own Supabase storage
  // host. Throws UrlValidationError for anything else; the caller
  // pre-validates the batch and rejects with a generic 400, so this is
  // defense-in-depth ensuring no disallowed URL is ever fetched.
  const safeUrl = validateFetchableUrl(url);
  const r = await fetch(safeUrl);
  if (!r.ok) throw new Error(`Fetch image failed: ${r.status} ${url}`);
  const mimeType = r.headers.get('content-type') ?? 'image/jpeg';
  const buf = await r.arrayBuffer();
  // Base64-encode in 32KB chunks to avoid stack overflow on large images.
  let binary = '';
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return { data: btoa(binary), mimeType };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'POST only' }, 405);
  if (!GEMINI_API_KEY) return jsonResponse({ success: false, error: 'GEMINI_API_KEY not configured' }, 500);

  // Server-side paywall: punch-list AI + DFR auto-summarize are Pro-tier
  // features. Without this gate, anyone with the URL can curl us for free
  // Gemini Vision passes (12 photos × ~1500 tokens each = noticeable cost
  // at scale).
  const auth = await requireTier(req, ['pro', 'business'], 'analyze_photos');
  if (!auth.ok) return jsonResponse(auth.body, auth.status);

  let body: AnalyzePhotosRequest;
  try { body = await req.json(); } catch { return jsonResponse({ success: false, error: 'Invalid JSON body' }, 400); }

  if (!body.task || !['punch', 'dfr', 'rfi', 'triage', 'receipt', 'rooms'].includes(body.task)) {
    return jsonResponse({ success: false, error: 'task must be "punch", "dfr", "rfi", "triage", "receipt", or "rooms"' }, 400);
  }

  const usingInline = Array.isArray(body.photos) && body.photos.length > 0;
  const usingUrls = Array.isArray(body.photoUrls) && body.photoUrls.length > 0;
  if (!usingInline && !usingUrls) {
    return jsonResponse({ success: false, error: 'Either photos[] (inline base64) or photoUrls[] required' }, 400);
  }
  const inputCount = usingInline ? body.photos!.length : body.photoUrls!.length;
  if (inputCount > 12) {
    return jsonResponse({ success: false, error: 'Max 12 photos per call (cost / latency control)' }, 400);
  }

  // Build the list of base64-encoded photos to feed Gemini. Inline
  // photos skip the server fetch (used for client-side camera /
  // library picks where the URI is file://). URL-based photos fetch
  // server-side; failures are skipped rather than aborting the whole
  // call so a single expired signed URL doesn't kill the request.
  let goodPhotos: { data: string; mimeType: string; originalIndex: number }[] = [];
  if (usingInline) {
    // Per-photo + total payload size guards (code-review #6). Supabase
    // Functions cap requests at ~10MB; we reject before forwarding so
    // the client gets a clear error instead of a silent network drop.
    const MAX_INLINE_BYTES_PER_PHOTO = 6 * 1024 * 1024;  // ~4.5MB raw
    const MAX_INLINE_BYTES_TOTAL = 8 * 1024 * 1024;
    let total = 0;
    for (let i = 0; i < body.photos!.length; i++) {
      const p = body.photos![i];
      if (!p || typeof p.base64 !== 'string' || p.base64.length === 0) {
        return jsonResponse({ success: false, error: `Photo ${i} missing base64 data` }, 400);
      }
      if (p.base64.length > MAX_INLINE_BYTES_PER_PHOTO) {
        const mb = (p.base64.length / 1024 / 1024).toFixed(1);
        return jsonResponse({
          success: false,
          error: `Photo ${i} is too large (${mb} MB encoded). Take photos at lower quality — around 1200×1600 px works well.`,
        }, 413);
      }
      total += p.base64.length;
    }
    if (total > MAX_INLINE_BYTES_TOTAL) {
      const mb = (total / 1024 / 1024).toFixed(1);
      return jsonResponse({
        success: false,
        error: `Total photo payload too large (${mb} MB). Pick fewer photos or take them at lower quality.`,
      }, 413);
    }
    goodPhotos = body.photos!.map((p, i) => ({
      data: p.base64,
      mimeType: p.mimeType || 'image/jpeg',
      originalIndex: i,
    }));
  } else {
    // SSRF guard: validate every URL before any server-side fetch. Reject
    // the whole batch with a generic 400 that does NOT echo the URL if any
    // is not an https URL on the app's own Supabase storage host.
    for (const u of body.photoUrls!) {
      try { validateFetchableUrl(u); }
      catch { return jsonResponse({ success: false, error: 'One or more photo URLs are not allowed.' }, 400); }
    }
    const fetched = await Promise.allSettled(body.photoUrls!.map(fetchAsBase64));
    goodPhotos = fetched
      .map((r, i) => r.status === 'fulfilled' ? { ...r.value, originalIndex: i } : null)
      .filter((x): x is { data: string; mimeType: string; originalIndex: number } => x !== null);
  }

  if (goodPhotos.length === 0) {
    return jsonResponse({ success: false, error: 'Could not load any of the supplied photos' }, 400);
  }

  // Monthly cap for this user. Meter AFTER at least one valid photo is in hand
  // — a missing/oversized/unfetchable input where no Gemini call runs must not
  // consume a unit. Counts both punch and dfr together (same underlying spend).
  const used = await aiUsageIncrement(auth.userId, 'analyze_photos');
  const cap = MONTHLY_CAPS[auth.tier].analyze_photos;
  if (used > cap) {
    return jsonResponse({
      success: false,
      error: `Monthly photo-analysis limit reached (${cap} on ${auth.tier}). Resets on the 1st.`,
      code: 'monthly_cap_reached',
      used, cap,
    }, 429);
  }

  // Lightweight observability (code-review #11) — task + count + path.
  console.log(`[analyze-photos] task=${body.task} photos=${goodPhotos.length} inline=${usingInline}`);

  const ctxLine = [
    body.projectName ? `Project: ${body.projectName}` : null,
    body.projectType ? `Type: ${body.projectType}` : null,
    body.notes ? `GC notes: ${body.notes}` : null,
  ].filter(Boolean).join('\n');

  const basePrompt =
    body.task === 'punch'   ? PUNCH_PROMPT :
    body.task === 'dfr'     ? DFR_PROMPT :
    body.task === 'rfi'     ? RFI_PROMPT :
    body.task === 'receipt' ? RECEIPT_PROMPT :
    body.task === 'rooms'   ? ROOMS_PROMPT :
    TRIAGE_PROMPT;
  const prompt = ctxLine ? `${ctxLine}\n\n${basePrompt}` : basePrompt;

  const parts: Record<string, unknown>[] = [{ text: prompt }];
  for (const p of goodPhotos) {
    parts.push({ inline_data: { mime_type: p.mimeType, data: p.data } });
  }

  let geminiResp: Response;
  try {
    geminiResp = await fetch(`${ENDPOINT}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.2,
          maxOutputTokens: 2000,
        },
      }),
    });
  } catch (e) {
    return jsonResponse({ success: false, error: `Gemini network error: ${(e as Error).message}` }, 502);
  }

  if (!geminiResp.ok) {
    const text = await geminiResp.text().catch(() => '');
    return jsonResponse({ success: false, error: `Gemini ${geminiResp.status}: ${text.slice(0, 200)}` }, 502);
  }

  // Guard the .json() itself: a 200 with a truncated/partial body throws here.
  // Return a CORS-carrying 502 rather than a bare, CORS-less 500.
  let j: Record<string, unknown>;
  try { j = await geminiResp.json(); }
  catch { return jsonResponse({ success: false, error: 'Gemini returned an unreadable response' }, 502); }
  const candidates = j?.candidates as { content?: { parts?: { text?: string }[] } }[] | undefined;
  const raw = candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return jsonResponse({ success: false, error: 'Gemini returned non-JSON', raw }, 500); }

  // Validate / normalize per-task.
  if (body.task === 'punch') {
    if (!Array.isArray(parsed)) return jsonResponse({ success: false, error: 'Expected array of punch items' }, 500);
    const items: PunchItem[] = (parsed as unknown[])
      .map((x): PunchItem => {
        const o = x as Record<string, unknown>;
        return {
          description: String(o.description ?? '').slice(0, 200),
          location: String(o.location ?? ''),
          trade: String(o.trade ?? 'General'),
          priority: (['low', 'medium', 'high'].includes(String(o.priority)) ? o.priority : 'medium') as PunchItem['priority'],
          photoIndex: Number.isFinite(Number(o.photoIndex)) ? Number(o.photoIndex) : 0,
          confidence: Number.isFinite(Number(o.confidence)) ? Math.max(0, Math.min(100, Number(o.confidence))) : 70,
        };
      })
      .filter(i => i.description.length > 0 && i.confidence >= 60);
    return jsonResponse({ success: true, data: { items } });
  }

  if (body.task === 'rfi') {
    if (!Array.isArray(parsed)) return jsonResponse({ success: false, error: 'Expected array of RFI candidates' }, 500);
    const items: RfiCandidate[] = (parsed as unknown[])
      .map((x): RfiCandidate => {
        const o = x as Record<string, unknown>;
        return {
          subject: String(o.subject ?? '').slice(0, 200),
          question: String(o.question ?? '').slice(0, 800),
          location: String(o.location ?? ''),
          trade: String(o.trade ?? 'General'),
          priority: (['low', 'medium', 'high'].includes(String(o.priority)) ? o.priority : 'medium') as RfiCandidate['priority'],
          photoIndex: Number.isFinite(Number(o.photoIndex)) ? Number(o.photoIndex) : 0,
          confidence: Number.isFinite(Number(o.confidence)) ? Math.max(0, Math.min(100, Number(o.confidence))) : 75,
        };
      })
      .filter(i => i.subject.length > 0 && i.question.length > 0 && i.confidence >= 70);
    return jsonResponse({ success: true, data: { items } });
  }

  if (body.task === 'triage') {
    if (!Array.isArray(parsed)) return jsonResponse({ success: false, error: 'Expected array of triage entries' }, 500);
    const VALID_CLASSES: TriageClass[] = ['punch', 'rfi', 'dfr', 'progress', 'noise'];
    const entries: TriageEntry[] = (parsed as unknown[]).map((x, i): TriageEntry => {
      const o = x as Record<string, unknown>;
      const cls = String(o.classification ?? 'noise');
      const safeCls: TriageClass = (VALID_CLASSES as string[]).includes(cls) ? (cls as TriageClass) : 'noise';
      const pri = String(o.priority ?? '');
      return {
        photoIndex: Number.isFinite(Number(o.photoIndex)) ? Number(o.photoIndex) : i,
        classification: safeCls,
        confidence: Number.isFinite(Number(o.confidence)) ? Math.max(0, Math.min(100, Number(o.confidence))) : 60,
        title: String(o.title ?? '').slice(0, 200),
        location: String(o.location ?? ''),
        trade: String(o.trade ?? ''),
        priority: (['low', 'medium', 'high'].includes(pri) ? pri : '') as TriageEntry['priority'],
        rationale: String(o.rationale ?? '').slice(0, 240),
      };
    });
    return jsonResponse({ success: true, data: { entries } });
  }

  if (body.task === 'receipt') {
    // Pass the parsed object through with light shaping — the client's
    // normalizeExtraction does the authoritative number-coercion + total
    // recompute, so here we only guarantee the shape exists.
    const o = parsed as Record<string, unknown>;
    const rawLines = Array.isArray(o.lines) ? o.lines : [];
    const out: ReceiptOut = {
      vendor: String(o.vendor ?? ''),
      receiptDate: String(o.receiptDate ?? ''),
      documentNumber: String(o.documentNumber ?? ''),
      lines: rawLines.map((l): ReceiptLineOut => {
        const r = (l ?? {}) as Record<string, unknown>;
        return {
          description: String(r.description ?? ''),
          category: String(r.category ?? ''),
          quantity: Number(r.quantity) || 0,
          unit: String(r.unit ?? ''),
          unitPrice: Number(r.unitPrice) || 0,
          lineTotal: Number(r.lineTotal) || 0,
        };
      }),
      subtotal: Number(o.subtotal) || 0,
      tax: Number(o.tax) || 0,
      total: Number(o.total) || 0,
      confidence: Number(o.confidence) || 0,
    };
    return jsonResponse({ success: true, data: out });
  }

  if (body.task === 'rooms') {
    // Accept either { rooms: [...] } or a bare array (Gemini drifts).
    // Light shaping only — the client's planIntelligence.normalizeDetectedRooms
    // does the authoritative clamping; we guarantee shape + the ≥40 confidence
    // floor the prompt promised.
    const container = parsed as Record<string, unknown>;
    const rawRooms = Array.isArray(container?.rooms) ? container.rooms
      : Array.isArray(parsed) ? (parsed as unknown[])
      : [];
    const clamp01 = (v: unknown) => Math.max(0, Math.min(1, Number(v) || 0));
    const rooms: RoomOut[] = (rawRooms as unknown[])
      .map((x): RoomOut => {
        const r = (x ?? {}) as Record<string, unknown>;
        const b = (r.bbox ?? {}) as Record<string, unknown>;
        return {
          name: String(r.name ?? '').slice(0, 60),
          type: String(r.type ?? 'other'),
          approxSqft: Number(r.approxSqft) || 0,
          bbox: { x: clamp01(b.x), y: clamp01(b.y), w: clamp01(b.w), h: clamp01(b.h) },
          confidence: Math.max(0, Math.min(100, Number(r.confidence) || 0)),
          note: String(r.note ?? '').slice(0, 160),
        };
      })
      .filter(r => r.name.length > 0 && r.approxSqft > 0 && r.confidence >= 40);
    return jsonResponse({ success: true, data: { rooms } });
  }

  // dfr task
  const o = parsed as Record<string, unknown>;
  const summary: DfrSummary = {
    workPerformed: String(o.workPerformed ?? ''),
    tradesOnSite: Array.isArray(o.tradesOnSite) ? o.tradesOnSite.map(String) : [],
    materialsObserved: Array.isArray(o.materialsObserved) ? o.materialsObserved.map(String) : [],
    notesForGC: String(o.notesForGC ?? ''),
  };
  return jsonResponse({ success: true, data: summary });
});

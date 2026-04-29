// analyze-photos
//
// Generic Gemini Vision pipeline for project photos. Two tasks today:
//   - 'punch'  → AI walks the photos and returns a structured punch
//                list (description, location, trade, priority).
//   - 'dfr'    → AI summarizes the photos as the workPerformed +
//                trades-on-site fields of a daily field report.
//
// Modelled on the existing analyze-drawings function — same auth /
// CORS / error shape, different prompt + schema per task.
//
// Secrets required:
//   GEMINI_API_KEY — Google AI Studio key (https://aistudio.google.com/)
//
// Request body:
// {
//   task: 'punch' | 'dfr';
//   photoUrls: string[];        // 1..N publicly fetchable image URLs
//   projectName?: string;
//   projectType?: string;
//   notes?: string;             // user-provided context
// }

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

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
  task: 'punch' | 'dfr';
  /** EITHER photoUrls (server fetches) OR photos[].base64 inline.
   *  Client-side camera / library picks are file:// URIs that the
   *  server can't fetch — those callers send inline base64 instead. */
  photoUrls?: string[];
  photos?: Array<{ base64: string; mimeType?: string }>;
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

async function fetchAsBase64(url: string): Promise<{ data: string; mimeType: string }> {
  const r = await fetch(url);
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

  let body: AnalyzePhotosRequest;
  try { body = await req.json(); } catch { return jsonResponse({ success: false, error: 'Invalid JSON body' }, 400); }

  if (!body.task || !['punch', 'dfr'].includes(body.task)) {
    return jsonResponse({ success: false, error: 'task must be "punch" or "dfr"' }, 400);
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
  let goodPhotos: Array<{ data: string; mimeType: string; originalIndex: number }> = [];
  if (usingInline) {
    goodPhotos = body.photos!.map((p, i) => ({
      data: p.base64,
      mimeType: p.mimeType || 'image/jpeg',
      originalIndex: i,
    }));
  } else {
    const fetched = await Promise.allSettled(body.photoUrls!.map(fetchAsBase64));
    goodPhotos = fetched
      .map((r, i) => r.status === 'fulfilled' ? { ...r.value, originalIndex: i } : null)
      .filter((x): x is { data: string; mimeType: string; originalIndex: number } => x !== null);
  }

  if (goodPhotos.length === 0) {
    return jsonResponse({ success: false, error: 'Could not load any of the supplied photos' }, 400);
  }

  const ctxLine = [
    body.projectName ? `Project: ${body.projectName}` : null,
    body.projectType ? `Type: ${body.projectType}` : null,
    body.notes ? `GC notes: ${body.notes}` : null,
  ].filter(Boolean).join('\n');

  const basePrompt = body.task === 'punch' ? PUNCH_PROMPT : DFR_PROMPT;
  const prompt = ctxLine ? `${ctxLine}\n\n${basePrompt}` : basePrompt;

  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
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

  const j = await geminiResp.json();
  const raw = j?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
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

// convert-pdf-to-images
//
// Deno edge function that takes a PDF (already uploaded to Supabase Storage)
// and renders each page to a PNG, uploads each PNG back to storage, and
// returns the public URLs + page metadata.
//
// Why server-side, not in the app:
//   - Native RN PDF renderers (react-native-pdf, etc.) bring 5–20 MB of
//     native deps, break on Fabric/New Arch in unpredictable ways, and
//     don't run on web at all. We support iOS + Android + web from a
//     single JS bundle, so server-side rendering is the only path that
//     ships everywhere unchanged.
//   - Plan PDFs are big (50–500 MB for a hospital set). On-device
//     rendering would melt phones in the field.
//
// 2026-05 — Rendering engine swap (mupdf-wasm → CloudConvert API).
//   The mupdf-wasm path crashed Supabase Edge workers with status 546
//   on every call (~2.8s execution then SIGKILL). Root cause: mupdf
//   reserves a 2 GB virtual heap on init, Supabase Edge caps workers
//   at ~256 MB resident, kernel kills the process before any of our JS
//   runs (so try-catch was useless). Both major pure-Deno PDF rendering
//   options (mupdf-wasm and pdfjs-dist + a Canvas2D shim) hit similar
//   memory ceilings; the only path that ships RIGHT NOW is to delegate
//   the rasterization to a hosted service.
//
//   CloudConvert was chosen because:
//   - JSON API, no SDK / WASM, works in any Deno runtime
//   - PDF → PNG with one PNG per page is a first-class operation
//   - $0.005/credit (~1 credit/page); 25 free credits/day on free tier
//   - We re-host the PNGs in our own Supabase Storage so the render is a
//     one-time service dependency, not an ongoing one — the client URLs
//     point at OUR `plan-sheets` bucket, not CloudConvert's CDN.
//
// Architecture
//   1. Client uploads the PDF to `pdf-uploads/<userId>/<uuid>.pdf` directly
//      from the app (Supabase Storage handles the multipart upload).
//   2. Client invokes this function with { pdfStoragePath, projectId }.
//   3. We mint a short-lived signed URL for the PDF.
//   4. We create a CloudConvert job (import/url → convert → export/url)
//      and poll until done. Typical residential set: 10–30s end-to-end.
//   5. We fetch each PNG from CloudConvert's export URL, read its
//      dimensions from the PNG IHDR chunk, and upload to our
//      `plan-sheets/<projectId>/<id>-page-N.png`.
//   6. Best-effort delete the source PDF (PNGs are now system of record).
//   7. Return public URLs + dimensions.
//
// Secrets:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (auto-injected)
//   CLOUDCONVERT_API_KEY                     (set via `supabase secrets set`)
//
// Request body:
//   {
//     pdfStoragePath: string,
//     projectId: string,
//     dpi?: number,          // 72–300, default 144
//     maxPages?: number,     // 1–200, default 50 (Pro) / 200 (Business)
//   }
//
// Response (success):
//   {
//     success: true,
//     pages: Array<{
//       pageNumber: number,
//       storagePath: string,    // inside `plan-sheets` bucket
//       publicUrl: string,
//       width: number,          // px
//       height: number,
//     }>,
//   }

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { PDFDocument } from 'https://esm.sh/pdf-lib@1.17.1';
import { requireTier, aiUsageIncrement, aiUsageGet, MONTHLY_CAPS } from '../_shared/auth.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CLOUDCONVERT_API_KEY = Deno.env.get('CLOUDCONVERT_API_KEY') ?? '';

const PDF_BUCKET = 'pdf-uploads';
const PNG_BUCKET = 'plan-sheets';

// CloudConvert hard caps the per-job wall-clock time at 30 minutes.
// Our poll budget is 5 minutes — plenty for a 200-page set; the wizard
// times out client-side at ~3 min so we err on the side of failing
// loudly here instead of leaving the client hanging.
const POLL_TIMEOUT_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 2_000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface RequestBody {
  pdfStoragePath: string;
  projectId: string;
  dpi?: number;
  maxPages?: number;
}

interface PageOutput {
  pageNumber: number;
  storagePath: string;
  publicUrl: string;
  width: number;
  height: number;
}

interface CloudConvertFile {
  filename: string;
  url: string;
  size?: number;
}
interface CloudConvertTask {
  id: string;
  name: string;
  operation: string;
  status: 'waiting' | 'processing' | 'finished' | 'error';
  message?: string | null;
  code?: string | null;
  result?: { files?: CloudConvertFile[] };
}
interface CloudConvertJob {
  id: string;
  status: 'waiting' | 'processing' | 'finished' | 'error';
  tasks: CloudConvertTask[];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ success: false, error: 'method not allowed' }, 405);

  const t0 = Date.now();
  const log = (step: string, data?: Record<string, unknown>) => {
    console.log(`[convert-pdf] +${Date.now() - t0}ms ${step}`, data ? JSON.stringify(data) : '');
  };

  try {
    log('boot');

    if (!CLOUDCONVERT_API_KEY) {
      return json({
        success: false,
        error: 'CLOUDCONVERT_API_KEY is not configured on the server. Set the secret in Supabase Edge Functions and redeploy.',
      }, 500);
    }

    // Server-side paywall: PDF→PNG rendering is the front door of the
    // estimate wizard pipeline (Pro/Business). Without this gate, anyone
    // with the URL could submit a 200-page 500MB PDF as a free DoS attack
    // OR free-ride the AI estimate flow by uploading their own PDF.
    const auth = await requireTier(req, ['pro', 'business'], 'convert_pdf');
    if (!auth.ok) return json(auth.body, auth.status);
    log('auth_ok', { userId: auth.userId, tier: auth.tier });

    let body: RequestBody;
    try {
      body = await req.json();
    } catch {
      return json({ success: false, error: 'invalid JSON body' }, 400);
    }

    const { pdfStoragePath, projectId } = body;
    const dpi = clamp(body.dpi ?? 144, 72, 300);
    // Tier-aware page cap. Pro: 50/run (typical residential set is 8–30
    // sheets). Business: 200/run for hospital / commercial sets.
    const HARD_PAGE_CAP = auth.tier === 'business' ? 200 : 50;
    const maxPages = clamp(body.maxPages ?? HARD_PAGE_CAP, 1, HARD_PAGE_CAP);

    if (!pdfStoragePath || !projectId) {
      return json({ success: false, error: 'pdfStoragePath and projectId are required' }, 400);
    }
    log('body_parsed', { pdfStoragePath, projectId, dpi, maxPages });

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1a. Download the PDF so we can count pages BEFORE running the cap
    //     check + paying Cloudconvert. pdf-lib parses metadata only — no
    //     rasterization — so this is fast (<200ms even on a 200-page set)
    //     and Deno-Deploy-safe (pure JS, no WASM).
    const { data: pdfBlob, error: dlErr } = await supabase.storage
      .from(PDF_BUCKET)
      .download(pdfStoragePath);
    if (dlErr || !pdfBlob) {
      log('download_failed', { err: dlErr?.message });
      return json({
        success: false,
        error: `could not read PDF: ${dlErr?.message ?? 'storage returned no blob'}`,
      }, 500);
    }
    const pdfBytes = new Uint8Array(await pdfBlob.arrayBuffer());

    let pdfPageCount: number;
    try {
      // ignoreEncryption=true so we don't error on password-protected
      // PDFs at the parse step — we'll fail later in Cloudconvert with a
      // clearer message if the file is genuinely locked.
      const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
      pdfPageCount = doc.getPageCount();
    } catch (err) {
      log('pdf_parse_failed', { err: (err as Error).message });
      return json({
        success: false,
        error: `Could not parse PDF: ${(err as Error).message}`,
      }, 400);
    }
    log('pdf_parsed', { pdfPageCount });

    // 1b. Page-based cap check. Quote-precheck pattern — read the user's
    //     current monthly usage, see if pageCount fits in the remaining
    //     quota, and DENY before running Cloudconvert if it doesn't.
    //     Pre-fix the cap was per-call (a 200-page hospital set burned
    //     1 unit, same as a kitchen) — both undercharged power users and
    //     overcharged small jobs. Page metering aligns cost with usage.
    const cap = MONTHLY_CAPS[auth.tier].takeoff_pages ?? 0;
    const used = await aiUsageGet(auth.userId, 'takeoff_pages');
    const remaining = Math.max(0, cap - used);
    log('quota_check', { used, cap, remaining, pdfPageCount });

    if (cap === 0) {
      return json({
        success: false,
        error: `Takeoffs aren't included on the ${auth.tier} plan. Upgrade to Pro to start using AI Takeoff.`,
        code: 'tier_required',
        used, cap, remaining, pageCount: pdfPageCount,
      }, 402);
    }
    if (pdfPageCount > remaining) {
      return json({
        success: false,
        error: `That PDF is ${pdfPageCount} pages but you only have ${remaining} of ${cap} pages remaining this month.`,
        code: 'monthly_cap_reached',
        used, cap, remaining, pageCount: pdfPageCount,
      }, 429);
    }

    // The maxPages limit at the body-level still applies as a defense-
    // in-depth ceiling so a user on Enterprise can't ask for 500 pages
    // in one job (Cloudconvert wall-clock budget). At this point we've
    // already validated `pageCount <= remaining`.
    const renderPageCount = Math.min(pdfPageCount, maxPages);

    // 1c. Mint a signed URL for CloudConvert to fetch the PDF. 10-min
    //     TTL is plenty — CloudConvert pulls the file inside its first
    //     second.
    const { data: signed, error: signErr } = await supabase.storage
      .from(PDF_BUCKET)
      .createSignedUrl(pdfStoragePath, 600);
    if (signErr || !signed?.signedUrl) {
      log('sign_failed', { err: signErr?.message });
      return json({
        success: false,
        error: `could not sign PDF URL: ${signErr?.message ?? 'no URL returned'}`,
      }, 500);
    }
    log('signed_pdf_url');

    // 2. Create the CloudConvert job. We use 3 chained tasks:
    //      import/url    — pull the PDF from our signed URL
    //      convert       — pdf → png with `pixel_density` for our DPI
    //      export/url    — generate a download URL per output file
    //    archive_multiple_files=false ensures we get N PNG URLs (one per
    //    page) instead of a zip. CloudConvert names them
    //    `<original>-1.png`, `<original>-2.png`, ...
    const jobBody = {
      tasks: {
        'import-pdf': {
          operation: 'import/url',
          url: signed.signedUrl,
        },
        'convert-pdf': {
          operation: 'convert',
          input: 'import-pdf',
          input_format: 'pdf',
          output_format: 'png',
          // pixel_density maps to ImageMagick `-density` — i.e. DPI for
          // the rasterization. 144 = 2× retina at 72dpi.
          pixel_density: dpi,
          // Cap pages CloudConvert will render. We use the actual PDF
          // page count (capped at maxPages and pre-validated against the
          // user's remaining quota) so we don't pay CC for pages we
          // wouldn't return anyway.
          pages: `1-${renderPageCount}`,
        },
        'export-pngs': {
          operation: 'export/url',
          input: 'convert-pdf',
          inline: false,
          archive_multiple_files: false,
        },
      },
    };

    const createRes = await fetch('https://api.cloudconvert.com/v2/jobs', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CLOUDCONVERT_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(jobBody),
    });
    if (!createRes.ok) {
      const text = await createRes.text();
      log('cc_create_failed', { status: createRes.status, body: text.slice(0, 300) });
      return json({
        success: false,
        error: `CloudConvert job creation failed (${createRes.status}): ${text.slice(0, 200)}`,
      }, 502);
    }
    const created = await createRes.json() as { data: CloudConvertJob };
    const jobId = created.data.id;
    log('cc_job_created', { jobId });

    // 3. Poll the job until it finishes or errors. CloudConvert also
    //    supports webhooks but polling is simpler and the wall-clock
    //    cost (a few seconds of edge runtime) is fine inside our
    //    POLL_TIMEOUT_MS budget.
    let job: CloudConvertJob | null = null;
    const pollStart = Date.now();
    while (Date.now() - pollStart < POLL_TIMEOUT_MS) {
      await sleep(POLL_INTERVAL_MS);
      const r = await fetch(`https://api.cloudconvert.com/v2/jobs/${jobId}`, {
        headers: { Authorization: `Bearer ${CLOUDCONVERT_API_KEY}` },
      });
      if (!r.ok) {
        log('cc_poll_http_error', { status: r.status });
        continue;
      }
      const wrapped = await r.json() as { data: CloudConvertJob };
      job = wrapped.data;
      if (job.status === 'finished' || job.status === 'error') break;
    }

    if (!job) {
      return json({ success: false, error: 'CloudConvert poll never returned a job' }, 504);
    }
    if (job.status === 'error') {
      const errTask = job.tasks.find(t => t.status === 'error');
      log('cc_job_error', { task: errTask?.name, code: errTask?.code, message: errTask?.message });
      return json({
        success: false,
        error: `CloudConvert job failed: ${errTask?.message ?? errTask?.code ?? 'unknown'}`,
        code: errTask?.code ?? null,
      }, 502);
    }
    if (job.status !== 'finished') {
      return json({ success: false, error: 'CloudConvert job timed out before finishing' }, 504);
    }
    log('cc_job_finished');

    const exportTask = job.tasks.find(t => t.name === 'export-pngs');
    const files = exportTask?.result?.files ?? [];
    if (files.length === 0) {
      return json({ success: false, error: 'CloudConvert finished but produced 0 files' }, 502);
    }
    log('cc_files_listed', { count: files.length });

    // 4. Sort files by their numeric page suffix so our output array is in
    //    page order regardless of what CloudConvert returned. The filename
    //    convention is `<base>-<n>.png`.
    const sorted = [...files].sort((a, b) => extractPageNumber(a.filename) - extractPageNumber(b.filename));

    // 5. For each PNG, fetch from CloudConvert, read dimensions from the
    //    PNG header, and re-upload to our `plan-sheets` bucket. We do this
    //    sequentially to bound peak memory — a 144 DPI 24x36 sheet is
    //    ~4 MB encoded, so even a 50-page set fits comfortably.
    const baseId = crypto.randomUUID();
    const outputs: PageOutput[] = [];

    for (let i = 0; i < sorted.length; i++) {
      const f = sorted[i];
      const pageNumber = extractPageNumber(f.filename) || (i + 1);

      const dl = await fetch(f.url);
      if (!dl.ok) {
        log(`page_${pageNumber}_download_failed`, { status: dl.status });
        return json({ success: false, error: `download of page ${pageNumber} failed` }, 502);
      }
      const pngBytes = new Uint8Array(await dl.arrayBuffer());

      const dims = readPngDimensions(pngBytes);
      if (!dims) {
        log(`page_${pageNumber}_dim_failed`);
        return json({ success: false, error: `could not read PNG dimensions for page ${pageNumber}` }, 502);
      }

      const outPath = `${projectId}/${baseId}-page-${pageNumber}.png`;
      const { error: upErr } = await supabase.storage
        .from(PNG_BUCKET)
        .upload(outPath, pngBytes, { contentType: 'image/png', upsert: false });
      if (upErr) {
        log(`page_${pageNumber}_upload_failed`, { err: upErr.message });
        return json({ success: false, error: `upload page ${pageNumber} failed: ${upErr.message}` }, 500);
      }

      const { data: pub } = supabase.storage.from(PNG_BUCKET).getPublicUrl(outPath);
      outputs.push({
        pageNumber,
        storagePath: outPath,
        publicUrl: pub.publicUrl,
        width: dims.width,
        height: dims.height,
      });
      log(`page_${pageNumber}_done`, { width: dims.width, height: dims.height });
    }

    // 6. Charge the user's monthly quota by the actual rendered page count
    //    (NOT the original PDF page count, which may be larger than what we
    //    converted if maxPages clamped). Charging post-success means a
    //    Cloudconvert failure never burns the user's quota — they retry
    //    cleanly. Pre-fix the cap was incremented up-front by 1 regardless
    //    of pages, so a failed render still ate a unit and the user lost
    //    their cap on a server problem they didn't cause.
    const newUsed = await aiUsageIncrement(auth.userId, 'takeoff_pages', outputs.length);
    log('quota_charged', { charged: outputs.length, newUsed, cap });

    // 7. Best-effort delete the source PDF — PNGs are the system of record now
    //    and storage costs compound. We don't fail the request if this errors.
    supabase.storage.from(PDF_BUCKET).remove([pdfStoragePath]).catch(() => {});

    log('done', { totalMs: Date.now() - t0, pagesRendered: outputs.length });
    return json({
      success: true,
      pages: outputs,
      usage: { used: newUsed, cap, remaining: Math.max(0, cap - newUsed) },
    }, 200);
  } catch (err) {
    // Top-level catch — any uncaught error becomes a clean 500 so the
    // client gets a real message instead of a 546 worker-died.
    console.error('[convert-pdf] FATAL:', err);
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    return json({
      success: false,
      error: `Render crashed: ${msg}`,
      stack: stack?.slice(0, 800),
    }, 500);
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Extract the trailing `-<n>.png` page number from a CloudConvert output
 * filename. Falls back to 0 if the pattern doesn't match — the caller
 * uses array index as a backup so this still does the right thing for
 * single-page conversions where CloudConvert may omit the suffix.
 */
function extractPageNumber(filename: string): number {
  const m = /-(\d+)\.png$/i.exec(filename);
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * Read width + height from a PNG file's IHDR chunk. PNG layout:
 *   bytes 0-7:   signature (always 89 50 4E 47 0D 0A 1A 0A)
 *   bytes 8-11:  IHDR chunk length (always 0x0D = 13)
 *   bytes 12-15: 'IHDR'
 *   bytes 16-19: width  (uint32 big-endian)
 *   bytes 20-23: height (uint32 big-endian)
 *
 * Avoids pulling in an image-decode dep for what's a 16-byte read.
 */
function readPngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  // Signature check
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4E || bytes[3] !== 0x47) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  if (width <= 0 || height <= 0 || width > 200000 || height > 200000) return null;
  return { width, height };
}

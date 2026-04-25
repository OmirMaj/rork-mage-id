// convert-pdf-to-images
//
// Deno edge function that takes a PDF (uploaded to Supabase Storage) and
// renders each page to a PNG, uploads each PNG back to storage, and returns
// the public URLs + page metadata.
//
// Why server-side, not in the app:
//   - Native RN PDF renderers (react-native-pdf, etc.) bring 5–20 MB of native
//     deps, break on Fabric/New Arch in unpredictable ways, and don't run on
//     web at all. We support iOS + Android + web from a single JS bundle, so
//     server-side rendering is the only path that ships everywhere unchanged.
//   - Plan PDFs are big (50–500 MB for a hospital set). On-device rendering
//     would melt phones in the field. The Edge runs on Supabase infra with
//     hard memory ceilings we control.
//
// We render at 144 DPI by default (2× retina at 72dpi) — high enough to read
// sheet titles and dimensions on a phone, low enough that a typical 24×36
// sheet weighs ~2 MB instead of 30 MB. The viewer pinch-zooms, so on-screen
// quality is fine. Callers can override via `dpi` (capped at 300).
//
// Architecture
//   1. Client uploads the PDF to `pdf-uploads/<userId>/<uuid>.pdf` directly
//      from the app (Supabase Storage handles the multipart upload).
//   2. Client invokes this function with { pdfStoragePath, projectId }.
//   3. We download the PDF, parse with pdfjs-dist (legacy ESM build, no
//      worker), render each page on a skia_canvas (Deno-native Canvas2D),
//      encode to PNG, upload back to `plan-sheets/<projectId>/...png`.
//   4. Best-effort delete the source PDF (PNGs are now system of record).
//   5. Return public URLs + dimensions.
//
// Secrets (auto-injected by Supabase runtime):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Request body:
//   {
//     pdfStoragePath: string,
//     projectId: string,
//     dpi?: number,          // 72–300, default 144
//     maxPages?: number,     // 1–200, default 50
//   }
//
// Response (success):
//   {
//     success: true,
//     pages: Array<{
//       pageNumber: number,
//       storagePath: string,    // inside `plan-sheets` bucket
//       publicUrl: string,
//       width: number,          // px at requested DPI
//       height: number,
//     }>,
//   }

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
// @ts-ignore — pdfjs has no types for the legacy ESM URL
import * as pdfjsLib from 'https://esm.sh/pdfjs-dist@4.0.379/legacy/build/pdf.mjs';
// skia_canvas — Deno-native Canvas2D backed by Skia (same engine as Chrome).
// pdfjs renders raster output through a Canvas2D context, so we provide one.
// @ts-ignore — runtime-only module
import { Canvas } from 'https://deno.land/x/skia_canvas@0.5.8/mod.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const PDF_BUCKET = 'pdf-uploads';
const PNG_BUCKET = 'plan-sheets';

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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ success: false, error: 'method not allowed' }, 405);

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: 'invalid JSON body' }, 400);
  }

  const { pdfStoragePath, projectId } = body;
  const dpi = clamp(body.dpi ?? 144, 72, 300);
  const maxPages = clamp(body.maxPages ?? 50, 1, 200);

  if (!pdfStoragePath || !projectId) {
    return json({ success: false, error: 'pdfStoragePath and projectId are required' }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Download the PDF.
  const { data: pdfBlob, error: dlErr } = await supabase.storage
    .from(PDF_BUCKET)
    .download(pdfStoragePath);
  if (dlErr || !pdfBlob) {
    return json({ success: false, error: `download failed: ${dlErr?.message ?? 'no blob'}` }, 500);
  }
  const pdfBytes = new Uint8Array(await pdfBlob.arrayBuffer());

  // 2. Parse with pdfjs. disableWorker is required in Deno (no Worker DOM).
  let pdfDoc: { numPages: number; getPage: (n: number) => Promise<PdfPage>; destroy: () => Promise<void> };
  try {
    pdfDoc = await pdfjsLib.getDocument({
      data: pdfBytes,
      disableWorker: true,
      isEvalSupported: false,
      useSystemFonts: false,
    }).promise;
  } catch (err) {
    return json({ success: false, error: `pdf parse failed: ${(err as Error).message}` }, 400);
  }

  const pageCount = Math.min(pdfDoc.numPages, maxPages);
  if (pageCount === 0) {
    return json({ success: false, error: 'pdf has no pages' }, 400);
  }

  // 3. Render → encode → upload, page by page.
  const scale = dpi / 72;
  const outputs: PageOutput[] = [];
  const baseId = crypto.randomUUID();

  for (let i = 1; i <= pageCount; i++) {
    const page = await pdfDoc.getPage(i);
    const viewport = page.getViewport({ scale });
    const width = Math.ceil(viewport.width);
    const height = Math.ceil(viewport.height);

    const canvas = new Canvas(width, height);
    const context = canvas.getContext('2d');

    // pdfjs needs a CanvasFactory so it can construct off-screen canvases for
    // patterns, masks, etc. The default factory in the legacy build expects a
    // browser DOM; we provide a tiny Skia-backed shim.
    const canvasFactory = {
      create: (w: number, h: number) => {
        const c = new Canvas(w, h);
        return { canvas: c, context: c.getContext('2d') };
      },
      reset: (cc: { canvas: Canvas }, w: number, h: number) => {
        cc.canvas.width = w;
        cc.canvas.height = h;
      },
      destroy: (cc: { canvas: Canvas }) => {
        cc.canvas.width = 0;
        cc.canvas.height = 0;
      },
    };

    await page.render({
      canvasContext: context,
      viewport,
      canvasFactory,
    }).promise;

    // skia_canvas can encode directly to PNG bytes — no separate encoder lib.
    const pngBytes: Uint8Array = canvas.encode('png');
    const outPath = `${projectId}/${baseId}-page-${i}.png`;

    const { error: upErr } = await supabase.storage
      .from(PNG_BUCKET)
      .upload(outPath, pngBytes, { contentType: 'image/png', upsert: false });
    if (upErr) {
      return json({ success: false, error: `upload page ${i} failed: ${upErr.message}` }, 500);
    }

    const { data: pub } = supabase.storage.from(PNG_BUCKET).getPublicUrl(outPath);
    outputs.push({
      pageNumber: i,
      storagePath: outPath,
      publicUrl: pub.publicUrl,
      width,
      height,
    });

    page.cleanup();
  }

  await pdfDoc.destroy();

  // 4. Best-effort delete the source PDF — PNGs are the system of record now
  //    and storage costs compound. We don't fail the request if this errors.
  supabase.storage.from(PDF_BUCKET).remove([pdfStoragePath]).catch(() => {});

  return json({ success: true, pages: outputs }, 200);
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

// Minimal pdfjs page surface we use. pdfjs ships no .d.ts for the legacy ESM
// URL we import from, so we re-declare just the methods we touch.
interface PdfPage {
  getViewport: (opts: { scale: number }) => { width: number; height: number };
  render: (opts: {
    canvasContext: unknown;
    viewport: { width: number; height: number };
    canvasFactory: unknown;
  }) => { promise: Promise<void> };
  cleanup: () => void;
}

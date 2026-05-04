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
// 2026-05 — Rendering engine swap (skia_canvas + pdfjs-dist → mupdf-wasm).
//   The old stack imported `skia_canvas@0.5.8` from deno.land/x, which in
//   turn fetched a native binary at `esm.sh/build/Release/canvas.node`. That
//   path returned 404 for months, blocking every redeploy. We've migrated
//   to `mupdf` (the WASM build of MuPDF from Artifex — same engine that
//   powers Bluebeam internally). Pure WASM, no native binary, ~6 MB blob
//   that loads once per isolate. Renders PDF → PNG bytes directly with no
//   Canvas2D shim and no separate pdfjs dependency.
//
// Architecture
//   1. Client uploads the PDF to `pdf-uploads/<userId>/<uuid>.pdf` directly
//      from the app (Supabase Storage handles the multipart upload).
//   2. Client invokes this function with { pdfStoragePath, projectId }.
//   3. We download the PDF, parse with mupdf, render each page directly to
//      PNG bytes via toPixmap → asPNG, upload back to
//      `plan-sheets/<projectId>/...png`.
//   4. Best-effort delete the source PDF (PNGs are now system of record).
//   5. Return public URLs + dimensions.
//
// Memory note: each rendered pixmap holds ~width*height*3 bytes (RGB). At
// 144 DPI a 24×36 sheet is ~3450×5184 = ~54 MB raw. We .destroy() each
// pixmap immediately after PNG encode + upload so peak RSS stays bounded
// across multi-page sets.
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
import { requireTier, aiUsageIncrement, MONTHLY_CAPS } from "../_shared/auth.ts";
// mupdf-wasm — Artifex's official WASM build of MuPDF. Pure WASM, loaded
// once per isolate. We use the npm: specifier (Deno Deploy supports this
// since 2024) to avoid the esm.sh build-path class of issue that took
// down the previous skia_canvas stack.
//
// Tested against mupdf 1.27.0; the API used here (Document.openDocument,
// Page.toPixmap, Pixmap.asPNG, Matrix.scale, ColorSpace.DeviceRGB) has
// been stable since 1.0. Pinned to a specific minor to avoid surprise
// breaking changes — bump deliberately when upstream cuts a new version.
//
// @ts-ignore — npm types don't ship for Deno consumption
import * as mupdf from "npm:mupdf@1.27.0";

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

  // Server-side paywall: PDF→PNG rendering is the front door of the
  // estimate wizard pipeline (Pro/Business). Without this gate, anyone
  // with the URL could submit a 200-page 500MB PDF as a free DoS attack
  // OR free-ride the AI estimate flow by uploading their own PDF.
  const auth = await requireTier(req, ['pro', 'business'], 'convert_pdf');
  if (!auth.ok) return json(auth.body, auth.status);

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: 'invalid JSON body' }, 400);
  }

  const { pdfStoragePath, projectId } = body;
  const dpi = clamp(body.dpi ?? 144, 72, 300);
  // Tier-aware page cap. Pro: 50/run (typical residential set is 8–30
  // sheets). Business: 200/run for hospital / commercial sets. Stops a
  // forged client from asking for 500 pages and exhausting wall-clock.
  const HARD_PAGE_CAP = auth.tier === 'business' ? 200 : 50;
  const maxPages = clamp(body.maxPages ?? HARD_PAGE_CAP, 1, HARD_PAGE_CAP);

  if (!pdfStoragePath || !projectId) {
    return json({ success: false, error: 'pdfStoragePath and projectId are required' }, 400);
  }

  // Monthly cap (matches drawing analyzer cap — they're the same
  // pipeline). Increment first so the 31st run on Pro denies BEFORE the
  // expensive render starts.
  const used = await aiUsageIncrement(auth.userId, 'convert_pdf');
  const cap = MONTHLY_CAPS[auth.tier].convert_pdf;
  if (used > cap) {
    return json({
      success: false,
      error: `Monthly PDF-conversion limit reached (${cap} on ${auth.tier}). Resets on the 1st.`,
      code: 'monthly_cap_reached',
      used, cap,
    }, 429);
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

  // 2. Parse with mupdf.
  //    Document.openDocument dispatches on MIME type; passing
  //    'application/pdf' explicitly avoids any sniff misfire on PDFs that
  //    have unusual headers. mupdf throws synchronously on parse failure.
  let doc: MupdfDocument;
  try {
    doc = mupdf.Document.openDocument(pdfBytes, 'application/pdf') as MupdfDocument;
  } catch (err) {
    return json({ success: false, error: `pdf parse failed: ${(err as Error).message}` }, 400);
  }

  const totalPages = doc.countPages();
  const pageCount = Math.min(totalPages, maxPages);
  if (pageCount === 0) {
    doc.destroy?.();
    return json({ success: false, error: 'pdf has no pages' }, 400);
  }

  // 3. Render → encode → upload, page by page. We destroy each pixmap +
  //    page immediately after upload to keep peak memory bounded across
  //    long sets. mupdf objects are WASM-allocated so without explicit
  //    destroy() they only release on isolate teardown — fatal at 50+
  //    high-DPI pages.
  const scale = dpi / 72;
  // Matrix.scale(sx, sy) returns a 6-tuple [a,b,c,d,e,f]; toPixmap takes
  // it directly. The API is stable across mupdf 1.x.
  const matrix = mupdf.Matrix.scale(scale, scale);
  const colorSpace = mupdf.ColorSpace.DeviceRGB;

  const outputs: PageOutput[] = [];
  const baseId = crypto.randomUUID();

  for (let i = 0; i < pageCount; i++) {
    let page: MupdfPage | undefined;
    let pixmap: MupdfPixmap | undefined;
    try {
      page = doc.loadPage(i);
      // toPixmap(matrix, colorSpace, alpha?). We pass alpha=false because
      // PNG encoding then skips the alpha channel — saves ~25% on
      // outbound bytes for opaque architectural drawings.
      pixmap = page.toPixmap(matrix, colorSpace, false);

      const width = pixmap.getWidth();
      const height = pixmap.getHeight();
      const pngBytes = pixmap.asPNG();

      const outPath = `${projectId}/${baseId}-page-${i + 1}.png`;
      const { error: upErr } = await supabase.storage
        .from(PNG_BUCKET)
        .upload(outPath, pngBytes, { contentType: 'image/png', upsert: false });
      if (upErr) {
        return json({ success: false, error: `upload page ${i + 1} failed: ${upErr.message}` }, 500);
      }

      const { data: pub } = supabase.storage.from(PNG_BUCKET).getPublicUrl(outPath);
      outputs.push({
        pageNumber: i + 1,
        storagePath: outPath,
        publicUrl: pub.publicUrl,
        width,
        height,
      });
    } finally {
      // Always release WASM-side memory, even on error.
      try { pixmap?.destroy?.(); } catch { /* ignore */ }
      try { page?.destroy?.(); } catch { /* ignore */ }
    }
  }

  try { doc.destroy?.(); } catch { /* ignore */ }

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

// Minimal mupdf surface we actually call. The npm package ships .d.ts but
// the npm: specifier path doesn't resolve them in Deno's type checker, so
// we re-declare the methods we touch.
interface MupdfDocument {
  countPages: () => number;
  loadPage: (i: number) => MupdfPage;
  destroy?: () => void;
}
interface MupdfPage {
  toPixmap: (matrix: unknown, colorSpace: unknown, alpha?: boolean) => MupdfPixmap;
  destroy?: () => void;
}
interface MupdfPixmap {
  getWidth: () => number;
  getHeight: () => number;
  asPNG: () => Uint8Array;
  destroy?: () => void;
}

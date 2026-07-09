// import-schedule
//
// Bring an external construction schedule into MAGE's Schedule Pro. Two
// source formats are supported:
//
//   - Excel .xlsx  → parsed with SheetJS (server-side, keeps the native
//                    dep off the mobile bundle). Because column layouts
//                    vary wildly, we ask Gemini to map the header row to
//                    MAGE's schedule fields (title, duration, start,
//                    predecessors, …). The client shows the detected
//                    mapping + a live preview; if detection fails the user
//                    renames their headers and re-imports.
//
//   - MS Project XML (MSPDI) → parsed deterministically (no AI). MSPDI is
//                    a well-defined schema, so we read <Task> elements +
//                    <PredecessorLink> children directly into the same
//                    ImportedScheduleRow shape. Predecessor links are
//                    serialized to MAGE's "<UID><TYPE>+<lag>d" token
//                    string so the pure client-side mapper's
//                    parsePredecessorString handles both formats.
//
// The response is the ScheduleImportResult shape (types/index.ts). The
// client then runs the PURE mapper (utils/scheduleImport.ts) → runCpm to
// validate, captures a baseline, and persists via updateProject.
//
// Cost/auth model — mirrors analyze-photos:
//   - Pro-tier gate (requireTier(req, ['pro'], 'schedule_import')).
//   - xlsx only meters a monthly unit (Gemini spend); MSPDI is a free
//     deterministic parse and is NOT metered.
//
// Secrets required (xlsx path only):
//   GEMINI_API_KEY — Google AI Studio key (https://aistudio.google.com/)
//
// Request body:
// {
//   fileBase64?: string;   // .xlsx bytes, base64 (data-URI prefix tolerated)
//   fileText?:   string;   // .xml (MSPDI) UTF-8 text
//   filename:    string;   // used for format detection + validation
// }

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import * as XLSX from "https://esm.sh/xlsx@0.20.3";
import { requireTier, aiUsageIncrement, MONTHLY_CAPS } from "../_shared/auth.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "";
const MODEL = "gemini-2.5-flash";
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

// ─── Types (mirror types/index.ts ScheduleImportResult) ───────────────────
type ScheduleImportField =
  | "title" | "durationDays" | "startDate" | "finishDate" | "predecessors"
  | "progress" | "wbs" | "outlineLevel" | "resource" | "notes"
  | "milestone" | "constraintType" | "constraintDate";

type ColumnMapping = Partial<Record<ScheduleImportField, number | null>>;

interface ImportedScheduleRow {
  sourceId: string;
  title: string;
  rawDuration?: string;
  rawStart?: string;
  rawFinish?: string;
  rawPredecessors?: string;
  progress?: number;
  wbs?: string;
  outlineLevel?: number;
  resource?: string;
  notes?: string;
  milestone?: boolean;
  constraintType?: number;
  constraintDate?: string;
}

interface ScheduleImportWarning {
  code: string;
  message: string;
  sourceId?: string;
}

interface ScheduleImportResult {
  format: "xlsx" | "msproject_xml";
  rawColumns?: string[];
  mapping?: ColumnMapping | null;
  rows: ImportedScheduleRow[];
  warnings: ScheduleImportWarning[];
  truncated?: boolean;
}

interface ImportScheduleRequest {
  fileBase64?: string;
  fileText?: string;
  filename?: string;
}

// Hard limits: Supabase Functions cap requests near 10 MB and a huge sheet
// would blow latency + Gemini token budget. Reject early with a clear error.
const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024;
const MAX_ROWS = 1000;
const HOURS_PER_DAY = 8;

// MSPDI PredecessorLink.Type (numeric) → MAGE link-type letter code. Kept in
// sync with utils/scheduleImport.ts MSPDI_LINK_TYPE. Serialized into the
// "<UID><TYPE>+<lag>d" token so the client's parsePredecessorString reads it.
const MSPDI_LINK_TYPE: Record<number, string> = { 0: "FF", 1: "FS", 2: "SF", 3: "SS" };

const MAP_SYSTEM_PROMPT = `You are mapping spreadsheet columns to a construction schedule import. Given the header row and sample rows, return JSON { title, durationDays, startDate, finishDate, predecessors, progress, wbs, outlineLevel, resource, notes } where each value is the 0-based column index or null. Return indices only.`;

const MAP_FIELDS: ScheduleImportField[] = [
  "title", "durationDays", "startDate", "finishDate", "predecessors",
  "progress", "wbs", "outlineLevel", "resource", "notes",
];

// ─── Format detection ─────────────────────────────────────────────────────
// xlsx files are ZIP archives → first bytes are "PK\x03\x04". MSPDI is XML.
function detectFormat(
  bytes: Uint8Array | undefined,
  text: string | undefined,
  filename: string,
): "xlsx" | "msproject_xml" | null {
  const name = filename.toLowerCase();
  if (name.endsWith(".xlsx") || (bytes && bytes[0] === 0x50 && bytes[1] === 0x4b)) return "xlsx";
  if ((text ?? "").includes("http://schemas.microsoft.com/project") || name.endsWith(".xml")) {
    return "msproject_xml";
  }
  return null;
}

// ─── base64 → bytes (tolerates a data-URI prefix) ─────────────────────────
function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.includes(",") ? b64.slice(b64.indexOf(",") + 1) : b64;
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ─── xlsx sheet read (cheap, deterministic — NOT metered) ─────────────────
// Split out from the Gemini step so a corrupt or empty workbook can be
// rejected BEFORE we charge the caller a monthly unit. XLSX.read can throw on
// a malformed archive; the handler runs this in its own try so that failure
// returns a 500 without ever touching aiUsageIncrement.
interface XlsxGrid {
  header: string[];
  dataRows: unknown[][];
  truncated: boolean;
  warnings: ScheduleImportWarning[];
  empty: boolean;
}

function readBestGrid(bytes: Uint8Array): XlsxGrid {
  const warnings: ScheduleImportWarning[] = [];
  const wb = XLSX.read(bytes, { type: "array" });

  // Pick the sheet with the most rows (schedules often live past a cover tab).
  let best: unknown[][] = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const grid = XLSX.utils.sheet_to_json(sheet, {
      header: 1, raw: false, defval: "", blankrows: false,
    }) as unknown[][];
    if (grid.length > best.length) best = grid;
  }

  if (best.length === 0) {
    return { header: [], dataRows: [], truncated: false, warnings, empty: true };
  }

  const header = (best[0] ?? []).map((c) => String(c ?? "").trim());
  let dataRows = best.slice(1);
  let truncated = false;
  if (dataRows.length > MAX_ROWS) {
    truncated = true;
    dataRows = dataRows.slice(0, MAX_ROWS);
    warnings.push({
      code: "truncated",
      message: `Only the first ${MAX_ROWS} rows were imported.`,
    });
  }

  return { header, dataRows, truncated, warnings, empty: false };
}

// ─── xlsx Gemini column detection + row materialization (metered step) ─────
async function parseXlsx(grid: XlsxGrid): Promise<ScheduleImportResult> {
  const warnings: ScheduleImportWarning[] = [...grid.warnings];
  const { header, dataRows, truncated } = grid;

  // Ask Gemini to map header → schedule fields. On any failure, mapping=null
  // and the client asks the user to rename their headers and re-import.
  const mapping = await detectColumns(header, dataRows.slice(0, 5), warnings);

  // Materialize ImportedScheduleRow[] using the suggested mapping. Excel
  // sourceId uses 1-based numbering (i + 1) to match the task IDs that
  // Excel/MS-Project predecessor cells reference (the sheet's visible row #),
  // so a "depends on task 3" cell resolves to the 3rd task, not the 4th.
  const cellAt = (row: unknown[], idx: number | null | undefined): string | undefined => {
    if (idx == null || idx < 0 || idx >= row.length) return undefined;
    const v = String(row[idx] ?? "").trim();
    return v.length ? v : undefined;
  };
  const toNum = (s: string | undefined): number | undefined => {
    if (s == null) return undefined;
    const n = parseFloat(s.replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(n) ? n : undefined;
  };

  const rows: ImportedScheduleRow[] = mapping
    ? dataRows.map((row, i): ImportedScheduleRow => ({
        sourceId: String(i + 1),
        title: cellAt(row, mapping.title) ?? "",
        rawDuration: cellAt(row, mapping.durationDays),
        rawStart: cellAt(row, mapping.startDate),
        rawFinish: cellAt(row, mapping.finishDate),
        rawPredecessors: cellAt(row, mapping.predecessors),
        progress: toNum(cellAt(row, mapping.progress)),
        wbs: cellAt(row, mapping.wbs),
        outlineLevel: toNum(cellAt(row, mapping.outlineLevel)),
        resource: cellAt(row, mapping.resource),
        notes: cellAt(row, mapping.notes),
      }))
    : [];

  if (!mapping) {
    warnings.push({
      code: "unmapped_field",
      message: "Could not auto-detect the columns. Rename your headers (Task, Duration, Start, Predecessors) and re-import.",
    });
  } else if (mapping.title == null) {
    warnings.push({
      code: "unmapped_field",
      message: "No task-name column found. Rename a column to 'Task' and re-import.",
    });
  }

  return { format: "xlsx", rawColumns: header, mapping, rows, warnings, truncated };
}

async function detectColumns(
  header: string[],
  sample: unknown[][],
  warnings: ScheduleImportWarning[],
): Promise<ColumnMapping | null> {
  const promptText =
    `${MAP_SYSTEM_PROMPT}\n\nHeader row (0-based columns):\n${JSON.stringify(header)}\n\nSample data rows:\n${JSON.stringify(sample)}`;

  let geminiResp: Response;
  try {
    geminiResp = await fetch(`${ENDPOINT}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptText }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0,
          maxOutputTokens: 500,
        },
      }),
    });
  } catch {
    warnings.push({ code: "column_detect_failed", message: "Column auto-detect is unavailable right now. Rename your headers (Task, Duration, Start, Predecessors) and re-import." });
    return null;
  }
  if (!geminiResp.ok) {
    warnings.push({ code: "column_detect_failed", message: "Column auto-detect is unavailable right now. Rename your headers (Task, Duration, Start, Predecessors) and re-import." });
    return null;
  }

  let raw = "";
  try {
    const j = await geminiResp.json() as Record<string, unknown>;
    const candidates = j?.candidates as { content?: { parts?: { text?: string }[] } }[] | undefined;
    raw = candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  } catch {
    return null;
  }

  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(raw) as Record<string, unknown>; } catch { return null; }

  const mapping: ColumnMapping = {};
  for (const field of MAP_FIELDS) {
    const v = parsed[field];
    const idx = typeof v === "number" ? v : (typeof v === "string" ? parseInt(v, 10) : NaN);
    mapping[field] = Number.isInteger(idx) && idx >= 0 && idx < header.length ? idx : null;
  }
  return mapping;
}

// ─── MSPDI (MS Project XML) parse ─────────────────────────────────────────
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&amp;/g, "&");
}

function tagValue(block: string, tag: string): string | undefined {
  const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? decodeXmlEntities(m[1]).trim() : undefined;
}

function parseMsproject(text: string): ScheduleImportResult {
  const warnings: ScheduleImportWarning[] = [];
  const taskBlocks = text.match(/<Task>[\s\S]*?<\/Task>/g) ?? [];

  let blocks = taskBlocks;
  let truncated = false;
  if (blocks.length > MAX_ROWS) {
    truncated = true;
    blocks = blocks.slice(0, MAX_ROWS);
    warnings.push({ code: "truncated", message: `Only the first ${MAX_ROWS} tasks were imported.` });
  }

  const rows: ImportedScheduleRow[] = [];
  for (const block of blocks) {
    const uid = tagValue(block, "UID");
    if (uid == null) continue; // malformed task
    const title = tagValue(block, "Name") ?? "";

    // Serialize predecessor links into MAGE's token string so the client's
    // parsePredecessorString handles Excel + MSPDI identically. MSPDI LinkLag
    // is in tenths of a minute; convert to whole working days (8h/day) to
    // match the mapper's duration math.
    const predTokens: string[] = [];
    const linkBlocks = block.match(/<PredecessorLink>[\s\S]*?<\/PredecessorLink>/g) ?? [];
    for (const lb of linkBlocks) {
      const predUid = tagValue(lb, "PredecessorUID");
      if (predUid == null) continue;
      const typeNum = parseInt(tagValue(lb, "Type") ?? "1", 10);
      const typeLetter = MSPDI_LINK_TYPE[Number.isFinite(typeNum) ? typeNum : 1] ?? "FS";
      const lagTenthsMin = parseInt(tagValue(lb, "LinkLag") ?? "0", 10) || 0;
      const lagDays = Math.round(lagTenthsMin / (10 * 60 * HOURS_PER_DAY));
      const sign = lagDays < 0 ? "-" : "+";
      predTokens.push(`${predUid}${typeLetter}${sign}${Math.abs(lagDays)}d`);
    }

    const progressStr = tagValue(block, "PercentComplete");
    const outlineStr = tagValue(block, "OutlineLevel");
    const constraintTypeStr = tagValue(block, "ConstraintType");
    const milestoneStr = tagValue(block, "Milestone");

    const constraintType = constraintTypeStr != null ? parseInt(constraintTypeStr, 10) : undefined;

    rows.push({
      sourceId: uid,
      title,
      rawDuration: tagValue(block, "Duration"),
      rawStart: tagValue(block, "Start"),
      rawFinish: tagValue(block, "Finish"),
      rawPredecessors: predTokens.length ? predTokens.join(", ") : undefined,
      progress: progressStr != null && progressStr !== "" ? Number(progressStr) : undefined,
      wbs: tagValue(block, "WBS"),
      outlineLevel: outlineStr != null && outlineStr !== "" ? Number(outlineStr) : undefined,
      milestone: milestoneStr === "1" || milestoneStr?.toLowerCase() === "true",
      constraintType: constraintType != null && Number.isFinite(constraintType) ? constraintType : undefined,
      constraintDate:
        constraintType != null && constraintType > 0 ? tagValue(block, "ConstraintDate") : undefined,
    });
  }

  if (rows.length === 0) {
    warnings.push({ code: "empty_file", message: "No <Task> elements found in the MS Project XML." });
  }

  // MSPDI is fully auto-mapped — no ColumnMapping / rawColumns needed.
  return { format: "msproject_xml", rows, warnings, truncated };
}

// ─── Handler ──────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ success: false, error: "POST only" }, 405);

  // Server-side paywall: schedule import is a Pro-tier feature. Without this
  // gate anyone with the URL could curl us for free Gemini column-detect passes.
  const auth = await requireTier(req, ["pro"], "schedule_import");
  if (!auth.ok) return jsonResponse(auth.body, auth.status);

  let body: ImportScheduleRequest;
  try { body = await req.json(); } catch { return jsonResponse({ success: false, error: "Invalid JSON body" }, 400); }

  const filename = String(body.filename ?? "").trim();
  const name = filename.toLowerCase();
  if (!name.endsWith(".xlsx") && !name.endsWith(".xml")) {
    return jsonResponse({ success: false, error: "Filename must end in .xlsx or .xml" }, 400);
  }

  const hasBase64 = typeof body.fileBase64 === "string" && body.fileBase64.length > 0;
  const hasText = typeof body.fileText === "string" && body.fileText.length > 0;
  if (!hasBase64 && !hasText) {
    return jsonResponse({ success: false, error: "Either fileBase64 or fileText is required" }, 400);
  }

  const payloadLen = (body.fileBase64?.length ?? 0) + (body.fileText?.length ?? 0);
  if (payloadLen > MAX_PAYLOAD_BYTES) {
    const mb = (payloadLen / 1024 / 1024).toFixed(1);
    return jsonResponse({
      success: false,
      error: `File too large (${mb} MB). Trim the schedule or split it before importing.`,
    }, 413);
  }

  let bytes: Uint8Array | undefined;
  if (hasBase64) {
    try { bytes = base64ToBytes(body.fileBase64!); }
    catch { return jsonResponse({ success: false, error: "fileBase64 is not valid base64" }, 400); }
  }

  const format = detectFormat(bytes, body.fileText, filename);
  if (!format) {
    return jsonResponse({
      success: false,
      error: "Could not recognize the file as Excel (.xlsx) or MS Project XML.",
    }, 400);
  }

  try {
    if (format === "msproject_xml") {
      const text = body.fileText ?? (bytes ? new TextDecoder().decode(bytes) : "");
      if (!text) return jsonResponse({ success: false, error: "MS Project XML body was empty" }, 400);
      // Deterministic parse — no AI, no metering.
      const result = parseMsproject(text);
      console.log(`[import-schedule] format=msproject_xml rows=${result.rows.length}`);
      return jsonResponse(result);
    }

    // xlsx path — requires Gemini + meters a monthly unit.
    if (!bytes) return jsonResponse({ success: false, error: "Excel file bytes missing (send fileBase64)" }, 400);
    if (!GEMINI_API_KEY) return jsonResponse({ success: false, error: "GEMINI_API_KEY not configured" }, 500);

    // Read the sheet up front (cheap, safe). A corrupt or empty workbook must
    // NOT burn a metered unit — only a genuine Gemini column-detect call does.
    // readBestGrid can throw on a malformed archive; the outer try turns that
    // into a 500 with no metering.
    const grid = readBestGrid(bytes);
    if (grid.empty) {
      // No Gemini spend for an empty workbook → do not meter.
      return jsonResponse({
        format: "xlsx", rawColumns: [], mapping: null, rows: [],
        warnings: [{ code: "empty_file", message: "No rows found in any sheet." }],
      });
    }

    // Meter only now — a real Gemini column-detect call is about to run.
    const used = await aiUsageIncrement(auth.userId, "schedule_import");
    const cap = MONTHLY_CAPS[auth.tier].schedule_import;
    if (used > cap) {
      return jsonResponse({
        success: false,
        error: `Monthly schedule-import limit reached (${cap} on ${auth.tier}). Resets on the 1st.`,
        code: "monthly_cap_reached",
        used, cap,
      }, 429);
    }

    const result = await parseXlsx(grid);
    console.log(`[import-schedule] format=xlsx rows=${result.rows.length} cols=${result.rawColumns?.length ?? 0}`);
    return jsonResponse(result);
  } catch (e) {
    return jsonResponse({ success: false, error: `Failed to parse schedule: ${(e as Error).message}` }, 500);
  }
});

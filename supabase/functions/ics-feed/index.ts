// ics-feed — live calendar subscription feed for a single project.
//
// Why a server-side feed instead of a one-shot download:
//   The existing `utils/icsGenerator.ts:exportProjectIcs` writes a static
//   .ics file to disk and shares it. Subscribers in Apple Calendar /
//   Google Calendar / Outlook would fall out of date the moment the GC
//   reschedules a task or sends a new invoice. The whole point of an
//   .ics URL (vs. a download) is that the calendar app re-fetches it
//   periodically — so this function returns the same bytes the static
//   builder produces, but live, gated by an unguessable per-project
//   `calendar_token`.
//
// URL shape:
//   https://<supabase-project>.functions.supabase.co/ics-feed?token=<uuid>
//   webcal://<supabase-project>.functions.supabase.co/ics-feed?token=<uuid>
//
// Apple Calendar accepts both webcal:// and https:// for subscribe-style
// imports. Google Calendar's "From URL" requires https://. The client UI
// surfaces both — webcal triggers the OS subscribe handler on iOS, https
// is the one to paste into Google Calendar.
//
// Auth model:
//   - No JWT. The `?token=<uuid>` is the bearer; anyone with it can read
//     the feed (same trust model as a Calendly link).
//   - Service-role read against the projects + schedule + invoices +
//     warranties tables, scoped by `calendar_token = ?`.
//   - To revoke, the GC rotates the token (an UPDATE on the project) —
//     all existing subscribers stop working immediately.
//
// Output: text/calendar (RFC 5545) with VEVENTs for:
//   - schedule tasks (each task = one VEVENT)
//   - milestones (separate category for client-side filtering)
//   - invoice due dates (only when status != 'paid')
//   - warranty expirations
//
// Dates are all-day VEVENTs. DTEND is exclusive (RFC 5545) — a single-day
// event on 2026-04-24 has DTEND;VALUE=DATE:20260425.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function icsHeaders() {
  return {
    ...CORS,
    "Content-Type": "text/calendar; charset=utf-8",
    "Cache-Control": "no-cache, max-age=0",
  };
}

// --- ICS builder helpers (mirror utils/icsGenerator.ts but server-side) ---

function escapeText(s: string): string {
  return (s || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "");
}

function fmtDate(iso: string): string {
  // YYYY-MM-DD → YYYYMMDD
  return iso.replace(/-/g, "");
}

function nextDayIso(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  if (!Number.isFinite(d.getTime())) return iso;
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function fmtMoney(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);
}

function buildIcs(projectName: string, events: { uid: string; startDate: string; endDate: string; summary: string; description?: string; categories?: string[] }[]): string {
  const lines: string[] = [];
  lines.push("BEGIN:VCALENDAR");
  lines.push("VERSION:2.0");
  lines.push("PRODID:-//MAGE ID//Live ICS Feed//EN");
  lines.push("CALSCALE:GREGORIAN");
  lines.push("METHOD:PUBLISH");
  lines.push(`X-WR-CALNAME:${escapeText(projectName)}`);
  lines.push(`X-WR-CALDESC:Live MAGE ID schedule for ${escapeText(projectName)}`);
  for (const ev of events) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${ev.uid}`);
    lines.push(`DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`);
    lines.push(`DTSTART;VALUE=DATE:${fmtDate(ev.startDate)}`);
    // RFC 5545: all-day DTEND is EXCLUSIVE — bump by one day so a single-
    // day event renders correctly across all calendar apps.
    lines.push(`DTEND;VALUE=DATE:${fmtDate(nextDayIso(ev.endDate))}`);
    lines.push(`SUMMARY:${escapeText(ev.summary)}`);
    if (ev.description) lines.push(`DESCRIPTION:${escapeText(ev.description)}`);
    if (ev.categories && ev.categories.length > 0) {
      lines.push(`CATEGORIES:${ev.categories.map(escapeText).join(",")}`);
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

// --- Supabase REST helpers (service-role) ---

async function sbGet<T>(path: string): Promise<T> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
  });
  if (!r.ok) throw new Error(`Supabase GET ${path} failed: ${r.status}`);
  return await r.json() as T;
}

interface ProjectRow {
  id: string;
  name: string;
  calendar_token: string;
  schedule: { tasks?: { id: string; title: string; phase?: string; startDay: number; durationDays: number; isMilestone?: boolean; status?: string }[]; startDate?: string } | null;
  created_at: string;
}

interface InvoiceRow {
  id: string;
  project_id: string;
  number: string | number;
  due_date: string | null;
  status: string;
  total_due: number | null;
  amount_paid: number | null;
}

interface WarrantyRow {
  id: string;
  project_id: string;
  title: string;
  expiration_date: string | null;
}

// --- Main handler ---

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405, headers: CORS });
  }

  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) {
    return new Response("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//MAGE ID//Error//EN\r\nEND:VCALENDAR\r\n", {
      status: 400, headers: icsHeaders(),
    });
  }

  try {
    // 1. Project lookup by calendar_token. The schema persists schedule
    //    as JSON on the projects row, so one fetch nets us the tasks.
    const projects = await sbGet<ProjectRow[]>(`projects?calendar_token=eq.${encodeURIComponent(token)}&select=id,name,calendar_token,schedule,created_at&limit=1`);
    if (projects.length === 0) {
      return new Response("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//MAGE ID//Error//EN\r\nEND:VCALENDAR\r\n", {
        status: 404, headers: icsHeaders(),
      });
    }
    const project = projects[0];

    // 2. Invoices for the project (only unpaid ones surface as events).
    const invoices = await sbGet<InvoiceRow[]>(`invoices?project_id=eq.${project.id}&select=id,project_id,number,due_date,status,total_due,amount_paid`);

    // 3. Warranties (optional table; tolerate 404 silently if not yet
    //    deployed in this env).
    let warranties: WarrantyRow[] = [];
    try {
      warranties = await sbGet<WarrantyRow[]>(`warranties?project_id=eq.${project.id}&select=id,project_id,title,expiration_date`);
    } catch { /* warranties table optional */ }

    // 4. Build events.
    const events: { uid: string; startDate: string; endDate: string; summary: string; description?: string; categories?: string[] }[] = [];

    const sched = project.schedule;
    const startBase = sched?.startDate || project.created_at?.slice(0, 10);
    if (sched?.tasks?.length && startBase) {
      const baseMs = Date.parse(startBase + "T00:00:00Z");
      if (Number.isFinite(baseMs)) {
        for (const t of sched.tasks) {
          if (!t.title) continue;
          const start = Math.max(1, t.startDay ?? 1);
          const dur = Math.max(1, t.durationDays ?? 1);
          const startIso = new Date(baseMs + (start - 1) * 86_400_000).toISOString().slice(0, 10);
          const endIso = new Date(baseMs + (start - 1 + dur - 1) * 86_400_000).toISOString().slice(0, 10);
          events.push({
            uid: `mageid-task-${t.id}@mageid.app`,
            startDate: startIso,
            endDate: endIso,
            summary: t.isMilestone ? `📍 ${t.title}` : t.title,
            description: t.phase ? `Phase: ${t.phase}` : undefined,
            categories: t.isMilestone ? ["Milestone"] : ["Task", t.phase ?? "General"],
          });
        }
      }
    }

    for (const inv of invoices) {
      if (inv.status === "paid") continue;
      if (!inv.due_date) continue;
      const iso = inv.due_date.slice(0, 10);
      const remaining = Math.max(0, (inv.total_due ?? 0) - (inv.amount_paid ?? 0));
      events.push({
        uid: `mageid-invoice-${inv.id}@mageid.app`,
        startDate: iso,
        endDate: iso,
        summary: `Invoice #${inv.number} due${remaining > 0 ? ` — ${fmtMoney(remaining)}` : ""}`,
        categories: ["Invoice"],
      });
    }

    for (const w of warranties) {
      if (!w.expiration_date) continue;
      const iso = w.expiration_date.slice(0, 10);
      events.push({
        uid: `mageid-warranty-${w.id}@mageid.app`,
        startDate: iso,
        endDate: iso,
        summary: `⚠️ Warranty ends: ${w.title}`,
        categories: ["Warranty"],
      });
    }

    const ics = buildIcs(project.name, events);
    return new Response(ics, { status: 200, headers: icsHeaders() });
  } catch (err) {
    console.error("[ics-feed] error", err);
    return new Response(
      `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//MAGE ID//Error//EN\r\nEND:VCALENDAR\r\n`,
      { status: 500, headers: icsHeaders() },
    );
  }
});

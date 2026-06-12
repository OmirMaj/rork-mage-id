// mcp — a Model Context Protocol server that exposes a user's MAGE ID data to
// Claude (or any MCP client) READ-ONLY. Deployed with verify_jwt:false because
// MCP clients authenticate with a MAGE personal access token, not a Supabase
// JWT — the gateway must let the request through so this function can do its
// own auth against the `mcp_tokens` table.
//
// Transport: Streamable HTTP. Clients POST JSON-RPC 2.0 requests and we reply
// with a single application/json response (no SSE streaming needed for these
// fast, read-only tools). We implement: initialize, tools/list, tools/call,
// ping, and swallow notifications/*.
//
// Auth: the token may arrive as `Authorization: Bearer <token>`, as a trailing
// path segment (/mcp/<token>), or as `?token=<token>`. Path/query support lets
// clients that only take a URL (e.g. claude.ai custom connectors) work without
// custom headers. We SHA-256 the presented token and match it against a live
// (non-revoked) row, then scope every query to that row's user_id via the
// service role.
//
// Read-only by design (v1). No tool mutates data; the worst a leaked token can
// do is read the owner's project data, and it's revocable instantly from
// Settings -> Connect Claude.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { hashMcpToken, TOKEN_PREFIX } from "../_shared/mcpToken.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";
const SERVER_VERSION = "1.0.0";
const DEFAULT_PROTOCOL = "2024-11-05";

const H: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, mcp-protocol-version, mcp-session-id",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Expose-Headers": "mcp-session-id",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...H, "Content-Type": "application/json" } });
}
function rpcResult(id: unknown, result: unknown) {
  return json({ jsonrpc: "2.0", id: id ?? null, result });
}
function rpcError(id: unknown, code: number, message: string, status = 200) {
  return json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, status);
}

// ── service-role REST helpers (read only) ───────────────────────────────────
async function rest<T = Record<string, unknown>>(pathAndQuery: string): Promise<T[]> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    });
    if (!r.ok) return [];
    return (await r.json()) as T[];
  } catch {
    return [];
  }
}

function extractToken(req: Request, url: URL): string | null {
  const auth = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  const bearer = auth.replace(/^Bearer\s+/i, "").trim();
  if (bearer.startsWith(TOKEN_PREFIX)) return bearer;
  const q = url.searchParams.get("token");
  if (q && q.startsWith(TOKEN_PREFIX)) return q;
  // trailing path segment: /functions/v1/mcp/<token>
  const seg = url.pathname.split("/").filter(Boolean).pop() || "";
  if (seg.startsWith(TOKEN_PREFIX)) return seg;
  return null;
}

async function userForToken(raw: string): Promise<string | null> {
  const hash = await hashMcpToken(raw);
  // Reject revoked AND expired tokens. expires_at is set with a 1-year default
  // at mint (migration mcp_token_expiry); a leaked token can no longer be used
  // forever. Legacy rows with a NULL expires_at are grandfathered (never expire).
  const nowIso = new Date().toISOString();
  const rows = await rest<{ id: string; user_id: string }>(
    `mcp_tokens?token_hash=eq.${hash}&revoked_at=is.null&or=(expires_at.is.null,expires_at.gt.${nowIso})&select=id,user_id&limit=1`,
  );
  if (!rows.length) return null;
  // Touch last_used_at (fire-and-forget; never blocks the response).
  fetch(`${SUPABASE_URL}/rest/v1/mcp_tokens?id=eq.${rows[0].id}`, {
    method: "PATCH",
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ last_used_at: new Date().toISOString() }),
  }).catch(() => {});
  return rows[0].user_id;
}

// ── formatting helpers ──────────────────────────────────────────────────────
function money(n: number): string {
  return "$" + (Math.round(n || 0)).toLocaleString("en-US");
}
function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
}
function projectValue(p: Record<string, unknown>): number {
  const le = (p.linked_estimate as Record<string, unknown>) || {};
  const e = (p.estimate as Record<string, unknown>) || {};
  return num(le.grandTotal) || num(e.grandTotal) || num(e.totalCost) || 0;
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function text(s: string) {
  return { content: [{ type: "text", text: s }] };
}

// ── tools ────────────────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: "financial_summary",
    description:
      "Money roll-up across all of the contractor's projects: total invoiced, total paid, outstanding (unpaid) balance, and how much of that is overdue. Use for questions like 'how much money is owed to me?' or 'what's overdue?'.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_projects",
    description:
      "List the contractor's projects with status, type, location, and contract/estimate value. Use for 'what projects do I have?', 'which jobs are active?', 'which project is biggest?'.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Optional filter, e.g. 'in_progress', 'draft', 'completed'." },
        limit: { type: "number", description: "Max projects to return (default 50)." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_open_rfis",
    description:
      "List open RFIs (requests for information) across projects, with subject, priority, who it's assigned to, and the date a response is required. Use for 'what RFIs are open?', 'what's waiting on the architect?'.",
    inputSchema: { type: "object", properties: { limit: { type: "number" } }, additionalProperties: false },
  },
  {
    name: "list_change_orders",
    description:
      "List change orders with their amount, resulting contract total, and status (draft/sent/approved). Use for 'what change orders are pending approval?', 'how much have change orders added?'.",
    inputSchema: {
      type: "object",
      properties: { status: { type: "string", description: "Optional status filter (e.g. 'draft','approved')." } },
      additionalProperties: false,
    },
  },
  {
    name: "list_overdue",
    description:
      "Everything past due right now: overdue (unpaid, past due_date) invoices and open RFIs past their required-response date. Use for 'what's overdue?', 'what needs attention today?'.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_subcontractors",
    description:
      "List subcontractors with trade and compliance info (COI expiry, license expiry, W-9 on file). Use for 'which subs have expiring insurance?', 'who's my electrician?'.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

async function projectNameMap(userId: string): Promise<Record<string, string>> {
  const rows = await rest<{ id: string; name: string }>(`projects?user_id=eq.${userId}&select=id,name`);
  const m: Record<string, string> = {};
  for (const r of rows) m[r.id] = r.name;
  return m;
}

async function runTool(name: string, args: Record<string, unknown>, userId: string): Promise<{ content: { type: string; text: string }[]; isError?: boolean }> {
  switch (name) {
    case "financial_summary": {
      const invoices = await rest<Record<string, unknown>>(
        `invoices?user_id=eq.${userId}&select=total_due,amount_paid,status,due_date`,
      );
      let invoiced = 0, paid = 0, outstanding = 0, overdue = 0, overdueCount = 0;
      const t = today();
      for (const inv of invoices) {
        const due = num(inv.total_due);
        const pd = num(inv.amount_paid);
        const bal = Math.max(0, due - pd);
        invoiced += due;
        paid += pd;
        if (String(inv.status) !== "paid" && bal > 0) {
          outstanding += bal;
          if (inv.due_date && String(inv.due_date) < t) { overdue += bal; overdueCount++; }
        }
      }
      const projects = await rest<Record<string, unknown>>(`projects?user_id=eq.${userId}&select=id`);
      const lines = [
        `Across ${projects.length} project(s) and ${invoices.length} invoice(s):`,
        `• Total invoiced: ${money(invoiced)}`,
        `• Total collected: ${money(paid)}`,
        `• Outstanding (unpaid): ${money(outstanding)}`,
        `• Overdue: ${money(overdue)} across ${overdueCount} invoice(s)`,
      ];
      return text(lines.join("\n"));
    }

    case "list_projects": {
      const limit = Math.min(200, Math.max(1, num(args.limit) || 50));
      let q = `projects?user_id=eq.${userId}&select=id,name,type,status,location,square_footage,estimate,linked_estimate&order=created_at.desc&limit=${limit}`;
      if (args.status) q += `&status=eq.${encodeURIComponent(String(args.status))}`;
      const rows = await rest<Record<string, unknown>>(q);
      if (!rows.length) return text("No projects found.");
      const lines = rows.map((p) => {
        const val = projectValue(p);
        const loc = p.location ? ` — ${p.location}` : "";
        const valStr = val > 0 ? ` (${money(val)})` : "";
        return `• ${p.name} [${p.status}] ${p.type}${loc}${valStr}`;
      });
      return text(`${rows.length} project(s):\n${lines.join("\n")}`);
    }

    case "list_open_rfis": {
      const limit = Math.min(200, Math.max(1, num(args.limit) || 100));
      const rows = await rest<Record<string, unknown>>(
        `rfis?user_id=eq.${userId}&status=eq.open&select=number,subject,priority,assigned_to,date_required,project_id&order=created_at.desc&limit=${limit}`,
      );
      if (!rows.length) return text("No open RFIs. 🎉");
      const names = await projectNameMap(userId);
      const lines = rows.map((r) => {
        const proj = names[String(r.project_id)] || "—";
        const pr = r.priority ? ` (${r.priority})` : "";
        const need = r.date_required ? ` · needs response by ${r.date_required}` : "";
        const who = r.assigned_to ? ` · assigned to ${r.assigned_to}` : "";
        return `• RFI #${r.number} — ${r.subject}${pr} [${proj}]${who}${need}`;
      });
      return text(`${rows.length} open RFI(s):\n${lines.join("\n")}`);
    }

    case "list_change_orders": {
      let q = `change_orders?user_id=eq.${userId}&select=number,description,change_amount,new_contract_total,status,project_id&order=created_at.desc&limit=200`;
      if (args.status) q += `&status=eq.${encodeURIComponent(String(args.status))}`;
      const rows = await rest<Record<string, unknown>>(q);
      if (!rows.length) return text("No change orders found.");
      const names = await projectNameMap(userId);
      const total = rows.reduce((s, r) => s + num(r.change_amount), 0);
      const lines = rows.map((r) => {
        const proj = names[String(r.project_id)] || "—";
        return `• CO #${r.number} [${r.status}] ${money(num(r.change_amount))} — ${r.description || "(no description)"} [${proj}]`;
      });
      return text(`${rows.length} change order(s), net ${money(total)}:\n${lines.join("\n")}`);
    }

    case "list_overdue": {
      const t = today();
      const invoices = await rest<Record<string, unknown>>(
        `invoices?user_id=eq.${userId}&select=number,total_due,amount_paid,status,due_date,project_id&order=due_date.asc`,
      );
      const names = await projectNameMap(userId);
      const overdueInv = invoices.filter((inv) => {
        const bal = num(inv.total_due) - num(inv.amount_paid);
        return String(inv.status) !== "paid" && bal > 0 && inv.due_date && String(inv.due_date) < t;
      });
      const rfis = await rest<Record<string, unknown>>(
        `rfis?user_id=eq.${userId}&status=eq.open&select=number,subject,date_required,project_id&order=date_required.asc`,
      );
      const overdueRfi = rfis.filter((r) => r.date_required && String(r.date_required) < t);
      const out: string[] = [];
      if (overdueInv.length) {
        out.push(`Overdue invoices (${overdueInv.length}):`);
        for (const inv of overdueInv) {
          const bal = num(inv.total_due) - num(inv.amount_paid);
          out.push(`• Invoice #${inv.number} — ${money(bal)} due ${inv.due_date} [${names[String(inv.project_id)] || "—"}]`);
        }
      }
      if (overdueRfi.length) {
        out.push(`${out.length ? "\n" : ""}Overdue RFIs (${overdueRfi.length}):`);
        for (const r of overdueRfi) {
          out.push(`• RFI #${r.number} — ${r.subject} (needed ${r.date_required}) [${names[String(r.project_id)] || "—"}]`);
        }
      }
      return text(out.length ? out.join("\n") : "Nothing overdue right now. ✅");
    }

    case "list_subcontractors": {
      const rows = await rest<Record<string, unknown>>(
        `subcontractors?user_id=eq.${userId}&select=company_name,trade,phone,email,coi_expiry,license_expiry,w9_on_file&order=company_name.asc`,
      );
      if (!rows.length) return text("No subcontractors on file.");
      const t = today();
      const lines = rows.map((s) => {
        const flags: string[] = [];
        if (s.coi_expiry && String(s.coi_expiry) < t) flags.push("COI EXPIRED");
        if (s.license_expiry && String(s.license_expiry) < t) flags.push("LICENSE EXPIRED");
        if (!s.w9_on_file) flags.push("no W-9");
        const flagStr = flags.length ? ` ⚠️ ${flags.join(", ")}` : "";
        return `• ${s.company_name} — ${s.trade || "trade n/a"}${flagStr}`;
      });
      return text(`${rows.length} subcontractor(s):\n${lines.join("\n")}`);
    }

    default:
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: H });

  const url = new URL(req.url);

  // Friendly GET for humans hitting the URL in a browser (and a cheap health
  // probe). Does not leak data; MCP traffic is all POST.
  if (req.method === "GET") {
    return json({ name: "MAGE ID MCP", status: "ok", transport: "streamable-http", note: "POST JSON-RPC 2.0 with a MAGE personal access token." });
  }
  if (req.method !== "POST") return rpcError(null, -32600, "Method not allowed", 405);

  const token = extractToken(req, url);
  if (!token) return rpcError(null, -32001, "Missing MAGE access token. Provide it as a Bearer header, ?token=, or trailing path segment.", 401);
  const userId = await userForToken(token);
  if (!userId) return rpcError(null, -32001, "Invalid or revoked MAGE access token.", 401);

  let msg: { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> };
  try {
    msg = await req.json();
  } catch {
    return rpcError(null, -32700, "Parse error");
  }

  const { id, method, params } = msg;

  // Notifications (no id, method starts with "notifications/") get an empty 202.
  if (method && method.startsWith("notifications/")) {
    return new Response(null, { status: 202, headers: H });
  }

  switch (method) {
    case "initialize": {
      const clientProto = (params?.protocolVersion as string) || DEFAULT_PROTOCOL;
      return rpcResult(id, {
        protocolVersion: clientProto,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "MAGE ID", version: SERVER_VERSION },
        instructions:
          "Read-only access to the contractor's MAGE ID construction data: projects, invoices/money, RFIs, change orders, and subcontractors. Use the tools to answer questions about their business; you cannot modify anything.",
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: TOOLS });
    case "tools/call": {
      const name = String(params?.name || "");
      const args = (params?.arguments as Record<string, unknown>) || {};
      if (!TOOLS.some((t) => t.name === name)) {
        return rpcError(id, -32602, `Unknown tool: ${name}`);
      }
      try {
        const result = await runTool(name, args, userId);
        return rpcResult(id, result);
      } catch (e) {
        return rpcResult(id, { content: [{ type: "text", text: `Tool error: ${e instanceof Error ? e.message : "unknown"}` }], isError: true });
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
});

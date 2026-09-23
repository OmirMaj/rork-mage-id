// construction-answer/citationFilter.ts — which records the answer actually used.
//
// PURE: no Deno globals, no imports, so index.ts bundles it on deploy and a Bun
// validator (scripts/validate-w5-ai-limits-construction.ts) exercises it directly.
//
// WHY (audit #120). "Sources" used to be everything the engine LOOKED AT:
// every open RFI list_rfis returned, up to 60 cost-rate categories, every web
// search result, and — when the plan keyword search found nothing — the six
// most recently updated plan sheets, each rendered as a "Sheet X" chip. An
// answer that rested on none of them read as plan-grounded. Now:
//
//   plan  — only real keyword matches are ever collected (the nearest-sheets
//           fallback is never cited), and one is a Source only when the answer
//           names the sheet.
//   rfi   — a Source only when the answer says "RFI #12" / "RFI 12".
//   rate  — a Source only when the answer mentions that rate's category.
//   web   — the URLs the model's final text blocks cite (Anthropic attaches
//           web_search_result_location citations to the text that uses them);
//           a search result no text block cites was only consulted.
//
// Everything collected but not used goes to `consulted`, which the client
// shows muted as "Also checked" — never under Sources.

export interface FilterCitation {
  label: string;
  kind: "web" | "plan" | "rfi" | "rate";
  url?: string;
  /** plan: sheet id (or number); rfi: the RFI number; rate: the category. */
  ref?: string;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function mentionsRfi(answer: string, n: string): boolean {
  if (!n) return false;
  return new RegExp(`\\bRFI\\s*(?:#|no\\.?|number)?\\s*${escapeRe(n)}\\b`, "i").test(answer);
}

/**
 * "Sheet A3" → mentioned as "A3" (word-bounded) anywhere in the answer.
 * A purely numeric sheet ("Sheet 1", "Sheet 12") must be named as a sheet or
 * page: a bare "1" or "12" in "1 inch cover" / "12 in footing" is a quantity,
 * and matching it would put the sheet back under Sources for an answer that
 * never used it (audit #120).
 */
function mentionsSheet(answer: string, label: string): boolean {
  const sheet = label.replace(/^sheet\s+/i, "").trim();
  if (!sheet) return false;
  if (/^\d+$/.test(sheet)) {
    return new RegExp(`\\b(?:sheet|page|pg\\.?)\\s*#?\\s*${escapeRe(sheet)}\\b`, "i").test(answer);
  }
  return new RegExp(`(^|[^A-Za-z0-9])${escapeRe(sheet)}([^A-Za-z0-9]|$)`, "i").test(answer);
}

function mentionsCategory(answer: string, category: string): boolean {
  const c = norm(category);
  if (!c) return false;
  const a = norm(answer);
  if (a.includes(c)) return true;
  // "Concrete - Footings" → every significant word of the category, each
  // allowed a plural/singular slip ("footing"). EVERY, not any: a shared word
  // like "labor" must not cite every labor rate the tool returned.
  const words = c.split(/[^a-z0-9]+/).filter(w => w.length >= 4);
  if (words.length === 0) return false;
  return words.every(w => {
    const stem = w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w;
    return new RegExp(`\\b${escapeRe(stem)}s?\\b`).test(a);
  });
}

function key(c: FilterCitation): string {
  return `${c.kind}|${c.label}|${c.url ?? ""}|${c.ref ?? ""}`;
}

/**
 * Split everything collected during the run into what the answer used and
 * what it only consulted.
 *
 * @param answer        the final answer text (footer already stripped)
 * @param collected     every citation gathered from tool results
 * @param citedWeb      web citations lifted from the final text blocks'
 *                      own `citations` (url + title)
 */
export function splitCitations(
  answer: string,
  collected: FilterCitation[],
  citedWeb: FilterCitation[],
): { citations: FilterCitation[]; consulted: FilterCitation[] } {
  const citations: FilterCitation[] = [];
  const consulted: FilterCitation[] = [];
  const seen = new Set<string>();
  const push = (list: FilterCitation[], c: FilterCitation) => {
    const k = key(c);
    if (seen.has(k)) return;
    seen.add(k);
    list.push(c);
  };

  const citedUrls = new Set(citedWeb.map(c => c.url).filter((u): u is string => !!u));
  for (const c of citedWeb) {
    if (c.url) push(citations, { label: c.label, kind: "web", url: c.url });
  }

  for (const c of collected) {
    let used = false;
    switch (c.kind) {
      case "web": used = !!c.url && citedUrls.has(c.url); break;
      case "rfi": used = mentionsRfi(answer, c.ref ?? c.label.replace(/^RFI\s*#?/i, "")); break;
      case "plan": used = mentionsSheet(answer, c.label); break;
      case "rate": used = mentionsCategory(answer, c.ref ?? c.label.replace(/\s+rate$/i, "")); break;
    }
    if (used) {
      // A web result already cited through its text block keeps that label.
      if (c.kind === "web") continue;
      push(citations, c);
    }
  }
  // Second pass so anything used above can't also appear as consulted.
  for (const c of collected) {
    if (c.kind === "web" && c.url && citedUrls.has(c.url)) continue;
    push(consulted, c);
  }
  return { citations, consulted };
}

/**
 * Web citations the final message's text blocks carry. Anthropic's web_search
 * attaches `citations: [{ type: 'web_search_result_location', url, title, … }]`
 * to each text block that uses a result.
 */
export function webCitationsFromTextBlocks(content: unknown): FilterCitation[] {
  const out: FilterCitation[] = [];
  if (!Array.isArray(content)) return out;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as { type?: unknown; citations?: unknown };
    if (b.type !== "text" || !Array.isArray(b.citations)) continue;
    for (const cit of b.citations) {
      if (!cit || typeof cit !== "object") continue;
      const c = cit as { type?: unknown; url?: unknown; title?: unknown };
      if (c.type !== "web_search_result_location" || typeof c.url !== "string" || !c.url) continue;
      const label = String(typeof c.title === "string" && c.title ? c.title : c.url).slice(0, 160);
      out.push({ label, kind: "web", url: c.url });
    }
  }
  return out;
}

/**
 * The plan search's keyword filter: the whole phrase first, then any of its
 * significant words (PostgREST `or=(content.ilike.*a*,content.ilike.*b*)`), so
 * "how deep do my footings need to be" still finds the sheet that says
 * "footing". Returns the terms; index.ts builds the query.
 */
const STOP = new Set([
  "the", "and", "for", "with", "what", "whats", "does", "need", "needs", "how", "deep",
  "this", "that", "my", "our", "your", "are", "is", "do", "be", "to", "of", "in", "on",
  "at", "a", "an", "it", "its", "from", "about", "have", "has", "can", "should", "will",
  "say", "says", "show", "shows", "plan", "plans", "sheet", "sheets", "detail", "details",
]);

export function planSearchTerms(query: string): string[] {
  const words = (query.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter(w => w.length >= 3 && !STOP.has(w));
  const out: string[] = [];
  for (const w of words) {
    // "footings" also finds "footing".
    const stem = w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w;
    if (!out.includes(stem)) out.push(stem);
    if (out.length >= 6) break;
  }
  return out;
}

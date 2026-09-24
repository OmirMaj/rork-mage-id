// supabase/functions/_shared/sampleFence.ts — the sample-project fence for the
// QuickBooks paths (qbo-sync, qbo-reconciler, qbo-connect-status).
//
// A sample job ("Sample — Sarah's Place") is real synced data so the tutorials
// run the real save paths, and it must never reach anyone's books. The app
// already refuses to push a sample (utils/sampleGuard + utils/qboSync), but the
// SERVER pushes on its own: every non-draft invoice write is marked
// qbo_sync_status 'pending' (utils/invoiceWrites), and qbo-reconciler's step 1
// pushes every owed row for every connected user every 30 minutes. The
// invoice-to-self tutorial's "Send to me" makes invoice #3 non-draft — without
// this fence its $63,360 lands in the GC's real QuickBooks on the next sweep.
//
// Why a query exclusion and not a terminal status: invoices_qbo_sync_status_check
// (migration 20260526120100) allows only pending / synced / error, and wave A
// ships no migration. 'synced' would be a lie and 'error' would sit in qbo-setup's
// Errors count forever. So the sweep and the Pending count leave sample rows out
// by project, and a sample row is simply never touched.
//
// create-payment-link and invoice-dunning restate the same block inline (they
// predate this file); scripts/validate-sample-guard.ts checks all three answer
// exactly like the app's rule and EXECUTES this block against a fake database.

// >>> sample-project-fence (the app's utils/sampleGuard + utils/projectCap
// rule, restated: a Deno function cannot import '@/utils'. Byte-exact
// 'Sample', space, EM DASH U+2014, space — the same prefix the free-cap
// trigger exempts; scripts/validate-sample-guard.ts pins the bytes.)
const SAMPLE_PROJECT_PREFIX = "Sample — ";
function isSampleProjectName(name: string | null | undefined): boolean {
  return typeof name === "string" && name.startsWith(SAMPLE_PROJECT_PREFIX);
}

// PostgREST `like` pattern for "his sample projects". The prefix has no `_`
// or `%` of its own, so nothing in it needs escaping.
const SAMPLE_PROJECT_NAME_LIKE = SAMPLE_PROJECT_PREFIX + "%";

/**
 * A PostgREST `or=` filter body keeping invoices that are NOT on one of these
 * projects. `project_id IS NULL` is kept explicitly: in SQL `NULL NOT IN (…)`
 * is NULL, which would silently drop every project-less invoice from the
 * sweep. Each id is double-quoted and escaped, so an id can never splice
 * PostgREST syntax into the query. With no sample projects it is a tautology,
 * so a caller can append it unconditionally.
 */
function notOnSampleProjectsFilter(sampleProjectIds: readonly (string | null | undefined)[]): string {
  const ids = Array.from(new Set(sampleProjectIds.filter((id): id is string => typeof id === "string" && id.length > 0)));
  if (ids.length === 0) return "project_id.is.null,project_id.not.is.null";
  const list = ids.map((id) => '"' + id.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"').join(",");
  return "project_id.is.null,project_id.not.in.(" + list + ")";
}

/** The minimal slice of the service-role client the fence reads with. */
type FenceRead = { data: unknown; error: { message: string } | null };
interface FenceQuery {
  eq(col: string, val: string): FenceQuery;
  like(col: string, pattern: string): FenceQuery;
  maybeSingle(): PromiseLike<FenceRead>;
  then: PromiseLike<FenceRead>["then"];
}
interface FenceClient {
  from(table: string): { select(cols: string): FenceQuery };
}

/**
 * The ids of this user's sample projects. Throws on a failed read: the
 * reconciler must not push blind when it cannot tell which rows are samples
 * (its per-user try/catch records the error and the next run retries).
 */
async function sampleProjectIdsFor(s: FenceClient, userId: string): Promise<string[]> {
  const res = await s.from("projects").select("id,name").eq("user_id", userId).like("name", SAMPLE_PROJECT_NAME_LIKE);
  if (res.error) throw new Error("sample project read failed: " + res.error.message);
  const rows = (Array.isArray(res.data) ? res.data : []) as { id?: unknown; name?: string | null }[];
  // The LIKE narrows the read; the prefix check is ours, byte for byte, so
  // the set is exactly what the app and the other fences call a sample.
  return rows
    .filter((r) => isSampleProjectName(r.name))
    .map((r) => (typeof r.id === "string" ? r.id : ""))
    .filter((id) => id.length > 0);
}

/**
 * qbo-sync's verdict for one object it was asked to push:
 *   'sample'  — it belongs to a sample project: push nothing;
 *   'real'    — push as before;
 *   'unknown' — the row could not be read: refuse this call (fail closed). An
 *               invoice stays 'pending', so the reconciler retries it — and
 *               the reconciler fences by project too.
 * Kinds that carry no project ('item', 'connection', 'reversal') are 'real'.
 * 'payment' ids are `<invoiceId>::<paymentId>`.
 */
async function qboObjectOnSample(
  s: FenceClient,
  kind: string,
  objectId: string,
  userId: string,
): Promise<"sample" | "real" | "unknown"> {
  let projectId: string | null = null;
  if (kind === "project") {
    projectId = objectId;
  } else if (kind === "invoice" || kind === "payment") {
    const invoiceId = kind === "payment" ? String(objectId).split("::")[0] : objectId;
    if (!invoiceId) return "unknown";
    const inv = await s.from("invoices").select("project_id").eq("id", invoiceId).eq("user_id", userId).maybeSingle();
    if (inv.error || !inv.data) return "unknown";
    const pid = (inv.data as { project_id?: unknown }).project_id;
    if (pid == null) return "real";
    if (typeof pid !== "string") return "unknown";
    projectId = pid;
  } else {
    return "real";
  }
  // By id alone (service role): an invoice a collaborator wrote sits on the
  // GC's project, and the question is only whether THAT project is a sample.
  const proj = await s.from("projects").select("name").eq("id", projectId).maybeSingle();
  if (proj.error || !proj.data) return "unknown";
  return isSampleProjectName((proj.data as { name?: string | null }).name) ? "sample" : "real";
}
// <<< sample-project-fence

export {
  isSampleProjectName,
  notOnSampleProjectsFilter,
  qboObjectOnSample,
  SAMPLE_PROJECT_NAME_LIKE,
  SAMPLE_PROJECT_PREFIX,
  sampleProjectIdsFor,
};
export type { FenceClient };
